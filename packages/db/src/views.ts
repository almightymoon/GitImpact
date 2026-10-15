import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  SavedView,
  SavedViewInput,
  ViewActorContext,
  ViewRole,
  ViewVisibility,
} from "@gitimpact/shared";
import { canReadSavedView, canWriteSavedView } from "@gitimpact/shared";
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

function rowToView(row: {
  id: string;
  repositoryId: string;
  name: string;
  pinnedSystemIds: unknown;
  hiddenBands: unknown;
  notes: string | null;
  orgLogin: string | null;
  visibility: string;
  createdBy: string | null;
  roleRequired: string;
  createdAt: Date;
  updatedAt: Date;
}): SavedView {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    name: row.name,
    pinnedSystemIds: (row.pinnedSystemIds as string[]) ?? [],
    hiddenBands: (row.hiddenBands as string[]) ?? [],
    notes: row.notes ?? undefined,
    scope: "team",
    orgLogin: row.orgLogin ?? undefined,
    visibility: (row.visibility as ViewVisibility) || "repo",
    createdBy: row.createdBy ?? undefined,
    roleRequired: (row.roleRequired as ViewRole) || "viewer",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedViews(
  owner: string,
  repo: string,
  ctx?: ViewActorContext,
): Promise<SavedView[]> {
  const repositoryId = `${owner}/${repo}`;
  const db = getDb();
  if (!db) {
    return memList(repositoryId)
      .map((v) => ({ ...v, scope: "local" as const }))
      .filter((v) => canReadSavedView(v, ctx));
  }
  try {
    const rows = await db
      .select()
      .from(savedViews)
      .where(eq(savedViews.repositoryId, repositoryId))
      .orderBy(desc(savedViews.updatedAt));
    return rows.map(rowToView).filter((v) => canReadSavedView(v, ctx));
  } catch (error) {
    console.error("[gitimpact] listSavedViews failed", error);
    return memList(repositoryId).filter((v) => canReadSavedView(v, ctx));
  }
}

export async function createSavedView(
  owner: string,
  repo: string,
  input: SavedViewInput,
  ctx?: ViewActorContext,
): Promise<SavedView> {
  const repositoryId = `${owner}/${repo}`;
  const now = new Date().toISOString();
  const visibility = input.visibility ?? "repo";
  const roleRequired = input.roleRequired ?? "viewer";
  const view: SavedView = {
    id: randomUUID(),
    repositoryId,
    name: input.name.trim() || "Untitled view",
    pinnedSystemIds: input.pinnedSystemIds ?? [],
    hiddenBands: input.hiddenBands ?? [],
    notes: input.notes,
    scope: input.scope ?? "team",
    orgLogin: input.orgLogin ?? owner,
    visibility,
    createdBy: input.createdBy ?? ctx?.login,
    roleRequired,
    createdAt: now,
    updatedAt: now,
  };

  if (!canWriteSavedView(view, ctx)) {
    throw new Error("FORBIDDEN");
  }

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
      orgLogin: view.orgLogin ?? null,
      visibility: view.visibility,
      createdBy: view.createdBy ?? null,
      roleRequired: view.roleRequired,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    return { ...view, scope: "team" };
  } catch (error) {
    console.error("[gitimpact] createSavedView failed", error);
    return { ...view, scope: "local" };
  }
}

export async function updateSavedView(
  owner: string,
  repo: string,
  viewId: string,
  input: Partial<SavedViewInput>,
  ctx?: ViewActorContext,
): Promise<SavedView | null> {
  const repositoryId = `${owner}/${repo}`;
  const existing =
    memList(repositoryId).find((v) => v.id === viewId) ??
    (await listSavedViews(owner, repo)).find((v) => v.id === viewId);
  if (!existing) return null;
  if (!canWriteSavedView(existing, ctx)) {
    throw new Error("FORBIDDEN");
  }

  const now = new Date().toISOString();
  const next: SavedView = {
    ...existing,
    name: input.name?.trim() || existing.name,
    pinnedSystemIds: input.pinnedSystemIds ?? existing.pinnedSystemIds,
    hiddenBands: input.hiddenBands ?? existing.hiddenBands,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    orgLogin: input.orgLogin ?? existing.orgLogin,
    visibility: input.visibility ?? existing.visibility,
    roleRequired: input.roleRequired ?? existing.roleRequired,
    updatedAt: now,
  };

  const list = memList(repositoryId).map((v) => (v.id === viewId ? next : v));
  memoryViews.set(repositoryId, list);

  const db = getDb();
  if (!db) return { ...next, scope: "local" };

  try {
    await db
      .update(savedViews)
      .set({
        name: next.name,
        pinnedSystemIds: next.pinnedSystemIds,
        hiddenBands: next.hiddenBands,
        notes: next.notes ?? null,
        orgLogin: next.orgLogin ?? null,
        visibility: next.visibility,
        roleRequired: next.roleRequired,
        updatedAt: new Date(now),
      })
      .where(and(eq(savedViews.id, viewId), eq(savedViews.repositoryId, repositoryId)));
    return { ...next, scope: "team" };
  } catch (error) {
    console.error("[gitimpact] updateSavedView failed", error);
    return { ...next, scope: "local" };
  }
}

export async function deleteSavedView(
  owner: string,
  repo: string,
  viewId: string,
  ctx?: ViewActorContext,
): Promise<boolean> {
  const repositoryId = `${owner}/${repo}`;
  const existing =
    memList(repositoryId).find((v) => v.id === viewId) ??
    (await listSavedViews(owner, repo)).find((v) => v.id === viewId);

  if (existing && !canWriteSavedView(existing, ctx)) {
    throw new Error("FORBIDDEN");
  }

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
