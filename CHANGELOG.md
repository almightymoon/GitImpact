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

### Security

- HTTPS GitHub-only clone URLs, credential redaction, structured log scrubbing
- Webhook signature verification + delivery idempotency
- Static analysis only — repository code is never executed

### Docs

- Architecture, deployment, GitHub App, security, operations, contributing
- Public beta checklist, private-repo E2E, load-testing guide
