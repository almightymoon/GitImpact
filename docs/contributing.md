# Contributing to GitImpact analysis

GitImpact is deterministic static analysis. Do not add managed AI providers.

## Pipeline overview

1. **Clone** — `packages/git` clones via `execFile("git", …)` (no shell).
2. **Discover** — `inventoryRepositoryFiles` walks the workspace under quotas.
3. **Parse** — `packages/parser` builds ASTs for TS/JS (never executes repo code).
4. **Graph** — `packages/graph` builds dependency nodes/edges.
5. **Frameworks / APIs** — `packages/framework-detector`.
6. **Architecture** — `packages/analysis` projection + walkthrough.
7. **Checks** — security / quality / deps / CI / infra rules.
8. **Impact** — `packages/impact-engine` for PR / change blast radius.
9. **Persist** — Postgres (or memory in dev) keyed by commit SHA + `ANALYSIS_SCHEMA_VERSION`.

Jobs run in `apps/worker` via Redis/BullMQ (`packages/queue`).

## Add a parser rule

1. Extend `packages/parser` visitors for the AST node you care about.
2. Emit stable node identities (file + symbol).
3. Add a fixture under `tests/accuracy` or `tests/real-world`.
4. Run `pnpm test:accuracy`.

## Add a Check rule

1. Add a rule id + finding shape in `packages/analysis/src/checks/`.
2. Register it in the category runner (`security`, `quality`, …).
3. Document remediation text (why + how to fix).
4. Honor `.gitimpact.yml` severity / suppressions.
5. Cover with an accuracy fixture.

## Add a framework detector

1. Extend `packages/framework-detector` with file/manifest signals.
2. Prefer deterministic path/content matches over heuristics that need network.
3. Export routes/components into the shared graph when applicable.

## Add architecture classification

1. Update classification helpers under `packages/analysis/src/architecture/`.
2. Keep walkthroughs deterministic and evidence-backed.
3. Avoid collapsing large systems into an opaque “Other” bucket without a test.

## Benchmarks

```bash
pnpm build:packages
pnpm test:accuracy
pnpm test:real-world
```

## Security invariants

- Never `npm install` / run scripts from analyzed repositories.
- Never log installation tokens or private keys.
- Treat every repository as hostile input.
