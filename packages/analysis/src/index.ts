import path from "node:path";
import {
  fetchPullRequestHead,
  getPullRequestFiles,
  getPullRequestMeta,
  parseGitHubUrl,
  toGitImpactPath,
  cloneOrUpdateRepository,
} from "@gitimpact/git";
import { parseRepository } from "@gitimpact/parser";
import { GraphStore, buildGraph } from "@gitimpact/graph";
import {
  buildImpactReport,
  buildPullRequestOverview,
  classifyDiffHunk,
  explainImpactPath,
  extractChangedSymbols,
  mapChangesToSymbolNodes,
} from "@gitimpact/impact-engine";
import {
  detectFrameworkNames,
  extractAllRoutes,
} from "@gitimpact/framework-detector";
import {
  isDatabaseConfigured,
  loadAnalysis as loadAnalysisFromDb,
  saveAnalysis as saveAnalysisToDb,
} from "@gitimpact/db";
import type {
  AnalysisSummary,
  ChangeRecord,
  ChecksReport,
  DependencyGraph,
  DetectedRoute,
  GraphNode,
  ImpactReport,
  ParsedFile,
  PullRequestImpactOverview,
  PullRequestMeta,
  RepositoryIntelligence,
  RepositoryMeta,
} from "@gitimpact/shared";
import {
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
  selectWhyPath,
} from "./pr-comment.js";
import { buildRepositoryIntelligence } from "./intelligence.js";
import {
  buildArchitectureExperience,
  collectArchitectureArtifacts,
} from "./architecture/index.js";
import { classifyAnalysisError } from "./access-errors.js";
import { buildChecksReport, buildInfrastructureNodes } from "./checks/index.js";

export interface StoredAnalysis {
  id: string;
  createdAt: string;
  repository: RepositoryMeta;
  summary: AnalysisSummary;
  graph: DependencyGraph;
  routePath: string;
  pullRequest?: PullRequestMeta;
  changes?: ChangeRecord[];
  impact?: ImpactReport;
  prOverview?: PullRequestImpactOverview;
  routes?: DetectedRoute[];
  intelligence?: RepositoryIntelligence;
  checks?: ChecksReport;
  persisted?: boolean;
}

const globalStore = globalThis as typeof globalThis & {
  __gitimpactAnalyses?: Map<string, StoredAnalysis>;
};

function getMemoryStore(): Map<string, StoredAnalysis> {
  if (!globalStore.__gitimpactAnalyses) {
    globalStore.__gitimpactAnalyses = new Map();
  }
  return globalStore.__gitimpactAnalyses;
}

function analysisId(owner: string, repo: string, pr?: number): string {
  return pr ? `${owner}/${repo}/pull/${pr}` : `${owner}/${repo}`;
}

