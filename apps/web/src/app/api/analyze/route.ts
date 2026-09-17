import { NextResponse } from "next/server";
import { analyzeRepositoryUrl, parseGitHubUrl, toGitImpactPath } from "@gitimpact/analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { repository?: string; depth?: number };
    if (!body.repository?.trim()) {
      return NextResponse.json({ error: "repository is required" }, { status: 400 });
    }

    // Validate early for clearer errors
    const parsed = parseGitHubUrl(body.repository);
    const analysis = await analyzeRepositoryUrl(body.repository, {
      depth: body.depth ?? 3,
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
    });

    return NextResponse.json({
      id: analysis.id,
      routePath: analysis.routePath || toGitImpactPath(parsed),
      summary: analysis.summary,
      repository: {
        owner: analysis.repository.owner,
        name: analysis.repository.name,
        url: analysis.repository.url,
        defaultBranch: analysis.repository.defaultBranch,
      },
      pullRequest: analysis.pullRequest,
      prOverview: analysis.prOverview,
      impact: analysis.impact
        ? {
            complexityScore: analysis.impact.complexityScore,
            summary: analysis.impact.summary,
            affectedFiles: analysis.impact.affectedFiles.length,
            directImpact: analysis.impact.directImpact.length,
            indirectImpact: analysis.impact.indirectImpact.length,
            relatedTests: analysis.impact.relatedTests.length,
            missingTests: analysis.impact.missingTests.length,
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
