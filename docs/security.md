# Security

## Threat model

GitImpact clones and statically analyzes **untrusted** repositories. Assume hostile content.

## Hard rules

1. Never execute repository code (`npm`/`pnpm`/`yarn`, tests, builds, binaries).
2. Never log GitHub installation tokens, private keys, Authorization headers, or full secret-scanner matches.
3. Installation tokens stay server-side and short-lived (minted per request, memory-cached ~50 min max).
4. Webhook signatures (`X-Hub-Signature-256`) must be verified before processing.
5. User repository URLs must not be passed to a shell; use `execFile("git", argv)` only.
6. Only `github.com` HTTPS URLs are accepted; `file://`, `ssh://`, and path-traversal names are rejected.
7. Clone credential material is redacted from error strings before surfacing.
8. Analysis workspaces stay under the configured cache/temp root; cleanup after success/failure/timeout.

## Public beta quotas

Conservative limits (files, bytes, graph size, duration, rate limits) protect the service from abuse and runaway memory. Soft parse caps surface a truncation notice; hard limits return typed errors (`REPOSITORY_TOO_LARGE`, `GRAPH_LIMIT_EXCEEDED`, `ANALYSIS_TIMEOUT`).

## GitHub API

Workers honor `429` / exhausted `X-RateLimit-Remaining` via `GITHUB_RATE_LIMITED` and bounded retries.

## Reporting

If you find a vulnerability in GitImpact itself, open a private security advisory on the GitHub repository.
