import { NextResponse } from "next/server";
import { deleteSavedView, updateSavedView } from "@gitimpact/db";
import type { SavedViewInput } from "@gitimpact/shared";
import { parseViewActor } from "@/lib/view-identity";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ owner: string; repo: string; viewId: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const { owner, repo, viewId } = await params;
  const ctx = parseViewActor(request);
  let body: Partial<SavedViewInput>;
  try {
    body = (await request.json()) as Partial<SavedViewInput>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const view = await updateSavedView(owner, repo, viewId, body, ctx);
    if (!view) {
      return NextResponse.json({ error: "View not found" }, { status: 404 });
    }
    return NextResponse.json({ view });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { owner, repo, viewId } = await params;
  const ctx = parseViewActor(request);
  try {
    const ok = await deleteSavedView(owner, repo, viewId, ctx);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete view" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw error;
  }
}
