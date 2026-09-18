#!/usr/bin/env node
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeAndCommentOnPullRequest,
  analyzeLocalPath,
  analyzeRepositoryUrl,
  parseGitHubUrl,
  listAnalysisHistory,
  compareAnalyses,
  buildReviewReportMarkdown,
  formatArchitectureDiffMarkdown,
} from "@gitimpact/analysis";
import type { StoredAnalysis } from "@gitimpact/analysis";
import { mkdir } from "node:fs/promises";

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

function isRemoteTarget(target: string): boolean {
  return (
    /^https?:\/\//i.test(target) ||
    /github\.com/i.test(target) ||
    /^[\w.-]+\/[\w.-]+(\/pull\/\d+)?$/i.test(target)
  );
}

async function loadAnalysis(
  target: string,
  options?: { maxFiles?: number },
): Promise<StoredAnalysis> {
  const maxFiles = options?.maxFiles ?? 2000;
  if (!isRemoteTarget(target)) {
    const localDir = path.resolve(target.replace(/^~(?=\/|$)/, process.env.HOME ?? ""));
    try {
      await access(localDir);
      return await analyzeLocalPath(localDir, { maxFiles });
    } catch {
      throw new Error(`Local path not found: ${localDir}`);
    }
  }
  return await analyzeRepositoryUrl(target, { maxFiles: Math.min(maxFiles, 800) });
}

function printAnalyzeSummary(analysis: StoredAnalysis): void {
  console.log("");
  console.log("Repository analyzed.");
  console.log(`Type: ${analysis.intelligence?.typeLabel ?? "unknown"}`);
  if (analysis.intelligence?.coverage) {
    console.log(
      `Confidence: ${analysis.intelligence.coverage.confidenceLabel}` +
        (analysis.intelligence.coverage.codeParseCoveragePercent != null
          ? ` · parse ${analysis.intelligence.coverage.codeParseCoveragePercent}%`
          : ""),
    );
  }
  console.log(`Files: ${analysis.summary.files}`);
  console.log(`Functions: ${analysis.summary.functions}`);
  console.log(`Dependencies: ${analysis.summary.dependencies}`);
  console.log(`API Routes: ${analysis.summary.apiRoutes}`);
  console.log(`Tests: ${analysis.summary.tests}`);
  if (analysis.summary.frameworks.length) {
    console.log(`Frameworks: ${analysis.summary.frameworks.join(", ")}`);
  }

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
    console.log(
      `Complexity: ${analysis.prOverview.complexityScore}/100 (${analysis.prOverview.impactLevel})`,
    );
  }
}

function printStructure(analysis: StoredAnalysis): void {
  const intel = analysis.intelligence;
  console.log("");
  console.log(`# ${analysis.repository.owner}/${analysis.repository.name}`);
  console.log(`Type: ${intel?.typeLabel ?? "unknown"}`);
  if (intel?.architectureSummary) {
    console.log("");
    console.log(intel.architectureSummary);
  }
  if (analysis.summary.frameworks.length) {
    console.log("");
    console.log(`Frameworks: ${analysis.summary.frameworks.join(", ")}`);
  }
  const systems =
    intel?.architecture?.components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM") ?? [];
  if (systems.length) {
    console.log("");
    console.log("Systems");
    for (const system of systems.slice(0, 20)) {
      const hint = system.pathHint ? ` (${system.pathHint})` : "";
      console.log(`- ${system.title}${hint} — ${system.role}`);
    }
  }
  const edges = intel?.architecture?.edges ?? [];
  if (edges.length) {
    console.log("");
    console.log("Relationships");
    for (const edge of edges.slice(0, 30)) {
      const from = systems.find((s) => s.id === edge.from)?.title ?? edge.from;
      const to = systems.find((s) => s.id === edge.to)?.title ?? edge.to;
      console.log(`- ${from} ${edge.label} ${to}`);
    }
  }
  if (intel?.coverage?.blindSpots?.length) {
    console.log("");
    console.log("Blind spots");
    for (const spot of intel.coverage.blindSpots) {
      console.log(`- ${spot}`);
    }
  }
}

