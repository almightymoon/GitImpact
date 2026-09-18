# Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | — | Required in production |
| `REDIS_URL` | — | Required in production for BullMQ |
| `GITHUB_APP_ID` | — | GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | — | PEM string |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC verification |
| `GITIMPACT_PUBLIC_URL` | — | Links in comments |
| `GITIMPACT_MAX_FILES` | `800` | Soft parse cap |
| `GITIMPACT_MAX_REPOSITORY_FILES` | `20000` | Hard public-beta limit |
| `GITIMPACT_MAX_REPOSITORY_BYTES` | `500MB` | Hard size limit |
| `GITIMPACT_MAX_FILE_BYTES` | `2MB` | Per-file limit |
| `GITIMPACT_MAX_ANALYSIS_DURATION_MS` | `300000` | Wall timeout |
| `GITIMPACT_MAX_GRAPH_NODES` | `100000` | Graph safety |
| `GITIMPACT_MAX_GRAPH_EDGES` | `250000` | Graph safety |
| `GITIMPACT_ANALYZE_RATE_LIMIT` | `10` | Per client key |
| `GITIMPACT_ANALYZE_RATE_WINDOW_SECONDS` | `60` | Window |
| `GITIMPACT_JOB_MAX_ATTEMPTS` | `3` | Bounded retries |
| `GITIMPACT_WORKER_CONCURRENCY` | `2` | BullMQ concurrency |
| `GITIMPACT_REPO_CACHE_TTL_HOURS` | `24` | Repo cache TTL |
| `GITIMPACT_PR_CACHE_TTL_HOURS` | `6` | PR cache TTL |

Development may omit `REDIS_URL` / `DATABASE_URL` (inline queue + memory). Production refuses to start without them.
