# Relationship accuracy benchmark

Measures whether GitImpact’s **graph edges** match reality — not just framework labels.

## Two complementary checks

| Check | Question | Command |
|-------|----------|---------|
| **Curated expectations** | Did we find known-true edges? | `pnpm relationships` |
| **Held-out emitted sample** | Of edges we emit, how often are they true? | `pnpm relationships:sample` |

A curated 100/100 score is necessary but not sufficient. Review sampled emissions for FALSE positives.

## Taxonomy (curated)

| Class | Meaning |
|-------|---------|
| `TRUE_POSITIVE` | Exact from → to with correct type |
| `FALSE_POSITIVE` | Edge that must **not** exist was found |
| `MISSING_EDGE` | Expected edge absent |
| `WRONG_TARGET` | Same from + type, different to |
| `WRONG_TYPE` | Same from → to, different relation type |
| `LOW_CONFIDENCE` | Correct edge exists but confidence is LOW |

## Held-out labels

| Label | Meaning |
|-------|---------|
| `TRUE` | Edge is correct |
| `FALSE` | Edge should not exist / wrong target |
| `AMBIGUOUS` | Unclear without more context (excluded from precision) |

## Run

```bash
pnpm build:packages
pnpm relationships
pnpm relationships -- --id python-flask-small
pnpm relationships:sample
pnpm relationships:sample -- --score tests/relationships/samples/pending-v1.1.3.json
```

Results: `tests/relationships/results/summary.json`
