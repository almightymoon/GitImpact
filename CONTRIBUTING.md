# Contributing

Thanks for helping with GitImpact.

## Quick start

```bash
pnpm install
pnpm db:up          # optional: postgres + redis
pnpm build:packages
pnpm --filter @gitimpact/web dev
pnpm worker:dev     # when REDIS_URL is set
```

See `docs/contributing.md` for how the analysis pipeline works and how to add parsers, Checks, framework detectors, and architecture rules.

## Tests

```bash
pnpm build:packages
pnpm test:accuracy
pnpm test:real-world
```

Optional integration (Docker required):

```bash
pnpm db:up
DATABASE_URL=postgresql://gitimpact:gitimpact@127.0.0.1:5432/gitimpact \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm --filter @gitimpact/accuracy-tests exec vitest run integration.test.ts
```

## Principles

- Deterministic analysis only for v1 — no managed AI providers.
- Prefer small, reviewable PRs.
- Do not commit secrets (`.env`, private keys, installation tokens).
