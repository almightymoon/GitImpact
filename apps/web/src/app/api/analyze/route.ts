import { NextResponse } from "next/server";
import {
  analyzeRepositoryUrl,
  classifyAnalysisError,
  parseGitHubUrl,
  toGitImpactPath,
} from "@gitimpact/analysis";
import {
  apiError,
  consumeRateLimit,
  createRequestId,
  log,
  observeMetric,
  incMetric,
} from "@gitimpact/ops";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestId = createRequestId(request.headers.get("x-request-id"));
  const started = Date.now();

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
    log("info", "analyze_started", {
      requestId,
      repository: `${parsed.owner}/${parsed.repo}`,
    });

    const analysis = await analyzeRepositoryUrl(body.repository, {
      depth: body.depth ?? 3,
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
    });

    observeMetric("analysis_duration_ms", Date.now() - started, { kind: "repository" });
    incMetric("analyses_succeeded_total", 1, { kind: "repository" });

    return NextResponse.json(
      {
        id: analysis.id,
        routePath: analysis.routePath || toGitImpactPath(parsed),
        summary: analysis.summary,
        intelligence: analysis.intelligence,
        requestId,
        repository: {
          owner: analysis.repository.owner,
          name: analysis.repository.name,
          url: analysis.repository.url,
          defaultBranch: analysis.repository.defaultBranch,
        },
        pullRequest: analysis.pullRequest,
        prOverview: analysis.prOverview,
        impact: analysis.impact
          ? {
              complexityScore: analysis.impact.complexityScore,
              summary: analysis.impact.summary,
              affectedFiles: analysis.impact.affectedFiles.length,
              directImpact: analysis.impact.directImpact.length,
              indirectImpact: analysis.impact.indirectImpact.length,
              relatedTests: analysis.impact.relatedTests.length,
              missingTests: analysis.impact.missingTests.length,
            }
          : undefined,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const classified = classifyAnalysisError(error);
    const code = (classified.code as string) || "ANALYSIS_FAILED";
    const status =
      classified.code === "PRIVATE_REPOSITORY" || classified.code === "ACCESS_DENIED"
        ? 403
        : classified.code === "NOT_FOUND" || classified.code === "REPOSITORY_NOT_FOUND"
          ? 404
          : code === "REPOSITORY_TOO_LARGE" ||
              code === "FILE_LIMIT_EXCEEDED" ||
              code === "GRAPH_LIMIT_EXCEEDED"
            ? 413
            : code === "ANALYSIS_TIMEOUT"
              ? 504
              : code === "GITHUB_RATE_LIMITED" || code === "RATE_LIMITED"
                ? 429
                : code === "INVALID_REPOSITORY_URL" || code === "UNSUPPORTED_REPOSITORY"
                  ? 400
                  : 500;

    log("error", "analyze_failed", {
      requestId,
      code,
      detail: classified.detail,
      durationMs: Date.now() - started,
    });
    incMetric("analyses_failed_total", 1, { code });

    return NextResponse.json(
      apiError(code as never, classified.message, {
        detail: classified.detail,
        requestId,
        retryable: status >= 500 || code === "ANALYSIS_TIMEOUT",
        action: classified.action,
      }),
      { status, headers: { "x-request-id": requestId } },
    );
  }
}
