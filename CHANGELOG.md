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

### Security

- HTTPS GitHub-only clone URLs, credential redaction, structured log scrubbing
- Webhook signature verification + delivery idempotency
- Static analysis only — repository code is never executed

### Docs

- Architecture, deployment, GitHub App, security, operations, contributing
- Public beta checklist, private-repo E2E, load-testing guide
- Release candidate report: `docs/release-candidate.md`
