import { NextResponse } from "next/server";
import { getAnalysisJob } from "@gitimpact/db";
import { apiError, createRequestId } from "@gitimpact/ops";

export const runtime = "nodejs";

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

  return NextResponse.json(
    {
      id: job.id,
      type: job.type,
      status: job.status,
      phase: job.phase,
      attemptCount: job.attemptCount,
      lastError: job.lastError,
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.pullRequestNumber,
      requestId: job.requestId,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    { headers: { "x-request-id": requestId } },
  );
}
