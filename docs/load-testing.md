# Load & failure testing

## Automated (CI-friendly)

```bash
pnpm --filter @gitimpact/accuracy-tests exec vitest run \
  webhook-reliability.test.ts security.test.ts v1-ops.test.ts
```

Covers:

- webhook delivery idempotency (duplicate `X-GitHub-Delivery`)
- retry vs deterministic failure classification
- 20× concurrent same-SHA enqueue dedupe
- rate limits, quotas, timeouts, dead-letter
- URL/protocol safety + log redaction

## Redis / Postgres integration

Requires Docker:

```bash
pnpm db:up
# apply migrations if volume is fresh (compose mounts drizzle SQL)

DATABASE_URL=postgresql://gitimpact:gitimpact@127.0.0.1:5432/gitimpact \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm --filter @gitimpact/accuracy-tests exec vitest run integration.test.ts
```

Validates job persistence, Redis ping, active-job dedupe in Postgres. Skipped automatically when env is unset.

## Automated multi-repo load (RC)

With web + worker + Postgres + Redis running:

```bash
GITIMPACT_PUBLIC_URL=http://localhost:3001 pnpm rc:load-test
```

Enqueues ≥10 distinct public repositories, polls jobs to completion, writes `.rc-tmp/evidence/load-*.json`. Verdict `PASS` when ≥10 distinct analyses succeed.

## No-exec marker proof (RC)

```bash
pnpm rc:no-exec
```

Analyzes `tests/real-world/cases/no-exec-marker` (package.json install scripts that would write a sentinel) and asserts the sentinel is never created.

## Manual scenarios

1. **Web restart** — enqueue with Redis, restart web only; worker should still complete; poll `/api/jobs/{id}`.
2. **Worker restart** — job in `RUNNING` should retry via BullMQ attempts / re-queue.
3. **Redis restart** — `/api/ready` → 503 in production; jobs resume after Redis returns.
4. **DB restart** — ready fails; after recovery, jobs/cache available again.
5. **10–20 concurrent different repos** — use `pnpm rc:load-test`; rate limit may 429.
6. **Large repo near quota** — expect `REPOSITORY_TOO_LARGE` rather than OOM.
7. Private-repo matrix — `docs/private-repo-e2e.md`.

Avoid hammering production GitHub orgs from CI.
