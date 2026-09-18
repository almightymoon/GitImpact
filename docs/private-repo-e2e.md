# Private repository E2E (manual)

Requires a real GitHub App install. Do not automate against production orgs.

## Happy path

1. Configure App secrets locally / staging.
2. Click **Connect GitHub** → install App → select a private repository.
3. Confirm webhook `installation` stored (`installation_id` for account).
4. Paste private repo URL into Analyze → job completes → overview loads.
5. Open PRs list for that repo.
6. Open a PR → impact analysis succeeds.
7. Confirm GitImpact PR comment upsert (single comment, updates on push).
8. Confirm Check Run created/completed for head SHA.

## Negative path

| Scenario | Expected |
|----------|----------|
| Private repo, App not installed | `PRIVATE_REPOSITORY` / connect CTA |
| Repo outside installation scope | `ACCESS_DENIED` or `PRIVATE_REPOSITORY` |
| Installation revoked / deleted | subsequent analyze fails with access error; no token leakage |
| Expired installation token | regenerated on next request (no persisted token) |

## Evidence to capture

- Request ID from UI / `x-request-id`
- Job ID + phases from `/api/jobs/{id}`
- Webhook delivery ID (no duplicate comments on redelivery)
- Confirm logs contain no `ghs_` / `x-access-token` secrets
