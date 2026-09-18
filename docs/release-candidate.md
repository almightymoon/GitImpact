# GitImpact v1.0.0-beta Release Candidate Report

**Date:** 2026-09-18  
**Verdict:** **NOT READY** to tag `1.0.0-beta`

Status vocabulary: **PASS** (verified), **FAIL**, **PARTIAL**, **NOT TESTED**, **IMPLEMENTED**.

Evidence (local/gitignored): `.rc-tmp/evidence/`

---

## Executive summary

Production Compose (`web` + `worker` + Postgres + Redis) boots and serves public analyses through BullMQ. Cache hits, 20× same-SHA dedupe, web/worker restart survival, rate limits, URL security rejects, Redis/Postgres outage **and recovery**, dead-letter **manual retry**, and automated suites were verified.

**Still blocking a beta tag:** private GitHub App E2E (mandatory), live webhook/PR-comment/Check-Run proofs, load test across many distinct repos, and no-exec marker-repo proof.

---

## Defects found & fixed in this RC

| ID | Finding | Fix |
|----|---------|-----|
| D1 | Worker/web image lacked `git` | `Dockerfile` apt install |
| D2 | Web CMD `pnpm` missing in runtime | Next binary CMD |
| D3 | Worker missing `GITHUB_WEBHOOK_SECRET` | compose env |
| D4 | Deterministic quota failures re-cloned 3× via BullMQ | `UnrecoverableError` |
| D5 | Cache columns not persisted to Postgres | `saveAnalysis` fields |
| D6 | Analyze hung on Redis down | offline queue off + timeouts |
| D7 | Redis ping failure cached forever | do not cache connect failure |
| D8 | Ready DB check was client-only | `databasePing()` |
| D9/D10 | Outage errors leaked SQL / wrong codes | `QUEUE_UNAVAILABLE` / `DATABASE_UNAVAILABLE` |
| D11 | Failed enqueue left orphaned `QUEUED` jobs | mark `FAILED` |
| D12 | Dead-letter retry deduped against itself | bypass dedupe + re-add BullMQ |
| D13 | BullMQ same `jobId` blocked retry | `getJob().remove()` before add |
| ENV | Host disk full mid-RC | pruned caches; environmental |

---

## Validation table

| Test | Status | Evidence / notes |
|------|--------|------------------|
| Production stack boot | PASS | health 200, ready 200; migrations 0000–0005 |
| Migrations + indexes | PASS | `analysis_jobs`, installations, webhooks, cache cols |
| Idempotent restart | PASS | web/worker restart |
| Public — Express | PASS | SUCCEEDED ~9s |
| Public — Next/React (`vercel/platforms`) | PASS | SUCCEEDED |
| Public — GitOps (`argocd-example-apps`) | PASS | SUCCEEDED |
| Cache hit same SHA | PASS | `fromCache:true`; DB commit_sha + expires |
| Concurrent dedupe 20× | PASS | 1 job / 19 deduped; Postgres `1\|1` |
| Web restart mid-job | PASS | multer SUCCEEDED |
| Worker restart mid-job | PASS | commander.js SUCCEEDED |
| Redis outage + recovery | PASS | ready 503; analyze `QUEUE_UNAVAILABLE` 503; recover without web restart |
| Postgres outage + recovery | PASS | ready 503; `DATABASE_UNAVAILABLE` 503; recover |
| Dead-letter + retry | PASS | oversized → DEAD_LETTER attempt 1; retry requeues → worker runs → DEAD_LETTER again |
| Deterministic failures | PASS | file/git/fake host; oversized no BullMQ loop |
| Rate limiting | PASS | HTTP 429 `RATE_LIMITED` + `retryAfterSeconds` |
| Quotas | PASS | next.js 31k files |
| Request/job traceability | PASS | requestId correlated |
| Health vs ready | PASS | health OK when redis down; ready 503 |
| Log secret review | PASS | 0 matches for token patterns in web/worker logs |
| Admin CLI health/dead/retention | PASS | health redisOk; dead list; retention `{0,0,0}` on fresh data |
| Accuracy tests | PASS | 83 pass / 3 skip offline |
| Integration Redis/Postgres | PASS | 4/4 |
| Real-world tests | PASS | 5/5 |
| Web build | PASS | Next + Docker image |
| Private repo E2E | NOT TESTED | No live App install |
| Private negatives | NOT TESTED | |
| Webhook idempotency (live) | NOT TESTED | Unit coverage only |
| PR comment idempotency | NOT TESTED | |
| Check Run flow | NOT TESTED | |
| Analysis timeout (forced) | NOT TESTED | Unit covered |
| Load 10–20 distinct repos | NOT TESTED | Disk/time interrupted |
| Repo code never executed (marker) | NOT TESTED | Policy + unit; no marker repo |
| Temp dir cleanup | NOT TESTED | |
| Dependency audit | PARTIAL | 3 high via Next-pinned `postcss` — deferred |
| Schema-mismatch / expiry E2E | PARTIAL | Unit + cache hit path |

---

## Dependency audit

`pnpm audit --prod`: 6 findings (1 low, 2 moderate, 3 high). High/moderate are transitive `postcss` via `next@15.5.25`. **Deferred** — upgrading Next solely for transitive postcss risks analyzer/UI churn; not exploitable in our static-analysis clone path. Documented in SECURITY residual risks.

---

## Tag readiness

**Safe to tag `1.0.0-beta`?** **No.**

Before READY:

1. Real GitHub App private-repo + private-PR E2E (`docs/private-repo-e2e.md`)
2. Live webhook replay, PR comment idempotency, Check Run
3. Marker-repo no-exec + temp cleanup proof
4. Load test (≥10 distinct repos) recorded in `docs/load-testing.md`
5. Forced timeout + admin retry UI smoke on a non-quota failure

---

## Commands used

```bash
docker compose -f docker-compose.prod.yml --env-file .rc-tmp/compose.env up -d --build
pnpm build:packages && pnpm test:accuracy && pnpm test:real-world
DATABASE_URL=... REDIS_URL=... pnpm --filter @gitimpact/accuracy-tests exec vitest run integration.test.ts
pnpm --filter @gitimpact/web build
pnpm audit --prod
```
