# GitImpact Real-World Benchmark

Adversarial / production-shaped snapshots. Unlike `tests/accuracy`, these cases
intentionally include patterns the engine may not fully resolve yet.

## Cases

| Case | Focus |
|------|--------|
| `nextjs-small` | App Router handlers, server actions, `@/` aliases |
| `nestjs-small` | Decorators, constructor DI |
| `express-small` | Middleware composition / HOFs |
| `prisma-project` | Generated client delegates, dynamic import |
| `monorepo-project` | Workspace aliases, barrel chains, dynamic import |

## Metrics that matter

- **Precision / Recall** — against hand-labelled edges
- **Resolution coverage** — `resolvedCalls / totalCalls` from the parser (not just labelled ones)
- **Unsupported-pattern count** — declared hard patterns in `expected.json`
- **Soft misses** — known gaps (`softMustCall`) excluded from hard scores

A suite can show 100% precision while refusing the hard 30%. Coverage exposes that.

## Run

```bash
pnpm test:real-world
```

Writes `tests/real-world/results.json`.
