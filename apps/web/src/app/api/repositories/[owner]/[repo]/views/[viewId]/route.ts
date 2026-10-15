import { NextResponse } from "next/server";
import { deleteSavedView } from "@gitimpact/db";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ owner: string; repo: string; viewId: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { owner, repo, viewId } = await params;
  const ok = await deleteSavedView(owner, repo, viewId);
  if (!ok) {
    return NextResponse.json({ error: "Failed to delete view" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
