# Public beta checklist

## Environment

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` (Postgres)
- [ ] `REDIS_URL`
- [ ] `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`
- [ ] `GITHUB_APP_SLUG` or `GITHUB_APP_INSTALL_URL`
- [ ] `GITHUB_WEBHOOK_SECRET`
- [ ] `GITIMPACT_PUBLIC_URL`
- [ ] Quota / rate-limit env vars reviewed (`.env.example`)

## Deployment

- [ ] Migrations applied through `0005_job_result.sql`
- [ ] `docker compose -f docker-compose.prod.yml up -d --build` (or equivalent)
- [ ] `GET /api/health` → 200
- [ ] `GET /api/ready` → 200 (DB + Redis)
- [ ] Worker process running separately from web
- [ ] Graceful SIGTERM verified on rolling deploy

## GitHub App

- [ ] App permissions: Contents read, Pull requests read/write, Checks write, Metadata
- [ ] Webhook URL → `/api/webhooks/github`
- [ ] Install on a test org with one private + one public repo
- [ ] Follow `docs/private-repo-e2e.md`

## Limits (documented defaults)

| Limit | Default |
|-------|---------|
| Analyze rate | 10 / 60s |
| Max repository files | 20_000 |
| Soft parse files | 800 |
| Max analysis duration | 5 min |
| Job attempts | 3 |
| Repo cache TTL | 24h |
| PR cache TTL | 6h |

## Verification suites

- [ ] `pnpm test:accuracy`
- [ ] `pnpm test:real-world`
- [ ] `pnpm --filter @gitimpact/web build`
- [ ] Integration tests with Redis/Postgres when Docker is available
- [ ] Load scenarios in `docs/load-testing.md`
- [ ] Manual private-repo E2E

## Release

- [ ] Tag `v1.0.0-beta.N` (or `v1.0.0` when ready)
- [ ] Update `CHANGELOG.md`
- [ ] Confirm `SECURITY.md` + `CONTRIBUTING.md` on default branch
