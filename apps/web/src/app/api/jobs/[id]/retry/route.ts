import { NextResponse } from "next/server";
import { getAnalysisJob } from "@gitimpact/db";
import { retryDeadLetterJob, getQueueDepth } from "@gitimpact/queue";
import { apiError, createRequestId, consumeRateLimit } from "@gitimpact/ops";

export const runtime = "nodejs";

/** Manually retry a dead-letter / failed analysis job. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId(request.headers.get("x-request-id"));
  const { id } = await context.params;

  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anonymous";
  const limit = await consumeRateLimit(`jobs-retry:${clientKey}`, {
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      apiError("RATE_LIMITED", "Too many retry requests.", {
        requestId,
        retryable: true,
        retryAfterSeconds: limit.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          "x-request-id": requestId,
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  const existing = await getAnalysisJob(id);
  if (!existing) {
    return NextResponse.json(
      apiError("NOT_FOUND", "Job not found", { requestId, retryable: false }),
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  if (existing.status !== "DEAD_LETTER" && existing.status !== "FAILED") {
    return NextResponse.json(
      apiError("INVALID_REQUEST", "Only failed or dead-letter jobs can be retried.", {
        requestId,
        retryable: false,
      }),
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const result = await retryDeadLetterJob(id);
  if (!result) {
    return NextResponse.json(
      apiError("ANALYSIS_FAILED", "Could not re-queue job.", {
        requestId,
        retryable: true,
      }),
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }

  const depth = await getQueueDepth();
  return NextResponse.json(
    {
      jobId: result.jobId,
      status: "QUEUED",
      deduped: result.deduped ?? false,
      queue: depth,
      requestId,
    },
    { status: 202, headers: { "x-request-id": requestId } },
  );
}
