#!/usr/bin/env node
import { analyzeRepositoryUrl } from "@gitimpact/analysis";

async function main() {
  const [, , command, target] = process.argv;

  if (!command || command === "help" || command === "--help") {
    console.log(`GitImpact CLI

Usage:
  gitimpact analyze <github-url>
  gitimpact diff <github-pr-url>

Examples:
  gitimpact analyze github.com/owner/repo
  gitimpact analyze github.com/owner/repo/pull/123
`);
    return;
  }

  if (command !== "analyze" && command !== "diff" && command !== "pr") {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  if (!target) {
    console.error("A GitHub repository or pull request URL is required.");
    process.exit(1);
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
