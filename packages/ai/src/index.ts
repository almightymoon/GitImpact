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
  /** Framework labels from deterministic detection */
  frameworks?: string[];
  directDependents?: number;
  indirectDependents?: number;
  /** Notable why-path target name */
  whyTarget?: string;
  languages?: string[];
}

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
  const provider = (env.GITIMPACT_AI_PROVIDER?.trim() ||
    (env.ANTHROPIC_API_KEY ? "anthropic" : "openai")) as AiProviderName;
  return {
    enabled: enabled && Boolean(apiKey),
    provider,
    apiKey,
    baseUrl: env.GITIMPACT_AI_BASE_URL?.trim() || undefined,
    model:
      env.GITIMPACT_AI_MODEL?.trim() ||
      (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini"),
    maxTokens: Number(env.GITIMPACT_AI_MAX_TOKENS ?? 400),
    timeoutMs: Number(env.GITIMPACT_AI_TIMEOUT_MS ?? 12_000),
  };
}

export function buildImpactNarrativePrompt(digest: ImpactDigest): string {
  return [
    "You are assisting a code-impact tool. Write 2-4 short sentences for developers.",
    "Do not invent files, APIs, frameworks, or tests not listed. Prefer caution over certainty.",
    `Repository: ${digest.repository}`,
    digest.pullRequestNumber != null ? `PR: #${digest.pullRequestNumber}` : "",
    digest.complexityScore != null
      ? `Complexity: ${digest.complexityScore}/100 (${digest.impactLevel ?? "n/a"})`
      : "",
    digest.frameworks?.length
      ? `Frameworks: ${digest.frameworks.slice(0, 8).join(", ")}`
      : "",
    digest.languages?.length
      ? `Languages: ${digest.languages.slice(0, 6).join(", ")}`
      : "",
    digest.directDependents != null || digest.indirectDependents != null
      ? `Blast radius: direct=${digest.directDependents ?? "?"} indirect=${digest.indirectDependents ?? "?"}`
      : "",
    digest.whyTarget ? `Notable dependent: ${digest.whyTarget}` : "",
    `Changed symbols: ${digest.changedSymbols.slice(0, 20).join(", ") || "(none)"}`,
    `Affected APIs: ${digest.affectedApis.slice(0, 15).join(", ") || "(none)"}`,
    `Relevant tests: ${digest.relevantTests.slice(0, 15).join(", ") || "(none)"}`,
    digest.summary ? `Deterministic summary: ${digest.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createHttpAiProvider(config: AiConfig): AiProvider | null {
  if (!config.enabled || !config.apiKey) return null;
  const apiKey = config.apiKey;
  const model = config.model ?? "gpt-4o-mini";
  const timeoutMs = config.timeoutMs;

  if (config.provider === "anthropic") {
    const base = config.baseUrl ?? "https://api.anthropic.com";
    return {
      name: "anthropic",
      async complete(prompt, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? timeoutMs);
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: options?.maxTokens ?? config.maxTokens,
              system:
                options?.system ??
                "You write concise, cautious blast-radius narratives. No secrets.",
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

  const base = config.baseUrl ?? "https://api.openai.com/v1";
  return {
    name: config.provider === "openai-compatible" ? "openai-compatible" : "openai",
    async complete(prompt, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? timeoutMs);
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: options?.maxTokens ?? config.maxTokens,
            messages: [
              {
                role: "system",
                content:
                  options?.system ??
                  "You write concise, cautious blast-radius narratives. No secrets.",
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

/**
 * Optional narrative for PR comments / overview. Returns undefined when AI is off or fails.
 */
export async function enrichImpactNarrative(
  digest: ImpactDigest,
  options?: { apiKey?: string; env?: NodeJS.ProcessEnv },
): Promise<string | undefined> {
  const env = options?.env ?? process.env;
  const config = loadAiConfig(env);
  if (options?.apiKey) {
    config.apiKey = options.apiKey;
    config.enabled = true;
  }
  const provider = createHttpAiProvider(config);
  if (!provider) return undefined;
  try {
    const text = await provider.complete(buildImpactNarrativePrompt(digest), {
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
    });
    return text || undefined;
  } catch {
    return undefined;
  }
}
