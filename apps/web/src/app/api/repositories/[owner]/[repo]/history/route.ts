import { NextResponse } from "next/server";
import {
  listAnalysisHistory,
  compareHistorySnapshots,
  getAnalysisHistoryEntry,
} from "@gitimpact/analysis";

export const runtime = "nodejs";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(request: Request, { params }: Params) {
  const { owner, repo } = await params;
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") as "repository" | "pull_request" | null;
  const prNumberRaw = searchParams.get("pr");
  const prNumber = prNumberRaw ? Number(prNumberRaw) : undefined;
  const limit = Number(searchParams.get("limit") ?? 20);
  const compareFrom = searchParams.get("from");
  const compareTo = searchParams.get("to");

  if (compareFrom && compareTo) {
    const [a, b] = await Promise.all([
      getAnalysisHistoryEntry(compareFrom),
      getAnalysisHistoryEntry(compareTo),
    ]);
    if (!a || !b) {
      return NextResponse.json(
        { error: "One or both history entries were not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json({ diff: compareHistorySnapshots(a, b) });
  }

  const entries = await listAnalysisHistory(owner, repo, {
    kind: kind ?? undefined,
    prNumber: Number.isFinite(prNumber) ? prNumber : undefined,
    limit: Number.isFinite(limit) ? Math.min(limit, 100) : 20,
  });

  return NextResponse.json({
    repository: `${owner}/${repo}`,
    count: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      commitSha: e.commitSha,
      baseSha: e.baseSha,
      headSha: e.headSha,
      prNumber: e.prNumber,
      createdAt: e.createdAt,
      typeLabel: e.snapshot.typeLabel,
      frameworks: e.snapshot.frameworks,
      summary: e.snapshot.summary,
      graph: e.snapshot.graph,
      coverageConfidence: e.snapshot.coverageConfidence,
      impact: e.snapshot.impact
        ? {
            directCount: e.snapshot.impact.directCount,
            indirectCount: e.snapshot.impact.indirectCount,
            complexityScore: e.snapshot.impact.complexityScore,
            impactLevel: e.snapshot.impact.impactLevel,
          }
        : undefined,
    })),
  });
}