function buildArchitectureMarkdown(analysis: StoredAnalysis): string {
  const intel = analysis.intelligence;
  const lines: string[] = [];
  lines.push(`# Architecture — ${analysis.repository.owner}/${analysis.repository.name}`);
  lines.push("");
  lines.push(`**Type:** ${intel?.typeLabel ?? "unknown"}`);
  if (analysis.summary.frameworks.length) {
    lines.push(`**Stack:** ${analysis.summary.frameworks.join(", ")}`);
  }
  if (intel?.coverage) {
    lines.push(
      `**Coverage:** ${intel.coverage.confidenceLabel}` +
        (intel.coverage.codeParseCoveragePercent != null
          ? ` · ${intel.coverage.codeParseCoveragePercent}% parsed`
          : ""),
    );
  }
  lines.push("");
  if (intel?.architectureSummary) {
    lines.push(intel.architectureSummary);
    lines.push("");
  }
  const systems =
    intel?.architecture?.components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM") ?? [];
  if (systems.length) {
    lines.push("## Systems");
    lines.push("");
    for (const system of systems) {
      const hint = system.pathHint ? ` \`${system.pathHint}\`` : "";
      lines.push(`- **${system.title}**${hint} — ${system.role}`);
    }
    lines.push("");
  }
  const edges = intel?.architecture?.edges ?? [];
  if (edges.length) {
    lines.push("## Relationships");
    lines.push("");
    for (const edge of edges) {
      const from = systems.find((s) => s.id === edge.from)?.title ?? edge.from;
      const to = systems.find((s) => s.id === edge.to)?.title ?? edge.to;
      lines.push(`- ${from} → ${to} (${edge.label})`);
    }
    lines.push("");
  }
  if (intel?.coverage?.blindSpots?.length) {
    lines.push("## Blind spots");
    lines.push("");
    for (const spot of intel.coverage.blindSpots) {
      lines.push(`- ${spot}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(`Generated by GitImpact · ${new Date().toISOString()}`);
  return `${lines.join("\n")}\n`;
}

function printHelp(): void {
  console.log(`GitImpact CLI

Usage:
  gitimpact analyze <github-url|local-path> [--json]
  gitimpact structure <github-url|local-path>
  gitimpact impact <github-pr-url>
  gitimpact impact --from <ref> --to <ref> <local-path>
  gitimpact pr --base <branch> <github-url|local-path>
  gitimpact history <owner/repo|github-url> [--limit N]
  gitimpact compare <path-or-url-a> <path-or-url-b>
  gitimpact export architecture.md <github-url|local-path>
  gitimpact export review.md <github-url|local-path>
  gitimpact export pack <dir> <github-url|local-path>
  gitimpact comment <github-pr-url> [--dry-run]
  gitimpact diff <github-pr-url>
  gitimpact admin <subcommand>

Examples:
  gitimpact analyze .
  gitimpact structure .
  gitimpact impact github.com/owner/repo/pull/123
  gitimpact history owner/repo
  gitimpact compare ./old-checkout ./new-checkout
  gitimpact pr --base main .
  gitimpact export architecture.md .
  gitimpact export review.md .
  gitimpact export pack ./gitimpact-pack .
  gitimpact comment github.com/owner/repo/pull/123 --dry-run
  gitimpact admin health
`);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  const [, , command, ...argv] = process.argv;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "admin") {
    await runAdmin(argv);
    return;
  }

  if (command === "comment") {
    const target = argv[0];
    const dryRun = argv.includes("--dry-run");
    if (!target) {
      console.error("comment requires a pull request URL");
      process.exit(1);
    }
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

  if (command === "history") {
    const target = argv[0];
    if (!target) {
      console.error("history requires owner/repo or a GitHub URL");
      process.exit(1);
    }
    const limit = Number(flagValue(argv, "--limit") ?? 20);
    let owner: string;
    let repo: string;
    if (target.includes("github.com") || target.startsWith("http")) {
      const parsed = parseGitHubUrl(target);
      owner = parsed.owner;
      repo = parsed.repo;
    } else {
      const [o, r] = target.replace(/^\//, "").split("/");
      if (!o || !r) {
        console.error("history requires owner/repo");
        process.exit(1);
      }
      owner = o;
      repo = r;
    }
    const entries = await listAnalysisHistory(owner, repo, {
      limit: Number.isFinite(limit) ? limit : 20,
    });
    if (entries.length === 0) {
      console.log(`No analysis history for ${owner}/${repo} yet.`);
      console.log("Run `gitimpact analyze` (with DATABASE_URL) to start recording.");
      return;
    }
    console.log(`# History — ${owner}/${repo} (${entries.length})`);
    console.log("");
    for (const entry of entries) {
      const sha = (entry.commitSha ?? entry.headSha ?? "?").slice(0, 7);
      const kind = entry.kind === "pull_request" ? `PR #${entry.prNumber}` : "repo";
      const impact = entry.snapshot.impact
        ? ` · blast ${entry.snapshot.impact.directCount}/${entry.snapshot.impact.indirectCount}`
        : "";
      console.log(
        `- ${entry.createdAt.slice(0, 19)}  ${sha}  ${kind}  ${entry.snapshot.typeLabel ?? "?"}  routes=${entry.snapshot.summary.apiRoutes}${impact}`,
      );
      console.log(`  id=${entry.id}`);
    }
    return;
  }

  if (command === "compare") {
    const aTarget = argv[0];
    const bTarget = argv[1];
    if (!aTarget || !bTarget) {
      console.error("compare requires two paths or URLs");
      process.exit(1);
    }
    console.log("Analyzing A…");
    const a = await loadAnalysis(aTarget);
    console.log("Analyzing B…");
    const b = await loadAnalysis(bTarget);
    const diff = compareAnalyses(a, b);
    console.log("");
    console.log(formatArchitectureDiffMarkdown(diff));
    return;
  }

  if (command === "export") {
    const format = argv[0] ?? "architecture.md";
    console.log("Analyzing…");

    if (format === "pack") {
      const packDir = path.resolve(argv[1] ?? "./gitimpact-pack");
      const packTarget = argv[2] ?? ".";
      const packed = await loadAnalysis(packTarget);
      await mkdir(packDir, { recursive: true });
      await writeFile(
        path.join(packDir, "architecture.md"),
        buildArchitectureMarkdown(packed),
        "utf8",
      );
      await writeFile(
        path.join(packDir, "review.md"),
        buildReviewReportMarkdown(packed),
        "utf8",
      );
      await writeFile(
        path.join(packDir, "snapshot.json"),
        JSON.stringify(
          {
            id: packed.id,
            createdAt: packed.createdAt,
            commitSha: packed.commitSha,
            repository: packed.repository,
            summary: packed.summary,
            intelligence: {
              repositoryType: packed.intelligence?.repositoryType,
              typeLabel: packed.intelligence?.typeLabel,
              architectureSummary: packed.intelligence?.architectureSummary,
              coverage: packed.intelligence?.coverage,
            },
            routes: packed.routes?.length ?? 0,
            impact: packed.impact
              ? {
                  direct: packed.impact.directImpact.length,
                  indirect: packed.impact.indirectImpact.length,
                  complexityScore: packed.impact.complexityScore,
                }
              : null,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`Wrote architecture pack → ${packDir}`);
      return;
    }

    const target = argv[1] ?? ".";
    const analysis = await loadAnalysis(target);
    const isReview = /review\.md$/i.test(format) || format === "review";
    const markdown = isReview
      ? buildReviewReportMarkdown(analysis)
      : buildArchitectureMarkdown(analysis);
    const outPath = path.resolve(
      format.endsWith(".md") ? format : isReview ? "review.md" : `${format}.md`,
    );
    await writeFile(outPath, markdown, "utf8");
    console.log(`Wrote ${outPath}`);
    return;
  }

  if (command === "structure") {
    const target = argv[0] ?? ".";
    console.log("Analyzing…");
    const analysis = await loadAnalysis(target);
    printStructure(analysis);
    return;
  }

  if (command === "pr") {
    const base = flagValue(argv, "--base") ?? "main";
    const target =
      argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--base") ?? ".";
    // Local/PR compare against base is represented via GitHub PR URL when remote;
    // for local paths we surface structure + coverage as the PR readiness snapshot.
    console.log(`Analyzing PR surface (base ${base})…`);
    const analysis = await loadAnalysis(target);
    printStructure(analysis);
    if (analysis.prOverview) {
      console.log("");
      console.log(
        `PR complexity vs ${base}: ${analysis.prOverview.complexityScore}/100 (${analysis.prOverview.impactLevel})`,
      );
    } else if (isRemoteTarget(target) && /\/pull\//i.test(target)) {
      // already included via analyze
    } else {
      console.log("");
      console.log(
        `Tip: pass a PR URL for blast-radius impact, e.g. gitimpact pr --base ${base} owner/repo/pull/123`,
      );
    }
    return;
  }

  if (command === "impact") {
    const fromRef = flagValue(argv, "--from");
    const toRef = flagValue(argv, "--to");
    const target =
      argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--from" && argv[i - 1] !== "--to") ??
      ".";

    if (fromRef || toRef) {
      console.log(
        `Local ref impact (${fromRef ?? "HEAD~1"} → ${toRef ?? "HEAD"}) is not wired yet.`,
      );
      console.log("Analyzing repository structure instead; use a PR URL for blast radius.");
    }

    console.log("Analyzing…");
    const analysis = await loadAnalysis(target);
    if (analysis.impact) {
      printAnalyzeSummary(analysis);
    } else if (isRemoteTarget(target) && /\/pull\//i.test(target)) {
      printAnalyzeSummary(analysis);
    } else {
      printStructure(analysis);
      console.log("");
      console.log(
        "No PR impact report — pass a pull request URL, e.g. gitimpact impact owner/repo/pull/12",
      );
    }
    return;
  }

  if (!["analyze", "diff"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const target = argv[0];
  if (!target) {
    console.error("A GitHub repository URL or local path is required.");
    process.exit(1);
  }

  console.log("Analyzing…");
  const jsonOut = argv.includes("--json");
  const analysis = await loadAnalysis(target);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          id: analysis.id,
          summary: analysis.summary,
          repositoryType: analysis.intelligence?.repositoryType,
          coverage: analysis.intelligence?.coverage
            ? {
                confidence: analysis.intelligence.coverage.confidence,
                codeParseCoveragePercent:
                  analysis.intelligence.coverage.codeParseCoveragePercent,
                highConfidenceEdgePercent:
                  analysis.intelligence.coverage.highConfidenceEdgePercent,
                reasons: analysis.intelligence.coverage.reasons,
                blindSpots: analysis.intelligence.coverage.blindSpots,
              }
            : null,
          frameworks: analysis.summary.frameworks,
        },
        null,
        2,
      ),
    );
    return;
  }

  printAnalyzeSummary(analysis);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
