import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type {
  AnalysisSummary,
  ChangeRecord,
  ChecksReport,
  DependencyGraph,
  DetectedRoute,
  ImpactReport,
  PullRequestImpactOverview,
  PullRequestMeta,
  RepositoryIntelligence,
  RepositoryMeta,
} from "@gitimpact/shared";
import { ANALYSIS_SCHEMA_VERSION } from "@gitimpact/shared";
import { getDb } from "./client.js";
import { analyses, repositories, webhookDeliveries } from "./schema.js";

export interface CachedAnalysisRecord {
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
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
  schemaVersion?: string;
  expiresAt?: string;
}

export interface CacheLookup {
  owner: string;
  repo: string;
  commitSha?: string;
  headSha?: string;
  baseSha?: string;
  prNumber?: number;
  schemaVersion?: string;
}

function hydrate(
  row: typeof analyses.$inferSelect,
  repo: typeof repositories.$inferSelect,
): CachedAnalysisRecord {
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
    intelligence: (row.intelligence as RepositoryIntelligence | null) ?? undefined,
    checks: (row.checks as ChecksReport | null) ?? undefined,
    commitSha: row.commitSha ?? undefined,
    baseSha: row.baseSha ?? undefined,
    headSha: row.headSha ?? undefined,
    schemaVersion: row.schemaVersion ?? undefined,
    expiresAt: row.expiresAt?.toISOString(),
  };
}

/**
 * Load a non-expired analysis matching commit identity + schema version.
 * Returns null on cache miss or when Postgres is unreachable / mis-migrated.
 */
export async function findCachedAnalysis(
  lookup: CacheLookup,
): Promise<CachedAnalysisRecord | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const schemaVersion = lookup.schemaVersion ?? ANALYSIS_SCHEMA_VERSION;
    const now = new Date();
    const repositoryId = `${lookup.owner}/${lookup.repo}`;

    const conditions = [
      eq(analyses.repositoryId, repositoryId),
      eq(analyses.schemaVersion, schemaVersion),
      or(isNull(analyses.expiresAt), gt(analyses.expiresAt, now)),
    ];

    if (lookup.prNumber != null) {
      conditions.push(eq(analyses.kind, "pull_request"));
      conditions.push(eq(analyses.prNumber, lookup.prNumber));
      if (lookup.headSha) conditions.push(eq(analyses.headSha, lookup.headSha));
      if (lookup.baseSha) conditions.push(eq(analyses.baseSha, lookup.baseSha));
    } else {
      conditions.push(eq(analyses.kind, "repository"));
      if (lookup.commitSha) conditions.push(eq(analyses.commitSha, lookup.commitSha));
    }

    const rows = await db
      .select()
      .from(analyses)
      .where(and(...conditions))
      .orderBy(desc(analyses.updatedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const repoRows = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .limit(1);
    const repo = repoRows[0];
    if (!repo) return null;

    return hydrate(row, repo);
  } catch (error) {
    console.error("[gitimpact] cache lookup failed", error);
    return null;
  }
}

export interface RecentRepository {
  id: string;
  owner: string;
  name: string;
  url: string;
  analyzedAt: string | null;
  frameworks: string[];
}

export async function listRecentRepositories(limit = 8): Promise<RecentRepository[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(repositories)
      .orderBy(desc(repositories.analyzedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      url: r.url,
      analyzedAt: r.analyzedAt?.toISOString() ?? null,
      frameworks: (r.frameworks as string[] | null) ?? [],
    }));
  } catch (error) {
    console.error("[gitimpact] listRecentRepositories failed", error);
    return [];
  }
}

export async function purgeExpiredAnalyses(now = new Date()): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const result = await db.delete(analyses).where(lt(analyses.expiresAt, now));
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export async function deleteAnalysesForRepository(owner: string, repo: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const repositoryId = `${owner}/${repo}`;
  const result = await db.delete(analyses).where(eq(analyses.repositoryId, repositoryId));
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export async function purgeOldWebhookDeliveries(olderThan: Date): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const result = await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.receivedAt, olderThan));
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export function cacheKeyParts(lookup: CacheLookup): string {
  const version = lookup.schemaVersion ?? ANALYSIS_SCHEMA_VERSION;
  if (lookup.prNumber != null) {
    return `pr:${lookup.owner}/${lookup.repo}#${lookup.prNumber}:${lookup.headSha ?? "?"}:${lookup.baseSha ?? "?"}:v${version}`;
  }
  return `repo:${lookup.owner}/${lookup.repo}:${lookup.commitSha ?? "?"}:v${version}`;
}
