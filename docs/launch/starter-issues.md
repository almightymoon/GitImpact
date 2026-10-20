# Draft starter issues (do not publish without owner OK)

## 1. Relationship fixture: Spring `@RequestMapping` method-level path
**Problem:** Spring route extraction focuses on `@GetMapping`-style annotations; mixed `@RequestMapping` + method verb cases may miss `HANDLED_BY`.  
**Expected:** Fixture under `tests/relationships/cases/` with expected HANDLED_BY edge.  
**Package:** `packages/framework-detector`, `tests/relationships`  
**Tests:** `pnpm relationships -- --id <new-id>`  
**Good first issue:** yes

## 2. Docs: port conflict note when 3000 is taken
**Problem:** README says 3000; local machines often have another service on 3000.  
**Expected:** Troubleshooting snippet already partly covered — add `next dev --port 3001` example to `docs/troubleshooting.md`.  
**Good first issue:** yes

## 3. Accessibility: Analyze form error announcements
**Problem:** Analysis failures may not be exposed to screen readers via `aria-live`.  
**Expected:** Error region with polite live region in `AnalyzeForm`.  
**Package:** `apps/web`  
**Good first issue:** yes

## 4. AI prompt eval fixture (mocked provider)
**Problem:** Prompt quality regressions are easy to introduce.  
**Expected:** Vitest with mocked `fetch` asserting section headings and no invented symbols when digest is empty.  
**Package:** `packages/ai`  
**Good first issue:** yes (after reading `docs/ai.md`)

## 5. C# `[HttpGet]` controller fixture (not only MapGet)
**Problem:** ASP.NET attribute-routing coverage is thinner than minimal APIs.  
**Expected:** Small fixture + relationship expected.json.  
**Good first issue:** intermediate

## 6. Complete real-world expectations for JVM/Rust/C# samples
**Problem:** `tests/real-world/cases/{java-spring-small,rust-axum-small,csharp-aspnet-small,no-exec-marker}` lack `expected.json` and are skipped by the suite.  
**Expected:** Author `expected.json` (or move `no-exec-marker` solely under RC scripts).  
**Package:** `tests/real-world`  
**Tests:** `pnpm test:real-world`  
**Good first issue:** yes (for one language at a time)
