# GitImpact Accuracy Benchmark (v0.4)

Priority suite for false-positive / false-negative risk. Each case under `cases/`
declares expected graph edges and, when relevant, expected changed symbols /
semantic diff events.

## Layout

```
tests/accuracy/
├── accuracy.test.ts
└── cases/
    ├── duplicate-method-names/
    ├── body-only-change/
    ├── deletion-only-change/
    ├── renamed-import/
    ├── default-export/
    ├── barrel-export/
    ├── path-alias/
    ├── inheritance/
    ├── arrow-function/
    └── …
```

## Expected schema (`expected.json`)

- `mustCall` / `mustNotCall` / `mustEdge` — graph edges
- `mustSymbols` — graph node ids that must exist
- `diffCases[]` — unified patches against fixture files
  - `mustEnclose` — Diff-to-AST enclosing symbols
  - `mustChangedSymbols` — Semantic Diff changed symbols
  - `mustSemanticEvents` — e.g. `METHOD_REMOVED`, `BODY_CHANGED`, `CALL_ADDED`

## Run

```bash
pnpm test:accuracy
```
