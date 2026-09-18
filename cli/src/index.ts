#!/usr/bin/env node
import {
  analyzeAndCommentOnPullRequest,
  analyzeRepositoryUrl,
  parseGitHubUrl,
} from "@gitimpact/analysis";

async function runAdmin(args: string[]): Promise<void> {
  const [subcommand, target] = args;
  const { listDeadLetterJobs, listFailedJobs, retryDeadLetterJob, getAnalysisJob } =
    await import("@gitimpact/queue");
  const {
    deleteAnalysesForRepository,
    purgeExpiredAnalyses,
    purgeExpiredJobs,
    purgeOldWebhookDeliveries,
  } = await import("@gitimpact/db");
  const { validateConfig, getMetricsSnapshot, redisPing } = await import("@gitimpact/ops");

  if (!subcommand || subcommand === "help") {
    console.log(`gitimpact admin

  gitimpact admin health
  gitimpact admin jobs failed
  gitimpact admin jobs dead
  gitimpact admin jobs retry <id>
  gitimpact admin jobs inspect <id>
  gitimpact admin cache purge <owner/repo>
  gitimpact admin retention run
`);
    return;
  }

  if (subcommand === "health") {
    const config = validateConfig();
    const redisOk = await redisPing();
    console.log(JSON.stringify({ config, redisOk, metrics: getMetricsSnapshot() }, null, 2));
    if (!config.ok) process.exit(1);
    return;
  }

  if (subcommand === "jobs") {
    const action = target;
    const id = args[2];
    if (action === "failed") {
      console.log(JSON.stringify(await listFailedJobs(50), null, 2));
      return;
    }
    if (action === "dead") {
      console.log(JSON.stringify(await listDeadLetterJobs(50), null, 2));
      return;
    }
    if (action === "inspect" && id) {
      console.log(JSON.stringify(await getAnalysisJob(id), null, 2));
      return;
    }
    if (action === "retry" && id) {
      const result = await retryDeadLetterJob(id);
      console.log(JSON.stringify(result ?? { error: "not found or not retryable" }, null, 2));
      return;
    }
    console.error("Unknown jobs action. Try: failed | dead | inspect <id> | retry <id>");
    process.exit(1);
  }

  if (subcommand === "cache" && target === "purge" && args[2]) {
    const [owner, repo] = args[2].split("/");
    if (!owner || !repo) {
      console.error("Expected owner/repo");
      process.exit(1);
    }
    const n = await deleteAnalysesForRepository(owner, repo);
    console.log(`Purged ${n} analysis record(s) for ${owner}/${repo}`);
    return;
  }

  if (subcommand === "retention" && target === "run") {
    const now = new Date();
    const jobCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const webhookCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const analyses = await purgeExpiredAnalyses(now);
    const jobs = await purgeExpiredJobs(jobCutoff);
    const webhooks = await purgeOldWebhookDeliveries(webhookCutoff);
    console.log(JSON.stringify({ analyses, jobs, webhooks }, null, 2));
    return;
  }

  console.error(`Unknown admin command: ${subcommand}`);
  process.exit(1);
}

async function main() {
  const [, , command, target, ...rest] = process.argv;

  if (!command || command === "help" || command === "--help") {
    console.log(`GitImpact CLI

Usage:
  gitimpact analyze <github-url>
  gitimpact comment <github-pr-url> [--dry-run]
  gitimpact diff <github-pr-url>
  gitimpact admin <subcommand>

Examples:
  gitimpact analyze github.com/owner/repo
  gitimpact analyze github.com/owner/repo/pull/123
  gitimpact comment github.com/owner/repo/pull/123
  gitimpact comment github.com/owner/repo/pull/123 --dry-run
  gitimpact admin health
  gitimpact admin jobs failed
  gitimpact admin jobs retry job_abc
  gitimpact admin cache purge owner/repo
`);
    return;
  }

  if (command === "admin") {
    await runAdmin([target, ...rest].filter(Boolean));
    return;
  }

  if (!["analyze", "diff", "pr", "comment"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  if (!target) {
    console.error("A GitHub repository or pull request URL is required.");
    process.exit(1);
  }

  if (command === "comment") {
    const dryRun = rest.includes("--dry-run");
    const parsed = parseGitHubUrl(target);
    if (parsed.kind !== "pull_request" || !parsed.prNumber) {
      console.error("comment requires a pull request URL");
      process.exit(1);
    }

    console.log(dryRun ? "Analyzing (dry-run, will not post)…" : "Analyzing and commenting…");
    const result = await analyzeAndCommentOnPullRequest({
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.prNumber,
      maxFiles: 800,
      postComment: !dryRun,
      analysisBaseUrl: process.env.GITIMPACT_PUBLIC_URL,
    });

    console.log("");
    console.log(result.commentBody);
    console.log("");
    if (result.posted) {
      console.log(
        result.commentCreated ? "Posted new PR comment." : "Updated existing GitImpact comment.",
      );
      if (result.commentUrl) console.log(result.commentUrl);
    } else {
      console.log(`Comment not posted: ${result.skippedReason ?? "unknown"}`);
    }
    return;
  }

  console.log("Analyzing…");
  const analysis = await analyzeRepositoryUrl(target, { maxFiles: 800 });

  console.log("");
  console.log("Repository analyzed.");
  console.log(`Files: ${analysis.summary.files}`);
  console.log(`Functions: ${analysis.summary.functions}`);
  console.log(`Dependencies: ${analysis.summary.dependencies}`);
  console.log(`API Routes: ${analysis.summary.apiRoutes}`);
  console.log(`Tests: ${analysis.summary.tests}`);

  if (analysis.impact) {
    console.log("");
    console.log("Impact");
    console.log(`Affected files: ${analysis.impact.affectedFiles.length}`);
    console.log(`Direct: ${analysis.impact.directImpact.length}`);
    console.log(`Indirect: ${analysis.impact.indirectImpact.length}`);
    console.log(`Related tests: ${analysis.impact.relatedTests.length}`);
    console.log(`Potential gaps: ${analysis.impact.missingTests.length}`);
    console.log("");
    console.log(analysis.impact.summary);
  }

  if (analysis.prOverview) {
    console.log("");
    console.log(`Complexity: ${analysis.prOverview.complexityScore}/100 (${analysis.prOverview.impactLevel})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
