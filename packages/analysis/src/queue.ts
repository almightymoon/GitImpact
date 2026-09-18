/**
 * Job enqueue helpers for web + webhooks.
 * Prefer `@gitimpact/queue` for low-level APIs.
 */
import {
  enqueueAnalyzePullRequest,
  enqueueAnalyzeRepository,
  registerInlineJobHandler,
  type EnqueueResult,
} from "@gitimpact/queue";
import { updateAnalysisJob } from "@gitimpact/db";

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
  maxFiles?: number;
  depth?: number;
}

export interface RepoAnalysisJob {
  owner: string;
  repo: string;
  commitSha?: string;
  installationId?: number;
  requestId?: string;
  maxFiles?: number;
  depth?: number;
  branch?: string;
}

let registered = false;

/**
 * Register inline handlers when Redis is unset (local/dev).
 * Production uses apps/worker + BullMQ.
 */
export async function ensureInlineAnalysisHandlers(): Promise<void> {
  if (registered || process.env.REDIS_URL) return;

  registerInlineJobHandler(async (payload) => {
    if (payload.type === "ANALYZE_REPOSITORY") {
      const { analyzeRepositoryUrl } = await import("./index.js");
      const analysis = await analyzeRepositoryUrl(
        `https://github.com/${payload.owner}/${payload.repo}`,
        {
          depth: payload.depth ?? Number(process.env.GITIMPACT_DEPTH ?? 3),
          maxFiles: payload.maxFiles ?? Number(process.env.GITIMPACT_MAX_FILES ?? 800),
          onPhase: async (phase) => {
            await updateAnalysisJob(payload.jobId, { phase });
          },
        },
      );
      await updateAnalysisJob(payload.jobId, {
        result: {
          analysisId: analysis.id,
          routePath: analysis.routePath,
          fromCache: analysis.fromCache,
        },
        commitSha: analysis.commitSha ?? payload.commitSha ?? null,
      });
      return;
    }

    if (payload.type === "ANALYZE_PULL_REQUEST") {
      const { processPrAnalysisJob } = await import("./pr-workflow.js");
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
      await updateAnalysisJob(payload.jobId, {
        result: {
          analysisId: `${payload.owner}/${payload.repo}/pull/${payload.pullRequestNumber}`,
          routePath: `/${payload.owner}/${payload.repo}/pull/${payload.pullRequestNumber}`,
        },
      });
      return;
    }

    throw new Error(`Unsupported inline job type: ${payload.type}`);
  });

  registered = true;
}

export async function enqueuePrAnalysis(job: PrAnalysisJob): Promise<EnqueueResult> {
  await ensureInlineAnalysisHandlers();
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
    maxFiles: job.maxFiles,
    depth: job.depth,
  });
}

export async function enqueueRepositoryAnalysis(
  job: RepoAnalysisJob,
): Promise<EnqueueResult> {
  await ensureInlineAnalysisHandlers();
  return enqueueAnalyzeRepository({
    owner: job.owner,
    repo: job.repo,
    commitSha: job.commitSha,
    installationId: job.installationId,
    requestId: job.requestId,
    maxFiles: job.maxFiles,
    depth: job.depth,
  });
}

export type { EnqueueResult };
