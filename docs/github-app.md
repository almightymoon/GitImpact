# GitHub App

## Install flow

1. User clicks **Connect GitHub** in GitImpact.
2. Browser opens `https://github.com/apps/<slug>/installations/new`.
3. User selects account/org and repositories.
4. GitHub sends `installation` webhook events; GitImpact stores `installation_id` + account login.
5. Subsequent private clones resolve an installation token server-side.

## Required env for the Connect button

The CTA only enables when **one** of these is set:

- `GITHUB_APP_SLUG` → builds `https://github.com/apps/<slug>/installations/new`
- `GITHUB_APP_INSTALL_URL` → used as-is

Also required for private clones / tokens:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM; `\n` escapes OK)
- `GITHUB_WEBHOOK_SECRET` (production)
- Webhook URL pointed at `https://<your-host>/api/webhooks/github`

Check locally:

```bash
curl -s http://localhost:3000/api/github/app
# expect: configured=true, installUrl="https://github.com/apps/..."
```

If `installUrl` is `null`, Connect GitHub stays disabled.

## Webhooks

Endpoint: `POST /api/webhooks/github`

- Verify `X-Hub-Signature-256`
- Claim `X-GitHub-Delivery` atomically (idempotent)
- Enqueue durable `ANALYZE_PULL_REQUEST`
- Return `202` immediately

## Comments / checks

PR comments are upserted using a stable marker (`GITIMPACT_COMMENT_MARKER`) so re-analysis updates a single comment.
Check runs are created per head SHA and completed by the worker.
