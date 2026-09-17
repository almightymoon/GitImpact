import { NextResponse } from "next/server";
import {
  analyzeRepositoryUrl,
  classifyAnalysisError,
  parseGitHubUrl,
  toGitImpactPath,
} from "@gitimpact/analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { repository?: string; depth?: number };
    if (!body.repository?.trim()) {
      return NextResponse.json({ error: "repository is required" }, { status: 400 });
    }

    const parsed = parseGitHubUrl(body.repository);
    const analysis = await analyzeRepositoryUrl(body.repository, {
      depth: body.depth ?? 3,
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
    });

    return NextResponse.json({
      id: analysis.id,
      routePath: analysis.routePath || toGitImpactPath(parsed),
      summary: analysis.summary,
      intelligence: analysis.intelligence,
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
    const classified = classifyAnalysisError(error);
    const status =
      classified.code === "PRIVATE_REPOSITORY" || classified.code === "ACCESS_DENIED"
        ? 403
        : classified.code === "NOT_FOUND"
          ? 404
          : 500;
    return NextResponse.json(
      {
        error: classified.message,
        code: classified.code,
        detail: classified.detail,
        action: classified.action,
      },
      { status },
    );
  }
}
