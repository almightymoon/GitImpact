import { createHmac, timingSafeEqual } from "node:crypto";

export interface GitHubComment {
  id: number;
  body: string;
  user?: { login?: string };
  html_url?: string;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitImpact/0.6",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Verify GitHub webhook HMAC SHA-256 signature (`X-Hub-Signature-256`).
 */
export function verifyGitHubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(typeof rawBody === "string" ? rawBody : new Uint8Array(rawBody))
      .digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function listPullRequestIssueComments(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubComment[]> {
  const comments: GitHubComment[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
      { headers: githubHeaders() },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to list PR comments #${number}: ${response.status} ${response.statusText}`,
      );
    }
    const batch = (await response.json()) as GitHubComment[];
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

export async function createPullRequestComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<GitHubComment> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create PR comment #${number}: ${response.status} ${response.statusText} — ${text}`,
    );
  }
  return (await response.json()) as GitHubComment;
}

export async function updateIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<GitHubComment> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
    {
      method: "PATCH",
      headers: {
        ...githubHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to update comment ${commentId}: ${response.status} ${response.statusText} — ${text}`,
    );
  }
  return (await response.json()) as GitHubComment;
}

/**
 * Create or update a bot comment identified by a body marker (idempotent on sync).
 */
export async function upsertPullRequestComment(options: {
  owner: string;
  repo: string;
  number: number;
  body: string;
  marker: string;
}): Promise<{ comment: GitHubComment; created: boolean }> {
  const { owner, repo, number, body, marker } = options;
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required to post PR comments");
  }

  const existing = await listPullRequestIssueComments(owner, repo, number);
  const prior = existing.find((comment) => comment.body?.includes(marker));
  if (prior) {
    const comment = await updateIssueComment(owner, repo, prior.id, body);
    return { comment, created: false };
  }
  const comment = await createPullRequestComment(owner, repo, number, body);
  return { comment, created: true };
}
