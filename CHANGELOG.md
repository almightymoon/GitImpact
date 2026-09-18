# Changelog

## 1.0.0-beta (unreleased)

### Platform

- Durable Redis/BullMQ queue with dedicated worker process
- Async `POST /api/analyze` (202 + job polling) for repository and PR URLs
- Job states, bounded retries, dead-letter inspect/retry
- Rate limiting, resource quotas, analysis phase timeouts
- Persistent analysis cache keyed by commit SHA + schema version
- Concurrent analysis deduplication
- Structured JSON logging, request IDs, health/ready endpoints
- Production Docker Compose (`web` + `worker` + Postgres + Redis)
- Admin CLI: health, jobs, cache purge, retention
- Worker heartbeat + scheduled retention cleanup

### RC validation fixes (2026-09-18)

- Production images install `git` / `ca-certificates`; web starts via Next binary (no runtime pnpm)
- Worker receives `GITHUB_WEBHOOK_SECRET` required by production config validation
- Persist analysis cache columns (`commit_sha`, `schema_version`, `expires_at`) to Postgres
- Deterministic failures use BullMQ `UnrecoverableError` (no expensive re-clones)
- Redis clients fail closed with timeouts; readiness recovers after Redis/Postgres outages
- `/api/ready` pings Postgres (`SELECT 1`) and Redis; analyze returns `QUEUE_UNAVAILABLE` / `DATABASE_UNAVAILABLE`
- Dead-letter retry re-adds BullMQ jobs instead of deduping against the reset QUEUED row
- Failed Redis enqueue marks the Postgres job `FAILED` (no orphaned active QUEUED rows)

### v1.1 dogfood start

- Roadmap + dogfood matrix/harness (`docs/roadmap.md`, `pnpm dogfood`)
- Fix Express false positives: no longer match `*Expression*` exports; ignore test-only `express` deps; detect Express package by name; label Fastify/Hono/Koa correctly
- GitOps/YAML-only overview: classify as GITOPS, surface manifest languages/modules/infra signals
- Wave-2: ignore `devDependencies` and `examples/` for framework labels; label Socket.IO/MSW/Preact by package name; stop classifying CI-only libs as DEVOPS
- Wave-3: aggregate workspace package prod/peer deps for monorepos; label Formik/Vite; treat `src/<package>.ts` as library entry
- Wave-4 held-out set (12 repos): primary-package-only deps, skip optional peers, ignore type-only Express imports, label Zod/Solid/Drizzle/Remix/Lit/BullMQ/Zustand/tRPC/TanStack Query/Payload; docs/www/bench excluded from framework signals
- Richer Analysis Coverage panel: file inventory counts, edge confidence mix, per-framework confidence, potential blind spots
- Relationship evidence on CALLS/IMPORTS/USES edges (file, snippet, resolved-through) with graph edge inspect UI
- Monorepo architecture: `apps/*` / `packages/*` become first-class systems with cross-package uses/calls edges
- CLI: `structure`, `impact`, `pr --base`, `export architecture.md` for local adoption without GitHub
- Analysis confidence / coverage report on Overview (parse %, edge confidence, unsupported inventory groups)
- Adoption: public sample chips, “Report incorrect analysis” issue draft, local-path CLI (`gitimpact analyze ./dir`), `docs/examples.md`

### Security

- HTTPS GitHub-only clone URLs, credential redaction, structured log scrubbing
- Webhook signature verification + delivery idempotency
- Static analysis only — repository code is never executed

### Docs

- Architecture, deployment, GitHub App, security, operations, contributing
- Public beta checklist, private-repo E2E, load-testing guide
- Release candidate report: `docs/release-candidate.md`
- Roadmap: `docs/roadmap.md` (v1.1 dogfood-first accuracy)
- Dogfood matrix: `docs/dogfood.md` / `tests/dogfood/`
