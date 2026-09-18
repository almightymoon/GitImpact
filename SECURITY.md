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

## Residual risks (accepted for public beta)

- Soft parse caps may analyze a subset of files; truncation is surfaced to users.
- Dependency audit findings that do not affect analyzer stability may be deferred.
- Optional Redis/BullMQ optional peer warnings (`@valkey/valkey-glide`) are unused and ignored.
