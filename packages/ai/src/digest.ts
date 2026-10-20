/**
 * Digest validation + redaction before anything is sent to an AI provider.
 */
import type { AiProviderName, ImpactDigest } from "./index.js";

const PROVIDERS = new Set<AiProviderName>([
  "openai",
  "anthropic",
  "openai-compatible",
]);

const SECRETISH =
  /(?:api[_-]?key|secret|token|password|passwd|authorization|bearer\s+[a-z0-9._-]{20,}|sk-[a-z0-9]{20,}|gh[pousr]_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,})/i;

const MAX_SYMBOLS = 20;
const MAX_APIS = 15;
const MAX_TESTS = 15;
const MAX_STRING = 240;
const MAX_SUMMARY = 600;
const MAX_LIST_ITEM = 120;

export function isAiProviderName(value: unknown): value is AiProviderName {
  return typeof value === "string" && PROVIDERS.has(value as AiProviderName);
}

function scrub(value: string, max = MAX_STRING): string {
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, max);
  if (SECRETISH.test(trimmed)) return "[redacted]";
  return trimmed;
}

function scrubList(items: unknown, maxItems: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => scrub(x, MAX_LIST_ITEM));
}

export interface DigestValidationResult {
  ok: boolean;
  digest?: ImpactDigest;
  error?: string;
}

/**
 * Normalize and bound a client/server digest. Rejects oversized or invalid payloads.
 */
export function sanitizeImpactDigest(input: unknown): DigestValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "digest must be an object" };
  }
  const raw = input as Record<string, unknown>;
  const repository = typeof raw.repository === "string" ? scrub(raw.repository, 160) : "";
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return { ok: false, error: "digest.repository must look like owner/repo" };
  }

  const digest: ImpactDigest = {
    repository,
    pullRequestNumber:
      typeof raw.pullRequestNumber === "number" &&
      Number.isFinite(raw.pullRequestNumber) &&
      raw.pullRequestNumber > 0
        ? Math.floor(raw.pullRequestNumber)
        : undefined,
    complexityScore:
      typeof raw.complexityScore === "number" && Number.isFinite(raw.complexityScore)
        ? Math.max(0, Math.min(100, Math.round(raw.complexityScore)))
        : undefined,
    impactLevel:
      typeof raw.impactLevel === "string" ? scrub(raw.impactLevel, 32) : undefined,
    changedSymbols: scrubList(raw.changedSymbols, MAX_SYMBOLS),
    affectedApis: scrubList(raw.affectedApis, MAX_APIS),
    relevantTests: scrubList(raw.relevantTests, MAX_TESTS),
    summary: typeof raw.summary === "string" ? scrub(raw.summary, MAX_SUMMARY) : undefined,
    frameworks: scrubList(raw.frameworks, 8),
    languages: scrubList(raw.languages, 6),
    directDependents:
      typeof raw.directDependents === "number" && Number.isFinite(raw.directDependents)
        ? Math.max(0, Math.floor(raw.directDependents))
        : undefined,
    indirectDependents:
      typeof raw.indirectDependents === "number" && Number.isFinite(raw.indirectDependents)
        ? Math.max(0, Math.floor(raw.indirectDependents))
        : undefined,
    whyTarget: typeof raw.whyTarget === "string" ? scrub(raw.whyTarget, 120) : undefined,
  };

  return { ok: true, digest };
}

export function estimateDigestChars(digest: ImpactDigest): number {
  return JSON.stringify(digest).length;
}
