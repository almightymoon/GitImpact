# Public-beta dogfood matrix

Use this checklist before cutting a public-beta build. Prefer fixtures/local mirrors in CI; use live public clones manually.

| Repo type | Example | Notes to record |
|-----------|---------|-----------------|
| Next.js app | `vercel/next.js` (shallow) or fixture | duration, files, graph size, APIs |
| React library | fixture / small public lib | parse failures |
| Express API | fixture | route detection |
| NestJS | fixture | modules / providers |
| Monorepo | fixture `monorepo-project` | workspace boundaries |
| Prisma | fixture with schema | data layer classification |
| Terraform | fixture | infra checks |
| Kubernetes / Helm | fixture | manifests |
| GitOps | fixture | workflow detection |
| Package/library | fixture | exports / public API |

For each run record:

- analysis duration (ms)
- files discovered / parsed
- graph nodes / edges
- parse failures
- detected architecture summary
- APIs / checks counts
- errors / timeouts / quota hits

Do not tune production heuristics only against the GitImpact monorepo itself.
