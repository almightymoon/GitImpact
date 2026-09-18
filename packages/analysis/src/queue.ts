/**
 * Compatibility shim — prefer `@gitimpact/queue` for new code.
 * Keeps existing webhook imports working.
 */
import {
  enqueueAnalyzePullRequest,
  registerInlineJobHandler,
  type EnqueueResult,
} from "@gitimpact/queue";

export interface PrAnalysisJob {
  deliveryId: string;
  owner: string;
  repo: string;
  number: number;
  action: string;
  installationId?: number;
  headSha?: string;
  analysisBaseUrl?: string;
  requestId?: string;
}

let registered = false;

async function ensureInlineHandler(): Promise<void> {
  if (registered || process.env.REDIS_URL) return;
  const { processPrAnalysisJob } = await import("./pr-workflow.js");
  registerInlineJobHandler(async (payload) => {
    if (payload.type !== "ANALYZE_PULL_REQUEST") {
      throw new Error(`Unsupported inline job type: ${payload.type}`);
    }
    await processPrAnalysisJob({
      deliveryId: payload.deliveryId ?? payload.jobId,
      owner: payload.owner,
      repo: payload.repo,
      number: payload.pullRequestNumber,
      action: payload.action ?? "synchronize",
      installationId: payload.installationId,
      headSha: payload.headSha,
      analysisBaseUrl: payload.analysisBaseUrl,
    });
  });
  registered = true;
}

/**
 * Enqueue a PR analysis job (durable Redis/BullMQ when REDIS_URL is set).
 */
export async function enqueuePrAnalysis(
  job: PrAnalysisJob,
): Promise<EnqueueResult> {
  await ensureInlineHandler();
  return enqueueAnalyzePullRequest({
    owner: job.owner,
    repo: job.repo,
    pullRequestNumber: job.number,
    deliveryId: job.deliveryId,
    installationId: job.installationId,
    headSha: job.headSha,
    action: job.action,
    analysisBaseUrl: job.analysisBaseUrl,
    requestId: job.requestId,
  });
}

export type { EnqueueResult };
