import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SavedView, SavedViewInput } from "@gitimpact/shared";
import { getDb } from "./client.js";
import { repositories, savedViews } from "./schema.js";

const memoryViews = new Map<string, SavedView[]>();

export function clearMemoryViewsForTests(): void {
  memoryViews.clear();
}

async function ensureRepositoryStub(repositoryId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const [owner, name] = repositoryId.split("/");
  if (!owner || !name) return;
  try {
    await db
      .insert(repositories)
      .values({
        id: repositoryId,
        owner,
        name,
        url: `https://github.com/${owner}/${name}`,
        defaultBranch: "main",
      })
      .onConflictDoNothing();
  } catch {
    // ignore — history/analyze may have created it
  }
}

function memList(repositoryId: string): SavedView[] {
  return memoryViews.get(repositoryId) ?? [];
}

export async function listSavedViews(owner: string, repo: string): Promise<SavedView[]> {
  const repositoryId = `${owner}/${repo}`;
  const db = getDb();
  if (!db) {
    return memList(repositoryId).map((v) => ({ ...v, scope: "local" as const }));
  }
  try {
    const rows = await db
      .select()
      .from(savedViews)
      .where(eq(savedViews.repositoryId, repositoryId))
      .orderBy(desc(savedViews.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      name: row.name,
      pinnedSystemIds: (row.pinnedSystemIds as string[]) ?? [],
      hiddenBands: (row.hiddenBands as string[]) ?? [],
      notes: row.notes ?? undefined,
      scope: "team" as const,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error("[gitimpact] listSavedViews failed", error);
    return memList(repositoryId);
  }
}

export async function createSavedView(
  owner: string,
  repo: string,
  input: SavedViewInput,
): Promise<SavedView> {
  const repositoryId = `${owner}/${repo}`;
  const now = new Date().toISOString();
  const view: SavedView = {
    id: randomUUID(),
    repositoryId,
    name: input.name.trim() || "Untitled view",
    pinnedSystemIds: input.pinnedSystemIds ?? [],
    hiddenBands: input.hiddenBands ?? [],
    notes: input.notes,
    scope: input.scope ?? "team",
    createdAt: now,
    updatedAt: now,
  };

  const list = memList(repositoryId);
  list.unshift(view);
  memoryViews.set(repositoryId, list.slice(0, 50));

  const db = getDb();
  if (!db) return { ...view, scope: "local" };

  try {
    await ensureRepositoryStub(repositoryId);
    await db.insert(savedViews).values({
      id: view.id,
      repositoryId,
      name: view.name,
      pinnedSystemIds: view.pinnedSystemIds,
      hiddenBands: view.hiddenBands,
      notes: view.notes ?? null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    return { ...view, scope: "team" };
  } catch (error) {
    console.error("[gitimpact] createSavedView failed", error);
    return { ...view, scope: "local" };
  }
}

export async function deleteSavedView(
  owner: string,
  repo: string,
  viewId: string,
): Promise<boolean> {
  const repositoryId = `${owner}/${repo}`;
  const list = memList(repositoryId).filter((v) => v.id !== viewId);
  memoryViews.set(repositoryId, list);

  const db = getDb();
  if (!db) return true;
  try {
    await db
      .delete(savedViews)
      .where(and(eq(savedViews.id, viewId), eq(savedViews.repositoryId, repositoryId)));
    return true;
  } catch (error) {
    console.error("[gitimpact] deleteSavedView failed", error);
    return false;
  }
}
