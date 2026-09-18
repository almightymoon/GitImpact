# Operations

## Jobs

Failed/exhausted jobs are stored as `DEAD_LETTER` in `analysis_jobs`.

CLI:

```bash
gitimpact admin health
gitimpact admin jobs failed
gitimpact admin jobs dead
gitimpact admin jobs inspect <id>
gitimpact admin jobs retry <id>
gitimpact admin cache purge owner/repo
gitimpact admin retention run
```

Programmatic helpers (`@gitimpact/queue` / `@gitimpact/db`):

- `listFailedJobs()`
- `listDeadLetterJobs()`
- `retryDeadLetterJob(id)`
- `getAnalysisJob(id)`

Do not print tokens or secret evidence when inspecting jobs.

## Health

- `GET /api/health` — process liveness
- `GET /api/ready` — database + Redis readiness
- `GET /api/jobs/:id` — job status / phase for debugging

## Rate limits

`POST /api/analyze` returns `429` with:

```json
{ "code": "RATE_LIMITED", "message": "Too many analysis requests.", "retryAfterSeconds": 42, "retryable": true }
```

## Logs

Structured JSON logs via `@gitimpact/ops` `log()`. Fields include `requestId`, `jobId`, `repository`, `phase`, `durationMs`. Secrets are redacted.

## Metrics (in-process)

Counters/histograms via `incMetric` / `observeMetric` / `getMetricsSnapshot()`.

## Retention

`gitimpact admin retention run` purges:

- expired analysis cache rows (`expires_at`)
- succeeded / dead-letter jobs older than 14 days
- webhook delivery records older than 30 days
