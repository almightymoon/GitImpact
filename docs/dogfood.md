# Public-beta & v1.1 dogfood

**Goal:** Find where GitImpact is wrong on real repos *before* adding languages.

Preferred loop:

1. Run the matrix (`pnpm dogfood`)
2. Manually inspect overview / graph for each repo
3. Append misses to `tests/dogfood/misses.jsonl`
4. Fix accuracy from the miss log
5. Re-run; only then expand languages (Python → Go)

Do not tune production heuristics only against the GitImpact monorepo itself.

## Quick start

```bash
pnpm build:packages
pnpm dogfood              # priority ≤ 1 (fast wave)
pnpm dogfood -- --priority 2
pnpm dogfood -- --all
pnpm dogfood -- --id express
```

Outputs:

- `tests/dogfood/results/<id>.json` — machine summary per repo
- `tests/dogfood/results/summary.json` — rollup
- `tests/dogfood/misses.jsonl` — human-curated miss log (append-only)

Optional: `GITHUB_TOKEN` raises GitHub API rate limits for HEAD SHA / clone of public repos.

## Matrix shapes

See `tests/dogfood/matrix.json`. Wave 1 is JS/TS + infra-only repos. Python/Go entries are reserved (`status: planned`) until wave-1 miss rate is under control.

## Recording a miss

```bash
pnpm dogfood:miss -- \
  --repo express \
  --kind missing_call \
  --from "src/router.js:Route.dispatch" \
  --to "src/router.js:Layer.handle_request" \
  --note "HOF dispatch not attributed to Route.dispatch"
```

Or append JSONL by hand (schema in `tests/dogfood/miss-schema.md`).

## Severity guide

| Severity | Meaning |
|----------|---------|
| `blocker` | Overview/graph actively misleading for the repo’s main story |
| `high` | Important relationship wrong/missing; trust damaged |
| `medium` | Noticeable gap; workaround exists |
| `low` | Edge case / polish |

## Per-run fields to glance at

- durationMs, commitSha
- filesDiscovered / filesParsed / parseFailures / truncated
- graph nodes/edges
- frameworks, apiRoutes
- **coverage.confidence** / codeParseCoveragePercent / highConfidenceEdgePercent
- error code if failed

## CI note

Live clones are **manual / scheduled**, not required for PR CI. Fixtures stay in `tests/real-world` and `tests/accuracy`.
