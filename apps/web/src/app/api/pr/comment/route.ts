import { NextResponse } from "next/server";
import {
  analyzeAndCommentOnPullRequest,
  parseGitHubUrl,
} from "@gitimpact/analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Manually analyze a PR and upsert the GitImpact comment.
 * Body: { pullRequest: "https://github.com/owner/repo/pull/123", postComment?: boolean }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      pullRequest?: string;
      owner?: string;
      repo?: string;
      number?: number;
      postComment?: boolean;
      depth?: number;
    };

    let owner = body.owner;
    let repo = body.repo;
    let number = body.number;

    if (body.pullRequest?.trim()) {
      const parsed = parseGitHubUrl(body.pullRequest);
      if (parsed.kind !== "pull_request" || !parsed.prNumber) {
        return NextResponse.json(
          { error: "pullRequest must be a GitHub pull request URL" },
          { status: 400 },
        );
      }
      owner = parsed.owner;
      repo = parsed.repo;
      number = parsed.prNumber;
    }

    if (!owner || !repo || !number) {
      return NextResponse.json(
        { error: "owner, repo, and number (or pullRequest URL) are required" },
        { status: 400 },
      );
    }

    const result = await analyzeAndCommentOnPullRequest({
      owner,
      repo,
      number,
      depth: body.depth ?? 3,
      maxFiles: Number(process.env.GITIMPACT_MAX_FILES ?? 800),
      postComment: body.postComment ?? Boolean(process.env.GITHUB_TOKEN),
      analysisBaseUrl: process.env.GITIMPACT_PUBLIC_URL,
    });

    return NextResponse.json({
      id: result.analysis.id,
      routePath: result.analysis.routePath,
      posted: result.posted,
      commentUrl: result.commentUrl,
      commentCreated: result.commentCreated,
      skippedReason: result.skippedReason,
      commentBody: result.commentBody,
      prOverview: result.analysis.prOverview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PR comment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
