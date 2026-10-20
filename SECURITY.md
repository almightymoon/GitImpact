# Security Policy

GitImpact analyzes **untrusted** repository content. Treat every cloned repo as hostile input.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x (public beta) | Yes |

## Hard rules

1. Never execute repository code (`npm` / `pnpm` / `yarn`, package scripts, tests, builds, binaries).
2. Never log GitHub installation tokens, private keys, `Authorization` headers, or full secret-scanner matches.
3. Installation tokens stay server-side, short-lived, and are regenerated rather than persisted.
4. Webhook signatures (`X-Hub-Signature-256`) must be verified before processing.
5. Repository URLs are never passed to a shell — only `execFile("git", argv)`.
6. Only `https://github.com/...` URLs are accepted (`file://`, `ssh://`, `git://` rejected).
7. README / markdown is rendered as text, not HTML.
8. Analysis workspaces are isolated under the configured cache root and cleaned up after success/failure/timeout.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository. Do not file public issues for exploitable findings.

## Optional AI (BYOK)

- Public `POST /api/ai/narrative` requires a **client-supplied** API key and does not use the operator server key.
- Digests are sanitized/redacted before provider calls; keys must not be logged or queued.
- Model output is untrusted text. Details: `docs/ai.md`.

## Dependency audit (2026-10-20)

`pnpm audit --prod` after Next `15.5.27` + `drizzle-orm` `^0.45.2`: **8** findings remain (5 high / 2 moderate / 1 low).

| Finding | Path | Disposition |
|---------|------|-------------|
| Next cache poisoning | patched via Next ≥15.5.27 | **Fixed** |
| drizzle-orm SQL identifiers | patched via ≥0.45.2 | **Fixed** |
| `postcss` / `source-map-js` highs | Next pins `postcss@8.4.31` | **Deferred** — wait for Next upstream; avoid blind overrides that break the framework |
| `sharp` librsvg | Next pins `sharp@0.35.4` | **Deferred** — same |
| `braces` DoS | transitive via `ts-morph` → `fast-glob` | **Deferred** — no compatible patch (`patched versions: <0.0.0`) |
| `cli` arbitrary file write | empty path / name collision with local `cli/` | **Likely false positive** — not the npm `cli` package |

Do not suppress advisories. Re-run `pnpm audit --prod` before each release tag.

## Residual risks (accepted for public beta)

- Soft parse caps may analyze a subset of files; truncation is surfaced to users.
- Deferred dependency findings above that do not affect analyzer correctness.
- Optional Redis/BullMQ optional peer warnings (`@valkey/valkey-glide`) are unused and ignored.
