export interface PrAnalysisJob {
  deliveryId: string;
  owner: string;
  repo: string;
  number: number;
  action: string;
  installationId?: number;
  headSha?: string;
  analysisBaseUrl?: string;
}

type JobHandler = (job: PrAnalysisJob) => Promise<void>;

let handler: JobHandler | null = null;
const pending: PrAnalysisJob[] = [];
let pumping = false;

export function registerPrAnalysisHandler(fn: JobHandler): void {
  handler = fn;
}

/**
 * Enqueue a PR analysis job and return immediately.
 * Processes asynchronously in-process (production can swap for Redis/BullMQ later).
 */
export async function enqueuePrAnalysis(
  job: PrAnalysisJob,
): Promise<{ mode: "inline" }> {
  if (!handler) {
    const { processPrAnalysisJob } = await import("./pr-workflow.js");
    handler = processPrAnalysisJob;
  }
  pending.push(job);
  void pumpInlineQueue();
  return { mode: "inline" };
}

async function pumpInlineQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.length > 0) {
      const job = pending.shift();
      if (!job || !handler) continue;
      try {
        await handler(job);
      } catch (error) {
        console.error(
          "[gitimpact] PR analysis job failed",
          job.deliveryId,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    pumping = false;
  }
}
