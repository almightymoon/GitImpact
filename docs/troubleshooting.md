# Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `QUEUE_UNAVAILABLE` | Missing `REDIS_URL` in production | Set Redis and restart worker/web |
| `429 RATE_LIMITED` | Client exceeded analyze quota | Wait `retryAfterSeconds` |
| `REPOSITORY_TOO_LARGE` | File/byte quota exceeded | Raise limit only intentionally |
| `ANALYSIS_TIMEOUT` | Phase hung / repo too complex | Check `phase` in error; retry later |
| Webhook `401` | Bad signature | Check `GITHUB_WEBHOOK_SECRET` |
| Duplicate ignored | Same `X-GitHub-Delivery` | Expected idempotency |
| Private repo denied | App not installed / no token | Install GitHub App for the account |
| `/api/ready` 503 | DB or Redis down | Check compose health |

Include `requestId` / `jobId` from responses when filing incidents.
