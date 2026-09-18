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
    const connection = new ioredisMod.default(redisUrl, { maxRetriesPerRequest: null });
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
  await queue.add(payload.type, payload, {
    jobId: payload.jobId,
    attempts,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
  return true;
}

export async function closeBullQueue(): Promise<void> {
  if (bullQueue) {
    await bullQueue.close();
    bullQueue = null;
  }
}
