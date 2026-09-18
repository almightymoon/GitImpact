import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  clearRateLimitMemoryForTests,
  consumeRateLimit,
  getResourceQuotas,
  validateConfig,
  QuotaExceededError,
  assertFileCount,
  assertGraphLimits,
  createRequestId,
  withTimeout,
} from "@gitimpact/ops";
import {
  enqueueAnalyzePullRequest,
  enqueueAnalyzeRepository,
  registerInlineJobHandler,
  listDeadLetterJobs,
  repoAnalysisDedupeKey,
  prAnalysisDedupeKey,
} from "@gitimpact/queue";
import { clearMemoryJobsForTests, getAnalysisJob, cacheKeyParts } from "@gitimpact/db";
import {
  parseGitHubUrl,
  redactGitCredentials,
  GitHubRateLimitError,
  assertGitHubRateLimit,
} from "@gitimpact/git";
import {
  ANALYSIS_SCHEMA_VERSION,
  isDeterministicJobFailure,
  isRetryableJobError,
} from "@gitimpact/shared";

describe("ops quotas and rate limits", () => {
  beforeEach(() => {
    clearRateLimitMemoryForTests();
  });

  it("rate limits after N requests in a window", async () => {
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await consumeRateLimit(key, { limit: 3, windowSeconds: 60 });
      expect(r.allowed).toBe(true);
    }
    const blocked = await consumeRateLimit(key, { limit: 3, windowSeconds: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("throws REPOSITORY_TOO_LARGE when file count exceeds quota", () => {
    expect(() => assertFileCount(100, 50)).toThrow(QuotaExceededError);
    try {
      assertFileCount(100, 50);
    } catch (error) {
      expect(error).toBeInstanceOf(QuotaExceededError);
      expect((error as QuotaExceededError).code).toBe("REPOSITORY_TOO_LARGE");
    }
  });

  it("throws GRAPH_LIMIT_EXCEEDED", () => {
    expect(() =>
      assertGraphLimits(10, 5, {
        ...getResourceQuotas(),
        maxGraphNodes: 5,
        maxGraphEdges: 100,
      }),
    ).toThrow(QuotaExceededError);
  });

  it("withTimeout records ANALYSIS_TIMEOUT phase", async () => {
    await expect(
      withTimeout("PARSER", 20, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "ok";
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_TIMEOUT", phase: "PARSER" });
  });

  it("validates production config requires redis + db", () => {
    const result = validateConfig({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /DATABASE_URL/.test(e))).toBe(true);
    expect(result.errors.some((e) => /REDIS_URL/.test(e))).toBe(true);
  });

  it("creates request ids", () => {
    expect(createRequestId()).toMatch(/^req_/);
    expect(createRequestId("req_abc12345")).toBe("req_abc12345");
  });

  it("exposes public-beta quota defaults", () => {
    const q = getResourceQuotas();
    expect(q.analyzeRateLimit).toBeGreaterThan(0);
    expect(q.maxRepositoryFiles).toBeGreaterThan(0);
    expect(q.jobMaxAttempts).toBeGreaterThanOrEqual(1);
  });
});

describe("clone / URL safety", () => {
  it("rejects non-GitHub and file protocols", () => {
    expect(() => parseGitHubUrl("file:///etc/passwd")).toThrow(/HTTPS GitHub/);
    expect(() => parseGitHubUrl("https://evil.example/owner/repo")).toThrow();
  });

  it("rejects path-like owner names", () => {
    expect(() => parseGitHubUrl("github.com/acme/foo..bar")).toThrow(/Invalid/);
    expect(() => parseGitHubUrl("github.com/own..er/repo")).toThrow(/Invalid/);
  });

  it("redacts tokens from clone URLs", () => {
    const raw = "https://x-access-token:ghs_secretvalue@github.com/acme/app.git";
    expect(redactGitCredentials(raw)).not.toContain("ghs_secretvalue");
  });
});

describe("GitHub rate limit awareness", () => {
  it("throws GITHUB_RATE_LIMITED on 429", () => {
    const headers = new Headers({
      "retry-after": "42",
      "x-ratelimit-remaining": "0",
    });
    const response = new Response("rate limited", { status: 429, headers });
    expect(() => assertGitHubRateLimit(response)).toThrow(GitHubRateLimitError);
    try {
      assertGitHubRateLimit(response);
    } catch (error) {
      expect((error as GitHubRateLimitError).code).toBe("GITHUB_RATE_LIMITED");
      expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(42);
    }
  });
});

describe("retry classification", () => {
  it("does not retry deterministic failures", () => {
    expect(isDeterministicJobFailure("REPOSITORY_TOO_LARGE")).toBe(true);
    expect(isDeterministicJobFailure("PRIVATE_REPOSITORY")).toBe(true);
    expect(isRetryableJobError("GITHUB_RATE_LIMITED")).toBe(true);
    expect(isRetryableJobError("ANALYSIS_TIMEOUT")).toBe(true);
  });
});

describe("cache keys", () => {
  it("includes schema version and commit sha", () => {
    expect(ANALYSIS_SCHEMA_VERSION).toBe("1.0");
    expect(
      cacheKeyParts({ owner: "a", repo: "b", commitSha: "abc", schemaVersion: "1.0" }),
    ).toContain("abc");
    expect(
      cacheKeyParts({ owner: "a", repo: "b", commitSha: "abc", schemaVersion: "1.0" }),
    ).toContain("v1.0");
  });

  it("builds stable dedupe keys", () => {
    expect(repoAnalysisDedupeKey("o", "r", "sha")).toBe("repo-analysis:o/r:sha");
    expect(prAnalysisDedupeKey("o", "r", 3, "head")).toBe("pr-analysis:o/r#3:head");
  });
});

describe("queue dead-letter and dedupe", () => {
  const previousDb = process.env.DATABASE_URL;
  const previousRedis = process.env.REDIS_URL;

  beforeEach(() => {
    clearMemoryJobsForTests();
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (previousDb) process.env.DATABASE_URL = previousDb;
    else delete process.env.DATABASE_URL;
    if (previousRedis) process.env.REDIS_URL = previousRedis;
    else delete process.env.REDIS_URL;
  });

  it("moves deterministic failures to dead letter without infinite retry", async () => {
    registerInlineJobHandler(async () => {
      const err = new Error("Repository not found on GitHub.");
      (err as Error & { code?: string }).code = "REPOSITORY_NOT_FOUND";
      throw err;
    });

    const queued = await enqueueAnalyzePullRequest({
      owner: "acme",
      repo: "missing",
      pullRequestNumber: 1,
      deliveryId: "d-1",
    });
    expect(queued.jobId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 300));
    const done = await getAnalysisJob(queued.jobId);
    expect(done?.status).toBe("DEAD_LETTER");
    const dead = await listDeadLetterJobs(10);
    expect(dead.some((j) => j.id === queued.jobId)).toBe(true);
  });

  it("dedupes concurrent repository analysis by sha", async () => {
    registerInlineJobHandler(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    const a = await enqueueAnalyzeRepository({
      owner: "acme",
      repo: "app",
      commitSha: "deadbeef",
    });
    const b = await enqueueAnalyzeRepository({
      owner: "acme",
      repo: "app",
      commitSha: "deadbeef",
    });
    expect(b.deduped).toBe(true);
    expect(b.jobId).toBe(a.jobId);
  });
});
