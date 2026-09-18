import { randomUUID } from "node:crypto";
import type {
  AnalyzePullRequestJobPayload,
  AnalyzeRepositoryJobPayload,
  JobPayload,
  JobType,
} from "@gitimpact/shared";
import { isDeterministicJobFailure, isRetryableJobError } from "@gitimpact/shared";
import {
  createAnalysisJob,
  findActiveJobByDedupeKey,
  getAnalysisJob,
  listDeadLetterJobs,
  listFailedJobs,
  updateAnalysisJob,
} from "@gitimpact/db";
import {
  getResourceQuotas,
  getRuntimeMode,
  incMetric,
  log,
  observeMetric,
} from "@gitimpact/ops";

export const QUEUE_NAME = "gitimpact-analysis";

export type EnqueueMode = "redis" | "inline";

export interface EnqueueResult {
  jobId: string;
  mode: EnqueueMode;
  deduped?: boolean;
  existingJobId?: string;
}

type JobHandler = (payload: JobPayload) => Promise<void>;

let inlineHandler: JobHandler | null = null;
const inlinePending: JobPayload[] = [];
let pumping = false;

export function registerInlineJobHandler(handler: JobHandler): void {
  inlineHandler = handler;
}

function newJobId(): string {
  return `job_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function repoAnalysisDedupeKey(owner: string, repo: string, commitSha?: string): string {
  return `repo-analysis:${owner}/${repo}:${commitSha ?? "HEAD"}`;
}

export function prAnalysisDedupeKey(
  owner: string,
  repo: string,
  number: number,
  headSha?: string,
): string {
  return `pr-analysis:${owner}/${repo}#${number}:${headSha ?? "HEAD"}`;
}

function backoffMs(attempt: number): number {
  return Math.min(60_000, 2000 * 4 ** Math.max(0, attempt - 1));
}

async function enqueueDurable(payload: JobPayload, dedupeKey?: string): Promise<EnqueueResult> {
  if (dedupeKey) {
    const existing = await findActiveJobByDedupeKey(dedupeKey);
    if (existing) {
      incMetric("cache_hit_total", 1, { kind: "job_dedupe" });
      return {
        jobId: existing.id,
        mode: process.env.REDIS_URL ? "redis" : "inline",
        deduped: true,
        existingJobId: existing.id,
      };
    }
  }

  const quotas = getResourceQuotas();
  await createAnalysisJob({
    id: payload.jobId,
    type: payload.type,
    payload,
    dedupeKey,
    owner: "owner" in payload ? payload.owner : undefined,
    repo: "repo" in payload ? payload.repo : undefined,
    pullRequestNumber:
      "pullRequestNumber" in payload ? payload.pullRequestNumber : undefined,
    commitSha:
      "commitSha" in payload
        ? payload.commitSha
        : "headSha" in payload
          ? payload.headSha
          : undefined,
    requestId: payload.requestId,
    maxAttempts: quotas.jobMaxAttempts,
  });

  const preferRedis =
    Boolean(process.env.REDIS_URL) &&
    !(getRuntimeMode() !== "production" && process.env.GITIMPACT_FORCE_INLINE_QUEUE === "1");

  if (preferRedis) {
    const { addBullJob } = await import("./bull.js");
    const added = await addBullJob(payload, quotas.jobMaxAttempts);
    if (added) {
      incMetric("analyses_started_total", 1, { type: payload.type, mode: "redis" });
      return { jobId: payload.jobId, mode: "redis" };
    }
    if (getRuntimeMode() === "production") {
      throw new Error("QUEUE_UNAVAILABLE");
    }
  }

  if (getRuntimeMode() === "production") {
    throw new Error("QUEUE_UNAVAILABLE: REDIS_URL required in production");
  }

  inlinePending.push(payload);
  void pumpInline();
  incMetric("analyses_started_total", 1, { type: payload.type, mode: "inline" });
  return { jobId: payload.jobId, mode: "inline" };
}

