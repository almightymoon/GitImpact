# GitImpact

**Know What Breaks Before You Merge.**

GitImpact maps the blast radius of code changes across a repository using static analysis and dependency graphs.

## MVP (v0.1)

- Public GitHub repositories & pull requests
- TypeScript / JavaScript parsing (`ts-morph`)
- Import / call / test dependency graph
- Blast-radius traversal with configurable depth
- Interactive React Flow graph
- URL routes: `/owner/repo` and `/owner/repo/pull/123`
- CLI: `gitimpact analyze <url>`

## Quick start

Requires **Node 20+** and **pnpm 9**.

```bash
pnpm install
pnpm build:packages
pnpm --filter @gitimpact/web dev
```

Open [http://localhost:3000](http://localhost:3000).

- Paste a public GitHub repo or PR URL, or use the local demos
- Repo demo: [/demo/tiny-fixture](http://localhost:3000/demo/tiny-fixture)
- PR demo: [/demo/tiny-fixture/pull/1](http://localhost:3000/demo/tiny-fixture/pull/1) (Overview · Graph · Changes · Tests · APIs)

Optional env:

```bash
export GITHUB_TOKEN=...          # higher PR API rate limits
export GITIMPACT_MAX_FILES=800   # parse cap (default 800)
export GITIMPACT_CACHE_DIR=./.repos
```

### CLI

```bash
pnpm --filter @gitimpact/cli build
node cli/dist/index.js analyze github.com/owner/repo
```

## Monorepo

```text
apps/web                 Next.js UI + API
packages/shared          Shared types
packages/git             GitHub URL + clone helpers
packages/parser          TS/JS AST extraction
packages/graph           Dependency graph builder
packages/impact-engine   Blast-radius traversal
packages/analysis        Orchestration + in-memory store
cli                      Local CLI
```

## Principles

1. Deterministic static analysis first
2. AI explains findings later (not in MVP core path)
3. Never execute repository code
4. Confidence levels on relationships
# GitImpact
