import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { AnalysisJobRecord, JobPayload, JobStatus, JobType } from "@gitimpact/shared";
import { ANALYSIS_SCHEMA_VERSION } from "@gitimpact/shared";
import { getDb, isDatabaseConfigured } from "./client.js";
import { analysisJobs } from "./schema.js";

const memoryJobs = new Map<string, AnalysisJobRecord>();

function rowToRecord(row: typeof analysisJobs.$inferSelect): AnalysisJobRecord {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    payload: row.payload as JobPayload,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError ?? undefined,
    phase: (row.phase as AnalysisJobRecord["phase"]) ?? undefined,
    dedupeKey: row.dedupeKey ?? undefined,
    owner: row.owner ?? undefined,
    repo: row.repo ?? undefined,
    pullRequestNumber: row.pullRequestNumber ?? undefined,
    commitSha: row.commitSha ?? undefined,
    requestId: row.requestId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createAnalysisJob(input: {
  id: string;
  type: JobType;
  payload: JobPayload;
  dedupeKey?: string;
  owner?: string;
  repo?: string;
  pullRequestNumber?: number;
  commitSha?: string;
  requestId?: string;
  maxAttempts?: number;
}): Promise<AnalysisJobRecord> {
  const now = new Date();
  const record: AnalysisJobRecord = {
    id: input.id,
    type: input.type,
    status: "QUEUED",
    payload: input.payload,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    dedupeKey: input.dedupeKey,
    owner: input.owner,
    repo: input.repo,
    pullRequestNumber: input.pullRequestNumber,
    commitSha: input.commitSha,
    requestId: input.requestId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const db = getDb();
  if (!db) {
    memoryJobs.set(record.id, record);
    return record;
  }

  await db.insert(analysisJobs).values({
    id: record.id,
    type: record.type,
    status: record.status,
    payload: record.payload,
    attemptCount: 0,
    maxAttempts: record.maxAttempts,
    dedupeKey: record.dedupeKey,
    owner: record.owner,
    repo: record.repo,
    pullRequestNumber: record.pullRequestNumber,
    commitSha: record.commitSha,
    requestId: record.requestId,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  });

  return record;
}

export async function updateAnalysisJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    attemptCount: number;
    lastError: string | null;
    phase: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>,
): Promise<AnalysisJobRecord | undefined> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const existing = memoryJobs.get(id);
    if (!existing) return undefined;
    const next: AnalysisJobRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      attemptCount: patch.attemptCount ?? existing.attemptCount,
      lastError:
        patch.lastError === null
          ? undefined
          : (patch.lastError ?? existing.lastError),
      phase:
        patch.phase === null
          ? undefined
          : ((patch.phase as AnalysisJobRecord["phase"]) ?? existing.phase),
      startedAt: patch.startedAt === null
        ? undefined
        : (patch.startedAt?.toISOString() ?? existing.startedAt),
      finishedAt: patch.finishedAt === null
        ? undefined
        : (patch.finishedAt?.toISOString() ?? existing.finishedAt),
      updatedAt: now.toISOString(),
    };
    memoryJobs.set(id, next);
    return next;
  }

  await db
    .update(analysisJobs)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.attemptCount != null ? { attemptCount: patch.attemptCount } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      updatedAt: now,
    })
    .where(eq(analysisJobs.id, id));

  const rows = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id)).limit(1);
  return rows[0] ? rowToRecord(rows[0]) : undefined;
}

export async function getAnalysisJob(id: string): Promise<AnalysisJobRecord | undefined> {
  const db = getDb();
  if (!db) return memoryJobs.get(id);
  const rows = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id)).limit(1);
  return rows[0] ? rowToRecord(rows[0]) : undefined;
}

export async function findActiveJobByDedupeKey(
  dedupeKey: string,
): Promise<AnalysisJobRecord | undefined> {
  const db = getDb();
  if (!db) {
    for (const job of memoryJobs.values()) {
      if (
        job.dedupeKey === dedupeKey &&
        (job.status === "QUEUED" || job.status === "RUNNING" || job.status === "RETRYING")
      ) {
        return job;
      }
    }
    return undefined;
  }

  const rows = await db
    .select()
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.dedupeKey, dedupeKey),
        sql`${analysisJobs.status} IN ('QUEUED', 'RUNNING', 'RETRYING')`,
      ),
    )
    .orderBy(desc(analysisJobs.createdAt))
    .limit(1);
  return rows[0] ? rowToRecord(rows[0]) : undefined;
}

export async function listFailedJobs(limit = 50): Promise<AnalysisJobRecord[]> {
  const db = getDb();
  if (!db) {
    return [...memoryJobs.values()]
      .filter((j) => j.status === "FAILED" || j.status === "DEAD_LETTER")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
  const rows = await db
    .select()
    .from(analysisJobs)
    .where(sql`${analysisJobs.status} IN ('FAILED', 'DEAD_LETTER')`)
    .orderBy(desc(analysisJobs.updatedAt))
    .limit(limit);
  return rows.map(rowToRecord);
}

export async function listDeadLetterJobs(limit = 50): Promise<AnalysisJobRecord[]> {
  const db = getDb();
  if (!db) {
    return [...memoryJobs.values()]
      .filter((j) => j.status === "DEAD_LETTER")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
  const rows = await db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.status, "DEAD_LETTER"))
    .orderBy(desc(analysisJobs.updatedAt))
    .limit(limit);
  return rows.map(rowToRecord);
}

export async function purgeExpiredJobs(olderThan: Date): Promise<number> {
  const db = getDb();
  if (!db) {
    let n = 0;
    for (const [id, job] of memoryJobs) {
      if (
        (job.status === "SUCCEEDED" || job.status === "DEAD_LETTER") &&
        new Date(job.updatedAt) < olderThan
      ) {
        memoryJobs.delete(id);
        n += 1;
      }
    }
    return n;
  }
  const result = await db
    .delete(analysisJobs)
    .where(
      and(
        sql`${analysisJobs.status} IN ('SUCCEEDED', 'DEAD_LETTER')`,
        lt(analysisJobs.updatedAt, olderThan),
      ),
    );
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export function clearMemoryJobsForTests(): void {
  memoryJobs.clear();
}

export { isDatabaseConfigured };
