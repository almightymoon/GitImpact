import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeDemoPullRequest } from "@gitimpact/analysis";

export const runtime = "nodejs";

export async function POST() {
  try {
    const fixtureDir = path.resolve(process.cwd(), "../../examples/tiny-fixture");
    const analysis = await analyzeDemoPullRequest(fixtureDir);
    return NextResponse.json({
      id: analysis.id,
      routePath: analysis.routePath,
      summary: analysis.summary,
      prOverview: analysis.prOverview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo PR analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
