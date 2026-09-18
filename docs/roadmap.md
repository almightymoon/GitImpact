# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that a developer trusts it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Steps 1–6 done |
| **v1.1.1** | Trust, coverage & explainability | Done |
| **v1.1.2** | Relationship accuracy + Python baseline | Done |
| **v1.1.3** | Python accuracy & framework intelligence | **Done** (held-out review + wave-5 green) |
| **v1.1.4** | Go support | **Next** |
| **v1.2** | Team collaboration + history + reports | Later |
| **v1.3** | Optional AI layer / BYOK | Later |

---

## v1.0 — Public beta

Production stack, durable queue, private GitHub App path, quotas, ops. Tag `1.0.0-beta` only when RC DoD is green (especially private-repo E2E).

---

## v1.1 — Real-world accuracy & adoption

**Success metric:** On a held-out dogfood set, overview + key call/import relationships match reality closely enough that a developer does not second-guess the graph.

### Order of work (mandatory)

1. ~~Dogfood **20–30** real public repositories (`pnpm dogfood`)~~ ✅
2. ~~Record misses~~ ✅
3. ~~Fix relationship / framework / monorepo accuracy~~ ✅
4. ~~Coverage / confidence~~ ✅
5. ~~Adoption polish~~ ✅
6. ~~**Python baseline**~~ ✅ (v1.1.2)
7. ~~**Python accuracy**~~ ✅ **v1.1.3**
8. **Then** Go ← **v1.1.4**

Do **not** start Go until Python wave 5 stays clean and Python relationship / held-out edge review targets hold.

---

## v1.1.2 — Relationship accuracy + Python baseline ✅

**Shipped:** `pnpm relationships` harness (13 cases, P=1 / R=1 on curated set), CJS `require()`, HOF attribution, `fetch()` → FETCHES, `.py` inventory + heuristic parser, Flask/FastAPI/Django labels, `python-flask-small` fixture.

**Honest caveat:** 100/100 on a curated expectation set proves recall of labelled edges — it does **not** prove emitted-edge precision. That is the job of v1.1.3 held-out sampling.

---

## v1.1.3 — Python accuracy & framework intelligence

**Goal:** Prove Python the same way JS/TS was proved — dogfood → misses → fixtures → relationship edges → honest blind spots. No Go until this bar is met.

### Order of work

1. ~~**Dogfood wave 5** — Flask, FastAPI, Django, CLI, library, monorepo-ish~~ ✅ (6/6 ok)
2. ~~**Record every miss**~~ ✅ (FastAPI Flask FP, route double-count, Click missing — fixed)
3. ~~**Framework route intelligence**~~ ✅ (Flask/FastAPI decorators + Django urls → HANDLED_BY)
4. ~~**Python relationship benchmark**~~ ✅ (class/method, src-layout, service→repo; curated P=1/R=1)
5. ~~**Python project detection**~~ ✅ (Poetry/uv/Pipenv/setuptools/src-layout)
6. ~~**Held-out emitted-edge review**~~ ✅ (65-sample: 57 TRUE / 0 FALSE / 8 AMBIGUOUS → 100% non-AMBIGUOUS)
7. ~~**Confidence / blind spots**~~ ✅ (heuristic Python limits + inventory wording)
8. ~~**Regression fixtures**~~ ✅ (wave-5 misses + Python LIBRARY typing + Django route noise)

### Targets

| Metric | Target |
|--------|--------|
| Python relationship P/R (curated) | ≥ JS/TS targets for IMPORTS/CALLS/HANDLED_BY |
| Held-out emitted-edge precision (TRUE / (TRUE+FALSE)) | ≥ 85% among non-AMBIGUOUS |
| Wave-5 dogfood | 0 unexplained overview/framework misses |

### Held-out edge sampling

Curated benchmarks measure “did we find known-true edges?”  
Sampling measures “of edges we emit, how often are they true?”

```bash
pnpm relationships:sample          # write stratified sample for review
pnpm relationships:sample -- --score samples/reviewed.json
```

Default mix (100 edges): CALLS 30 · IMPORTS 25 · USES 15 · FETCHES 10 · HANDLED_BY 10 · QUERIES 10.

---

## v1.1.4 — Go support

After v1.1.3 is green: Echo + Cobra (already planned in dogfood matrix), then expand.

---

## Explicitly deferred

- Private-repo / webhook RC E2E → v1.0 when App credentials are available
- Go → **v1.1.4** only after Python accuracy holds
- History / team dashboards → **v1.2**
- AI → **v1.3**
- More UI / platform infra → not the bottleneck; deepen language accuracy first

---

## Commands

```bash
pnpm dogfood -- --wave 5           # Python accuracy dogfood
pnpm relationships                 # curated edge precision/recall
pnpm relationships:sample          # held-out emitted-edge sample
pnpm relationships:review-sample   # auto-assist labels from curated expectations
pnpm test:accuracy
pnpm test:real-world
```
