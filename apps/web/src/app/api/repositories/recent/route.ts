import { NextResponse } from "next/server";
import { listRecentRepositories } from "@gitimpact/db";

export const runtime = "nodejs";

export async function GET() {
  const repositories = await listRecentRepositories(8);
  return NextResponse.json({ repositories });
}
