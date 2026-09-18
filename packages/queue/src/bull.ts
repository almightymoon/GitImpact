import { log } from "@gitimpact/ops";
import type { JobPayload } from "@gitimpact/shared";

/** Keep in sync with `client.ts` QUEUE_NAME. */
export const BULL_QUEUE_NAME = "gitimpact-analysis";

let bullQueue: import("bullmq").Queue | null = null;

export async function getBullQueue(): Promise<import("bullmq").Queue | null> {
  if (bullQueue) return bullQueue;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const { Queue } = await import("bullmq");
    const ioredisMod = (await import("ioredis")) as unknown as {
      default: new (url: string, opts?: object) => object;
    };
    const connection = new ioredisMod.default(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      commandTimeout: 5_000,
    });
    bullQueue = new Queue(BULL_QUEUE_NAME, { connection: connection as never });
    return bullQueue;
  } catch (error) {
    log("warn", "redis_queue_unavailable", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function addBullJob(
  payload: JobPayload,
  attempts: number,
): Promise<boolean> {
  const queue = await getBullQueue();
  if (!queue) return false;
  try {
    // Manual retries reuse the Postgres job id — remove any prior BullMQ record first.
    try {
      const existing = await queue.getJob(payload.jobId);
      if (existing) await existing.remove();
    } catch {
      // ignore missing/locked jobs
    }
    await Promise.race([
      queue.add(payload.type, payload, {
        jobId: payload.jobId,
        attempts,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("QUEUE_UNAVAILABLE")), 5_000),
      ),
    ]);
    return true;
  } catch (error) {
    log("warn", "redis_enqueue_failed", {
      detail: error instanceof Error ? error.message : String(error),
      jobId: payload.jobId,
    });
    try {
      await closeBullQueue();
    } catch {
      bullQueue = null;
    }
    return false;
  }
}

export async function closeBullQueue(): Promise<void> {
  if (bullQueue) {
    await bullQueue.close();
    bullQueue = null;
  }
}
