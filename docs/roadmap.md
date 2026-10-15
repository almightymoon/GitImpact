# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that a developer trusts it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Through v1.1.4 done |
| **v1.1.4** | Go parsing, framework intel & relationship accuracy | Done |
| **v1.2** | History, change intelligence & team workflows | **In progress** |
| **v1.3** | Optional AI layer / BYOK | Later |

---

## Language coverage freeze

JS/TS + Python + Go are the supported language surface. **No Java / Rust / C#** until v1.2 stabilizes.

---

## v1.2 — History, change intelligence & team workflows

**Goal:** Turn GitImpact from an occasional lookup into something teams keep in their development workflow.

### Shipped

| Capability | Surface |
|------------|---------|
| Analysis history snapshots | `analysis_history` · Overview panel · CLI `history` |
| Architecture / blast-radius compare | `compareAnalyses` · CLI `compare` · history API |
| Deterministic review + export packs | `export review.md` · `export pack` |
| Local ref impact | `gitimpact impact --from <ref> --to <ref> .` |
| Saved / team views | Structure pin + save · `saved_views` table · views API · localStorage fallback |
| PR impact history trend | PR Overview sparkline (blast radius across head SHAs) |

### Still open / polish

- Richer shared-view collaboration (roles, org scoping)
- Optional scheduled re-analyze for PR head tracking

---

## Explicitly deferred

- Private-repo / webhook RC E2E → v1.0 when App credentials are available
- Java / Rust / C# → after v1.2 stabilizes
- AI → **v1.3**

---

## Commands

```bash
gitimpact impact --from main --to HEAD .
gitimpact history owner/repo
gitimpact compare ./before ./after
gitimpact export pack ./pack .
pnpm dogfood -- --wave 6
pnpm relationships
```
