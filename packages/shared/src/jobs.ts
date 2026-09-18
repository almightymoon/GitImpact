/** v1.0 — job types, analysis schema version, production error codes */

export const ANALYSIS_SCHEMA_VERSION = "1.0";

export type JobType =
  | "ANALYZE_REPOSITORY"
  | "ANALYZE_PULL_REQUEST"
  | "UPDATE_PR_COMMENT"
  | "UPDATE_CHECK_RUN";

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "DEAD_LETTER";

export type AnalysisPhase =
  | "QUEUED"
  | "CLONE"
  | "DISCOVERY"
  | "PARSER"
  | "GRAPH"
  | "FRAMEWORK"
  | "ARCHITECTURE"
  | "CHECKS"
  | "IMPACT"
  | "PERSISTENCE"
  | "GITHUB_COMMENT"
  | "GITHUB_CHECK"
  | "FINALIZING";

/** Lightweight payloads only — never put graphs or tokens here. */
export interface AnalyzeRepositoryJobPayload {
  jobId: string;
  owner: string;
  repo: string;
  commitSha?: string;
  installationId?: number;
  requestedAt: string;
  requestId?: string;
  maxFiles?: number;
  depth?: number;
}

export interface AnalyzePullRequestJobPayload {
  jobId: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  deliveryId?: string;
  installationId?: number;
  headSha?: string;
  baseSha?: string;
  action?: string;
  analysisBaseUrl?: string;
  requestedAt: string;
  requestId?: string;
  maxFiles?: number;
  depth?: number;
}

export interface UpdatePrCommentJobPayload {
  jobId: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  analysisId: string;
  installationId?: number;
  analysisBaseUrl?: string;
  requestedAt: string;
  requestId?: string;
}

export interface UpdateCheckRunJobPayload {
  jobId: string;
  owner: string;
  repo: string;
  headSha: string;
  analysisId: string;
  installationId?: number;
  checkRunId?: number;
  requestedAt: string;
  requestId?: string;
}

export type JobPayload =
  | ({ type: "ANALYZE_REPOSITORY" } & AnalyzeRepositoryJobPayload)
  | ({ type: "ANALYZE_PULL_REQUEST" } & AnalyzePullRequestJobPayload)
  | ({ type: "UPDATE_PR_COMMENT" } & UpdatePrCommentJobPayload)
  | ({ type: "UPDATE_CHECK_RUN" } & UpdateCheckRunJobPayload);

export interface AnalysisJobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: JobPayload;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  phase?: AnalysisPhase;
  dedupeKey?: string;
  owner?: string;
  repo?: string;
  pullRequestNumber?: number;
  commitSha?: string;
  requestId?: string;
  /** Lightweight completion metadata — never graphs/tokens. */
  result?: {
    analysisId?: string;
    routePath?: string;
    fromCache?: boolean;
  };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export type ApiErrorCode =
  | "INVALID_REPOSITORY_URL"
  | "PRIVATE_REPOSITORY"
  | "ACCESS_DENIED"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_TOO_LARGE"
  | "UNSUPPORTED_REPOSITORY"
  | "FILE_LIMIT_EXCEEDED"
  | "ANALYSIS_TIMEOUT"
  | "ANALYSIS_FAILED"
  | "RATE_LIMITED"
  | "GITHUB_RATE_LIMITED"
  | "QUEUE_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "GRAPH_LIMIT_EXCEEDED"
  | "EMPTY_REPOSITORY"
  | "NO_SUPPORTED_FILES"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  detail?: string;
  retryable: boolean;
  requestId?: string;
  retryAfterSeconds?: number;
  phase?: AnalysisPhase;
  action?: "connect_github" | "retry" | "none";
}

export function isRetryableJobError(code?: string, status?: number): boolean {
  if (status && status >= 500) return true;
  if (status === 429) return true;
  const retryable = new Set([
    "ANALYSIS_TIMEOUT",
    "GITHUB_RATE_LIMITED",
    "QUEUE_UNAVAILABLE",
    "DATABASE_UNAVAILABLE",
    "NETWORK_ERROR",
    "CLONE_FAILED_TRANSIENT",
  ]);
  return code ? retryable.has(code) : false;
}

export function isDeterministicJobFailure(code?: string, status?: number): boolean {
  if (status === 401 || status === 403 || status === 404) return true;
  const deterministic = new Set([
    "INVALID_REPOSITORY_URL",
    "PRIVATE_REPOSITORY",
    "ACCESS_DENIED",
    "REPOSITORY_NOT_FOUND",
    "REPOSITORY_TOO_LARGE",
    "UNSUPPORTED_REPOSITORY",
    "FILE_LIMIT_EXCEEDED",
    "GRAPH_LIMIT_EXCEEDED",
    "EMPTY_REPOSITORY",
    "NO_SUPPORTED_FILES",
    "INVALID_REQUEST",
  ]);
  return code ? deterministic.has(code) : false;
}
