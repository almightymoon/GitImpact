# Contributing

Thanks for helping with GitImpact.

## Prerequisites

- **Node.js 20+**
- **pnpm 9** (`packageManager` in root `package.json`)
- Docker optional (Postgres + Redis for persistence / durable queue)

## Quick start

```bash
pnpm install
pnpm db:up          # optional: postgres + redis
pnpm db:push        # when DATABASE_URL is set
pnpm build:packages
pnpm --filter @gitimpact/web dev
pnpm worker:dev     # when REDIS_URL is set
```

Analysis pipeline details (parsers, Checks, frameworks, architecture): [`docs/contributing.md`](docs/contributing.md).

## Workspace map

| Path | Purpose |
|------|---------|
| `apps/web` | Next.js UI + API routes |
| `apps/worker` | Job worker |
| `packages/parser` | Language parsing |
| `packages/framework-detector` | Route / framework signals |
| `packages/graph` / `impact-engine` | Graph + blast radius |
| `packages/analysis` | Orchestration |
| `packages/ai` | Optional BYOK narratives |
| `cli` | Local CLI |
| `tests/accuracy` / `real-world` / `relationships` / `dogfood` | Suites |

## Tests

```bash
pnpm build:packages
pnpm --filter @gitimpact/parser test      # focused
pnpm --filter @gitimpact/ai test
pnpm test:accuracy
pnpm test:real-world
pnpm relationships
pnpm rc:no-exec
```

Integration (Docker required):

```bash
pnpm db:up
DATABASE_URL=postgresql://gitimpact:gitimpact@127.0.0.1:5432/gitimpact \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm --filter @gitimpact/accuracy-tests exec vitest run integration.test.ts
```

## Pull requests

- Prefer small, reviewable PRs with a clear why.
- Add or update fixtures/tests for parser, graph, or security behavior changes.
- Do not commit secrets (`.env`, private keys, installation tokens, AI keys).
- Deterministic analysis must keep working with AI disabled.

## Bug reports

Include: GitImpact commit SHA, Node/pnpm versions, exact command, public repo URL or fixture path, and whether Docker/App credentials were involved. Prefer reproducible fixtures under `tests/` when possible.

## Good first contributions

Look for fixtures, detector edge cases, docs fixes, and accessibility polish. Avoid drive-by refactors of the queue/worker contract. Draft starter issues: [`docs/launch/starter-issues.md`](docs/launch/starter-issues.md).

## Principles

1. Static analysis only — never execute analyzed repository code.
2. Deterministic findings are the source of truth; AI is optional explanation.
3. Prefer evidence-backed changes over speculative accuracy claims.