async function pumpInline(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (inlinePending.length > 0) {
      const payload = inlinePending.shift();
      if (!payload) continue;
      try {
        await runJobWithLifecycle(payload, inlineHandler);
      } catch (error) {
        log("error", "inline_job_failed", {
          jobId: payload.jobId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    pumping = false;
  }
}

export async function runJobWithLifecycle(
  payload: JobPayload,
  handler?: JobHandler | null,
): Promise<void> {
  const started = Date.now();
  const activeHandler = handler ?? inlineHandler;
  await updateAnalysisJob(payload.jobId, {
    status: "RUNNING",
    startedAt: new Date(),
    attemptCount: ((await getAnalysisJob(payload.jobId))?.attemptCount ?? 0) + 1,
    phase: "QUEUED",
    lastError: null,
  });

  try {
    if (!activeHandler) {
      throw new Error("No job handler registered");
    }
    await activeHandler(payload);
    await updateAnalysisJob(payload.jobId, {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      phase: "FINALIZING",
      lastError: null,
    });
    incMetric("analyses_succeeded_total", 1, { type: payload.type });
    observeMetric("analysis_duration_ms", Date.now() - started, { type: payload.type });
    log("info", "job_succeeded", {
      jobId: payload.jobId,
      requestId: payload.requestId,
      durationMs: Date.now() - started,
      status: "SUCCEEDED",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : undefined;
    const job = await getAnalysisJob(payload.jobId);
    const attempts = job?.attemptCount ?? 1;
    const maxAttempts = job?.maxAttempts ?? getResourceQuotas().jobMaxAttempts;
    const deterministic = isDeterministicJobFailure(code);
    const retryable = !deterministic && isRetryableJobError(code);

    if (!retryable || attempts >= maxAttempts || deterministic) {
      await updateAnalysisJob(payload.jobId, {
        status: "DEAD_LETTER",
        finishedAt: new Date(),
        lastError: message.slice(0, 2000),
      });
      incMetric("analyses_failed_total", 1, { type: payload.type, dead_letter: "1" });
      log("error", "job_dead_letter", {
        jobId: payload.jobId,
        requestId: payload.requestId,
        code,
        status: "DEAD_LETTER",
        durationMs: Date.now() - started,
      });
      throw error;
    }

    await updateAnalysisJob(payload.jobId, {
      status: "RETRYING",
      lastError: message.slice(0, 2000),
    });
    incMetric("job_retry_total", 1, { type: payload.type });
    log("warn", "job_retrying", {
      jobId: payload.jobId,
      requestId: payload.requestId,
      code,
      status: "RETRYING",
      attempt: attempts,
    });

    if (!process.env.REDIS_URL) {
      await new Promise((r) => setTimeout(r, backoffMs(attempts)));
      inlinePending.push(payload);
      void pumpInline();
    } else {
      throw error;
    }
  }
}

export async function enqueueAnalyzeRepository(
  input: Omit<AnalyzeRepositoryJobPayload, "jobId" | "requestedAt"> & {
    jobId?: string;
    requestedAt?: string;
  },
): Promise<EnqueueResult> {
  const jobId = input.jobId ?? newJobId();
  const payload: JobPayload = {
    type: "ANALYZE_REPOSITORY",
    jobId,
    owner: input.owner,
    repo: input.repo,
    commitSha: input.commitSha,
    installationId: input.installationId,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    requestId: input.requestId,
    maxFiles: input.maxFiles,
    depth: input.depth,
  };
  return enqueueDurable(
    payload,
    repoAnalysisDedupeKey(input.owner, input.repo, input.commitSha),
  );
}

export async function enqueueAnalyzePullRequest(
  input: Omit<AnalyzePullRequestJobPayload, "jobId" | "requestedAt"> & {
    jobId?: string;
    requestedAt?: string;
  },
): Promise<EnqueueResult> {
  const jobId = input.jobId ?? newJobId();
  const payload: JobPayload = {
    type: "ANALYZE_PULL_REQUEST",
    jobId,
    owner: input.owner,
    repo: input.repo,
    pullRequestNumber: input.pullRequestNumber,
    deliveryId: input.deliveryId,
    installationId: input.installationId,
    headSha: input.headSha,
    baseSha: input.baseSha,
    action: input.action,
    analysisBaseUrl: input.analysisBaseUrl,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    requestId: input.requestId,
    maxFiles: input.maxFiles,
    depth: input.depth,
  };
  return enqueueDurable(
    payload,
    prAnalysisDedupeKey(input.owner, input.repo, input.pullRequestNumber, input.headSha),
  );
}

export async function enqueueJob(type: JobType, payload: JobPayload): Promise<EnqueueResult> {
  void type;
  return enqueueDurable(payload);
}

export async function retryDeadLetterJob(jobId: string): Promise<EnqueueResult | undefined> {
  const job = await getAnalysisJob(jobId);
  if (!job || (job.status !== "DEAD_LETTER" && job.status !== "FAILED")) return undefined;
  await updateAnalysisJob(jobId, {
    status: "QUEUED",
    attemptCount: 0,
    lastError: null,
    finishedAt: null,
    startedAt: null,
  });
  const nextPayload = { ...job.payload, jobId, requestedAt: new Date().toISOString() };
  return enqueueDurable(nextPayload, job.dedupeKey);
}

export { listFailedJobs, listDeadLetterJobs, getAnalysisJob };

export async function closeQueue(): Promise<void> {
  if (!process.env.REDIS_URL) return;
  const { closeBullQueue } = await import("./bull.js");
  await closeBullQueue();
}
