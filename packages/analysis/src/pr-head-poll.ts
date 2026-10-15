/**
 * Optional scheduled PR head re-analyze (v1.2).
 * Opt-in via GITIMPACT_PR_HEAD_POLL=1 — fills impact history when webhooks miss.
 */
import { listAnalysisHistory, listRecentRepositories } from "@gitimpact/db";
import { listOpenPullRequests } from "@gitimpact/git";
import { enqueueAnalyzePullRequest } from "@gitimpact/queue";

export interface PrHeadPollResult {
  reposChecked: number;
  prsChecked: number;
  enqueued: number;
  skipped: number;
}

export async function pollPrHeadUpdates(options?: {
  repoLimit?: number;
  prLimit?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}): Promise<PrHeadPollResult> {
  const enabled =
    process.env.GITIMPACT_PR_HEAD_POLL === "1" ||
    process.env.GITIMPACT_PR_HEAD_POLL === "true";
  if (!enabled) {
    return { reposChecked: 0, prsChecked: 0, enqueued: 0, skipped: 0 };
  }

  const repoLimit = options?.repoLimit ?? Number(process.env.GITIMPACT_PR_HEAD_POLL_REPOS ?? 8);
  const prLimit = options?.prLimit ?? Number(process.env.GITIMPACT_PR_HEAD_POLL_PRS ?? 20);
  const log = options?.log ?? (() => undefined);

  const repos = await listRecentRepositories(repoLimit);
  let prsChecked = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const repo of repos) {
    const open = await listOpenPullRequests(repo.owner, repo.name, { limit: prLimit });
    for (const pr of open) {
      if (pr.draft) {
        skipped += 1;
        continue;
      }
      prsChecked += 1;
      if (!pr.headSha) {
        skipped += 1;
        continue;
      }
      const history = await listAnalysisHistory(repo.owner, repo.name, {
        kind: "pull_request",
        prNumber: pr.number,
        limit: 1,
      });
      const latest = history[0];
      if (latest?.headSha && latest.headSha === pr.headSha) {
        skipped += 1;
        continue;
      }
      try {
        await enqueueAnalyzePullRequest({
          owner: repo.owner,
          repo: repo.name,
          pullRequestNumber: pr.number,
          headSha: pr.headSha,
          baseSha: pr.baseSha,
          action: "scheduled",
          deliveryId: `poll-${repo.owner}-${repo.name}-${pr.number}-${pr.headSha.slice(0, 8)}`,
        });
        enqueued += 1;
        log("pr_head_poll_enqueued", {
          repository: repo.id,
          pr: pr.number,
          headSha: pr.headSha,
        });
      } catch (error) {
        skipped += 1;
        log("pr_head_poll_enqueue_failed", {
          repository: repo.id,
          pr: pr.number,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    reposChecked: repos.length,
    prsChecked,
    enqueued,
    skipped,
  };
}
