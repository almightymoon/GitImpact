import { NextResponse } from "next/server";
import { enrichImpactNarrative, type ImpactDigest } from "@gitimpact/ai";

export const runtime = "nodejs";

/**
 * On-demand BYOK narrative. API key stays on this request only — never queued.
 */
export async function POST(request: Request) {
  let body: { digest?: ImpactDigest; apiKey?: string };
  try {
    body = (await request.json()) as { digest?: ImpactDigest; apiKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.digest?.repository) {
    return NextResponse.json({ error: "digest.repository is required" }, { status: 400 });
  }

  const headerKey = request.headers.get("x-gitimpact-ai-key")?.trim();
  const apiKey = body.apiKey?.trim() || headerKey || undefined;

  try {
    const narrative = await enrichImpactNarrative(body.digest, { apiKey });
    if (!narrative) {
      return NextResponse.json(
        {
          enabled: false,
          narrative: null,
          message:
            "AI disabled or unavailable. Set GITIMPACT_AI_* on the server or pass a BYOK apiKey.",
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ enabled: true, narrative });
  } catch (error) {
    return NextResponse.json(
      {
        error: "AI_FAILED",
        message: error instanceof Error ? error.message : "Narrative failed",
      },
      { status: 502 },
    );
  }
}
