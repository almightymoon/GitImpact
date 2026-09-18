/**
 * Optional Redis/Postgres integration tests.
 *
 * Run with Docker services up:
 *
 *   pnpm db:up
 *   DATABASE_URL=postgresql://gitimpact:gitimpact@127.0.0.1:5432/gitimpact \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   pnpm --filter @gitimpact/accuracy-tests exec vitest run integration.test.ts
 *
 * Without those env vars the suite is skipped (CI stays green offline).
 */
import { describe, expect, it, beforeAll } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.REDIS_URL?.trim();
const enabled = Boolean(databaseUrl && redisUrl);

describe.skipIf(!enabled)("redis/postgres integration", () => {
  beforeAll(() => {
    expect(databaseUrl).toBeTruthy();
    expect(redisUrl).toBeTruthy();
  });

  it("persists jobs across getAnalysisJob round-trip", async () => {
    const { createAnalysisJob, getAnalysisJob, clearMemoryJobsForTests } =
      await import("@gitimpact/db");
    clearMemoryJobsForTests();
    const id = `job_integ_${Date.now()}`;
    await createAnalysisJob({
      id,
      type: "ANALYZE_REPOSITORY",
      payload: {
        type: "ANALYZE_REPOSITORY",
        jobId: id,
        owner: "acme",
        repo: "integ",
        commitSha: "abc",
        requestedAt: new Date().toISOString(),
      },
      owner: "acme",
      repo: "integ",
      commitSha: "abc",
      dedupeKey: `repo-analysis:acme/integ:abc`,
    });
    const loaded = await getAnalysisJob(id);
    expect(loaded?.id).toBe(id);
    expect(loaded?.status).toBe("QUEUED");
    expect(loaded?.commitSha).toBe("abc");
  });

  it("pings redis and reports queue depth", async () => {
    const { redisPing } = await import("@gitimpact/ops");
    const { getQueueDepth } = await import("@gitimpact/queue");
    expect(await redisPing()).toBe(true);
    const depth = await getQueueDepth();
    expect(depth.mode).toBe("redis");
    expect(depth.waiting).toBeGreaterThanOrEqual(0);
  });

  it("dedupes active jobs by dedupe key in postgres", async () => {
    const {
      createAnalysisJob,
      findActiveJobByDedupeKey,
      updateAnalysisJob,
    } = await import("@gitimpact/db");
    const dedupeKey = `repo-analysis:acme/dedupe:${Date.now()}`;
    const firstId = `job_d1_${Date.now()}`;
    await createAnalysisJob({
      id: firstId,
      type: "ANALYZE_REPOSITORY",
      payload: {
        type: "ANALYZE_REPOSITORY",
        jobId: firstId,
        owner: "acme",
        repo: "dedupe",
        requestedAt: new Date().toISOString(),
      },
      dedupeKey,
      owner: "acme",
      repo: "dedupe",
    });
    const active = await findActiveJobByDedupeKey(dedupeKey);
    expect(active?.id).toBe(firstId);
    await updateAnalysisJob(firstId, { status: "SUCCEEDED", finishedAt: new Date() });
    const after = await findActiveJobByDedupeKey(dedupeKey);
    expect(after).toBeUndefined();
  });
});

describe("integration gate", () => {
  it("documents how to enable redis/postgres tests", () => {
    if (!enabled) {
      expect(true).toBe(true);
    } else {
      expect(databaseUrl).toMatch(/^postgres/);
      expect(redisUrl).toMatch(/^redis/);
    }
  });
});
