import { NextResponse } from "next/server";
import { getRuntimeMode } from "@gitimpact/ops";

export const runtime = "nodejs";

/** Liveness — process is up */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "gitimpact-web",
    mode: getRuntimeMode(),
    ts: new Date().toISOString(),
  });
}