function defaultCacheDir(): string {
  // Prefer monorepo root .repos over apps/web/.repos when running Next.js
  const fromEnv = process.env.GITIMPACT_CACHE_DIR;
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}apps${path.sep}web`)) {
    return path.resolve(cwd, "../../.repos");
  }
  return path.join(cwd, ".repos");
}

async function persist(analysis: StoredAnalysis): Promise<StoredAnalysis> {
  getMemoryStore().set(analysis.id, analysis);
  if (!isDatabaseConfigured()) {
    return { ...analysis, persisted: false };
  }
  try {
    await saveAnalysisToDb(analysis);
    return { ...analysis, persisted: true };
  } catch (error) {
    console.error("[gitimpact] failed to persist analysis", error);
    return { ...analysis, persisted: false };
  }
}

function buildSummary(
  files: ParsedFile[],
  graph: DependencyGraph,
  store: GraphStore,
  languages: AnalysisSummary["languages"],
  frameworks: string[],
  routeCount: number,
): AnalysisSummary {
  return {
    files: files.length,
    functions: files.reduce((sum, f) => sum + f.functions.length, 0),
    classes: files.reduce((sum, f) => sum + f.classes.length, 0),
    dependencies: graph.edges.filter((e) => e.type === "IMPORTS").length,
    tests: files.filter((f) => f.isTest).length,
    apiRoutes: Math.max(
      routeCount,
      store.getNodes().filter((n) => n.type === "API_ROUTE").length,
    ),
    languages,
    frameworks,
  };
}

function buildGraphFromParse(parsed: Awaited<ReturnType<typeof parseRepository>>): {
  graph: DependencyGraph;
  store: GraphStore;
  routes: DetectedRoute[];
  frameworks: string[];
} {
  const detectedFrameworks = detectFrameworkNames(parsed.files, parsed.packageDeps);
  const frameworks = [...new Set([...parsed.frameworks, ...detectedFrameworks])];
  const routes = extractAllRoutes(
    parsed.files,
    parsed.contentsByPath,
    parsed.packageDeps,
  );
  const graph = buildGraph(parsed.files, routes);
  const store = new GraphStore(graph);
  return { graph, store, routes, frameworks };
}

async function finalizeChecks(
  graph: DependencyGraph,
  input: {
    files: ParsedFile[];
    contentsByPath: Map<string, string>;
    packageDeps?: Record<string, string>;
    clonePath?: string;
    allRelativeFiles?: string[];
    infraSignals?: RepositoryIntelligence["infraSignals"];
    changes?: ChangeRecord[];
    impact?: ImpactReport;
    prOverview?: PullRequestImpactOverview;
  },
): Promise<{ graph: DependencyGraph; checks: ChecksReport }> {
  const checks = await buildChecksReport({
    files: input.files,
    contentsByPath: input.contentsByPath,
    graph,
    packageDeps: input.packageDeps,
    clonePath: input.clonePath,
    allRelativeFiles: input.allRelativeFiles,
    infraSignals: input.infraSignals,
    changes: input.changes,
    impact: input.impact,
    prOverview: input.prOverview,
  });

  const infra = buildInfrastructureNodes({
    infraSignals: input.infraSignals ?? [],
    findings: checks.findings,
  });
  if (infra.nodes.length > 0) {
    return {
      graph: {
        nodes: [...graph.nodes, ...infra.nodes],
        edges: [...graph.edges, ...infra.edges],
      },
      checks,
    };
  }
  return { graph, checks };
}

function buildChangeRecords(
  prFiles: Array<{ filename: string; status?: string; patch?: string }>,
): ChangeRecord[] {
  return prFiles.map((file) => {
    const symbols = extractChangedSymbols(file.patch);
    return {
      filePath: file.filename,
      changeType: classifyDiffHunk(file.patch, file.status),
      symbolName: symbols[0],
      symbols,
      status: file.status,
      patch: file.patch,
    };
  });
}

function resolveChangedNodes(
  store: GraphStore,
  changes: ChangeRecord[],
  contentsByPath?: Map<string, string>,
): GraphNode[] {
  return mapChangesToSymbolNodes(store, changes, contentsByPath);
}

export async function analyzeRepositoryUrl(
  inputUrl: string,
  options?: { depth?: number; cacheDir?: string; maxFiles?: number },
): Promise<StoredAnalysis> {
  const parsedUrl = parseGitHubUrl(inputUrl);
  const cacheDir = options?.cacheDir ?? defaultCacheDir();
  const depth = options?.depth ?? 3;

  if (parsedUrl.kind === "pull_request" && parsedUrl.prNumber) {
    return analyzePullRequest(parsedUrl.owner, parsedUrl.repo, parsedUrl.prNumber, {
      depth,
      cacheDir,
      maxFiles: options?.maxFiles,
    });
  }

  const repository = await cloneOrUpdateRepository({
    owner: parsedUrl.owner,
    repo: parsedUrl.repo,
    cacheDir,
    branch: parsedUrl.branch,
  });

  if (!repository.clonePath) {
    throw new Error("Repository clone path missing");
  }

  const parsed = await parseRepository(repository.clonePath, {
    maxFiles: options?.maxFiles ?? 1500,
  });
  const { graph, store, routes, frameworks } = buildGraphFromParse(parsed);

  const intelligence = await buildRepositoryIntelligence({
    owner: parsedUrl.owner,
    repo: parsedUrl.repo,
    clonePath: repository.clonePath,
    files: parsed.files,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    routes,
    frameworks,
    languages: parsed.languages,
    packageDeps: parsed.packageDeps,
    analysisHealth: parsed.analysisHealth,
    allRelativeFiles: parsed.allRelativeFiles,
  });

  // Attach cached PR impact metrics when available
  for (const pr of intelligence.openPullRequests) {
    const cached = getMemoryStore().get(analysisId(parsedUrl.owner, parsedUrl.repo, pr.number));
    if (cached?.prOverview) {
      pr.complexityScore = cached.prOverview.complexityScore;
      pr.changedSymbols = cached.prOverview.functionsModified;
      pr.affectedApis = cached.prOverview.apiRoutesAffected;
      pr.relevantTests = cached.prOverview.relevantTests;
      pr.potentialTestGaps = cached.prOverview.potentialMissingTests;
      pr.filesChanged = cached.prOverview.filesChanged;
    }
  }

  const finalized = await finalizeChecks(graph, {
    files: parsed.files,
    contentsByPath: parsed.contentsByPath,
    packageDeps: parsed.packageDeps,
    clonePath: repository.clonePath,
    allRelativeFiles: parsed.allRelativeFiles,
    infraSignals: intelligence.infraSignals,
  });

  const stored: StoredAnalysis = {
    id: analysisId(parsedUrl.owner, parsedUrl.repo),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(
      parsed.files,
      finalized.graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph: finalized.graph,
    routePath: toGitImpactPath(parsedUrl),
    routes,
    intelligence,
    checks: finalized.checks,
  };

  return persist(stored);
}

export async function analyzePullRequest(
  owner: string,
  repo: string,
  number: number,
  options?: {
    depth?: number;
    cacheDir?: string;
    maxFiles?: number;
    installationId?: number;
    token?: string;
  },
): Promise<StoredAnalysis> {
  const cacheDir = options?.cacheDir ?? defaultCacheDir();
  const depth = options?.depth ?? 3;

  const { resolveGitHubToken } = await import("@gitimpact/git");
  const { findInstallationIdForOwner } = await import("@gitimpact/db");

  const installationId =
    options?.installationId ?? (await findInstallationIdForOwner(owner));
  const token =
    options?.token ?? (await resolveGitHubToken({ installationId }));

  const [pullRequest, prFiles] = await Promise.all([
    getPullRequestMeta(owner, repo, number, token),
    getPullRequestFiles(owner, repo, number, token),
  ]);

  const repository = await fetchPullRequestHead({
    owner,
    repo,
    number,
    cacheDir,
    headBranch: pullRequest.headBranch,
    token,
  });

  if (!repository.clonePath) {
    throw new Error("Repository clone path missing");
  }

  const parsed = await parseRepository(repository.clonePath, {
    maxFiles: options?.maxFiles ?? 1500,
  });
  const { graph, store, routes, frameworks } = buildGraphFromParse(parsed);

  const changes = buildChangeRecords(prFiles);
  const changedNodes = resolveChangedNodes(store, changes, parsed.contentsByPath);
  const impact = buildImpactReport(store, changedNodes, depth);
  const prOverview = buildPullRequestOverview(impact, changes, pullRequest);

  const intelligence = await buildRepositoryIntelligence({
    owner,
    repo,
    clonePath: repository.clonePath,
    files: parsed.files,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    routes,
    frameworks,
    languages: parsed.languages,
    packageDeps: parsed.packageDeps,
    analysisHealth: parsed.analysisHealth,
    allRelativeFiles: parsed.allRelativeFiles,
    token,
    skipOpenPrs: true,
  });

  const finalized = await finalizeChecks(graph, {
    files: parsed.files,
    contentsByPath: parsed.contentsByPath,
    packageDeps: parsed.packageDeps,
    clonePath: repository.clonePath,
    allRelativeFiles: parsed.allRelativeFiles,
    infraSignals: intelligence.infraSignals,
    changes,
    impact,
    prOverview,
  });

  const stored: StoredAnalysis = {
    id: analysisId(owner, repo, number),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(
      parsed.files,
      finalized.graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph: finalized.graph,
    routePath: `/${owner}/${repo}/pull/${number}`,
    pullRequest,
    changes,
    impact,
    prOverview,
    routes,
    intelligence,
    checks: finalized.checks,
  };

  return persist(stored);
}

function enrichArchitectureIfMissing(analysis: StoredAnalysis): StoredAnalysis {
  if (!analysis.intelligence) return analysis;
  const existing = analysis.intelligence.architecture;
  const hasCollapsedOther = existing?.components?.some(
    (c) => c.id === "shared:Other modules" || c.title === "Other modules",
  );
  const hasClusteredDeploy = existing?.components?.some(
    (c) => c.id === "deployment:Deployment" && c.childIds && c.childIds.length > 0,
  );
  // Re-build when missing, incomplete, clustered, or collapsed into "Other modules"
  if (
    existing?.components?.length &&
    existing.summary &&
    existing.walkthrough?.length &&
    !hasClusteredDeploy &&
    !hasCollapsedOther
  ) {
    return analysis;
  }

  const filePaths = [
    ...new Set([
      ...analysis.graph.nodes.map((n) => n.file).filter(Boolean),
      ...(analysis.intelligence.architectureArtifacts ?? []),
      ...(analysis.intelligence.infraSignals?.map((s) => s.path) ?? []),
    ]),
  ];
  const artifacts =
    analysis.intelligence.architectureArtifacts?.length
      ? analysis.intelligence.architectureArtifacts
      : collectArchitectureArtifacts(filePaths);
  const architecture = buildArchitectureExperience({
    codeFiles: analysis.graph.nodes
      .filter((n) => n.type === "FILE" || n.type === "CONFIG")
      .map((n) => ({ path: n.file, type: n.type })),
    artifacts,
    infraSignals: analysis.intelligence.infraSignals,
    graphNodes: analysis.graph.nodes,
    graphEdges: analysis.graph.edges,
    routes: analysis.routes,
    repositoryType: analysis.intelligence.repositoryType,
  });

  const enriched: StoredAnalysis = {
    ...analysis,
    intelligence: {
      ...analysis.intelligence,
      architectureArtifacts: artifacts,
      architecture,
    },
  };
  getMemoryStore().set(analysis.id, enriched);
  return enriched;
}

export async function getAnalysis(id: string): Promise<StoredAnalysis | undefined> {
  const memory = getMemoryStore().get(id);
  if (memory) return enrichArchitectureIfMissing(memory);

  if (!isDatabaseConfigured()) return undefined;
  try {
    const fromDb = await loadAnalysisFromDb(id);
    if (!fromDb) return undefined;
    const hydrated: StoredAnalysis = { ...fromDb, persisted: true };
    const enriched = enrichArchitectureIfMissing(hydrated);
    getMemoryStore().set(id, enriched);
    return enriched;
  } catch (error) {
    console.error("[gitimpact] failed to load analysis", error);
    return undefined;
  }
}

export async function getNodeImpact(
  analysisIdValue: string,
  nodeId: string,
  depth = 3,
): Promise<ImpactReport | undefined> {
  const analysis = await getAnalysis(analysisIdValue);
  if (!analysis) return undefined;
  const store = new GraphStore(analysis.graph);
  const node = store.getNode(nodeId) ?? store.findFileNode(nodeId);
  if (!node) return undefined;
  return buildImpactReport(store, [node], depth);
}

export async function getImpactPathExplanation(
  analysisIdValue: string,
  targetNodeId: string,
  changedNodeId?: string,
): Promise<ReturnType<typeof explainImpactPath> | undefined> {
  const analysis = await getAnalysis(analysisIdValue);
  if (!analysis?.impact) return undefined;
  const store = new GraphStore(analysis.graph);

  const candidate =
    analysis.impact.directImpact.find((i) => i.node.id === targetNodeId) ??
    analysis.impact.indirectImpact.find((i) => i.node.id === targetNodeId);

  if (candidate) {
    return explainImpactPath(store, candidate.relationshipPath);
  }

  // Recompute from an explicit changed node if provided
  if (changedNodeId) {
    const report = await getNodeImpact(analysisIdValue, changedNodeId, analysis.impact.maxDepth);
    const hit =
      report?.directImpact.find((i) => i.node.id === targetNodeId) ??
      report?.indirectImpact.find((i) => i.node.id === targetNodeId);
    if (hit) return explainImpactPath(store, hit.relationshipPath);
  }

  return undefined;
}

export async function searchAnalysis(
  analysisIdValue: string,
  query: string,
): Promise<GraphNode[]> {
  const analysis = await getAnalysis(analysisIdValue);
  if (!analysis) return [];
  return new GraphStore(analysis.graph).search(query);
}

export async function analyzeLocalFixture(
  fixtureDir: string,
  options?: { depth?: number; id?: string },
): Promise<StoredAnalysis> {
  const depth = options?.depth ?? 3;
  const id = options?.id ?? "demo/tiny-fixture";
  const parsed = await parseRepository(fixtureDir);
  const { graph, store, routes, frameworks } = buildGraphFromParse(parsed);

  const seed =
    store.getNode("METHOD:src/auth.service.ts:AuthService.authenticate") ??
    store.findFileNode("src/auth.service.ts") ??
    store.getNodes().find((n) => n.type !== "ENV_VARIABLE");

  const impact = seed ? buildImpactReport(store, [seed], depth) : undefined;

  const intelligence = await buildRepositoryIntelligence({
    owner: "demo",
    repo: "tiny-fixture",
    clonePath: fixtureDir,
    files: parsed.files,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    routes,
    frameworks,
    languages: parsed.languages,
    packageDeps: parsed.packageDeps,
    analysisHealth: parsed.analysisHealth,
    allRelativeFiles: parsed.allRelativeFiles,
    skipOpenPrs: true,
  });

  const finalized = await finalizeChecks(graph, {
    files: parsed.files,
    contentsByPath: parsed.contentsByPath,
    packageDeps: parsed.packageDeps,
    clonePath: fixtureDir,
    allRelativeFiles: parsed.allRelativeFiles,
    infraSignals: intelligence.infraSignals,
    impact,
  });

  const stored: StoredAnalysis = {
    id,
    createdAt: new Date().toISOString(),
    repository: {
      owner: "demo",
      name: "tiny-fixture",
      url: "local://demo/tiny-fixture",
      defaultBranch: "main",
      clonePath: fixtureDir,
    },
    summary: buildSummary(
      parsed.files,
      finalized.graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph: finalized.graph,
    routePath: "/demo/tiny-fixture",
    impact,
    routes,
    intelligence,
    checks: finalized.checks,
  };

  return persist(stored);
}

const DEMO_PR_PATCH = `@@ -10,10 +10,11 @@ export class AuthService {
   private users = new UserRepository();
 
-  authenticate(email: string, password: string) {
+  authenticate(email: string, password: string, organizationId: string) {
     if (!email || !password) {
       throw new Error("missing credentials");
     }
     const user = this.users.findByEmail(email);
-    return { token: "demo", email: user.email };
+    return { token: "demo", email: user.email, organizationId };
   }
`;

export async function analyzeDemoPullRequest(
  fixtureDir: string,
  options?: { depth?: number },
): Promise<StoredAnalysis> {
  const depth = options?.depth ?? 3;
  const parsed = await parseRepository(fixtureDir);
  const { graph, store, routes, frameworks } = buildGraphFromParse(parsed);

  const pullRequest: PullRequestMeta = {
    owner: "demo",
    repo: "tiny-fixture",
    number: 1,
    title: "Add organization-aware authentication",
    baseBranch: "main",
    headBranch: "feat/org-auth",
    url: "local://demo/tiny-fixture/pull/1",
  };

  const prFiles = [
    {
      filename: "src/auth.service.ts",
      status: "modified",
      patch: DEMO_PR_PATCH,
    },
  ];

  const changes = buildChangeRecords(prFiles);
  const changedNodes = resolveChangedNodes(store, changes, parsed.contentsByPath);
  const impact = buildImpactReport(store, changedNodes, depth);
  const prOverview = buildPullRequestOverview(impact, changes, pullRequest);

  const intelligence = await buildRepositoryIntelligence({
    owner: "demo",
    repo: "tiny-fixture",
    clonePath: fixtureDir,
    files: parsed.files,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    routes,
    frameworks,
    languages: parsed.languages,
    packageDeps: parsed.packageDeps,
    analysisHealth: parsed.analysisHealth,
    allRelativeFiles: parsed.allRelativeFiles,
    skipOpenPrs: true,
  });

  const finalized = await finalizeChecks(graph, {
    files: parsed.files,
    contentsByPath: parsed.contentsByPath,
    packageDeps: parsed.packageDeps,
    clonePath: fixtureDir,
    allRelativeFiles: parsed.allRelativeFiles,
    infraSignals: intelligence.infraSignals,
    changes,
    impact,
    prOverview,
  });

  const stored: StoredAnalysis = {
    id: analysisId("demo", "tiny-fixture", 1),
    createdAt: new Date().toISOString(),
    repository: {
      owner: "demo",
      name: "tiny-fixture",
      url: "local://demo/tiny-fixture",
      defaultBranch: "main",
      clonePath: fixtureDir,
    },
    summary: buildSummary(
      parsed.files,
      finalized.graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph: finalized.graph,
    routePath: "/demo/tiny-fixture/pull/1",
    pullRequest,
    changes,
    impact,
    prOverview,
    routes,
    intelligence,
    checks: finalized.checks,
  };

  return persist(stored);
}

export interface AnalyzeAndCommentResult {
  analysis: StoredAnalysis;
  commentBody: string;
  commentUrl?: string;
  commentCreated?: boolean;
  posted: boolean;
  skippedReason?: string;
}

/**
 * v0.6 product flow: analyze a PR and upsert a deterministic GitImpact comment.
 */
export async function analyzeAndCommentOnPullRequest(options: {
  owner: string;
  repo: string;
  number: number;
  depth?: number;
  cacheDir?: string;
  maxFiles?: number;
  postComment?: boolean;
  analysisBaseUrl?: string;
  installationId?: number;
  token?: string;
}): Promise<AnalyzeAndCommentResult> {
  const { upsertPullRequestComment, resolveGitHubToken } = await import("@gitimpact/git");
  const { findInstallationIdForOwner } = await import("@gitimpact/db");

  const installationId =
    options.installationId ?? (await findInstallationIdForOwner(options.owner));
  const token =
    options.token ?? (await resolveGitHubToken({ installationId }));

  const analysis = await analyzePullRequest(options.owner, options.repo, options.number, {
    depth: options.depth,
    cacheDir: options.cacheDir,
    maxFiles: options.maxFiles,
    installationId,
    token,
  });

  if (!analysis.impact || !analysis.prOverview || !analysis.pullRequest) {
    return {
      analysis,
      commentBody: "",
      posted: false,
      skippedReason: "Analysis produced no impact report",
    };
  }

  const store = new GraphStore(analysis.graph);
  const selected = selectWhyPath(analysis.impact);
  const whyPath = selected
    ? {
        targetName: selected.targetName,
        steps: explainImpactPath(store, selected.path),
      }
    : undefined;

  const analysisUrl = options.analysisBaseUrl
    ? `${options.analysisBaseUrl.replace(/\/$/, "")}${analysis.routePath}`
    : undefined;

  const commentBody = formatPullRequestComment({
    pullRequest: analysis.pullRequest,
    impact: analysis.impact,
    overview: analysis.prOverview,
    whyPath,
    analysisUrl,
  });

  const shouldPost = options.postComment ?? Boolean(token);
  if (!shouldPost) {
    return {
      analysis,
      commentBody,
      posted: false,
      skippedReason: "postComment disabled or GitHub auth missing",
    };
  }

  if (!token) {
    return {
      analysis,
      commentBody,
      posted: false,
      skippedReason: "GitHub App installation token or GITHUB_TOKEN required to post",
    };
  }

  const { comment, created } = await upsertPullRequestComment({
    owner: options.owner,
    repo: options.repo,
    number: options.number,
    body: commentBody,
    marker: GITIMPACT_COMMENT_MARKER,
    token,
  });

  return {
    analysis,
    commentBody,
    commentUrl: comment.html_url,
    commentCreated: created,
    posted: true,
  };
}

export async function getNodeInspector(
  analysisIdValue: string,
  nodeId: string,
  depth = 3,
): Promise<
  | {
      node: GraphNode;
      directDependencies: Array<{
        node: GraphNode;
        edgeType: string;
        confidence: string;
        direction: "outgoing";
      }>;
      directDependents: Array<{
        node: GraphNode;
        edgeType: string;
        confidence: string;
        direction: "incoming";
      }>;
      relatedApis: GraphNode[];
      relatedTests: GraphNode[];
      impact: ImpactReport;
    }
  | undefined
> {
  const analysis = await getAnalysis(analysisIdValue);
  if (!analysis) return undefined;
  const store = new GraphStore(analysis.graph);
  const node = store.getNode(nodeId) ?? store.findFileNode(nodeId);
  if (!node) return undefined;

  const outgoing = store.getOutgoing(node.id);
  const incoming = store.getIncoming(node.id);
  const directDependencies = outgoing
    .map((edge) => {
      const target = store.getNode(edge.to);
      if (!target) return null;
      return {
        node: target,
        edgeType: edge.type,
        confidence: edge.confidence,
        direction: "outgoing" as const,
      };
    })
    .filter(Boolean) as Array<{
    node: GraphNode;
    edgeType: string;
    confidence: string;
    direction: "outgoing";
  }>;

  const directDependents = incoming
    .map((edge) => {
      const source = store.getNode(edge.from);
      if (!source) return null;
      return {
        node: source,
        edgeType: edge.type,
        confidence: edge.confidence,
        direction: "incoming" as const,
      };
    })
    .filter(Boolean) as Array<{
    node: GraphNode;
    edgeType: string;
    confidence: string;
    direction: "incoming";
  }>;

  const impact = buildImpactReport(store, [node], depth);
  return {
    node,
    directDependencies,
    directDependents,
    relatedApis: impact.affectedApis,
    relatedTests: impact.relatedTests,
    impact,
  };
}

export {
  parseGitHubUrl,
  toGitImpactPath,
  isDatabaseConfigured,
  explainImpactPath,
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
  selectWhyPath,
  classifyAnalysisError,
};

export {
  formatImpactSummaryMarkdown,
  formatBlastRadiusExplanation,
  formatRelationshipChain,
  humanizeSemanticEvent,
  formatSemanticEventDetail,
  explainTestGap,
  relationLabel,
} from "@gitimpact/shared";

export { buildChecksReport, buildInfrastructureNodes } from "./checks/index.js";

export { enqueuePrAnalysis, type PrAnalysisJob } from "./queue.js";
export { processPrAnalysisJob } from "./pr-workflow.js";
