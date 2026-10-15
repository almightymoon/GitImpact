import { NextResponse } from "next/server";
import { listSavedViews, createSavedView } from "@gitimpact/db";
import type { SavedViewInput } from "@gitimpact/shared";
import { parseViewActor } from "@/lib/view-identity";

export const runtime = "nodejs";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(request: Request, { params }: Params) {
  const { owner, repo } = await params;
  const ctx = parseViewActor(request);
  const views = await listSavedViews(owner, repo, ctx);
  return NextResponse.json({ repository: `${owner}/${repo}`, views });
}

export async function POST(request: Request, { params }: Params) {
  const { owner, repo } = await params;
  const ctx = parseViewActor(request);
  let body: SavedViewInput;
  try {
    body = (await request.json()) as SavedViewInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const view = await createSavedView(
      owner,
      repo,
      {
        ...body,
        createdBy: body.createdBy ?? ctx?.login,
        orgLogin: body.orgLogin ?? owner,
      },
      ctx,
    );
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw error;
  }
}
