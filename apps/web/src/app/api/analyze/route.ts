import { NextResponse } from "next/server";
import {
  classifyAnalysisError,
  enqueuePrAnalysis,
  enqueueRepositoryAnalysis,
  parseGitHubUrl,
  toGitImpactPath,
} from "@gitimpact/analysis";
import { findCachedAnalysis, findInstallationIdForOwner } from "@gitimpact/db";
import { resolveGitHubToken, resolveRepositoryHeadSha, getPullRequestMeta } from "@gitimpact/git";
import { ANALYSIS_SCHEMA_VERSION } from "@gitimpact/shared";
import {
  apiError,
  consumeRateLimit,
  createRequestId,
  log,
  incMetric,
} from "@gitimpact/ops";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = createRequestId(request.headers.get("x-request-id"));

  try {
    const body = (await request.json()) as { repository?: string; depth?: number };
    if (!body.repository?.trim()) {
      return NextResponse.json(
        apiError("INVALID_REQUEST", "repository is required", {
          requestId,
          retryable: false,
        }),
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const clientKey =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anonymous";
    const limit = await consumeRateLimit(`analyze:${clientKey}`);
    if (!limit.allowed) {
      incMetric("analyses_failed_total", 1, { reason: "rate_limited" });
      return NextResponse.json(
        apiError("RATE_LIMITED", "Too many analysis requests.", {
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

    const parsed = parseGitHubUrl(body.repository);
    const depth = body.depth ?? 3;
    const maxFiles = Number(process.env.GITIMPACT_MAX_FILES ?? 800);

    const installationId = await findInstallationIdForOwner(parsed.owner);
    const token = await resolveGitHubToken({ installationId });

    // Pull request URL → durable PR job
    if (parsed.kind === "pull_request" && parsed.prNumber) {
      const pr = await getPullRequestMeta(parsed.owner, parsed.repo, parsed.prNumber, token);
      const cached = await findCachedAnalysis({
        owner: parsed.owner,
        repo: parsed.repo,
        prNumber: parsed.prNumber,
        headSha: pr.headSha,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
      });
      if (cached) {
        incMetric("cache_hit_total", 1, { kind: "analyze_api_pr" });
        return NextResponse.json(
          {
            status: "SUCCEEDED",
            fromCache: true,
            id: cached.id,
            routePath: cached.routePath || toGitImpactPath(parsed),
            commitSha: pr.headSha,
            requestId,
          },
          { headers: { "x-request-id": requestId } },
        );
      }
      incMetric("cache_miss_total", 1, { kind: "analyze_api_pr" });

      const queued = await enqueuePrAnalysis({
        deliveryId: `api-${requestId}`,
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.prNumber,
        action: "api",
        installationId: installationId ?? undefined,
        headSha: pr.headSha,
        requestId,
        maxFiles,
        depth,
      });

      log("info", "analyze_enqueued", {
        requestId,
        jobId: queued.jobId,
        repository: `${parsed.owner}/${parsed.repo}`,
        pullRequestNumber: parsed.prNumber,
        status: "QUEUED",
      });

      return NextResponse.json(
        {
          jobId: queued.jobId,
          status: "QUEUED",
          phase: "QUEUED",
          deduped: queued.deduped ?? false,
          owner: parsed.owner,
          repo: parsed.repo,
          pullRequestNumber: parsed.prNumber,
          commitSha: pr.headSha,
          requestId,
        },
        { status: 202, headers: { "x-request-id": requestId } },
      );
    }

    // Repository URL → resolve SHA → cache → enqueue
    const { sha: commitSha } = await resolveRepositoryHeadSha({
      owner: parsed.owner,
      repo: parsed.repo,
      ref: parsed.branch,
      token,
    });

    const cached = await findCachedAnalysis({
      owner: parsed.owner,
      repo: parsed.repo,
      commitSha,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
    });
    if (cached) {
      incMetric("cache_hit_total", 1, { kind: "analyze_api_repo" });
      log("info", "analyze_cache_hit", {
        requestId,
        repository: `${parsed.owner}/${parsed.repo}`,
        commitSha,
      });
      return NextResponse.json(
        {
          status: "SUCCEEDED",
          fromCache: true,
          id: cached.id,
          routePath: cached.routePath || toGitImpactPath(parsed),
          commitSha,
          requestId,
        },
        { headers: { "x-request-id": requestId } },
      );
    }
    incMetric("cache_miss_total", 1, { kind: "analyze_api_repo" });

    const queued = await enqueueRepositoryAnalysis({
      owner: parsed.owner,
      repo: parsed.repo,
      commitSha,
      installationId: installationId ?? undefined,
      requestId,
      maxFiles,
      depth,
      branch: parsed.branch,
    });

    log("info", "analyze_enqueued", {
      requestId,
      jobId: queued.jobId,
      repository: `${parsed.owner}/${parsed.repo}`,
      commitSha,
      status: "QUEUED",
      deduped: queued.deduped,
    });

    return NextResponse.json(
      {
        jobId: queued.jobId,
        status: "QUEUED",
        phase: "QUEUED",
        deduped: queued.deduped ?? false,
        owner: parsed.owner,
        repo: parsed.repo,
        commitSha,
        requestId,
      },
      { status: 202, headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/QUEUE_UNAVAILABLE/i.test(message)) {
      log("error", "analyze_enqueue_failed", {
        requestId,
        code: "QUEUE_UNAVAILABLE",
        detail: "Redis queue unavailable",
      });
      incMetric("analyses_failed_total", 1, { code: "QUEUE_UNAVAILABLE" });
      return NextResponse.json(
        apiError("QUEUE_UNAVAILABLE", "Analysis queue is temporarily unavailable.", {
          requestId,
          retryable: true,
          action: "retry",
        }),
        { status: 503, headers: { "x-request-id": requestId } },
      );
    }
    if (
      /DATABASE_UNAVAILABLE|ECONNREFUSED|Connection terminated|Failed query/i.test(message)
    ) {
      log("error", "analyze_enqueue_failed", {
        requestId,
        code: "DATABASE_UNAVAILABLE",
        detail: "database unavailable",
      });
      incMetric("analyses_failed_total", 1, { code: "DATABASE_UNAVAILABLE" });
      return NextResponse.json(
        apiError("DATABASE_UNAVAILABLE", "Database is temporarily unavailable.", {
          requestId,
          retryable: true,
          action: "retry",
        }),
        { status: 503, headers: { "x-request-id": requestId } },
      );
    }

    const classified = classifyAnalysisError(error);
    const code = (classified.code as string) || "ANALYSIS_FAILED";
    const status =
      classified.code === "PRIVATE_REPOSITORY" || classified.code === "ACCESS_DENIED"
        ? 403
        : classified.code === "NOT_FOUND" || classified.code === "REPOSITORY_NOT_FOUND"
          ? 404
          : code === "QUEUE_UNAVAILABLE"
            ? 503
            : code === "GITHUB_RATE_LIMITED" || code === "RATE_LIMITED"
              ? 429
              : code === "INVALID_REPOSITORY_URL" || code === "UNSUPPORTED_REPOSITORY"
                ? 400
                : 500;

    log("error", "analyze_enqueue_failed", {
      requestId,
      code,
      detail: classified.detail,
    });
    incMetric("analyses_failed_total", 1, { code });

    return NextResponse.json(
      apiError(code as never, classified.message, {
        detail: classified.detail,
        requestId,
        retryable: status >= 500 || code === "GITHUB_RATE_LIMITED",
        action: classified.action,
      }),
      { status, headers: { "x-request-id": requestId } },
    );
  }
}
