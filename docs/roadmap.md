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
| **v1.2** | History, change intelligence & team workflows | **Done** |
| **v1.3** | Optional AI layer / BYOK | Foundation shipped (`@gitimpact/ai`) |

---

## Language coverage

Supported surface: **JS/TS + Python + Go + Java + Rust + C#** (heuristic parsers; no toolchain execution).

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
| Saved / team views | Structure pin + save · `saved_views` · visibility/org/roles · views API |
| PR impact history trend | PR Overview sparkline (blast radius across head SHAs) |
| Scheduled PR head re-analyze | Worker ops tick · `GITIMPACT_PR_HEAD_POLL=1` |

---

## v1.3 — Optional AI / BYOK

| Capability | Surface |
|------------|---------|
| Optional narrative enrichment | `@gitimpact/ai` · PR comment section when `GITIMPACT_AI_ENABLED` + key |
| Deterministic metrics remain source of truth | AI never replaces scores / graphs |

---

## Explicitly deferred / RC blockers

- Private-repo / webhook live E2E → run `pnpm rc:private-e2e` when App credentials are available (`docs/private-repo-e2e.md`)
- Load test ≥10 distinct repos + no-exec marker proof → v1.0 tag
- Deeper Java/Rust/C# relationship accuracy dogfood waves → follow-up

---

## Commands

```bash
gitimpact impact --from main --to HEAD .
gitimpact history owner/repo
gitimpact compare ./before ./after
gitimpact export pack ./pack .
pnpm dogfood -- --wave 6
pnpm relationships
pnpm rc:private-e2e
```
