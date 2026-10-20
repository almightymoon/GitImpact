# Draft launch announcement (unpublished)

**GitImpact is open for early evaluation.**

GitImpact estimates what a pull request might break using **static analysis and dependency graphs** — not by running your codebase, and not by asking an LLM to invent a blast radius.

Paste a public GitHub repo or PR, or run the CLI on a local checkout. You’ll get an interactive graph, impacted APIs/tests, and optional GitHub Check Runs / PR comments when a GitHub App is configured.

Optional **Bring Your Own Key** AI can narrate the deterministic digest. Core analysis works with AI turned off.

**Honest limits:** language coverage beyond JS/TS uses heuristics; live private-repo App E2E still needs your App credentials; we publish measured relationship fixtures rather than marketing accuracy claims.

Repo: https://github.com/almightymoon/GitImpact  
Docs: README · `docs/ai.md` · `docs/release-candidate.md`
