#!/usr/bin/env node
/**
 * RC no-exec proof — analyze a local fixture that would write a sentinel if executed.
 *
 *   pnpm rc:no-exec
 *
 * Evidence: .rc-tmp/evidence/no-exec-*.json
 */
import { access, mkdir, mkdtemp, rm, writeFile, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixtureSrc = path.join(root, "tests/real-world/cases/no-exec-marker");
const evidenceDir = path.resolve(root, ".rc-tmp/evidence");
await mkdir(evidenceDir, { recursive: true });

const require = createRequire(import.meta.url);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const work = await mkdtemp(path.join(tmpdir(), "gitimpact-no-exec-"));
const fixture = path.join(work, "repo");
await cp(fixtureSrc, fixture, { recursive: true });

const sentinel = path.join(fixture, "GITIMPACT_EXECUTED.sentinel");
const report = {
  ts: new Date().toISOString(),
  fixture: fixtureSrc,
  work,
  checks: [],
};

function add(name, status, detail) {
  report.checks.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  // Ensure sentinel is absent before analyze
  if (await exists(sentinel)) {
    await rm(sentinel, { force: true });
  }
  add("precondition_clean", "PASS", "sentinel absent before analyze");

  // Load built analysis package
  const analysisPath = path.join(root, "packages/analysis/dist/index.js");
  if (!(await exists(analysisPath))) {
    add("build", "FAIL", "packages/analysis/dist missing — run pnpm build:packages");
    report.verdict = "FAIL";
  } else {
    const { analyzeLocalPath } = await import(analysisPath);
    const analysis = await analyzeLocalPath(fixture, { maxFiles: 200 });
    add(
      "analyze_local",
      analysis ? "PASS" : "FAIL",
      `files=${analysis?.summary?.files ?? "?"} frameworks=${(analysis?.frameworks ?? []).join(",")}`,
    );

    const executed = await exists(sentinel);
    add(
      "sentinel_absent",
      executed ? "FAIL" : "PASS",
      executed
        ? "GITIMPACT_EXECUTED.sentinel was created — repo code may have been executed"
        : "no sentinel; install/preinstall scripts did not run",
    );

    // package.json scripts should not have been invoked — node_modules absent is expected
    const nm = await exists(path.join(fixture, "node_modules"));
    add(
      "no_node_modules",
      nm ? "FAIL" : "PASS",
      nm ? "node_modules appeared" : "no package install",
    );

    report.verdict =
      !executed && !nm && analysis ? "PASS" : "FAIL";
    report.analysisId = analysis?.id;
  }
} catch (error) {
  add("exception", "FAIL", error instanceof Error ? error.message : String(error));
  report.verdict = "FAIL";
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}

const out = path.join(evidenceDir, `no-exec-${Date.now()}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nVerdict: ${report.verdict}`);
console.log(`Evidence: ${out}`);
process.exit(report.verdict === "PASS" ? 0 : 1);
