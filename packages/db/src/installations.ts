import { eq, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import { githubInstallations, webhookDeliveries } from "./schema.js";

export type DeliveryStatus =
  | "received"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "duplicate";

export interface DeliveryRecord {
  deliveryId: string;
  event: string;
  action?: string | null;
  owner?: string | null;
  repo?: string | null;
  prNumber?: number | null;
  installationId?: number | null;
  status: DeliveryStatus;
  error?: string | null;
  receivedAt: Date;
  processedAt?: Date | null;
}

const memoryDeliveries = new Map<string, DeliveryRecord>();
const memoryInstallations = new Map<
  string,
  { installationId: number; accountLogin: string; accountType: string; suspendedAt?: Date | null }
>();

/**
 * Claim a webhook delivery ID. Returns duplicate:true if already seen.
 */
export async function claimWebhookDelivery(input: {
  deliveryId: string;
  event: string;
  action?: string;
  owner?: string;
  repo?: string;
  prNumber?: number;
  installationId?: number;
}): Promise<{ claimed: boolean; duplicate: boolean }> {
  const db = getDb();
  if (!db) {
    if (memoryDeliveries.has(input.deliveryId)) {
      return { claimed: false, duplicate: true };
    }
    memoryDeliveries.set(input.deliveryId, {
      deliveryId: input.deliveryId,
      event: input.event,
      action: input.action,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      installationId: input.installationId,
      status: "received",
      receivedAt: new Date(),
    });
    return { claimed: true, duplicate: false };
  }

  try {
    await db.insert(webhookDeliveries).values({
      deliveryId: input.deliveryId,
      event: input.event,
      action: input.action ?? null,
      owner: input.owner ?? null,
      repo: input.repo ?? null,
      prNumber: input.prNumber ?? null,
      installationId: input.installationId ?? null,
      status: "received",
      receivedAt: new Date(),
    });
    return { claimed: true, duplicate: false };
  } catch {
    return { claimed: false, duplicate: true };
  }
}

export async function updateWebhookDelivery(
  deliveryId: string,
  patch: { status: DeliveryStatus; error?: string },
): Promise<void> {
  const db = getDb();
  const processedAt =
    patch.status === "completed" || patch.status === "failed" ? new Date() : undefined;

  if (!db) {
    const existing = memoryDeliveries.get(deliveryId);
    if (existing) {
      existing.status = patch.status;
      existing.error = patch.error ?? existing.error;
      if (processedAt) existing.processedAt = processedAt;
    }
    return;
  }

  await db
    .update(webhookDeliveries)
    .set({
      status: patch.status,
      error: patch.error ?? null,
      ...(processedAt ? { processedAt } : {}),
    })
    .where(eq(webhookDeliveries.deliveryId, deliveryId));
}

export async function upsertGitHubInstallation(input: {
  installationId: number;
  accountLogin: string;
  accountType?: string;
  suspendedAt?: Date | null;
}): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryInstallations.set(input.accountLogin.toLowerCase(), {
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      accountType: input.accountType ?? "Organization",
      suspendedAt: input.suspendedAt,
    });
    return;
  }

  const now = new Date();
  await db
    .insert(githubInstallations)
    .values({
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      accountType: input.accountType ?? "Organization",
      suspendedAt: input.suspendedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubInstallations.installationId,
      set: {
        accountLogin: input.accountLogin,
        accountType: input.accountType ?? "Organization",
        suspendedAt: input.suspendedAt ?? null,
        updatedAt: now,
      },
    });
}

export async function deleteGitHubInstallation(installationId: number): Promise<void> {
  const db = getDb();
  if (!db) {
    for (const [login, row] of memoryInstallations) {
      if (row.installationId === installationId) memoryInstallations.delete(login);
    }
    return;
  }
  await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId));
}

export async function findInstallationIdForOwner(
  owner: string,
): Promise<number | undefined> {
  const normalized = owner.toLowerCase();
  const db = getDb();
  if (!db) {
    return memoryInstallations.get(normalized)?.installationId;
  }
  try {
    const rows = await db
      .select()
      .from(githubInstallations)
      .where(sql`lower(${githubInstallations.accountLogin}) = ${normalized}`)
      .limit(1);
    const row = rows[0];
    if (!row || row.suspendedAt) return undefined;
    return row.installationId;
  } catch (error) {
    // Missing migration / down Postgres must not block public PR analysis.
    console.error("[gitimpact] installation lookup failed", error);
    return memoryInstallations.get(normalized)?.installationId;
  }
}

/** Test helper — clear in-memory stores */
export function __resetDeliveryMemoryForTests(): void {
  memoryDeliveries.clear();
  memoryInstallations.clear();
}
