# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that a developer trusts it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Through v1.1.4 done |
| **v1.1.1** | Trust, coverage & explainability | Done |
| **v1.1.2** | Relationship accuracy + Python baseline | Done |
| **v1.1.3** | Python accuracy & framework intelligence | Done |
| **v1.1.4** | Go parsing, framework intel & relationship accuracy | Done |
| **v1.2** | History, change intelligence & team workflows | **Next / in progress** |
| **v1.3** | Optional AI layer / BYOK | Later |

---

## Language coverage freeze

JS/TS + Python + Go are the supported language surface. **No Java / Rust / C#** until v1.2 workflow value ships and stabilizes.

---

## v1.1.4 — Go parsing, framework intelligence & relationship accuracy ✅

Heuristic Go surface, Echo/Gin/Chi/Cobra/GORM intelligence, wave-6 dogfood 6/6, curated fixtures, held-out review 22 TRUE / 0 FALSE.

---

## v1.2 — History, change intelligence & team workflows

**Goal:** Turn GitImpact from an occasional lookup into something teams keep in their development workflow.

```
Repository analysis history
      ↓
compare two analyses
      ↓
"What changed in the architecture?"

PR impact history
      ↓
"Did this PR increase/decrease blast radius?"

Architecture export packs · Deterministic review reports · Overview history UI
```

### Shipped in v1.2 start

| Capability | Surface |
|------------|---------|
| Append-only analysis history snapshots | `analysis_history` table + memory fallback |
| Architecture / blast-radius compare | `compareAnalyses` · CLI `gitimpact compare` · API `?from=&to=` |
| History listing | CLI `gitimpact history` · `GET /api/repositories/:owner/:repo/history` · Overview panel |
| Deterministic review report | CLI `gitimpact export review.md` |
| Architecture export pack | CLI `gitimpact export pack <dir>` → architecture.md + review.md + snapshot.json |

### Still open in v1.2

- Saved / team views (shared filters & pinned systems)
- Local `impact --from/--to` git ref wiring
- Deeper PR impact history charts in the PR workbench

---

## Explicitly deferred

- Private-repo / webhook RC E2E → v1.0 when App credentials are available
- Java / Rust / C# → after v1.2 stabilizes
- AI → **v1.3**

---

## Commands

```bash
pnpm dogfood -- --wave 6
pnpm relationships
pnpm relationships:sample -- --seed v1.1.4-go --prefix go-
gitimpact history owner/repo
gitimpact compare ./before ./after
gitimpact export review.md .
gitimpact export pack ./pack .
```
