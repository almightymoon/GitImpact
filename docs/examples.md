# Public examples & case studies

Short, dogfood-backed examples of what GitImpact should show. Use these as demos or regression checks after accuracy changes.

## Express — middleware HTTP service

- URL: https://github.com/expressjs/express
- Expect: `API_SERVICE`, framework **Express**, dense CALLS/IMPORTS, many route nodes
- Confidence: typically **HIGH** parse coverage on JS sources

```bash
pnpm dogfood -- --id express
# or
gitimpact analyze https://github.com/expressjs/express
```

## Vercel Platforms — Next.js App Router

- URL: https://github.com/vercel/platforms
- Expect: **Next.js** + **React**, frontend/full-stack shape, Structure cards for app routes

## NestJS starter — decorator DI

- URL: https://github.com/nestjs/typescript-starter
- Expect: **NestJS**, at least one API route from controllers

## Argo CD examples — GitOps / YAML-only

- URL: https://github.com/argoproj/argocd-example-apps
- Expect: `GITOPS`, inventory languages dominated by YAML, infra signals (Helm / K8s / Argo), confidence **HIGH** for infra-primary story even with `filesParsed = 0`

## Formik — React workspace package

- URL: https://github.com/jaredpalmer/formik
- Expect: **React** + **Formik** from `packages/formik` peers (not empty frameworks at the monorepo root)

## Local offline analysis

```bash
gitimpact analyze ./path/to/checkout
gitimpact analyze ./path/to/checkout --json
```

No GitHub token required for local paths. Coverage and type labels print in the CLI summary.

## Reporting a miss

From the Overview UI use **Report incorrect analysis**, or append to `tests/dogfood/misses.jsonl` (see `docs/dogfood.md`).
