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
- v1.1.2 start: relationship accuracy benchmark (`pnpm relationships`) with TP/FP/MISSING taxonomy and precision/recall targets; MEDIUM confidence copy explains Lua/SQL blind spots instead of inflating trust
- CommonJS `require("...")` now emits IMPORTS edges (Express-style .js) — fixed first relationship-benchmark miss
- HOF attribution: `const loginHandler = compose(...)` includes the outer call + nested callback CALLS
- Destructured `const { fn } = require(...)` bindings resolve to CALLS; USES probes in relationship suite
- `fetch("https://host/...")` → FETCHES external-service edges
- Python surface: `.py` in inventory, heuristic parser (imports/defs/classes/calls), Flask/FastAPI/Django detection, `python-flask-small` relationship fixture; dogfood wave 5 activated
- **v1.1.3 start:** Python route intelligence (Flask/FastAPI decorators + Django `urls.py` → `HANDLED_BY`), Python project detection (Poetry/uv/Pipenv/setuptools/src-layout), held-out emitted-edge sampler (`pnpm relationships:sample`), expanded wave-5 dogfood (Django, Click, Requests, fullstack template), FastAPI/Django fixtures
- Wave-5 dogfood 6/6: drop FastAPI→Flask false positive (test-only deps / docs_src); stop double-counting decorator routes under two frameworks; label Click CLI packages; demote Click to MEDIUM under Flask/FastAPI/Django
- v1.1.3 complete: Python class/method + src-layout + service→repo relationship fixtures; `self.method` HIGH CALLS; src-layout `authkit.*` imports; Python packages classify as LIBRARY; Django route noise cut (tests/docs skipped: 749→27); held-out edge review harness (`relationships:review-sample`) — 57 TRUE / 0 FALSE / 8 AMBIGUOUS
- **v1.1.4 start:** Go surface (`.go` inventory, heuristic parser for packages/imports/funcs/methods/structs/calls), Echo/Gin/Chi/Cobra/GORM detection + route HANDLED_BY, GORM QUERIES, local fixtures + relationship cases, dogfood wave 6 activated (Echo, Cobra, Gin, Chi, GORM, testify); language freeze after Go → v1.2 history/workflows
- Wave-6 dogfood 6/6: Go modules without HTTP surface classify as LIBRARY (GORM, testify); skip Chi `_examples/` route noise (47→9); surface Go heuristic + anonymous-handler blind spots in dogfood coverage; held-out Go edge review 22 TRUE / 0 FALSE
- **v1.1.4 complete / language freeze:** JS/TS + Python + Go are the supported languages; no Java/Rust/C# until v1.2 workflow value ships
- **v1.2 start:** analysis history snapshots (`analysis_history`), architecture + blast-radius compare (`gitimpact compare`, history API), deterministic review reports + export packs, Overview history panel
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
