# Deployment

## Local dependencies

```bash
pnpm db:up          # postgres + redis
pnpm build:packages
pnpm --filter @gitimpact/web dev
pnpm worker:dev     # optional when REDIS_URL is set
```

Apply migrations (including `packages/db/drizzle/0004_v1_jobs.sql`) against Postgres.

## Production compose

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Services: `web`, `worker`, `postgres`, `redis`.

## Required production env

- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITIMPACT_PUBLIC_URL`

See `.env.example` for quotas and rate limits.

## Health

- `GET /api/health` — liveness
- `GET /api/ready` — DB + Redis readiness (strict in production)

## Worker

```bash
pnpm --filter @gitimpact/worker start
```

Graceful shutdown on `SIGTERM` / `SIGINT`.
