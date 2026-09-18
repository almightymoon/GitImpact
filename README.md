# GitImpact

**Know What Breaks Before You Merge.**

GitImpact maps the blast radius of code changes across a repository using static analysis and dependency graphs.

## MVP (v0.1)

- Public GitHub repositories & pull requests
- TypeScript / JavaScript parsing (`ts-morph`)
- Import / call / test dependency graph
- Blast-radius traversal with configurable depth
- Interactive React Flow graph
- URL routes: `/owner/repo` and `/owner/repo/pull/123`
- CLI: `gitimpact analyze <url>`

## Quick start

Requires **Node 20+** and **pnpm 9**.

```bash
pnpm install
pnpm build:packages
pnpm --filter @gitimpact/web dev
```

Open [http://localhost:3000](http://localhost:3000).

- Paste a public GitHub repo or PR URL, or use the local demos
- Repo demo: [/demo/tiny-fixture](http://localhost:3000/demo/tiny-fixture)
- PR demo: [/demo/tiny-fixture/pull/1](http://localhost:3000/demo/tiny-fixture/pull/1) (Overview · Graph · Changes · Tests · APIs)

## Persistence

Analyses are cached in memory and, when configured, written to Postgres.

```bash
cp .env.example apps/web/.env.local
pnpm db:up          # starts Postgres via Docker
# schema auto-applies from packages/db/drizzle/0000_init.sql on first boot
pnpm build:packages
pnpm --filter @gitimpact/web dev
```

Without `DATABASE_URL`, GitImpact still works with in-memory storage (lost on restart).

## Framework route detection

MVP detectors:

- **Next.js** — `app/api/**/route.ts` and `pages/api/**`
- **Express** — `app.get/post/...`, `router.get/...`, `.route().get(...)`

### CLI

```bash
pnpm --filter @gitimpact/cli build
node cli/dist/index.js analyze github.com/owner/repo
```

## Monorepo

```text
apps/web                      Next.js UI + API
packages/shared               Shared types
packages/git                  GitHub URL + clone helpers
packages/parser               TS/JS AST extraction
packages/framework-detector   Next.js + Express route detection
packages/graph                Dependency graph builder
packages/impact-engine        Blast-radius traversal
packages/db                   Postgres + Drizzle persistence
packages/analysis             Orchestration + cache
cli                           Local CLI
```

## Principles

1. Deterministic static analysis first
2. AI explains findings later (not in MVP core path)
3. Never execute repository code
4. Confidence levels on relationships

### Accuracy benchmark (v0.4)

```bash
pnpm build:packages
pnpm test:accuracy
```

Cases live under `tests/accuracy/cases/` and assert exact CALLS/IMPORTS edges, changed symbols, blast-radius nodes, and semantic events. `pnpm test:accuracy` regenerates `tests/accuracy/results.json` with measured precision/recall (not hand-written scores).

### Real-world benchmark

Adversarial snapshots under `tests/real-world/cases/` (Next.js, NestJS, Express, Prisma, monorepo). Reports resolution coverage — not only labelled precision:

```bash
pnpm test:real-world
```

Call graphs resolve through the TypeScript type checker (repository-level `ts-morph` Project), not name heuristics:

```text
CallExpression → Symbol → Declaration → exact file + function/method
```

Graph semantics:

- `FILE/CLASS → * : CONTAINS`
- `FILE → exported symbol : EXPORTS`
- `FUNCTION/METHOD → FUNCTION/METHOD : CALLS` (resolved)

### v0.3 — Diff-to-AST

Changed line ranges from Git patches map to the smallest enclosing FUNCTION/METHOD/CLASS via AST — not declaration-line regex alone.

### v0.4 — Semantic Diff Engine

Unified diffs are compared as old-file AST vs new-file AST, emitting events such as `METHOD_REMOVED`, `PARAMETER_ADDED`, `CALL_ADDED`, and `BODY_CHANGED` — finer than broad STRUCTURAL / INTERFACE / BEHAVIORAL buckets.

### v0.5 — Framework & Resolution Coverage

Dynamic `import()`, NestJS DI (`DEPENDS_ON`) + decorator routes (`HANDLED_BY`), and Prisma delegate `QUERIES` → `DATABASE_MODEL` edges. Goal on the real-world suite: resolution coverage ≥ 90% with precision ≥ 98%.

### v0.6 — GitHub PR Integration

Product flow for teams:

```text
PR opened / synchronized
        ↓
GitImpact analyzes diff
        ↓
semantic diff → blast radius → test gaps
        ↓
upsert PR comment
```

**Webhook:** `POST /api/webhooks/github` (events: `pull_request` opened / synchronize / reopened)

**Manual:** `POST /api/pr/comment` or CLI:

```bash
gitimpact comment https://github.com/owner/repo/pull/123
gitimpact comment https://github.com/owner/repo/pull/123 --dry-run
```

Requires `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (preferred) or `GITHUB_TOKEN` (dev). Optional: `GITHUB_WEBHOOK_SECRET`, `GITIMPACT_PUBLIC_URL`, `GITIMPACT_API_KEY`.

### v0.7 — GitHub App & Production PR Workflow

Production-oriented PR pipeline:

```text
GitHub App installed → installation_id stored
        ↓
Webhook (X-GitHub-Delivery claimed once)
        ↓
202 Accepted + background job
        ↓
Installation access token
        ↓
Analyze private/public repo
        ↓
Upsert PR comment + neutral Check Run
```

- **App auth:** short-lived installation tokens (no long-lived PAT required)
- **Idempotency:** `webhook_deliveries.delivery_id` rejects duplicate deliveries
- **Async:** webhook returns `202` immediately; analysis runs in-process queue
- **Checks:** `GitImpact` check run concludes `neutral` (informational, does not block merges)
- **Manual endpoint:** `POST /api/pr/comment` requires `Authorization: Bearer <GITIMPACT_API_KEY>` to post; unauthenticated callers get dry-run only

Apply DB migration: `packages/db/drizzle/0001_github_app.sql`

### v0.8 — Product UX & Repository Intelligence

Turns analysis into an understandable product surface:

- **Overview:** repository type, README digest, architecture summary, modules, analysis health
- **Private repos:** clear access-error states (never silent empty graphs)
- **Graph:** relationship inspector, blast-radius explanation, copyable impact summary
- **PRs:** open PR listing + “potential impact if merged” detail
- **Semantic changes / Tests / APIs:** human labels, why-flagged gaps, API chains, infra empty states
- **Navigation:** empty-canvas click deselects (no fake back-navigation)

Apply DB migration: `packages/db/drizzle/0002_intelligence.sql`

### Roadmap

```text
v0.9  Code Quality + Security + CI/CD Intelligence
        ↓
v1.0  Public Beta & Production Hardening            ← current
```

**v1.0 focus:** durable workers (Redis/BullMQ), rate limits, quotas/timeouts, persistent jobs, structured logs, health/ready, Docker web+worker, docs — not more analyzers.

See `docs/` for architecture, deployment, configuration, operations, security, and troubleshooting.
Public beta launch checklist: `docs/beta-checklist.md`. Security policy: `SECURITY.md`.

### v1.0 — Public Beta & Production Hardening

- **Checks trust:** every finding has ruleId, severity, confidence, evidence, why-it-matters, remediation; `.gitimpact.yml` ignore + severity overrides
- **Platform:** rate limiting, durable jobs (Redis/BullMQ), persistent analysis cache, repo-size quotas
- **GitHub App:** install/onboarding flow, private-repo E2E, webhook retry / dead-letter
- **Ops:** structured logging/observability, production error handling, Docker/deploy docs
- **Product:** onboarding/tutorial, public docs, external-repo dogfooding, security review of GitImpact itself

#### `.gitimpact.yml` (Checks config)

```yaml
checks:
  ignore:
    - rule: high_complexity_function
      path: src/legacy/**
      reason: legacy module scheduled for replacement
  severity:
    dangerous_dependency: high
```

### v0.9 — Code Quality, Security & CI Intelligence

Answers: “What is risky about this code change besides dependency impact?”

- **Checks tab:** Security · Code Quality · Dependencies · CI/CD · Infrastructure
- **Security:** secret patterns, env mishandling, auth-sensitive paths, dangerous deps, risky sinks
- **Quality:** complexity, large functions/classes, unused exports, circular imports, `any`, empty catches
- **CI/CD & infra:** GitHub Actions, Docker, Kubernetes, Helm, Terraform, Argo CD — presence + PR-affected surfaces
- **PR quality report:** combined Change Impact + Quality + Security + CI/Deployment bullets
- **Structure:** infrastructure nodes (`INFRASTRUCTURE`) linked via `DEPLOYS` when detected
- **Architecture map:** GitDiagram-style Structure bands (deployment / server / client / persistence / actors)

Apply DB migration: `packages/db/drizzle/0003_checks.sql`
