import { githubFetch } from "./github-api.js";
import { resolveGitHubToken } from "./github-app.js";
import type { OpenPullRequestSummary } from "@gitimpact/shared";

/**
 * List open pull requests for a repository (public or via installation token).
 */
export async function listOpenPullRequests(
  owner: string,
  repo: string,
  options?: { token?: string; limit?: number },
): Promise<OpenPullRequestSummary[]> {
  const token = options?.token ?? (await resolveGitHubToken());
  const limit = options?.limit ?? 30;
  let response: Response;
  try {
    response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=${limit}&sort=updated&direction=desc`,
      { token },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    return [];
  }

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return [];
  }
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as Array<{
    number: number;
    title: string;
    draft?: boolean;
    html_url: string;
    created_at?: string;
    updated_at?: string;
    user?: { login?: string };
    head?: { ref?: string };
    base?: { ref?: string };
  }>;

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    headBranch: pr.head?.ref ?? "unknown",
    baseBranch: pr.base?.ref ?? "main",
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    draft: Boolean(pr.draft),
    url: pr.html_url,
  }));
}
