# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that they trust it.

No language expansion or AI until that bar is met for today’s TypeScript/JavaScript surface.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Steps 1–5 done; languages deferred |
| **v1.1.1** | Trust, coverage & explainability | **Next** |
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
4. ~~Surface **coverage / confidence** so trust is measurable~~ ✅ (baseline)
5. ~~Adoption polish (GitHub App onboarding, demos, docs)~~ ✅ (samples, feedback, local CLI, examples doc)
6. **Then** add Python ← blocked until miss log stays quiet on JS/TS
7. **Then** add Go

Do **not** add languages before the miss log stops growing on the core JS/TS matrix.

---

## v1.1.1 — Trust, coverage & explainability

**Goal:** Developers believe the analysis because they can see *how much* of the repo was understood and *why* each relationship exists.

### Order of work

1. ~~**Held-out dogfood wave 4** — 10–15 repos unused in waves 1–3~~ ✅ (12 repos)
2. ~~Record every miss~~ ✅ (see `tests/dogfood/misses.jsonl`)
3. ~~Fix only real misses; add regression fixtures/tests~~ ✅ (framework identity / optional peers / type-only Express; open: payload cap, bullmq lua MEDIUM)
4. ~~**Richer coverage reporting**~~ ✅ (inventory counts, edge mix, framework confidence, blind spots)
5. ~~**Edge evidence**~~ ✅ (CALLS/IMPORTS carry file/snippet/resolution; graph edge inspect panel)
6. ~~**Monorepo architecture**~~ ✅ (apps/packages as systems + cross-package uses/calls)
7. ~~**Local CLI expansion**~~ ✅ (`analyze`, `structure`, `impact`, `pr`, `export architecture.md`)
8. Only then reconsider Python

### Explicitly deferred

- Private-repo / webhook RC E2E → finish under v1.0 when App credentials are available
- Languages (Python/Go) → after wave-4 miss rate is quiet
- History / team dashboards → **v1.2**
- AI → **v1.3**

---

## v1.1 tracks (carry-forward)

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
pnpm dogfood -- --wave 4  # held-out wave-4 set
pnpm dogfood -- --all     # full matrix
pnpm dogfood:misses       # print miss log summary
```

See `docs/dogfood.md` and `tests/dogfood/`.
