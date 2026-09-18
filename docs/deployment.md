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
# Optional: map web to another host port if 3000 is taken
# GITIMPACT_WEB_PORT=3001
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Services: `web`, `worker`, `postgres`, `redis`.

The runtime images include `git` and `ca-certificates` (worker clones repositories for static analysis only — never `npm install`).

Postgres publishes `5432` and Redis `6379` for host-side admin/integration use. Override with compose if those ports collide.

## Required production env

- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITIMPACT_PUBLIC_URL`
- Optional: `GITHUB_TOKEN` (public API rate-limit headroom; not a substitute for the GitHub App on private repos)

See `.env.example` for quotas and rate limits.

## Health

- `GET /api/health` — liveness
- `GET /api/ready` — DB + Redis readiness (strict in production)

## Worker

```bash
pnpm --filter @gitimpact/worker start
```

Graceful shutdown on `SIGTERM` / `SIGINT`.
