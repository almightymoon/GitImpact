import { NextResponse } from "next/server";
import { listSavedViews, createSavedView } from "@gitimpact/db";
import type { SavedViewInput } from "@gitimpact/shared";

export const runtime = "nodejs";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { owner, repo } = await params;
  const views = await listSavedViews(owner, repo);
  return NextResponse.json({ repository: `${owner}/${repo}`, views });
}

export async function POST(request: Request, { params }: Params) {
  const { owner, repo } = await params;
  let body: SavedViewInput;
  try {
    body = (await request.json()) as SavedViewInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const view = await createSavedView(owner, repo, body);
  return NextResponse.json({ view }, { status: 201 });
}
