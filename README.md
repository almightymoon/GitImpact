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
