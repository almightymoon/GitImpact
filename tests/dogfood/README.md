# Dogfood harness (v1.1)

Live public-repo matrix + miss log. See `docs/dogfood.md` and `docs/roadmap.md`.

```bash
pnpm --filter @gitimpact/dogfood dogfood
pnpm --filter @gitimpact/dogfood miss -- --repo express --kind missing_call --note "..."
pnpm --filter @gitimpact/dogfood misses
```

Root shortcuts: `pnpm dogfood`, `pnpm dogfood:miss`, `pnpm dogfood:misses`.
