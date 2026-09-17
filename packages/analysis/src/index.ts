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
  extractChangedSymbols,
  mapChangedFilesToNodes,
} from "@gitimpact/impact-engine";
import type {
  AnalysisSummary,
  ChangeRecord,
  DependencyGraph,
  GraphNode,
  ImpactReport,
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
}

const globalStore = globalThis as typeof globalThis & {
  __gitimpactAnalyses?: Map<string, StoredAnalysis>;
};

function getStore(): Map<string, StoredAnalysis> {
  if (!globalStore.__gitimpactAnalyses) {
    globalStore.__gitimpactAnalyses = new Map();
  }
  return globalStore.__gitimpactAnalyses;
}

function analysisId(owner: string, repo: string, pr?: number): string {
  return pr ? `${owner}/${repo}/pull/${pr}` : `${owner}/${repo}`;
}

function defaultCacheDir(): string {
  return process.env.GITIMPACT_CACHE_DIR ?? path.join(process.cwd(), ".repos");
}

function buildSummary(
  files: Awaited<ReturnType<typeof parseRepository>>["files"],
  graph: DependencyGraph,
  store: GraphStore,
  languages: AnalysisSummary["languages"],
  frameworks: string[],
): AnalysisSummary {
  return {
    files: files.length,
    functions: files.reduce((sum, f) => sum + f.functions.length, 0),
    classes: files.reduce((sum, f) => sum + f.classes.length, 0),
    dependencies: graph.edges.filter((e) => e.type === "IMPORTS").length,
    tests: files.filter((f) => f.isTest).length,
    apiRoutes: store.getNodes().filter((n) => n.type === "API_ROUTE").length,
    languages,
    frameworks,
  };
}

function resolveChangedNodes(
  store: GraphStore,
  prFiles: Array<{ filename: string; patch?: string }>,
): GraphNode[] {
  const changedFiles = prFiles.map((f) => f.filename);
  let changedNodes = mapChangedFilesToNodes(store, changedFiles);

  for (const file of prFiles) {
    const symbols = extractChangedSymbols(file.patch);
    for (const symbol of symbols) {
      const fn = store.getNode(`FUNCTION:${file.filename}:${symbol}`);
      const cls = store.getNode(`CLASS:${file.filename}:${symbol}`);
      if (fn) changedNodes.push(fn);
      if (cls) changedNodes.push(cls);
    }
  }

  const seen = new Set<string>();
  changedNodes = changedNodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });

  if (changedNodes.length === 0) {
    changedNodes = changedFiles
      .map((file) => store.findFileNode(file))
      .filter((n): n is GraphNode => Boolean(n));
  }

  return changedNodes;
}

export async function analyzeRepositoryUrl(
  inputUrl: string,
  options?: { depth?: number; cacheDir?: string; maxFiles?: number },
): Promise<StoredAnalysis> {
  const parsed = parseGitHubUrl(inputUrl);
  const cacheDir = options?.cacheDir ?? defaultCacheDir();
  const depth = options?.depth ?? 3;

  if (parsed.kind === "pull_request" && parsed.prNumber) {
    return analyzePullRequest(parsed.owner, parsed.repo, parsed.prNumber, {
      depth,
      cacheDir,
      maxFiles: options?.maxFiles,
    });
  }

  const repository = await cloneOrUpdateRepository({
    owner: parsed.owner,
    repo: parsed.repo,
    cacheDir,
    branch: parsed.branch,
  });

  if (!repository.clonePath) {
    throw new Error("Repository clone path missing");
  }

  const { files, languages, frameworks } = await parseRepository(
    repository.clonePath,
    { maxFiles: options?.maxFiles ?? 1500 },
  );
  const graph = buildGraph(files);
  const store = new GraphStore(graph);

  const stored: StoredAnalysis = {
    id: analysisId(parsed.owner, parsed.repo),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(files, graph, store, languages, frameworks),
    graph,
    routePath: toGitImpactPath(parsed),
  };

  getStore().set(stored.id, stored);
  return stored;
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

  const { files, languages, frameworks } = await parseRepository(
    repository.clonePath,
    { maxFiles: options?.maxFiles ?? 1500 },
  );
  const graph = buildGraph(files);
  const store = new GraphStore(graph);

  const changes: ChangeRecord[] = prFiles.map((file) => {
    const symbols = extractChangedSymbols(file.patch);
    return {
      filePath: file.filename,
      changeType: classifyDiffHunk(file.patch, file.status),
      symbolName: symbols[0],
      symbols,
      status: file.status,
    };
  });

  const changedNodes = resolveChangedNodes(store, prFiles);
  const impact = buildImpactReport(store, changedNodes, depth);
  const prOverview = buildPullRequestOverview(impact, changes, pullRequest);

  const stored: StoredAnalysis = {
    id: analysisId(owner, repo, number),
    createdAt: new Date().toISOString(),
    repository,
    summary: buildSummary(files, graph, store, languages, frameworks),
    graph,
    routePath: `/${owner}/${repo}/pull/${number}`,
    pullRequest,
    changes,
    impact,
    prOverview,
  };

  getStore().set(stored.id, stored);
  return stored;
}

export function getAnalysis(id: string): StoredAnalysis | undefined {
  return getStore().get(id);
}

export function getNodeImpact(
  analysisIdValue: string,
  nodeId: string,
  depth = 3,
): ImpactReport | undefined {
  const analysis = getStore().get(analysisIdValue);
  if (!analysis) return undefined;
  const store = new GraphStore(analysis.graph);
  const node = store.getNode(nodeId) ?? store.findFileNode(nodeId);
  if (!node) return undefined;
  return buildImpactReport(store, [node], depth);
}

export function searchAnalysis(
  analysisIdValue: string,
  query: string,
): GraphNode[] {
  const analysis = getStore().get(analysisIdValue);
  if (!analysis) return [];
  return new GraphStore(analysis.graph).search(query);
}

export async function analyzeLocalFixture(
  fixtureDir: string,
  options?: { depth?: number; id?: string },
): Promise<StoredAnalysis> {
  const depth = options?.depth ?? 3;
  const id = options?.id ?? "demo/tiny-fixture";
  const { files, languages, frameworks } = await parseRepository(fixtureDir);
  const graph = buildGraph(files);
  const store = new GraphStore(graph);

  const seed =
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
    summary: buildSummary(files, graph, store, languages, frameworks),
    graph,
    routePath: "/demo/tiny-fixture",
    impact,
  };

  getStore().set(stored.id, stored);
  return stored;
}

const DEMO_PR_PATCH = `@@ -5,8 +5,8 @@ export function register(email: string) {
   return createUser(email);
 }
 
-export function authenticate(email: string, password: string) {
+export function authenticate(email: string, password: string, organizationId: string) {
   if (!email || !password) {
     throw new Error("missing credentials");
   }
-  return { token: "demo", email };
+  return { token: "demo", email, organizationId };
 }
`;

export async function analyzeDemoPullRequest(
  fixtureDir: string,
  options?: { depth?: number },
): Promise<StoredAnalysis> {
  const depth = options?.depth ?? 3;
  const { files, languages, frameworks } = await parseRepository(fixtureDir);
  const graph = buildGraph(files);
  const store = new GraphStore(graph);

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
    };
  });

  const changedNodes = resolveChangedNodes(store, prFiles);
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
    summary: buildSummary(files, graph, store, languages, frameworks),
    graph,
    routePath: "/demo/tiny-fixture/pull/1",
    pullRequest,
    changes,
    impact,
    prOverview,
  };

  getStore().set(stored.id, stored);
  return stored;
}

export { parseGitHubUrl, toGitImpactPath };
