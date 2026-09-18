import { describe, expect, it, beforeEach } from "vitest";
import {
  claimWebhookDelivery,
  updateWebhookDelivery,
  __resetDeliveryMemoryForTests,
} from "@gitimpact/db";
import {
  enqueueAnalyzeRepository,
  registerInlineJobHandler,
  getQueueDepth,
  getInlineQueueDepth,
} from "@gitimpact/queue";
import { clearMemoryJobsForTests, getAnalysisJob } from "@gitimpact/db";
import { isRetryableJobError, isDeterministicJobFailure } from "@gitimpact/shared";

describe("webhook delivery idempotency", () => {
  beforeEach(() => {
    __resetDeliveryMemoryForTests();
  });

  it("claims a delivery once and marks duplicates", async () => {
    const first = await claimWebhookDelivery({
      deliveryId: "deliv-1",
      event: "pull_request",
      action: "opened",
      owner: "acme",
      repo: "app",
      prNumber: 1,
    });
    expect(first.claimed).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await claimWebhookDelivery({
      deliveryId: "deliv-1",
      event: "pull_request",
      action: "opened",
      owner: "acme",
      repo: "app",
      prNumber: 1,
    });
    expect(second.duplicate).toBe(true);
    expect(second.claimed).toBe(false);
  });

  it("records failed deliveries without re-claiming", async () => {
    await claimWebhookDelivery({
      deliveryId: "deliv-fail",
      event: "pull_request",
      action: "synchronize",
    });
    await updateWebhookDelivery("deliv-fail", {
      status: "failed",
      error: "GitHub timeout",
    });
    const again = await claimWebhookDelivery({
      deliveryId: "deliv-fail",
      event: "pull_request",
      action: "synchronize",
    });
    expect(again.duplicate).toBe(true);
  });
});

describe("failure injection classification", () => {
  it("treats GitHub 5xx / rate limit as retryable", () => {
    expect(isRetryableJobError("GITHUB_RATE_LIMITED")).toBe(true);
    expect(isRetryableJobError("ANALYSIS_TIMEOUT")).toBe(true);
    expect(isRetryableJobError("CLONE_FAILED_TRANSIENT")).toBe(true);
    expect(isRetryableJobError(undefined, 503)).toBe(true);
    expect(isRetryableJobError(undefined, 429)).toBe(true);
  });

  it("does not retry access / size / unsupported failures", () => {
    expect(isDeterministicJobFailure("PRIVATE_REPOSITORY")).toBe(true);
    expect(isDeterministicJobFailure("REPOSITORY_TOO_LARGE")).toBe(true);
    expect(isDeterministicJobFailure("UNSUPPORTED_REPOSITORY")).toBe(true);
    expect(isDeterministicJobFailure(undefined, 404)).toBe(true);
  });
});

describe("load-ish concurrent enqueue", () => {
  beforeEach(() => {
    clearMemoryJobsForTests();
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  it("dedupes 20 concurrent same-SHA requests to one job", async () => {
    registerInlineJobHandler(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        enqueueAnalyzeRepository({
          owner: "acme",
          repo: "busy",
          commitSha: "same-sha",
        }),
      ),
    );

    const unique = new Set(results.map((r) => r.jobId));
    expect(unique.size).toBe(1);
    expect(results.filter((r) => r.deduped).length).toBeGreaterThanOrEqual(19);

    const depth = await getQueueDepth();
    expect(depth.mode).toBe("inline");
    expect(getInlineQueueDepth()).toBeGreaterThanOrEqual(0);

    await new Promise((r) => setTimeout(r, 200));
    const job = await getAnalysisJob(results[0]!.jobId);
    expect(job?.status).toBe("SUCCEEDED");
  });
});
