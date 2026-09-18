import type { JobPayload } from "@gitimpact/shared";
import { log, observeMetric, incMetric } from "@gitimpact/ops";
import { startAnalysisWorker } from "@gitimpact/queue/workers";
import { updateWebhookDelivery } from "@gitimpact/db";
import {
  completeCheckRun,
  createCheckRun,
  formatCheckRunSummary,
  resolveGitHubToken,
  upsertPullRequestComment,
} from "@gitimpact/git";
import { GraphStore } from "@gitimpact/graph";
import { explainImpactPath } from "@gitimpact/impact-engine";
import {
  analyzePullRequest,
  analyzeRepositoryUrl,
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
  selectWhyPath,
} from "@gitimpact/analysis";
import { updateAnalysisJob } from "@gitimpact/db";

async function processPayload(payload: JobPayload): Promise<void> {
  const started = Date.now();
  const repo =
    "owner" in payload && "repo" in payload ? `${payload.owner}/${payload.repo}` : undefined;

  log("info", "job_started", {
    jobId: payload.jobId,
    requestId: payload.requestId,
    repository: repo,
    status: "RUNNING",
  });

  if (payload.type === "ANALYZE_REPOSITORY") {
    await updateAnalysisJob(payload.jobId, { phase: "CLONE" });
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
    observeMetric("analysis.phase.duration", Date.now() - started, { phase: "repository" });
    return;
  }

  if (payload.type === "ANALYZE_PULL_REQUEST") {
    if (payload.deliveryId) {
      await updateWebhookDelivery(payload.deliveryId, { status: "processing" });
    }
    await updateAnalysisJob(payload.jobId, { phase: "CLONE" });

    const token = await resolveGitHubToken({ installationId: payload.installationId });
    let checkRunId: number | undefined;

    if (payload.headSha && token) {
      try {
        await updateAnalysisJob(payload.jobId, { phase: "GITHUB_CHECK" });
        const check = await createCheckRun({
          owner: payload.owner,
          repo: payload.repo,
          headSha: payload.headSha,
          token,
        });
        checkRunId = check.id;
      } catch (error) {
        log("warn", "check_run_create_skipped", {
          jobId: payload.jobId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const analysis = await analyzePullRequest(
        payload.owner,
        payload.repo,
        payload.pullRequestNumber,
        {
          depth: payload.depth ?? Number(process.env.GITIMPACT_DEPTH ?? 3),
          maxFiles: payload.maxFiles ?? Number(process.env.GITIMPACT_MAX_FILES ?? 800),
          installationId: payload.installationId,
          token,
          onPhase: async (phase) => {
            await updateAnalysisJob(payload.jobId, { phase });
          },
        },
      );

      if (!analysis.impact || !analysis.prOverview || !analysis.pullRequest) {
        throw new Error("Analysis produced no impact report");
      }

      const store = new GraphStore(analysis.graph);
      const selected = selectWhyPath(analysis.impact);
      const whyPath = selected
        ? {
            targetName: selected.targetName,
            steps: explainImpactPath(store, selected.path),
          }
        : undefined;

      const commentBody = formatPullRequestComment({
        pullRequest: analysis.pullRequest,
        impact: analysis.impact,
        overview: analysis.prOverview,
        whyPath,
        analysisUrl: payload.analysisBaseUrl
          ? `${payload.analysisBaseUrl.replace(/\/$/, "")}${analysis.routePath}`
          : undefined,
      });

      if (token) {
        await updateAnalysisJob(payload.jobId, { phase: "GITHUB_COMMENT" });
        await upsertPullRequestComment({
          owner: payload.owner,
          repo: payload.repo,
          number: payload.pullRequestNumber,
          body: commentBody,
          marker: GITIMPACT_COMMENT_MARKER,
          token,
        });
      }

      if (token && checkRunId) {
        const changedSymbols = analysis.impact.changedNodes.filter(
          (n) => n.type === "FUNCTION" || n.type === "METHOD" || n.type === "CLASS",
        ).length;
        const { title, summary } = formatCheckRunSummary({
          complexityScore: analysis.prOverview.complexityScore,
          changedSymbols,
          directDependents: analysis.prOverview.directDependencies,
          indirectDependents: analysis.prOverview.indirectDependencies,
          affectedApis: analysis.prOverview.apiRoutesAffected,
          relevantTests: analysis.prOverview.relevantTests,
          potentialGaps: analysis.prOverview.potentialMissingTests,
        });
        await completeCheckRun({
          owner: payload.owner,
          repo: payload.repo,
          checkRunId,
          conclusion: "neutral",
          title,
          summary,
          text: commentBody,
          token,
        });
      }

      if (payload.deliveryId) {
        await updateWebhookDelivery(payload.deliveryId, { status: "completed" });
      }
      await updateAnalysisJob(payload.jobId, {
        result: {
          analysisId: analysis.id,
          routePath: analysis.routePath,
          fromCache: analysis.fromCache,
        },
        commitSha: analysis.commitSha ?? payload.headSha ?? null,
      });
      incMetric("analyses_succeeded_total", 1, { type: "ANALYZE_PULL_REQUEST" });
    } catch (error) {
      if (payload.deliveryId) {
        await updateWebhookDelivery(payload.deliveryId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (token && checkRunId) {
        try {
          await completeCheckRun({
            owner: payload.owner,
            repo: payload.repo,
            checkRunId,
            conclusion: "failure",
            title: "GitImpact analysis failed",
            summary: error instanceof Error ? error.message : "Analysis failed",
            token,
          });
        } catch {
          // ignore
        }
      }
      throw error;
    }
    return;
  }

  log("warn", "job_type_unimplemented", { jobId: payload.jobId, code: payload.type });
}

async function main(): Promise<void> {
  log("info", "gitimpact_worker_boot", {});
  await startAnalysisWorker(processPayload);

  // Lightweight ops loop: heartbeat + retention (cache / jobs / webhooks)
  const retentionHours = Number(process.env.GITIMPACT_RETENTION_INTERVAL_HOURS ?? 6);
  const intervalMs = Math.max(1, retentionHours) * 60 * 60 * 1000;
  const runOps = async () => {
    try {
      const { getQueueDepth } = await import("@gitimpact/queue");
      const {
        purgeExpiredAnalyses,
        purgeExpiredJobs,
        purgeOldWebhookDeliveries,
      } = await import("@gitimpact/db");
      const depth = await getQueueDepth();
      incMetric("queue_depth", depth.waiting + depth.active, { mode: depth.mode });
      log("info", "worker_heartbeat", {
        status: "ok",
        waiting: depth.waiting,
        active: depth.active,
      });
      const now = new Date();
      const jobCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const webhookCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const analyses = await purgeExpiredAnalyses(now);
      const jobs = await purgeExpiredJobs(jobCutoff);
      const webhooks = await purgeOldWebhookDeliveries(webhookCutoff);
      if (analyses || jobs || webhooks) {
        log("info", "retention_cleanup", {
          analyses,
          jobs,
          webhooks,
        });
      }
    } catch (error) {
      log("warn", "worker_ops_tick_failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  void runOps();
  setInterval(() => {
    void runOps();
  }, intervalMs);

  // Keep process alive for inline mode
  if (!process.env.REDIS_URL) {
    setInterval(() => undefined, 60_000);
  }
}

main().catch((error) => {
  log("error", "worker_boot_failed", {
    detail: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
