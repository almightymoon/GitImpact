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
  DependencyGraph,
  DetectedRoute,
  GraphNode,
  ImpactReport,
  ParsedFile,
  PullRequestImpactOverview,
  PullRequestMeta,
  RepositoryMeta,
} from "@gitimpact/shared";

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

function resolveChangedNodes(
  store: GraphStore,
  prFiles: Array<{ filename: string; status?: string; patch?: string }>,
  contentsByPath?: Map<string, string>,
): GraphNode[] {
  const changes: ChangeRecord[] = prFiles.map((file) => {
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

  const stored: StoredAnalysis = {
    id: analysisId(parsedUrl.owner, parsedUrl.repo),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(
      parsed.files,
      graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph,
    routePath: toGitImpactPath(parsedUrl),
    routes,
  };

  return persist(stored);
}

export async function analyzePullRequest(
  owner: string,
  repo: string,
  number: number,
  options?: { depth?: number; cacheDir?: string; maxFiles?: number },
): Promise<StoredAnalysis> {
  const cacheDir = options?.cacheDir ?? defaultCacheDir();
  const depth = options?.depth ?? 3;

  const [pullRequest, prFiles] = await Promise.all([
    getPullRequestMeta(owner, repo, number),
    getPullRequestFiles(owner, repo, number),
  ]);

  const repository = await fetchPullRequestHead({
    owner,
    repo,
    number,
    cacheDir,
    headBranch: pullRequest.headBranch,
  });

  if (!repository.clonePath) {
    throw new Error("Repository clone path missing");
  }

  const parsed = await parseRepository(repository.clonePath, {
    maxFiles: options?.maxFiles ?? 1500,
  });
  const { graph, store, routes, frameworks } = buildGraphFromParse(parsed);

  const changes: ChangeRecord[] = prFiles.map((file) => {
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

  const changedNodes = resolveChangedNodes(store, prFiles, parsed.contentsByPath);
  const impact = buildImpactReport(store, changedNodes, depth);
  const prOverview = buildPullRequestOverview(impact, changes, pullRequest);

  const stored: StoredAnalysis = {
    id: analysisId(owner, repo, number),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(
      parsed.files,
      graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph,
    routePath: `/${owner}/${repo}/pull/${number}`,
    pullRequest,
    changes,
    impact,
    prOverview,
    routes,
  };

  return persist(stored);
}

export async function getAnalysis(id: string): Promise<StoredAnalysis | undefined> {
  const memory = getMemoryStore().get(id);
  if (memory) return memory;

  if (!isDatabaseConfigured()) return undefined;
  try {
    const fromDb = await loadAnalysisFromDb(id);
    if (!fromDb) return undefined;
    const hydrated: StoredAnalysis = { ...fromDb, persisted: true };
    getMemoryStore().set(id, hydrated);
    return hydrated;
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
      graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph,
    routePath: "/demo/tiny-fixture",
    impact,
    routes,
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

  const changes: ChangeRecord[] = prFiles.map((file) => {
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

  const changedNodes = resolveChangedNodes(store, prFiles, parsed.contentsByPath);
  const impact = buildImpactReport(store, changedNodes, depth);
  const prOverview = buildPullRequestOverview(impact, changes, pullRequest);

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
      graph,
      store,
      parsed.languages,
      frameworks,
      routes.length,
    ),
    graph,
    routePath: "/demo/tiny-fixture/pull/1",
    pullRequest,
    changes,
    impact,
    prOverview,
    routes,
  };

  return persist(stored);
}

export { parseGitHubUrl, toGitImpactPath, isDatabaseConfigured, explainImpactPath };
