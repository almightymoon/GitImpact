/**
 * Optional BYOK AI enrichment (v1.3).
 * Deterministic analysis remains the source of truth; AI never runs on raw repo dumps.
 */

export type AiProviderName = "openai" | "anthropic" | "openai-compatible";

export interface AiCompleteOptions {
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiProvider {
  name: AiProviderName;
  complete(prompt: string, options?: AiCompleteOptions): Promise<string>;
}

export interface AiConfig {
  enabled: boolean;
  provider: AiProviderName;
  /** Bring-your-own key — never log or put on job payloads */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface ImpactDigest {
  repository: string;
  pullRequestNumber?: number;
  complexityScore?: number;
  impactLevel?: string;
  changedSymbols: string[];
  affectedApis: string[];
  relevantTests: string[];
  summary?: string;
  frameworks?: string[];
  directDependents?: number;
  indirectDependents?: number;
  whyTarget?: string;
  languages?: string[];
}

export {
  sanitizeImpactDigest,
  isAiProviderName,
  estimateDigestChars,
  type DigestValidationResult,
} from "./digest.js";
export { buildImpactNarrativePrompt, AI_SYSTEM_PROMPT } from "./prompt.js";

import { buildImpactNarrativePrompt, AI_SYSTEM_PROMPT } from "./prompt.js";
import { isAiProviderName } from "./digest.js";

const ALLOWED_BASE_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
]);

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey =
    env.GITIMPACT_AI_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.ANTHROPIC_API_KEY?.trim() ||
    undefined;
  const enabled =
    env.GITIMPACT_AI_ENABLED === "1" ||
    env.GITIMPACT_AI_ENABLED === "true" ||
    Boolean(apiKey && env.GITIMPACT_AI_ENABLED !== "0");
  const rawProvider = env.GITIMPACT_AI_PROVIDER?.trim() ||
    (env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
  const provider = isAiProviderName(rawProvider) ? rawProvider : "openai";
  return {
    enabled: enabled && Boolean(apiKey),
    provider,
    apiKey,
    baseUrl: env.GITIMPACT_AI_BASE_URL?.trim() || undefined,
    model:
      env.GITIMPACT_AI_MODEL?.trim() ||
      (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini"),
    maxTokens: Math.min(800, Math.max(64, Number(env.GITIMPACT_AI_MAX_TOKENS ?? 400))),
    timeoutMs: Math.min(30_000, Math.max(3_000, Number(env.GITIMPACT_AI_TIMEOUT_MS ?? 12_000))),
  };
}

/** Reject open redirects / arbitrary SSRF-ish base URLs unless explicitly allowed. */
export function assertSafeAiBaseUrl(baseUrl: string | undefined, provider: AiProviderName): string {
  if (!baseUrl) {
    return provider === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com/v1";
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid AI base URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("AI base URL must use https");
  }
  const allowCustom = process.env.GITIMPACT_AI_ALLOW_CUSTOM_BASE === "1";
  if (!allowCustom && !ALLOWED_BASE_HOSTS.has(url.hostname)) {
    throw new Error(
      "AI base URL host not allowed (set GITIMPACT_AI_ALLOW_CUSTOM_BASE=1 for openai-compatible proxies)",
    );
  }
  return baseUrl.replace(/\/$/, "");
}

export function createHttpAiProvider(config: AiConfig): AiProvider | null {
  if (!config.enabled || !config.apiKey) return null;
  const apiKey = config.apiKey;
  const model = config.model ?? "gpt-4o-mini";
  const timeoutMs = config.timeoutMs;
  const maxTokens = config.maxTokens;

  if (config.provider === "anthropic") {
    const base = assertSafeAiBaseUrl(config.baseUrl, "anthropic");
    return {
      name: "anthropic",
      async complete(prompt, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? timeoutMs);
        try {
          const res = await fetch(`${base}/v1/messages`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: options?.maxTokens ?? maxTokens,
              system: options?.system ?? AI_SYSTEM_PROMPT,
              messages: [{ role: "user", content: prompt }],
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(`AI provider error ${res.status}`);
          }
          const json = (await res.json()) as {
            content?: Array<{ type?: string; text?: string }>;
          };
          return (
            json.content?.find((c) => c.type === "text")?.text?.trim() ||
            json.content?.[0]?.text?.trim() ||
            ""
          );
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  const base = assertSafeAiBaseUrl(
    config.baseUrl,
    config.provider === "openai-compatible" ? "openai-compatible" : "openai",
  );
  const chatBase = base.endsWith("/v1") ? base : `${base}/v1`;
  return {
    name: config.provider === "openai-compatible" ? "openai-compatible" : "openai",
    async complete(prompt, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? timeoutMs);
      try {
        const res = await fetch(`${chatBase}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: options?.maxTokens ?? maxTokens,
            messages: [
              {
                role: "system",
                content: options?.system ?? AI_SYSTEM_PROMPT,
              },
              { role: "user", content: prompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`AI provider error ${res.status}`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return json.choices?.[0]?.message?.content?.trim() || "";
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface EnrichOptions {
  /** Client BYOK key — preferred for public HTTP endpoints */
  apiKey?: string;
  provider?: AiProviderName;
  baseUrl?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * When false (default for public HTTP), never fall back to server env keys.
   * Worker/PR paths set true so GITIMPACT_AI_* can enrich comments.
   */
  allowServerKey?: boolean;
}

/**
 * Optional narrative for PR comments / overview. Returns undefined when AI is off or fails.
 * Never throws into the deterministic analysis path.
 */
export async function enrichImpactNarrative(
  digest: ImpactDigest,
  options?: EnrichOptions,
): Promise<string | undefined> {
  const env = options?.env ?? process.env;
  const config = loadAiConfig(env);

  if (options?.apiKey?.trim()) {
    config.apiKey = options.apiKey.trim();
    config.enabled = true;
  } else if (!options?.allowServerKey) {
    // Public BYOK endpoint must not burn the operator's server key.
    return undefined;
  }

  if (options?.provider && isAiProviderName(options.provider)) {
    config.provider = options.provider;
  }
  if (options?.baseUrl) config.baseUrl = options.baseUrl;
  if (options?.model) config.model = options.model;

  let provider: AiProvider | null;
  try {
    provider = createHttpAiProvider(config);
  } catch {
    return undefined;
  }
  if (!provider) return undefined;

  try {
    const text = await provider.complete(buildImpactNarrativePrompt(digest), {
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      system: AI_SYSTEM_PROMPT,
    });
    return text ? text.slice(0, 4_000) : undefined;
  } catch {
    return undefined;
  }
}
