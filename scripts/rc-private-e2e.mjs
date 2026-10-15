#!/usr/bin/env node
/**
 * Private GitHub App RC E2E harness.
 * Skips cleanly when App credentials are missing; runs smoke checks when present.
 *
 * Usage: pnpm rc:private-e2e
 * Evidence dir: .rc-tmp/evidence/ (gitignored)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const required = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
];

const missing = required.filter((k) => !process.env[k]?.trim());
const evidenceDir = path.resolve(".rc-tmp/evidence");
await mkdir(evidenceDir, { recursive: true });

const report = {
  ts: new Date().toISOString(),
  verdict: "SKIPPED",
  missing,
  checks: [],
};

function add(name, status, detail) {
  report.checks.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

if (missing.length) {
  add(
    "credentials",
    "SKIP",
    `Missing ${missing.join(", ")}. Configure App secrets then re-run (see docs/private-repo-e2e.md).`,
  );
  report.verdict = "SKIPPED_NO_CREDENTIALS";
} else {
  add("credentials", "PASS", "App id / private key / webhook secret present");

  // Structural smoke: JWT mint + installation listing require live network + install.
  const privateRepo = process.env.GITIMPACT_RC_PRIVATE_REPO; // owner/repo
  const prNumber = process.env.GITIMPACT_RC_PRIVATE_PR;
  if (!privateRepo) {
    add(
      "private_repo_target",
      "SKIP",
      "Set GITIMPACT_RC_PRIVATE_REPO=owner/repo to exercise live private analyze",
    );
    report.verdict = "PARTIAL";
  } else {
    add("private_repo_target", "PASS", privateRepo);
    const base = process.env.GITIMPACT_PUBLIC_URL || "http://localhost:3001";
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: prNumber
            ? `https://github.com/${privateRepo}/pull/${prNumber}`
            : `https://github.com/${privateRepo}`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202 || res.ok) {
        add("analyze_enqueue", "PASS", `status=${res.status} jobId=${body.jobId ?? "?"}`);
        report.verdict = "PASS";
      } else {
        add(
          "analyze_enqueue",
          "FAIL",
          `status=${res.status} code=${body.code ?? body.error ?? "?"}`,
        );
        report.verdict = "FAIL";
      }
    } catch (error) {
      add(
        "analyze_enqueue",
        "FAIL",
        error instanceof Error ? error.message : String(error),
      );
      report.verdict = "FAIL";
    }
  }

  add(
    "manual_followups",
    "INFO",
    "Still capture webhook redelivery, PR comment upsert, Check Run, no-exec marker repo per docs/private-repo-e2e.md",
  );
}

const out = path.join(evidenceDir, `private-e2e-${Date.now()}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nVerdict: ${report.verdict}`);
console.log(`Evidence: ${out}`);
process.exit(report.verdict === "FAIL" ? 1 : 0);
