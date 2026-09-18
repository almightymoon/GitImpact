# GitImpact roadmap

## North star

A developer pastes a random real repository and GitImpact explains it correctly enough that a developer trusts it.

---

## Version line

| Version | Theme | Status |
|---------|--------|--------|
| **v1.0** | Public beta / production hardening | RC in progress — see `docs/release-candidate.md` |
| **v1.1** | Real-world accuracy + adoption | Through v1.1.3 done |
| **v1.1.1** | Trust, coverage & explainability | Done |
| **v1.1.2** | Relationship accuracy + Python baseline | Done |
| **v1.1.3** | Python accuracy & framework intelligence | Done |
| **v1.1.4** | Go parsing, framework intel & relationship accuracy | **In progress** (wave-6 dogfood green) |
| **v1.2** | History, change intelligence & team workflows | After language freeze |
| **v1.3** | Optional AI layer / BYOK | Later |

---

## v1.0 — Public beta

Production stack, durable queue, private GitHub App path, quotas, ops. Tag `1.0.0-beta` only when RC DoD is green (especially private-repo E2E).

---

## v1.1.3 — Python accuracy & framework intelligence ✅

Proved Python the same way as JS/TS: dogfood → misses → fixtures → curated relationships → held-out emitted-edge review.

---

## v1.1.4 — Go parsing, framework intelligence & relationship accuracy

**Goal:** Add Go with the *same discipline* as Python — not “parser exists” but trustworthy graph edges + honest confidence. **No new languages after this** until v1.2 workflow value is shipped.

### Dogfood wave 6 (start)

| Shape | Repo |
|-------|------|
| HTTP framework | `labstack/echo` |
| CLI | `spf13/cobra` |
| HTTP framework | `gin-gonic/gin` |
| Router / middleware | `go-chi/chi` |
| ORM / data | `go-gorm/gorm` |
| Library | e.g. `stretchr/testify` or `spf13/viper` |

### First-pass language surface

`.go` files · packages · imports · functions · methods · structs · interfaces · function/method calls · cross-package imports (via `go.mod` module prefix)

**Explicitly deferred (use MEDIUM/LOW + blind spots):** interface satisfaction / method sets, constructor DI graphs, generated code, build tags, reflection, dynamic registration.

### Framework intelligence

| Framework | Pattern → edge |
|-----------|----------------|
| Echo | `e.GET("/users", getUsers)` → HANDLED_BY `getUsers` |
| Gin | `router.POST("/orders", createOrder)` → HANDLED_BY `createOrder` |
| Chi | `r.Get("/…", handler)` → HANDLED_BY |
| Cobra | `rootCmd.AddCommand(serverCmd)` → DEPENDS_ON / CALLS |
| GORM | `db.Where(…).Find(&model)` → QUERIES model (incremental) |

### Trust pipeline (mandatory)

```
Go dogfood → miss log → regression fixtures
         → curated relationship benchmark
         → held-out emitted-edge review
         → confidence / blind spots
```

### Targets (same bar as JS/TS)

| Relation | Precision | Recall |
|----------|-----------|--------|
| IMPORTS | ≥ 95% | ≥ 90% |
| CALLS | ≥ 90% | ≥ 80% |
| HANDLED_BY | ≥ 90% | ≥ 85% |
| Overall important edges | ≥ 90% | ≥ 80% |
| Held-out emitted-edge precision | ≥ 85% among non-AMBIGUOUS |

### Order of work

1. **Go inventory + heuristic parser** (`.go` in CODE_EXTENSIONS)
2. **Activate wave-6 dogfood** (Echo + Cobra first, then Gin/Chi/GORM/library)
3. **Framework route / command intelligence**
4. **Curated Go relationship fixtures** + `pnpm relationships`
5. **Held-out emitted-edge review** on Go cases
6. **Blind spots** for interfaces, reflection, build tags, generated code
7. **Language coverage freeze** — no Java/Rust/C# until v1.2 lands

---

## After Go — language freeze → v1.2

Once JS/TS + Python + Go are trustworthy, **stop adding languages**. Deeper workflow features add more product value than another parser.

### v1.2 — History, change intelligence & team workflows

```
Repository analysis history
      ↓
compare two analyses
      ↓
"What changed in the architecture?"

PR impact history
      ↓
"Did this PR increase/decrease blast radius?"

Architecture export packs · Saved/team views · Deterministic review reports
```

Turn GitImpact from an occasional lookup into something teams keep in their development workflow.

---

## Explicitly deferred

- Private-repo / webhook RC E2E → v1.0 when App credentials are available
- Java / Rust / C# → **not** immediately after Go
- AI → **v1.3**
- More UI / platform infra → not the bottleneck while language accuracy is open

---

## Commands

```bash
pnpm dogfood -- --wave 6           # Go accuracy dogfood
pnpm relationships                 # curated edge precision/recall
pnpm relationships:sample          # held-out emitted-edge sample
pnpm relationships:review-sample   # auto-assist labels
pnpm test:accuracy
pnpm test:real-world
```
