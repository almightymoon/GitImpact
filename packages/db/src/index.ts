import { eq } from "drizzle-orm";
import type {
  AnalysisSummary,
  ChangeRecord,
  DependencyGraph,
  DetectedRoute,
  ImpactReport,
  PullRequestImpactOverview,
  PullRequestMeta,
  RepositoryMeta,
} from "@gitimpact/shared";
import { getDb, isDatabaseConfigured } from "./client.js";
import { analyses, repositories } from "./schema.js";

export interface PersistedAnalysis {
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
}

function repoId(owner: string, name: string): string {
  return `${owner}/${name}`;
}

export async function saveAnalysis(analysis: PersistedAnalysis): Promise<void> {
  const db = getDb();
  if (!db) return;

  const repositoryKey = repoId(analysis.repository.owner, analysis.repository.name);
  const now = new Date();

  await db
    .insert(repositories)
    .values({
      id: repositoryKey,
      owner: analysis.repository.owner,
      name: analysis.repository.name,
      url: analysis.repository.url,
      defaultBranch: analysis.repository.defaultBranch,
      languages: analysis.summary.languages,
      frameworks: analysis.summary.frameworks,
      analyzedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: repositories.id,
      set: {
        url: analysis.repository.url,
        defaultBranch: analysis.repository.defaultBranch,
        languages: analysis.summary.languages,
        frameworks: analysis.summary.frameworks,
        analyzedAt: now,
        updatedAt: now,
      },
    });

  await db
    .insert(analyses)
    .values({
      id: analysis.id,
      repositoryId: repositoryKey,
      kind: analysis.pullRequest ? "pull_request" : "repository",
      prNumber: analysis.pullRequest?.number ?? null,
      routePath: analysis.routePath,
      summary: analysis.summary,
      graph: analysis.graph,
      impact: analysis.impact ?? null,
      prOverview: analysis.prOverview ?? null,
      changes: analysis.changes ?? null,
      pullRequest: analysis.pullRequest ?? null,
      routes: analysis.routes ?? null,
      createdAt: new Date(analysis.createdAt),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: analyses.id,
      set: {
        routePath: analysis.routePath,
        summary: analysis.summary,
        graph: analysis.graph,
        impact: analysis.impact ?? null,
        prOverview: analysis.prOverview ?? null,
        changes: analysis.changes ?? null,
        pullRequest: analysis.pullRequest ?? null,
        routes: analysis.routes ?? null,
        updatedAt: now,
      },
    });
}

export async function loadAnalysis(id: string): Promise<PersistedAnalysis | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  const repoRows = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, row.repositoryId))
    .limit(1);
  const repo = repoRows[0];
  if (!repo) return null;

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    repository: {
      owner: repo.owner,
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
    },
    summary: row.summary as AnalysisSummary,
    graph: row.graph as DependencyGraph,
    routePath: row.routePath,
    pullRequest: (row.pullRequest as PullRequestMeta | null) ?? undefined,
    changes: (row.changes as ChangeRecord[] | null) ?? undefined,
    impact: (row.impact as ImpactReport | null) ?? undefined,
    prOverview: (row.prOverview as PullRequestImpactOverview | null) ?? undefined,
    routes: (row.routes as DetectedRoute[] | null) ?? undefined,
  };
}

export { isDatabaseConfigured };
export { analyses, repositories } from "./schema.js";
export { getDb, createDb, closeDb } from "./client.js";
