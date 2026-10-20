import { NextResponse } from "next/server";
import {
  enrichImpactNarrative,
  estimateDigestChars,
  isAiProviderName,
  sanitizeImpactDigest,
  type AiProviderName,
} from "@gitimpact/ai";
import { consumeRateLimit } from "@gitimpact/ops";

export const runtime = "nodejs";

const MAX_DIGEST_CHARS = 8_000;
const AI_RATE_LIMIT = Number(process.env.GITIMPACT_AI_RATE_LIMIT ?? 8);
const AI_RATE_WINDOW = Number(process.env.GITIMPACT_AI_RATE_WINDOW_SECONDS ?? 60);

/**
 * On-demand BYOK narrative.
 * - Requires a client-supplied API key (body or x-gitimpact-ai-key).
 * - Never falls back to the server operator key (prevents anonymous key burn).
 * - Keys are not logged, queued, or persisted.
 */
export async function POST(request: Request) {
  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anonymous";

  const limit = await consumeRateLimit(`ai-narrative:${clientKey}`, {
    limit: AI_RATE_LIMIT,
    windowSeconds: AI_RATE_WINDOW,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many AI narrative requests.",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: {
    digest?: unknown;
    apiKey?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const headerKey = request.headers.get("x-gitimpact-ai-key")?.trim();
  const apiKey = body.apiKey?.trim() || headerKey || undefined;
  if (!apiKey) {
    return NextResponse.json(
      {
        enabled: false,
        narrative: null,
        message:
          "BYOK apiKey required. Pass apiKey in the JSON body or x-gitimpact-ai-key header. Server env keys are not used on this public endpoint.",
      },
      { status: 401 },
    );
  }

  if (apiKey.length < 8 || apiKey.length > 512) {
    return NextResponse.json({ error: "Invalid apiKey" }, { status: 400 });
  }

  const sanitized = sanitizeImpactDigest(body.digest);
  if (!sanitized.ok || !sanitized.digest) {
    return NextResponse.json(
      { error: "INVALID_DIGEST", message: sanitized.error ?? "Invalid digest" },
      { status: 400 },
    );
  }

  if (estimateDigestChars(sanitized.digest) > MAX_DIGEST_CHARS) {
    return NextResponse.json(
      { error: "DIGEST_TOO_LARGE", message: "Digest exceeds size limit" },
      { status: 413 },
    );
  }

  let provider: AiProviderName | undefined;
  if (body.provider) {
    if (!isAiProviderName(body.provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    provider = body.provider;
  }

  try {
    const narrative = await enrichImpactNarrative(sanitized.digest, {
      apiKey,
      provider,
      model: typeof body.model === "string" ? body.model.slice(0, 80) : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      allowServerKey: false,
    });
    if (!narrative) {
      return NextResponse.json(
        {
          enabled: false,
          narrative: null,
          message: "AI provider unavailable or returned an empty response.",
        },
        { status: 200 },
      );
    }
    return NextResponse.json({
      enabled: true,
      narrative,
      disclaimer:
        "AI-assisted interpretation of deterministic findings — not a substitute for review or test results.",
    });
  } catch {
    return NextResponse.json(
      {
        error: "AI_FAILED",
        message: "Narrative failed",
      },
      { status: 502 },
    );
  }
}
