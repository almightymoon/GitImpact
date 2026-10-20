# Optional AI layer (BYOK)

GitImpact analysis is **deterministic by default**. AI is an optional post-pass that narrates an already-computed **impact digest**. The product must remain fully useful with AI disabled.

## Two modes (do not confuse them)

| Mode | Where | Key source | Uses server `GITIMPACT_AI_*`? |
|------|--------|------------|------------------------------|
| **Client BYOK** | Homepage settings → `POST /api/ai/narrative` | Request body / `x-gitimpact-ai-key` | **No** (rejected without client key) |
| **Server enrichment** | Worker / PR comment path | Env (`GITIMPACT_AI_API_KEY` / provider keys) | **Yes** (`allowServerKey: true`) |

The public HTTP endpoint will **not** burn the operator’s server API key for anonymous callers.

## What leaves your environment

When AI is enabled, only a **sanitized digest** is sent to the chosen provider (OpenAI, Anthropic, or an allow-listed / explicitly enabled OpenAI-compatible base URL):

- Repository `owner/repo`, optional PR number
- Complexity / impact level labels
- Changed symbol names, affected API names, related test names
- Framework / language labels, blast-radius counts, optional why-target
- Short deterministic summary text

**Not sent:** full repository contents, full diffs, `.env` files, or raw secrets (secret-like strings in digest fields are redacted).

Keys are never placed on BullMQ job payloads, never written to PR comments, and must not appear in structured logs.

## Client BYOK (UI)

1. Open the homepage **Optional AI narrative (BYOK)** panel.
2. Paste a provider API key (stored in `sessionStorage` for this tab — anyone with tab access can read it; use **Clear key** when done).
3. **Test key** calls `/api/ai/narrative` with your key + a tiny demo digest.

Tradeoff: sessionStorage survives refresh in the same tab; it is convenience, not a vault. Prefer clearing the key after use.

## Server enable (PR comments / worker)

```bash
GITIMPACT_AI_ENABLED=1
GITIMPACT_AI_API_KEY=sk-...          # or OPENAI_API_KEY / ANTHROPIC_API_KEY
GITIMPACT_AI_PROVIDER=openai         # openai | anthropic | openai-compatible
# GITIMPACT_AI_BASE_URL=             # custom hosts need GITIMPACT_AI_ALLOW_CUSTOM_BASE=1
# GITIMPACT_AI_MODEL=gpt-4o-mini
# GITIMPACT_AI_MAX_TOKENS=400
# GITIMPACT_AI_TIMEOUT_MS=12000
# GITIMPACT_AI_RATE_LIMIT=8          # public narrative endpoint
# GITIMPACT_AI_RATE_WINDOW_SECONDS=60
```

## Guarantees

- Deterministic metrics remain the source of truth; AI text is labeled.
- Model output is untrusted text (do not execute generated HTML/code).
- Provider failures must not fail the analysis job (worker catches and continues).
- Public endpoint: rate-limited; requires BYOK key; digests validated and size-bounded.

See `@gitimpact/ai` (`packages/ai`).
