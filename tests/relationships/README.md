# Relationship accuracy benchmark (v1.1.2)

Measures whether GitImpact’s **graph edges** match reality — not just framework labels.

## Taxonomy

For each expected relationship we record one of:

| Class | Meaning |
|-------|---------|
| `TRUE_POSITIVE` | Exact from → to with correct type |
| `FALSE_POSITIVE` | Edge that must **not** exist was found |
| `MISSING_EDGE` | Expected edge absent |
| `WRONG_TARGET` | Same from + type, different to |
| `WRONG_TYPE` | Same from → to, different relation type |
| `LOW_CONFIDENCE` | Correct edge exists but confidence is LOW |

## Run

```bash
pnpm build:packages
pnpm relationships
pnpm relationships -- --id nestjs-small
```

Results: `tests/relationships/results/summary.json`

## Cases

Local fixtures under `cases/*/expected.json` plus optional dogfood clones (`source: "dogfood"`).
Dogfood cases skip gracefully when `.repos/dogfood/...` is missing — run `pnpm dogfood -- --id <id>` first.
