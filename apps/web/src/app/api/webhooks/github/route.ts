import { NextResponse } from "next/server";
import { analyzeAndCommentOnPullRequest } from "@gitimpact/analysis";
import { verifyGitHubWebhookSignature } from "@gitimpact/git";

export const runtime = "nodejs";
export const maxDuration = 300;

type PullRequestWebhookPayload = {
  action?: string;
  number?: number;
  pull_request?: {
    number: number;
    draft?: boolean;
  };
  repository?: {
    name: string;
    owner?: { login: string };
    full_name?: string;
  };
};

const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

/**
 * GitHub webhook: pull_request opened / synchronized → analyze → PR comment.
 *
 * Configure:
 * - GITHUB_TOKEN — PAT or app installation token with `pull_requests: write`
 * - GITHUB_WEBHOOK_SECRET — webhook secret for signature verification
 * - GITIMPACT_PUBLIC_URL — optional workbench base URL embedded in the comment
 */
export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

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

  const event = request.headers.get("x-github-event");
  if (event === "ping") {
    return NextResponse.json({ ok: true, message: "pong" });
  }
  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, ignored: true, event });
  }

  let payload: PullRequestWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PullRequestWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = payload.action ?? "";
  if (!HANDLED_ACTIONS.has(action)) {
    return NextResponse.json({ ok: true, ignored: true, action });
  }

  if (payload.pull_request?.draft) {
    return NextResponse.json({ ok: true, ignored: true, reason: "draft" });
  }

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const number = payload.pull_request?.number ?? payload.number;
  if (!owner || !repo || !number) {
    return NextResponse.json({ error: "Missing repository or PR number" }, { status: 400 });
  }

  try {
    const result = await analyzeAndCommentOnPullRequest({
      owner,
      repo,
      number,
      depth: Number(process.env.GITIMPACT_DEPTH ?? 3),
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
      postComment: true,
      analysisBaseUrl: process.env.GITIMPACT_PUBLIC_URL,
    });

    return NextResponse.json({
      ok: true,
      action,
      analysisId: result.analysis.id,
      posted: result.posted,
      commentUrl: result.commentUrl,
      commentCreated: result.commentCreated,
      skippedReason: result.skippedReason,
      complexityScore: result.analysis.prOverview?.complexityScore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook analysis failed";
    console.error("[gitimpact] webhook failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
