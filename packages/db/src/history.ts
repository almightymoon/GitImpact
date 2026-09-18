import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AnalysisHistoryEntry, AnalysisHistorySnapshot } from "@gitimpact/shared";
import { getDb } from "./client.js";
import { analysisHistory } from "./schema.js";

export interface AppendHistoryInput {
  repositoryId: string;
  analysisId: string;
  kind: "repository" | "pull_request";
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
  prNumber?: number;
  snapshot: AnalysisHistorySnapshot;
  createdAt?: string;
}

const memoryHistory: AnalysisHistoryEntry[] = [];

export function clearMemoryHistoryForTests(): void {
  memoryHistory.length = 0;
}

function sameRun(a: AnalysisHistoryEntry, b: AppendHistoryInput): boolean {
  if (a.repositoryId !== b.repositoryId || a.kind !== b.kind) return false;
  if (b.kind === "pull_request") {
    return (
      a.prNumber === b.prNumber &&
      (a.headSha ?? null) === (b.headSha ?? null) &&
      (a.baseSha ?? null) === (b.baseSha ?? null)
    );
  }
  return (a.commitSha ?? null) === (b.commitSha ?? null);
}

export async function appendAnalysisHistory(
  input: AppendHistoryInput,
): Promise<AnalysisHistoryEntry> {
  // Dedupe identical commit/PR head snapshots (cache hits / re-analyze same SHA).
  const existingMem = memoryHistory.find((e) => sameRun(e, input));
  if (existingMem) return existingMem;

  const entry: AnalysisHistoryEntry = {
    id: randomUUID(),
    repositoryId: input.repositoryId,
    analysisId: input.analysisId,
    kind: input.kind,
    commitSha: input.commitSha,
    baseSha: input.baseSha,
    headSha: input.headSha,
    prNumber: input.prNumber,
    createdAt: input.createdAt ?? new Date().toISOString(),
    snapshot: input.snapshot,
  };

  memoryHistory.unshift(entry);
  if (memoryHistory.length > 500) memoryHistory.length = 500;

  const db = getDb();
  if (!db) return entry;

  try {
    // Skip insert when same SHA already recorded for this repo/kind.
    if (input.commitSha || input.headSha) {
      const conditions = [
        eq(analysisHistory.repositoryId, input.repositoryId),
        eq(analysisHistory.kind, input.kind),
      ];
      if (input.kind === "pull_request" && input.prNumber != null) {
        conditions.push(eq(analysisHistory.prNumber, input.prNumber));
        if (input.headSha) conditions.push(eq(analysisHistory.headSha, input.headSha));
      } else if (input.commitSha) {
        conditions.push(eq(analysisHistory.commitSha, input.commitSha));
      }
      const prior = await db
        .select()
        .from(analysisHistory)
        .where(and(...conditions))
        .limit(1);
      if (prior[0]) {
        return {
          id: prior[0].id,
          repositoryId: prior[0].repositoryId,
          analysisId: prior[0].analysisId,
          kind: prior[0].kind as "repository" | "pull_request",
          commitSha: prior[0].commitSha ?? undefined,
          baseSha: prior[0].baseSha ?? undefined,
          headSha: prior[0].headSha ?? undefined,
          prNumber: prior[0].prNumber ?? undefined,
          createdAt: prior[0].createdAt.toISOString(),
          snapshot: prior[0].snapshot as AnalysisHistorySnapshot,
        };
      }
    }

    await db.insert(analysisHistory).values({
      id: entry.id,
      repositoryId: entry.repositoryId,
      analysisId: entry.analysisId,
      kind: entry.kind,
      commitSha: entry.commitSha ?? null,
      baseSha: entry.baseSha ?? null,
      headSha: entry.headSha ?? null,
      prNumber: entry.prNumber ?? null,
      snapshot: entry.snapshot,
      createdAt: new Date(entry.createdAt),
    });
  } catch (error) {
    console.error("[gitimpact] appendAnalysisHistory failed", error);
  }

  return entry;
}

export async function listAnalysisHistory(
  owner: string,
  repo: string,
  options?: { kind?: "repository" | "pull_request"; prNumber?: number; limit?: number },
): Promise<AnalysisHistoryEntry[]> {
  const repositoryId = `${owner}/${repo}`;
  const limit = options?.limit ?? 20;

  const db = getDb();
  if (!db) {
    return memoryHistory
      .filter((e) => {
        if (e.repositoryId !== repositoryId) return false;
        if (options?.kind && e.kind !== options.kind) return false;
        if (options?.prNumber != null && e.prNumber !== options.prNumber) return false;
        return true;
      })
      .slice(0, limit);
  }

  try {
    const conditions = [eq(analysisHistory.repositoryId, repositoryId)];
    if (options?.kind) conditions.push(eq(analysisHistory.kind, options.kind));
    if (options?.prNumber != null) {
      conditions.push(eq(analysisHistory.prNumber, options.prNumber));
    }
    const rows = await db
      .select()
      .from(analysisHistory)
      .where(and(...conditions))
      .orderBy(desc(analysisHistory.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      analysisId: row.analysisId,
      kind: row.kind as "repository" | "pull_request",
      commitSha: row.commitSha ?? undefined,
      baseSha: row.baseSha ?? undefined,
      headSha: row.headSha ?? undefined,
      prNumber: row.prNumber ?? undefined,
      createdAt: row.createdAt.toISOString(),
      snapshot: row.snapshot as AnalysisHistorySnapshot,
    }));
  } catch (error) {
    console.error("[gitimpact] listAnalysisHistory failed", error);
    return [];
  }
}

export async function getAnalysisHistoryEntry(
  id: string,
): Promise<AnalysisHistoryEntry | null> {
  const mem = memoryHistory.find((e) => e.id === id);
  if (mem) return mem;

  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(analysisHistory)
      .where(eq(analysisHistory.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      repositoryId: row.repositoryId,
      analysisId: row.analysisId,
      kind: row.kind as "repository" | "pull_request",
      commitSha: row.commitSha ?? undefined,
      baseSha: row.baseSha ?? undefined,
      headSha: row.headSha ?? undefined,
      prNumber: row.prNumber ?? undefined,
      createdAt: row.createdAt.toISOString(),
      snapshot: row.snapshot as AnalysisHistorySnapshot,
    };
  } catch (error) {
    console.error("[gitimpact] getAnalysisHistoryEntry failed", error);
    return null;
  }
}
