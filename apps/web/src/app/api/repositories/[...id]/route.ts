import { NextResponse } from "next/server";
import { getAnalysis, getNodeImpact, searchAnalysis } from "@gitimpact/analysis";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string[] }> };

function decodeId(parts: string[]): string {
  return parts.map(decodeURIComponent).join("/");
}

export async function GET(request: Request, { params }: Params) {
  const { id: parts } = await params;
  const id = decodeId(parts);
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("nodeId");
  const depth = Number(searchParams.get("depth") ?? 3);
  const q = searchParams.get("q");

  const analysis = getAnalysis(id);
  if (!analysis) {
    return NextResponse.json(
      { error: "Analysis not found. Re-run analyze from the home page." },
      { status: 404 },
    );
  }

  if (q) {
    return NextResponse.json({ results: searchAnalysis(id, q) });
  }

  if (nodeId) {
    const impact = getNodeImpact(id, nodeId, depth);
    if (!impact) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ impact });
  }

  // Return a trimmed graph for the UI (file-level nodes + import edges)
  const fileNodes = analysis.graph.nodes.filter(
    (n) =>
      n.type === "FILE" ||
      n.type === "SERVICE" ||
      n.type === "CONTROLLER" ||
      n.type === "COMPONENT" ||
      n.type === "TEST" ||
      n.type === "API_ROUTE" ||
      n.type === "CONFIG" ||
      n.type === "DATABASE_MODEL" ||
      n.type === "HOOK",
  );
  const fileIds = new Set(fileNodes.map((n) => n.id));
  const importEdges = analysis.graph.edges.filter(
    (e) => e.type === "IMPORTS" && fileIds.has(e.from) && fileIds.has(e.to),
  );

  // Cap for browser performance
  const cappedNodes = fileNodes.slice(0, 400);
  const cappedIds = new Set(cappedNodes.map((n) => n.id));
  const cappedEdges = importEdges
    .filter((e) => cappedIds.has(e.from) && cappedIds.has(e.to))
    .slice(0, 800);

  return NextResponse.json({
    id: analysis.id,
    createdAt: analysis.createdAt,
    repository: {
      owner: analysis.repository.owner,
      name: analysis.repository.name,
      url: analysis.repository.url,
      defaultBranch: analysis.repository.defaultBranch,
    },
    summary: analysis.summary,
    pullRequest: analysis.pullRequest,
    changes: analysis.changes,
    impact: analysis.impact,
    prOverview: analysis.prOverview,
    graph: {
      nodes: cappedNodes,
      edges: cappedEdges,
    },
  });
}
