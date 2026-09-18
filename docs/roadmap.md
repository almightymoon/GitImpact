# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that they trust it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Steps 1–5 done |
| **v1.1.1** | Trust, coverage & explainability | Done |
| **v1.1.2** | Relationship accuracy + Python surface | **In progress** |
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
6. ~~**Python surface**~~ ✅ (parser + Flask/FastAPI labels + relationship fixture; dogfood wave 5)
7. **Then** add Go

---

## v1.1.1 — Trust, coverage & explainability

**Goal:** Developers believe the analysis because they can see *how much* of the repo was understood and *why* each relationship exists.

### Order of work

1. ~~**Held-out dogfood wave 4** — 10–15 repos unused in waves 1–3~~ ✅ (12 repos)
2. ~~Record every miss~~ ✅ (see `tests/dogfood/misses.jsonl`)
3. ~~Fix only real misses; add regression fixtures/tests~~ ✅ (framework identity / optional peers / type-only Express; open: bullmq MEDIUM — intentional)
4. ~~**Richer coverage reporting**~~ ✅ (inventory counts, edge mix, framework confidence, blind spots)
5. ~~**Edge evidence**~~ ✅ (CALLS/IMPORTS carry file/snippet/resolution; graph edge inspect panel)
6. ~~**Monorepo architecture**~~ ✅ (apps/packages as systems + cross-package uses/calls)
7. ~~**Local CLI expansion**~~ ✅ (`analyze`, `structure`, `impact`, `pr`, `export architecture.md`)
8. ~~Reconsider Python after relationship benchmark~~ ✅

### Explicitly deferred

- Private-repo / webhook RC E2E → finish under v1.0 when App credentials are available
- Go → after Python dogfood wave 5 is green
- History / team dashboards → **v1.2**
- AI → **v1.3**

---

## v1.1.2 — Relationship accuracy + Python

**Goal:** Prove the graph understands *dependencies*, not only repo classification/framework labels. Impact analysis is only trustworthy if CALLS/IMPORTS/USES/… edges are correct. Python joins the supported surface once JS/TS relationship targets hold.

### Order of work

1. ~~**Curate ~10 repos** with 10–20 hand-verified relationships each~~ ✅ (expanded local + dogfood cases in `tests/relationships`)
2. ~~**Classify every expectation**~~ ✅ (TP / FP / MISSING / WRONG_TARGET / WRONG_TYPE / LOW_CONFIDENCE)
3. ~~**Score precision/recall by relation type**~~ ✅ (`pnpm relationships`)
4. ~~**Fix graph false positives** from the log~~ ✅
5. ~~**Fix important missing edges**~~ ✅ (CommonJS `require()`, HOF `compose()` attribution, `fetch()` → FETCHES)
6. ~~**Add regression fixtures**~~ ✅ (`cjs-require`, `fetch-external`, express-small HOF hard asserts)
7. ~~**Python language parsing**~~ ✅ (`.py` inventory, imports/defs/calls, Flask/FastAPI/Django labels)
8. **Publish targets** / dogfood wave 5 (`python-flask`, `python-fastapi`)

### Targets

| Relation | Precision | Recall |
|----------|-----------|--------|
| CALLS | ≥ 90% | ≥ 80% |
| IMPORTS | ≥ 95% | ≥ 90% |
| USES | ≥ 90% | ≥ 75% |
| HANDLED_BY | ≥ 90% | ≥ 85% |
| QUERIES | ≥ 85% | ≥ 80% |
| FETCHES | ≥ 85% | ≥ 70% |
| Overall important edges | ≥ 90% | ≥ 80% |

Run: `pnpm relationships` → `tests/relationships/results/summary.json`

### BullMQ / unsupported-format note

MEDIUM confidence when Lua/SQL inventory dominates is **correct** — do not raise confidence artificially. The trust UI must explain that unsupported formats (e.g. Redis Lua) are a real blind spot.

---

## v1.1 tracks (carry-forward)

**A — Accuracy & framework coverage**

- Expand dogfood matrix + real-world fixtures from recorded misses
- Fix parsing / CALLS / IMPORTS / framework edges
- Improve monorepo root & workspace detection
- Repository analysis confidence / coverage report
- Parser-failure / unsupported-file telemetry (product-visible, not vanity)
- Python dogfood wave 5 → deepen FastAPI / Django route intel

**B — Developer experience & adoption**

- GitHub App onboarding polish (Connect CTA, setup hints, docs)
- Hosted demo / sample repositories
- Public examples & short case studies

**C — Languages**

- ~~Python~~ ✅ baseline
- Go next

---

## Commands

```bash
pnpm dogfood               # default priority ≤ 1
pnpm dogfood -- --wave 4   # held-out JS/TS wave
pnpm dogfood -- --wave 5   # Python flask/fastapi
pnpm relationships         # v1.1.2 relationship precision/recall
pnpm test:accuracy
pnpm test:real-world
```
