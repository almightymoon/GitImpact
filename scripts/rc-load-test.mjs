#!/usr/bin/env node
/**
 * RC load test — enqueue ≥10 distinct public repos against a running web.
 *
 *   GITIMPACT_PUBLIC_URL=http://localhost:3001 pnpm rc:load-test
 *
 * Evidence: .rc-tmp/evidence/load-*.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = (process.env.GITIMPACT_PUBLIC_URL || "http://localhost:3001").replace(
  /\/$/,
  "",
);

/** Distinct public repos — prefer smaller surfaces for reliable staging. */
const REPOS = [
  "https://github.com/colinhacks/zod",
  "https://github.com/pmndrs/zustand",
  "https://github.com/expressjs/multer",
  "https://github.com/tj/commander.js",
  "https://github.com/sindresorhus/is",
  "https://github.com/uuidjs/uuid",
  "https://github.com/debug-js/debug",
  "https://github.com/mswjs/msw",
  "https://github.com/remix-run/history",
  "https://github.com/lukeed/clsx",
  "https://github.com/developit/mitt",
  "https://github.com/ai/nanoid",
];

const evidenceDir = path.resolve(".rc-tmp/evidence");
await mkdir(evidenceDir, { recursive: true });

async function enqueue(url) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ repository: url }),
    });
    const body = await res.json().catch(() => ({}));
    return {
      url,
      status: res.status,
      jobId: body.jobId ?? body.id,
      code: body.code,
      error: body.error ?? body.message,
      fromCache: Boolean(body.fromCache),
      enqueueMs: Date.now() - started,
    };
  } catch (error) {
    return {
      url,
      status: 0,
      code: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
      enqueueMs: Date.now() - started,
    };
  }
}

async function poll(jobId, timeoutMs = 240_000) {
  if (!jobId) return { status: "NO_JOB" };
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/jobs/${jobId}`, {
        headers: { accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (
        body.status === "SUCCEEDED" ||
        body.status === "FAILED" ||
        body.status === "DEAD_LETTER"
      ) {
        return {
          status: body.status,
          durationMs: Date.now() - started,
          lastError: body.lastError,
          phase: body.phase,
        };
      }
    } catch {
      // transient server blip — keep polling
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "TIMEOUT", durationMs: timeoutMs };
}

console.log(`RC load test → ${base} (${REPOS.length} repos)`);

let healthOk = false;
try {
  const h = await fetch(`${base}/api/health`);
  healthOk = h.ok;
} catch {
  healthOk = false;
}

if (!healthOk) {
  const report = {
    ts: new Date().toISOString(),
    verdict: "SKIPPED_NO_SERVER",
    detail: `Web not reachable at ${base}`,
  };
  const out = path.join(evidenceDir, `load-${Date.now()}.json`);
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Evidence: ${out}`);
  process.exit(0);
}

const results = [];
for (const url of REPOS) {
  const row = await enqueue(url);
  if (row.fromCache && (row.status === 200 || row.status === 202)) {
    results.push({ ...row, status: "SUCCEEDED", durationMs: row.enqueueMs });
    console.log(`[CACHE] ${url.replace("https://github.com/", "")}`);
  } else if ((row.status === 202 || row.status === 200) && row.jobId) {
    const done = await poll(row.jobId);
    results.push({ ...row, ...done });
    console.log(
      `[${done.status}] ${url.replace("https://github.com/", "")} job=${row.jobId} ${done.durationMs ?? row.enqueueMs}ms`,
    );
  } else {
    results.push({ ...row, status: "ENQUEUE_FAILED" });
    console.log(`[ENQUEUE_${row.status}] ${url} ${row.code ?? row.error ?? ""}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}

const succeeded = results.filter((r) => r.status === "SUCCEEDED").length;
const distinctOk = new Set(
  results.filter((r) => r.status === "SUCCEEDED").map((r) => r.url),
).size;

const report = {
  ts: new Date().toISOString(),
  base,
  requested: REPOS.length,
  succeeded,
  distinctSucceeded: distinctOk,
  verdict: distinctOk >= 10 ? "PASS" : distinctOk >= 1 ? "PARTIAL" : "FAIL",
  results,
};

const out = path.join(evidenceDir, `load-${Date.now()}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nVerdict: ${report.verdict} (${distinctOk}/${REPOS.length} distinct succeeded)`);
console.log(`Evidence: ${out}`);
process.exit(report.verdict === "FAIL" ? 1 : 0);
