# Open-source launch readiness — implementation report

**Date:** 2026-10-20 (UTC)  
**Baseline commit:** `67c26e2e15b10fa610b54ddf9a832e956d5d3be6`  
**Working tree:** launch-readiness changes **uncommitted** (not pushed)  
**Verdict:** Better documented and safer AI surface — **not** ready to tag `1.0.0-beta` until LICENSE + live GitHub App proofs.

---

## 1. Repository assessment

### Architecture (confirmed in code)

Monorepo (`pnpm` + turbo): `apps/web` (Next.js API/UI), `apps/worker` (BullMQ), `packages/{parser,framework-detector,graph,impact-engine,analysis,git,queue,db,ops,ai,shared}`, `cli`, accuracy/real-world/relationships/dogfood suites.

**Confirmed capabilities:** public repo/PR analyze; dependency graph + blast-radius; GitHub App webhook/PR comment/Check Run paths (code present); CLI; JS/TS AST + Python/Go/Java/Rust/C# heuristics; optional BYOK AI narrative; history/compare/saved views.

### Highest-priority blockers found (Phase 1)

1. No root `LICENSE` (cannot claim OSS terms)
2. Public `/api/ai/narrative` could burn server API key (fixed this cycle)
3. Stale / hard-to-scan README vs actual product
4. Missing `.github` issue/PR templates
5. Live private App E2E + webhooks still credential-blocked
6. Dependency audit highs (partially reduced this cycle)

---

## 2. Changes implemented

| Change | Files | Why | Behavior | Tests |
|--------|-------|-----|----------|-------|
| BYOK-only public AI endpoint | `apps/web/.../ai/narrative/route.ts` | Prevent anonymous server-key burn | Requires client key; rate limit; digest size/validation; `allowServerKey: false` | `@gitimpact/ai` unit tests |
| Digest sanitize/redact + prompt sections | `packages/ai/src/{digest,prompt,index}.ts` | Minimize disclosure; useful narrative structure | Secret-like strings → `[redacted]`; structured prompt | 8 AI tests PASS |
| Worker/PR keep server key | `apps/worker`, `packages/analysis/pr-workflow.ts` | PR comments still may use operator key | `allowServerKey: true` on server path only | build |
| AI settings clear-key UX | `AiSettingsPanel.tsx` | SessionStorage tradeoff + clear | Clear removes key | manual/UI |
| README / CONTRIBUTING / ai.md / SECURITY | docs + root | First-minute DX + accurate AI modes | Scannable, no invented metrics | n/a |
| `.github` templates | `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md` | Community onboarding | Bug/feature/PR forms | n/a |
| Launch pack drafts | `docs/launch/*` | Portfolio/launch without publishing | License decision, issues, announcement, metadata | n/a |
| Real-world skip incomplete fixtures | `tests/real-world/real-world.test.ts` | Suite was FAIL on dirs without `expected.json` | Only cases with expectations run | 17 PASS |
| Next 15.5.27 + drizzle-orm ^0.45.2 | `apps/web`, `packages/db`, lockfile | Address advisory patches | Next cache-poisoning + drizzle identifier SQLi patched | web build PASS; db build PASS |

**Not done (owner decision):** root `LICENSE` file (see `licensing-decision.md`).

---

## 3. Test results

| Check | Result | Evidence |
|---|---|---|
| Package build | **PASS** | `pnpm build:packages` (exit 0) |
| Web production build | **PASS** | `pnpm --filter @gitimpact/web build` (Next 15.5.27) |
| AI unit / security tests | **PASS** | `pnpm --filter @gitimpact/ai test` — 8 passed |
| Parser / analysis / framework-detector / git | **PASS** | 6 + 20 + 17 + 1 tests |
| Analysis accuracy | **PASS** | `pnpm test:accuracy` — 85 passed, 3 skipped; TP suite metrics 100% on TS fixtures |
| Relationship accuracy | **PASS** | `pnpm relationships` — TP=112 P=1 R=1 |
| Real-world | **PASS** | `pnpm test:real-world` — 17 passed (4 incomplete dirs skipped) |
| RC no-exec | **PASS** | `pnpm rc:no-exec` → `.rc-tmp/evidence/no-exec-*.json` |
| Dependency audit | **PARTIAL** | Was 11 vulns; after Next+drizzle: **8** (5 high / 2 moderate / 1 low). Remaining: Next-bundled `postcss`/`source-map-js`/`sharp`, transitive `braces` (no patch), false-positive `cli` name collision |
| GitHub App E2E (private) | **BLOCKED: credentials required** | `pnpm rc:private-e2e` |
| Load test ≥10 repos | **PASS** | 12/12 with `gh auth token` → `.rc-tmp/evidence/load-1792490448204.json` |
| Live webhook / PR comment / Check Run | **BLOCKED: credentials required** | Needs installed App |
| Production deployment | **BLOCKED: infrastructure required** | No deploy this cycle |
| Typecheck (full turbo) | **NOT RUN** this cycle | Packages built via `tsc`; web typecheck included in `next build` |

---

## 4. Remaining blockers

### Must fix before public beta

1. **Owner confirms license** and adds root `LICENSE` (+ package metadata)
2. **Live GitHub App proofs** (private clone, webhook signature path, PR comment upsert, Check Runs) with real secrets
3. **Load test** to ≥10 SUCCEEDED with `GITHUB_TOKEN` (or document rate-limit expectation)
4. **Honest beta label** — do not claim production-ready until (2)

### Should fix soon

1. Remaining audit highs tied to Next’s `postcss@8.4.31` / `sharp@0.35.4` (await upstream Next bump or pnpm overrides after validating)
2. Author `expected.json` for JVM/Rust/C# real-world samples (starter issue #6)
3. Re-run historical Compose/outage RC rows before tagging

### Optional

1. Publish starter issues from `docs/launch/starter-issues.md`
2. Enable Discussions; set topics/description from `repo-metadata.md`
3. AI prompt eval fixtures with mocked `fetch`

### Human decisions / external deps

- License SPDX choice (MIT recommended)
- GitHub App private key + webhook secret + installation on a private test repo
- Optional `GITHUB_TOKEN` for load test
- Authorization to push commits / create release tag / change GitHub settings

---

## 5. Open-source launch pack

| Item | Location / status |
|------|-------------------|
| Repo description + topics | `docs/launch/repo-metadata.md` (draft; do not apply without OK) |
| README / CONTRIBUTING | Updated in working tree |
| Starter issues | `docs/launch/starter-issues.md` (6 drafts; unpublished) |
| Announcement | `docs/launch/announcement-draft.md` |
| Demo outline | `docs/launch/demo-outline.md` |
| License | **Pending owner** — `docs/launch/licensing-decision.md` |

---

## 6. Recommended next steps (priority order)

1. **Confirm MIT (or alternate) and add `LICENSE`** — without this, launch messaging is legally ambiguous.
2. **Commit launch-readiness changes on a branch + open PR** (owner) — reviewable AI harden + docs; do not force-push.
3. **Run `pnpm rc:private-e2e` with App secrets** — only credible path to “GitHub integration works.”
4. **Re-run `pnpm rc:load-test` with `GITHUB_TOKEN`** — clear PARTIAL rate-limit noise.
5. **Decide on Next postcss/sharp overrides vs wait** — document residual audit in SECURITY until resolved.

---

## Definition of success (this cycle)

GitImpact is easier to adopt (README/CONTRIBUTING/templates), safer on the public AI endpoint (BYOK + rate limit + redaction), and backed by reproducible local evidence. Deterministic analysis remains fully useful without AI. Public beta tag is **not** declared.
