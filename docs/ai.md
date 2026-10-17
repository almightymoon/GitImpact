# Optional AI layer (BYOK)

GitImpact analysis is deterministic by default. AI is an **optional post-pass** that narrates already-computed impact digests.

## Server enable (PR comments / worker)

```bash
GITIMPACT_AI_ENABLED=1
GITIMPACT_AI_API_KEY=sk-...          # or OPENAI_API_KEY / ANTHROPIC_API_KEY
GITIMPACT_AI_PROVIDER=openai         # openai | anthropic | openai-compatible
# GITIMPACT_AI_BASE_URL=             # for openai-compatible proxies
# GITIMPACT_AI_MODEL=gpt-4o-mini
# GITIMPACT_AI_MAX_TOKENS=400
# GITIMPACT_AI_TIMEOUT_MS=12000
```

## Client BYOK (UI)

Homepage → **Optional AI narrative (BYOK)** stores the key in `sessionStorage` and sends it only to `POST /api/ai/narrative`. Analysis jobs never receive the key.

## Guarantees

- Keys are never written to BullMQ job payloads or structured logs
- Prompts include digests only (symbols, APIs, tests, frameworks, blast-radius counts) — not full repository contents
- PR comments label AI text separately; metrics remain deterministic
- Disabled by default when no key is configured

See `@gitimpact/ai` (`packages/ai`).
