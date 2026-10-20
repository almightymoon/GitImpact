# Contributing to GitImpact analysis

GitImpact’s core path is **deterministic static analysis**. Optional BYOK AI (`packages/ai`) may narrate digests but must not invent edges, bugs, or test results. Keep the product fully useful with AI disabled.

## Pipeline overview

1. **Clone** — `packages/git` clones via `execFile("git", …)` (no shell).
2. **Discover** — `inventoryRepositoryFiles` walks the workspace under quotas.
3. **Parse** — `packages/parser` (TS/JS via ts-morph; Python/Go/Java/Rust/C# heuristics).
4. **Graph** — `packages/graph` builds dependency nodes/edges.
5. **Frameworks / APIs** — `packages/framework-detector`.
6. **Architecture** — `packages/analysis` projection + walkthrough.
7. **Checks** — security / quality / deps / CI / infra rules.
8. **Impact** — `packages/impact-engine` for PR / change blast radius.
9. **Persist** — Postgres (or memory in dev) keyed by commit SHA + `ANALYSIS_SCHEMA_VERSION`.
10. **Optional AI** — digest → narrative (worker may use server `GITIMPACT_AI_*`; public HTTP requires client BYOK).

Jobs run in `apps/worker` via Redis/BullMQ (`packages/queue`), or inline when Redis is unset.

## Add a parser rule

1. Extend the relevant file under `packages/parser` (or add a language module).
2. Emit stable node identities (file + symbol).
3. Wire extensions into `CODE_EXTENSIONS` / `parseRepository` when adding a language.
4. Add a fixture under `tests/accuracy`, `tests/real-world`, or `tests/relationships`.
5. Run `pnpm --filter @gitimpact/parser test` and the relevant suite.

## Add a Check rule

1. Add a rule id + finding shape in `packages/analysis/src/checks/`.
2. Register it in the category runner (`security`, `quality`, …).
3. Document remediation text (why + how to fix).
4. Honor `.gitimpact.yml` severity / suppressions.
5. Cover with an accuracy fixture.

## Add a framework detector

1. Extend `packages/framework-detector` with file/manifest signals.
2. Prefer deterministic path/content matches over network-dependent heuristics.
3. Export routes into the shared graph when applicable (`HANDLED_BY` needs `handlerName` / `handlerClass` when possible).

## Add architecture classification

1. Update helpers under `packages/analysis/src/architecture/` (and related).
2. Keep walkthroughs deterministic and evidence-backed.

## Benchmarks

```bash
pnpm build:packages
pnpm test:accuracy
pnpm test:real-world
pnpm relationships
pnpm dogfood -- --wave 7
```

## Security invariants

- Never `npm install` / run scripts from analyzed repositories.
- Never log installation tokens, private keys, or AI API keys.
- Treat every repository as hostile input.
- Public `/api/ai/narrative` must not use the operator’s server AI key (client BYOK only).
