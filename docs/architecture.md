# GitImpact architecture (v1.0)

## Processes

- **web** (`apps/web`) — Next.js API + UI. Accepts analyze requests and GitHub webhooks, enqueues durable jobs, serves cached analyses.
- **worker** (`apps/worker`) — Consumes BullMQ jobs, runs analysis, updates PR comments / check runs.
- **postgres** — Analyses, installations, webhook deliveries, job records.
- **redis** — BullMQ queue + rate-limit counters (required in production).

## Analysis pipeline

clone → discover → parse → graph → frameworks → architecture → checks → impact → persist

Heavy work must not run inside the webhook HTTP request. Webhooks claim delivery IDs, enqueue `ANALYZE_PULL_REQUEST`, and return `202`.

## Job model

Types: `ANALYZE_REPOSITORY`, `ANALYZE_PULL_REQUEST`, `UPDATE_PR_COMMENT`, `UPDATE_CHECK_RUN`

States: `QUEUED` → `RUNNING` → `SUCCEEDED` | `RETRYING` → `DEAD_LETTER`

Payloads are lightweight (owner/repo/SHAs/installationId). Graphs and tokens are never placed on the queue.

## Cache

Analyses persist in Postgres. Schema version: `ANALYSIS_SCHEMA_VERSION` (`1.0`).
Cache identity should include owner, repo, commit SHA (and base/head for PRs).

## Security principles

- Static analysis only — never execute repository code (`npm install`, tests, builds).
- Installation tokens stay server-side, short-lived, never logged.
- Treat every cloned repository as hostile input.
