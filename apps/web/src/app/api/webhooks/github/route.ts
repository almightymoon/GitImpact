import { NextResponse } from "next/server";
import {
  enqueuePrAnalysis,
} from "@gitimpact/analysis";
import { verifyGitHubWebhookSignature } from "@gitimpact/git";
import {
  claimWebhookDelivery,
  updateWebhookDelivery,
  upsertGitHubInstallation,
  deleteGitHubInstallation,
} from "@gitimpact/db";

export const runtime = "nodejs";
export const maxDuration = 30;

type WebhookPayload = {
  action?: string;
  number?: number;
  installation?: {
    id: number;
    account?: { login?: string; type?: string };
    suspended_at?: string | null;
  };
  pull_request?: {
    number: number;
    draft?: boolean;
    head?: { sha?: string };
  };
  repository?: {
    name: string;
    owner?: { login: string };
  };
};

const HANDLED_PR_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

/**
 * GitHub webhook (v0.7):
 * verify → claim delivery (idempotent) → enqueue → 202
 *
 * Configure:
 * - GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (preferred)
 * - GITHUB_WEBHOOK_SECRET
 * - GITIMPACT_PUBLIC_URL
 * - GITHUB_TOKEN (dev fallback only)
 */
export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId =
    request.headers.get("x-github-delivery") ?? `local-${Date.now()}-${Math.random()}`;

  if (secret) {
    if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "GITHUB_WEBHOOK_SECRET is required in production" },
      { status: 500 },
    );
  }

  const event = request.headers.get("x-github-event") ?? "unknown";
  if (event === "ping") {
    return NextResponse.json({ ok: true, message: "pong" });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Installation lifecycle — store installation_id for token minting
  if (event === "installation" || event === "installation_repositories") {
    const installationId = payload.installation?.id;
    const login = payload.installation?.account?.login;
    if (installationId && login) {
      if (payload.action === "deleted") {
        await deleteGitHubInstallation(installationId);
      } else {
        await upsertGitHubInstallation({
          installationId,
          accountLogin: login,
          accountType: payload.installation?.account?.type,
          suspendedAt: payload.installation?.suspended_at
            ? new Date(payload.installation.suspended_at)
            : null,
        });
      }
    }
    await claimWebhookDelivery({
      deliveryId,
      event,
      action: payload.action,
      installationId,
    });
    await updateWebhookDelivery(deliveryId, { status: "completed" });
    return NextResponse.json({ ok: true, event, action: payload.action });
  }

  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, ignored: true, event });
  }

  const action = payload.action ?? "";
  if (!HANDLED_PR_ACTIONS.has(action)) {
    return NextResponse.json({ ok: true, ignored: true, action });
  }
  if (payload.pull_request?.draft) {
    return NextResponse.json({ ok: true, ignored: true, reason: "draft" });
  }

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const number = payload.pull_request?.number ?? payload.number;
  const installationId = payload.installation?.id;
  if (!owner || !repo || !number) {
    return NextResponse.json({ error: "Missing repository or PR number" }, { status: 400 });
  }

  if (installationId && owner) {
    await upsertGitHubInstallation({
      installationId,
      accountLogin: owner,
      accountType: payload.installation?.account?.type,
    });
  }

  const claim = await claimWebhookDelivery({
    deliveryId,
    event,
    action,
    owner,
    repo,
    prNumber: number,
    installationId,
  });

  if (claim.duplicate) {
    return NextResponse.json(
      { ok: true, duplicate: true, deliveryId },
      { status: 200 },
    );
  }

  await updateWebhookDelivery(deliveryId, { status: "queued" });
  const requestId =
    request.headers.get("x-request-id") ||
    `wh_${deliveryId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
  const queued = await enqueuePrAnalysis({
    deliveryId,
    owner,
    repo,
    number,
    action,
    installationId,
    headSha: payload.pull_request?.head?.sha,
    analysisBaseUrl: process.env.GITIMPACT_PUBLIC_URL,
    requestId,
  });

  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      deliveryId,
      jobId: queued.jobId,
      queue: queued.mode,
      deduped: queued.deduped ?? false,
      requestId,
      owner,
      repo,
      number,
    },
    { status: 202, headers: { "x-request-id": requestId } },
  );
}
