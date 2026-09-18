import { Worker } from "bullmq";
import type { JobPayload } from "@gitimpact/shared";
import { log, closeRedis, validateConfig } from "@gitimpact/ops";
import {
  QUEUE_NAME,
  registerInlineJobHandler,
  runJobWithLifecycle,
  closeQueue,
} from "./client.js";

export type WorkerProcessor = (payload: JobPayload) => Promise<void>;

export async function startAnalysisWorker(processor: WorkerProcessor): Promise<{
  close: () => Promise<void>;
}> {
  const validation = validateConfig();
  for (const w of validation.warnings) log("warn", "config_warning", { detail: w });
  if (!validation.ok) {
    for (const e of validation.errors) log("error", "config_error", { detail: e });
    if (validation.mode === "production") {
      throw new Error(`Invalid production config: ${validation.errors.join("; ")}`);
    }
  }

  registerInlineJobHandler(processor);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log("info", "worker_inline_mode", {
      detail: "REDIS_URL unset — worker will process inline enqueues only",
    });
    return {
      close: async () => {
        await closeQueue();
        await closeRedis();
      },
    };
  }

  const ioredisMod = (await import("ioredis")) as unknown as {
    default: new (url: string, opts?: object) => object;
  };
  const connection = new ioredisMod.default(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const payload = job.data as JobPayload;
      await runJobWithLifecycle(payload, processor);
    },
    {
      connection: connection as never,
      concurrency: Number(process.env.GITIMPACT_WORKER_CONCURRENCY ?? 2),
    },
  );

  worker.on("failed", (job, err) => {
    log("error", "bullmq_job_failed", {
      jobId: job?.id,
      detail: err.message,
    });
  });

  log("info", "worker_started", { queue: QUEUE_NAME });

  const shutdown = async () => {
    log("info", "worker_shutting_down", {});
    await worker.close();
    await (connection as { quit: () => Promise<void> }).quit();
    await closeQueue();
    await closeRedis();
  };

  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  return { close: shutdown };
}
