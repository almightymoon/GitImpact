export interface ResourceQuotas {
  maxRepositoryFiles: number;
  maxRepositoryBytes: number;
  maxFileBytes: number;
  maxAnalysisDurationMs: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxPrChangedFiles: number;
  analyzeRateLimit: number;
  analyzeRateWindowSeconds: number;
  repoAnalysisTtlHours: number;
  prAnalysisTtlHours: number;
  jobMaxAttempts: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getResourceQuotas(): ResourceQuotas {
  return {
    maxRepositoryFiles: num("GITIMPACT_MAX_REPOSITORY_FILES", num("GITIMPACT_MAX_FILES", 20_000)),
    maxRepositoryBytes: num("GITIMPACT_MAX_REPOSITORY_BYTES", 500 * 1024 * 1024),
    maxFileBytes: num("GITIMPACT_MAX_FILE_BYTES", 2 * 1024 * 1024),
    maxAnalysisDurationMs: num("GITIMPACT_MAX_ANALYSIS_DURATION_MS", 5 * 60 * 1000),
    maxGraphNodes: num("GITIMPACT_MAX_GRAPH_NODES", 100_000),
    maxGraphEdges: num("GITIMPACT_MAX_GRAPH_EDGES", 250_000),
    maxPrChangedFiles: num("GITIMPACT_MAX_PR_CHANGED_FILES", 500),
    analyzeRateLimit: num("GITIMPACT_ANALYZE_RATE_LIMIT", 10),
    analyzeRateWindowSeconds: num("GITIMPACT_ANALYZE_RATE_WINDOW_SECONDS", 60),
    repoAnalysisTtlHours: num("GITIMPACT_REPO_CACHE_TTL_HOURS", 24),
    prAnalysisTtlHours: num("GITIMPACT_PR_CACHE_TTL_HOURS", 6),
    jobMaxAttempts: num("GITIMPACT_JOB_MAX_ATTEMPTS", 3),
  };
}

export type RuntimeMode = "development" | "production" | "test";

export function getRuntimeMode(): RuntimeMode {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

export interface ConfigValidationResult {
  ok: boolean;
  mode: RuntimeMode;
  errors: string[];
  warnings: string[];
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const nodeEnv = env.NODE_ENV;
  const mode: RuntimeMode =
    nodeEnv === "production" ? "production" : nodeEnv === "test" ? "test" : "development";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (mode === "production") {
    if (!env.DATABASE_URL) errors.push("DATABASE_URL is required in production");
    if (!env.REDIS_URL) errors.push("REDIS_URL is required in production");
    if (!env.GITHUB_WEBHOOK_SECRET) errors.push("GITHUB_WEBHOOK_SECRET is required in production");
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      errors.push("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required in production");
    }
    if (!env.GITIMPACT_PUBLIC_URL) warnings.push("GITIMPACT_PUBLIC_URL should be set for PR links");
  } else {
    if (!env.DATABASE_URL) warnings.push("DATABASE_URL unset — using in-memory persistence");
    if (!env.REDIS_URL) warnings.push("REDIS_URL unset — using in-process queue fallback");
  }

  return { ok: errors.length === 0, mode, errors, warnings };
}

export class QuotaExceededError extends Error {
  readonly code:
    | "REPOSITORY_TOO_LARGE"
    | "FILE_LIMIT_EXCEEDED"
    | "GRAPH_LIMIT_EXCEEDED"
    | "ANALYSIS_TIMEOUT";
  readonly detail?: string;
  readonly phase?: string;

  constructor(
    code:
      | "REPOSITORY_TOO_LARGE"
      | "FILE_LIMIT_EXCEEDED"
      | "GRAPH_LIMIT_EXCEEDED"
      | "ANALYSIS_TIMEOUT",
    message: string,
    detail?: string,
    phase?: string,
  ) {
    super(message);
    this.name = "QuotaExceededError";
    this.code = code;
    this.detail = detail;
    this.phase = phase;
  }
}

export function assertFileCount(count: number, max = getResourceQuotas().maxRepositoryFiles): void {
  if (count > max) {
    throw new QuotaExceededError(
      "REPOSITORY_TOO_LARGE",
      `GitImpact found ${count.toLocaleString()} files. The current public-beta limit is ${max.toLocaleString()}.`,
      `files=${count} limit=${max}`,
      "DISCOVERY",
    );
  }
}

export function assertGraphLimits(
  nodes: number,
  edges: number,
  quotas = getResourceQuotas(),
): void {
  if (nodes > quotas.maxGraphNodes) {
    throw new QuotaExceededError(
      "GRAPH_LIMIT_EXCEEDED",
      `Dependency graph reached ${nodes.toLocaleString()} nodes (limit ${quotas.maxGraphNodes.toLocaleString()}).`,
      `nodes=${nodes}`,
      "GRAPH",
    );
  }
  if (edges > quotas.maxGraphEdges) {
    throw new QuotaExceededError(
      "GRAPH_LIMIT_EXCEEDED",
      `Dependency graph reached ${edges.toLocaleString()} edges (limit ${quotas.maxGraphEdges.toLocaleString()}).`,
      `edges=${edges}`,
      "GRAPH",
    );
  }
}

export async function withTimeout<T>(
  phase: string,
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new QuotaExceededError(
              "ANALYSIS_TIMEOUT",
              `Analysis exceeded the configured processing limit during ${phase.toLowerCase()}.`,
              `phase=${phase} timeoutMs=${ms}`,
              phase,
            ),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
