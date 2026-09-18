# GitHub App

## Install flow

1. User clicks **Connect GitHub** in GitImpact.
2. Browser opens `https://github.com/apps/<slug>/installations/new`.
3. User selects account/org and repositories.
4. GitHub sends `installation` webhook events; GitImpact stores `installation_id` + account login.
5. Subsequent private clones resolve an installation token server-side.

## Webhooks

Endpoint: `POST /api/webhooks/github`

- Verify `X-Hub-Signature-256`
- Claim `X-GitHub-Delivery` atomically (idempotent)
- Enqueue durable `ANALYZE_PULL_REQUEST`
- Return `202` immediately

## Comments / checks

PR comments are upserted using a stable marker (`GITIMPACT_COMMENT_MARKER`) so re-analysis updates a single comment.
Check runs are created per head SHA and completed by the worker.
