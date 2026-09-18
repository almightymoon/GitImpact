# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that they trust it.

No language expansion or AI until that bar is met for today’s TypeScript/JavaScript surface.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | **Next** (dogfood-first) |
| **v1.2** | Team collaboration + history + reports | Later |
| **v1.3** | Optional AI layer / BYOK | Later |

---

## v1.0 — Public beta

Production stack, durable queue, private GitHub App path, quotas, ops. Tag `1.0.0-beta` only when RC DoD is green (especially private-repo E2E).

---

## v1.1 — Real-world accuracy & adoption

**Success metric:** On a held-out dogfood set, overview + key call/import relationships match reality closely enough that a developer does not second-guess the graph.

### Order of work (mandatory)

1. ~~Dogfood **20–30** real public repositories (`pnpm dogfood`)~~ ✅ (~25 active matrix)
2. ~~Record misses in `tests/dogfood/misses.jsonl`~~ ✅
3. ~~Fix relationship / framework / monorepo accuracy from that log~~ ✅ (waves 1–3; 0 open)
4. ~~Surface **coverage / confidence** so trust is measurable~~ ✅
5. ~~Adoption polish (GitHub App onboarding, demos, docs)~~ ✅ (samples, feedback, local CLI, examples doc)
6. **Then** add Python ← blocked until miss log stays quiet on JS/TS
7. **Then** add Go

Do **not** add languages before the miss log stops growing on the core JS/TS matrix.

### Tracks

**A — Accuracy & framework coverage**

- Expand dogfood matrix + real-world fixtures from recorded misses
- Fix parsing / CALLS / IMPORTS / framework edges
- Improve monorepo root & workspace detection
- Repository analysis confidence / coverage report
- Parser-failure / unsupported-file telemetry (product-visible, not vanity)

**B — Developer experience & adoption**

- GitHub App onboarding polish (Connect CTA, setup hints, docs)
- Hosted demo / sample repositories
- Public examples & short case studies
- Issue-feedback flow for incorrect analysis
- Better CLI for local/offline analysis

**C — Light workflow (only if A is green)**

- PR report readability improvements
- Shareable / exportable architecture summary (static, no AI)

### Explicitly deferred out of v1.1

- Compare-analysis-over-time → **v1.2**
- Saved repo history / team dashboards → **v1.2**
- AI summaries / BYOK → **v1.3**

---

## v1.2 — Team collaboration + history + reports

- Analysis history / compare over time
- Deeper PR review summaries (still deterministic)
- Team-oriented saved views and exports
- Stronger sharing of architecture packs

---

## v1.3 — Optional AI (BYOK)

- Open-source / self-host: bring your own key
- Optional SaaS managed AI later
- Never a substitute for the deterministic graph; AI explains or drafts only on top of verified structure

---

## Dogfood loop

```bash
pnpm build:packages
pnpm dogfood              # priority 1 matrix
pnpm dogfood -- --all     # full matrix
pnpm dogfood:misses       # print miss log summary
```

See `docs/dogfood.md` and `tests/dogfood/`.
