import type { ImpactDigest } from "./index.js";

export const AI_SYSTEM_PROMPT = [
  "You explain GitImpact deterministic blast-radius findings for developers.",
  "Use only the provided digest. Do not invent files, APIs, tests, bugs, or test results.",
  "Distinguish clearly: (1) deterministic facts from the digest, (2) cautious interpretation,",
  "(3) speculative risks, (4) suggested tests to run or add.",
  "Never claim a bug definitely exists because a dependency exists.",
  "Never claim a test passed. Prefer short, scannable markdown.",
].join(" ");

/**
 * Structured prompt for useful PR / overview narratives.
 */
export function buildImpactNarrativePrompt(digest: ImpactDigest): string {
  return [
    "Write a brief impact narrative with these sections:",
    "### What changed",
    "### Likely affected areas",
    "### Why they may be affected",
    "### Tests to run or add",
    "### Risks if merged",
    "### Confidence & uncertainty",
    "",
    "Digest (source of truth — do not invent beyond this):",
    `Repository: ${digest.repository}`,
    digest.pullRequestNumber != null ? `PR: #${digest.pullRequestNumber}` : "",
    digest.complexityScore != null
      ? `Complexity score: ${digest.complexityScore}/100 (${digest.impactLevel ?? "n/a"})`
      : "",
    digest.frameworks?.length
      ? `Frameworks: ${digest.frameworks.join(", ")}`
      : "",
    digest.languages?.length ? `Languages: ${digest.languages.join(", ")}` : "",
    digest.directDependents != null || digest.indirectDependents != null
      ? `Blast radius counts: direct=${digest.directDependents ?? "?"} indirect=${digest.indirectDependents ?? "?"}`
      : "",
    digest.whyTarget ? `Notable dependent: ${digest.whyTarget}` : "",
    `Changed symbols: ${digest.changedSymbols.join(", ") || "(none listed)"}`,
    `Affected APIs: ${digest.affectedApis.join(", ") || "(none listed)"}`,
    `Related tests: ${digest.relevantTests.join(", ") || "(none listed)"}`,
    digest.summary ? `Deterministic summary: ${digest.summary}` : "",
    "",
    "Keep the whole answer under ~250 words.",
  ]
    .filter(Boolean)
    .join("\n");
}
