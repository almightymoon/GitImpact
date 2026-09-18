import { NextResponse } from "next/server";
import { getAnalysisJob } from "@gitimpact/db";
import { getQueueDepth } from "@gitimpact/queue";
import { apiError, createRequestId } from "@gitimpact/ops";
import type { AnalysisPhase } from "@gitimpact/shared";

export const runtime = "nodejs";

const PHASE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  CLONE: "Fetching repository",
  DISCOVERY: "Discovering files",
  PARSER: "Parsing code",
  GRAPH: "Building graph",
  FRAMEWORK: "Detecting frameworks",
  ARCHITECTURE: "Building architecture",
  CHECKS: "Running checks",
  IMPACT: "Calculating impact",
  PERSISTENCE: "Saving results",
  GITHUB_COMMENT: "Updating PR comment",
  GITHUB_CHECK: "Updating check run",
  FINALIZING: "Finalizing",
};

function routePathForJob(job: {
  owner?: string;
  repo?: string;
  pullRequestNumber?: number;
  result?: { routePath?: string };
}): string | undefined {
  if (job.result?.routePath) return job.result.routePath;
  if (!job.owner || !job.repo) return undefined;
  if (job.pullRequestNumber) {
    return `/${job.owner}/${job.repo}/pull/${job.pullRequestNumber}`;
  }
  return `/${job.owner}/${job.repo}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId(request.headers.get("x-request-id"));
  const { id } = await context.params;
  const job = await getAnalysisJob(id);
  if (!job) {
    return NextResponse.json(
      apiError("NOT_FOUND", "Job not found", { requestId, retryable: false }),
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  const phase = (job.phase ?? "QUEUED") as AnalysisPhase | string;
  const routePath = routePathForJob(job);
  const depth = await getQueueDepth();
  const queuedBehind =
    job.status === "QUEUED" ? Math.max(0, depth.waiting - 1) : 0;

  return NextResponse.json(
    {
      id: job.id,
      type: job.type,
      status: job.status,
      phase,
      phaseLabel:
        job.status === "QUEUED" && queuedBehind > 0
          ? `Queued behind ${queuedBehind} job${queuedBehind === 1 ? "" : "s"}`
          : (PHASE_LABELS[phase] ?? phase),
      attemptCount: job.attemptCount,
      lastError: job.lastError,
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.pullRequestNumber,
      commitSha: job.commitSha,
      requestId: job.requestId,
      result: job.result,
      routePath: job.status === "SUCCEEDED" ? routePath : undefined,
      queue: depth,
      queuedBehind,
      retryable: job.status === "DEAD_LETTER" || job.status === "FAILED",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    { headers: { "x-request-id": requestId } },
  );
}
