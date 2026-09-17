#!/usr/bin/env node
import {
  analyzeAndCommentOnPullRequest,
  analyzeRepositoryUrl,
  parseGitHubUrl,
} from "@gitimpact/analysis";

async function main() {
  const [, , command, target, ...rest] = process.argv;

  if (!command || command === "help" || command === "--help") {
    console.log(`GitImpact CLI

Usage:
  gitimpact analyze <github-url>
  gitimpact comment <github-pr-url> [--dry-run]
  gitimpact diff <github-pr-url>

Examples:
  gitimpact analyze github.com/owner/repo
  gitimpact analyze github.com/owner/repo/pull/123
  gitimpact comment github.com/owner/repo/pull/123
  gitimpact comment github.com/owner/repo/pull/123 --dry-run
`);
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
