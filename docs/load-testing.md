# Load & failure testing

## Scenarios

1. **10 concurrent analyze requests** — different public fixture URLs or the same local fixture via API mock.
2. **Same repo @ same SHA concurrently** — expect job dedupe (`deduped: true`) / shared result.
3. **Repeated webhook deliveries** — same `X-GitHub-Delivery` must not double-comment.
4. **Large repository** — assert `REPOSITORY_TOO_LARGE` rather than OOM.
5. **Redis down** — production must fail ready check / refuse silent ephemeral queue.
6. **DB down** — readiness 503; jobs that need persistence surface `DATABASE_UNAVAILABLE` where applicable.
7. **GitHub timeout / 429** — worker retries with backoff; deterministic private/404 does not infinite-retry.
8. **Analysis timeout** — `ANALYSIS_TIMEOUT` with `phase` set.

## Local helpers

```bash
# Unit / ops coverage
pnpm --filter @gitimpact/accuracy-tests exec vitest run v1-ops.test.ts

# Packages + web
pnpm build:packages
pnpm --filter @gitimpact/web build
```

Avoid hammering production GitHub orgs from CI. Use signed webhook fixtures and in-memory queue mode (`REDIS_URL` unset) for most automated cases.
