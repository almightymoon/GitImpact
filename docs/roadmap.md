# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that a developer trusts it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC — run `pnpm rc:*` with evidence |
| **v1.1** | Real-world accuracy + adoption | Through v1.1.4 done |
| **v1.1.4** | Go parsing, framework intel & relationship accuracy | Done |
| **v1.2** | History, change intelligence & team workflows | **Done** |
| **v1.3** | Optional AI layer / BYOK | Foundation + UI shipped |

---

## Language coverage

Supported surface: **JS/TS + Python + Go + Java + Rust + C#** (heuristic parsers; no toolchain execution).

Dogfood **wave 7** covers Spring / Axum / ASP.NET + library counterparts.

---

## v1.0 RC commands

```bash
pnpm rc:private-e2e   # needs GitHub App secrets + optional GITIMPACT_RC_PRIVATE_REPO
pnpm rc:load-test     # ≥10 distinct public repos against running web
pnpm rc:no-exec       # local marker fixture proves install scripts never run
```

Evidence lands in `.rc-tmp/evidence/`.

**Still needs human App credentials for the beta tag:** live private install, webhook redelivery, PR comment / Check Run proof.

---

## v1.3 — Optional AI / BYOK

| Capability | Surface |
|------------|---------|
| Server-side enrichment | Worker / pr-workflow when `GITIMPACT_AI_*` set |
| Client BYOK | Homepage settings → `POST /api/ai/narrative` (key never on job payloads) |
| Richer digests | frameworks, blast-radius counts, why-target, languages |

---

## Commands

```bash
pnpm dogfood -- --wave 7
pnpm relationships -- --id java-spring-small
pnpm rc:no-exec
pnpm rc:load-test
```
