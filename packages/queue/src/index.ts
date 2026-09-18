export {
  QUEUE_NAME,
  registerInlineJobHandler,
  runJobWithLifecycle,
  enqueueAnalyzeRepository,
  enqueueAnalyzePullRequest,
  enqueueJob,
  retryDeadLetterJob,
  listFailedJobs,
  listDeadLetterJobs,
  getAnalysisJob,
  closeQueue,
  repoAnalysisDedupeKey,
  prAnalysisDedupeKey,
  getInlineQueueDepth,
  getQueueDepth,
  type EnqueueMode,
  type EnqueueResult,
} from "./client.js";

/** Worker entry lives at `@gitimpact/queue/workers` — keep BullMQ out of the web bundle. */
