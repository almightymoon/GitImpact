# GitImpact v1.0.0-beta Release Candidate Report

**Date:** 2026-10-20  
**Commit:** `67c26e2` (baseline before launch-readiness hardening) + subsequent local launch-readiness changes  
**Verdict:** **NOT READY** to tag `1.0.0-beta`

Status vocabulary: **PASS** (verified this cycle), **FAIL**, **PARTIAL**, **BLOCKED**, **NOT TESTED**.

Evidence (local/gitignored): `.rc-tmp/evidence/`

---

## Executive summary

Core public analysis, queue/ops hardening, no-exec marker proof, relationship fixtures (incl. Java/Rust/C#), and BYOK AI foundation exist in code. Launch-readiness work hardened the public AI endpoint (BYOK-only, rate limit, digest redaction) and refreshed OSS docs.

**Still blocking a beta tag:**

1. Live private GitHub App E2E (`pnpm rc:private-e2e` + App secrets) — still `SKIPPED_NO_CREDENTIALS` without `GITHUB_APP_*`
2. Live webhook / PR-comment / Check Run proofs on a real install
3. Remaining deferred dependency audit findings (`SECURITY.md`)

**Resolved this cycle:** root MIT `LICENSE` + package metadata; load test **12/12 PASS** with GitHub token.

---

## Validation table (current)

| Test | Status | Evidence / notes |
|------|--------|------------------|
| Package build | PASS (2026-10-20) | `pnpm build:packages` |
| Web production build | PASS | `pnpm --filter @gitimpact/web build` (Next 15.5.27) |
| `pnpm relationships` | PASS | TP=112 P=1 R=1 |
| `pnpm test:accuracy` | PASS | 85 passed / 3 skipped |
| `pnpm test:real-world` | PASS | 17 passed (incomplete fixtures skipped) |
| `@gitimpact/ai` tests | PASS | 8 passed (BYOK / redact / URL safety) |
| `pnpm rc:no-exec` | PASS | `.rc-tmp/evidence/no-exec-*.json` |
| `pnpm rc:load-test` | PASS (2026-10-20) | 12/12 SUCCEEDED with `GITHUB_TOKEN` from `gh auth token`; evidence `.rc-tmp/evidence/load-1792490448204.json` |
| Private repo E2E | BLOCKED | `SKIPPED_NO_CREDENTIALS` — needs `GITHUB_APP_ID` / private key / webhook secret |
| Live webhook / comment / checks | BLOCKED | credentials required |
| Public AI endpoint abuse (server key) | FIXED in launch-readiness | BYOK required; `allowServerKey: false` on HTTP |
| Temp dir cleanup | NOT TESTED | |
| Dependency audit | PARTIAL | 8 remaining after Next+drizzle bumps; see launch report |

Historical September RC ops PASS rows (Compose boot, Redis/Postgres outage recovery, dead-letter retry, etc.) remain documented in git history from 2026-09-18 and were not all re-executed this cycle — re-run before tagging.

---

## RC commands

```bash
pnpm build:packages
pnpm rc:no-exec
GITIMPACT_PUBLIC_URL=http://localhost:3001 GITHUB_TOKEN=… pnpm rc:load-test
# With App secrets:
pnpm rc:private-e2e
```

Harnesses: `scripts/rc-*.mjs`.
