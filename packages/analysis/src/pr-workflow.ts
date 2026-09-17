import {
  completeCheckRun,
  createCheckRun,
  formatCheckRunSummary,
  resolveGitHubToken,
  upsertPullRequestComment,
} from "@gitimpact/git";
import { updateWebhookDelivery } from "@gitimpact/db";
import { GraphStore } from "@gitimpact/graph";
import { explainImpactPath } from "@gitimpact/impact-engine";
import type { PrAnalysisJob } from "./queue.js";
import {
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
  selectWhyPath,
} from "./pr-comment.js";

/**
 * Background worker body for a claimed webhook delivery.
 */
export async function processPrAnalysisJob(job: PrAnalysisJob): Promise<void> {
  await updateWebhookDelivery(job.deliveryId, { status: "processing" });

  const token = await resolveGitHubToken({ installationId: job.installationId });
  let checkRunId: number | undefined;

  // Lazy import avoids circular dependency with index.ts exports
  const { analyzePullRequest } = await import("./index.js");

  try {
    if (job.headSha && token) {
      try {
        const check = await createCheckRun({
          owner: job.owner,
          repo: job.repo,
          headSha: job.headSha,
          token,
        });
        checkRunId = check.id;
      } catch (error) {
        console.warn(
          "[gitimpact] check run create skipped:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const analysis = await analyzePullRequest(job.owner, job.repo, job.number, {
      depth: Number(process.env.GITIMPACT_DEPTH ?? 3),
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
      installationId: job.installationId,
      token,
    });

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
      analysisUrl: job.analysisBaseUrl
        ? `${job.analysisBaseUrl.replace(/\/$/, "")}${analysis.routePath}`
        : undefined,
    });

    if (token) {
      await upsertPullRequestComment({
        owner: job.owner,
        repo: job.repo,
        number: job.number,
        body: commentBody,
        marker: GITIMPACT_COMMENT_MARKER,
        token,
      });
    }

    if (checkRunId && token) {
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
        owner: job.owner,
        repo: job.repo,
        checkRunId,
        conclusion: "neutral",
        title,
        summary,
        text: commentBody,
        token,
      });
    }

    await updateWebhookDelivery(job.deliveryId, { status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateWebhookDelivery(job.deliveryId, { status: "failed", error: message });

    if (checkRunId && token) {
      try {
        await completeCheckRun({
          owner: job.owner,
          repo: job.repo,
          checkRunId,
          conclusion: "neutral",
          title: "GitImpact analysis incomplete",
          summary: `Analysis failed: ${message}\n\nConclusion: neutral (informational only).`,
          token,
        });
      } catch {
        // ignore secondary failure
      }
    }
    throw error;
  }
}
