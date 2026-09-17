import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import type { PullRequestMeta, RepositoryMeta } from "@gitimpact/shared";

const execFileAsync = promisify(execFile);

export interface ParsedGitHubUrl {
  kind: "repository" | "pull_request";
  owner: string;
  repo: string;
  prNumber?: number;
  branch?: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function parseGitHubUrl(input: string): ParsedGitHubUrl {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`Invalid GitHub URL: ${input}`);
  }

  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only GitHub repository and pull request URLs are supported in MVP");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Expected a GitHub URL like github.com/owner/repo");
  }

  const [owner, repoRaw, maybePull, prNumber] = parts;
  const repo = repoRaw.replace(/\.git$/, "");

  if (maybePull === "pull" && prNumber && /^\d+$/.test(prNumber)) {
    return {
      kind: "pull_request",
      owner,
      repo,
      prNumber: Number(prNumber),
    };
  }

  if (maybePull === "tree" && prNumber) {
    return {
      kind: "repository",
      owner,
      repo,
      branch: parts.slice(3).join("/") || prNumber,
    };
  }

  return { kind: "repository", owner, repo };
}

export function toGitImpactPath(parsed: ParsedGitHubUrl): string {
  if (parsed.kind === "pull_request") {
    return `/${parsed.owner}/${parsed.repo}/pull/${parsed.prNumber}`;
  }
  return `/${parsed.owner}/${parsed.repo}`;
}

export function repositoryCloneUrl(owner: string, repo: string, token?: string): string {
  if (token) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }
  return `https://github.com/${owner}/${repo}.git`;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function cloneOrUpdateRepository(options: {
  owner: string;
  repo: string;
  cacheDir: string;
  branch?: string;
  token?: string;
}): Promise<RepositoryMeta> {
  const { owner, repo, cacheDir, branch, token } = options;
  const clonePath = path.join(cacheDir, owner, repo);
  const url = repositoryCloneUrl(owner, repo, token);

  await ensureDir(path.dirname(clonePath));

  try {
    if (await exists(path.join(clonePath, ".git"))) {
      await execFileAsync("git", ["fetch", "--depth", "1", "origin"], {
        cwd: clonePath,
        timeout: 120_000,
      });
      if (branch) {
        await execFileAsync("git", ["checkout", branch], {
          cwd: clonePath,
          timeout: 60_000,
        }).catch(async () => {
          await execFileAsync("git", ["checkout", "-B", branch, `origin/${branch}`], {
            cwd: clonePath,
            timeout: 60_000,
          });
        });
      } else {
        await execFileAsync("git", ["pull", "--ff-only"], {
          cwd: clonePath,
          timeout: 120_000,
        }).catch(() => undefined);
      }
    } else {
      const args = ["clone", "--depth", "1"];
      if (branch) {
        args.push("--branch", branch);
      }
      args.push(url, clonePath);
      await execFileAsync("git", args, { timeout: 180_000 });
    }
  } catch (error) {
    throw new Error(friendlyGitError(error, url));
  }

  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: clonePath },
  );

  return {
    owner,
    name: repo,
    url: `https://github.com/${owner}/${repo}`,
    defaultBranch: stdout.trim() || branch || "main",
    clonePath,
  };
}

function friendlyGitError(error: unknown, url: string): string {
  const raw =
    error instanceof Error
      ? `${error.message}${"stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string" ? `\n${(error as { stderr: string }).stderr}` : ""}`
      : String(error);

  if (/Could not resolve host|nodename nor servname|getaddrinfo/i.test(raw)) {
    return `Could not reach GitHub (DNS/network). Check your internet connection, then retry. Tried: ${url}`;
  }
  if (/Repository not found|Authentication failed|could not read Username/i.test(raw)) {
    return `GitHub repository not found or private. For private repos, set GITHUB_TOKEN. Tried: ${url}`;
  }
  if (/timed out|ETIMEDOUT|timeout/i.test(raw)) {
    return `Git clone timed out while fetching ${url}. Retry in a moment.`;
  }

  const compact = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return `Failed to clone repository: ${compact}`;
}

export async function fetchPullRequestHead(options: {
  owner: string;
  repo: string;
  number: number;
  cacheDir: string;
  headBranch?: string;
  token?: string;
}): Promise<RepositoryMeta> {
  const { owner, repo, number, cacheDir, headBranch, token } = options;
  const clonePath = path.join(cacheDir, owner, `${repo}-pr-${number}`);
  const url = repositoryCloneUrl(owner, repo, token);

  await ensureDir(path.dirname(clonePath));

  try {
    if (!(await exists(path.join(clonePath, ".git")))) {
      await execFileAsync("git", ["clone", "--depth", "1", url, clonePath], {
        timeout: 180_000,
      });
    }

    // GitHub exposes PR heads as pull/<n>/head
    await execFileAsync(
      "git",
      ["fetch", "--depth", "1", "origin", `pull/${number}/head:pr-${number}`],
      { cwd: clonePath, timeout: 120_000 },
    );

    await execFileAsync("git", ["checkout", `pr-${number}`], {
      cwd: clonePath,
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(friendlyGitError(error, url));
  }

  return {
    owner,
    name: repo,
    url: `https://github.com/${owner}/${repo}`,
    defaultBranch: headBranch ?? `pr-${number}`,
    clonePath,
  };
}

export async function getPullRequestMeta(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<PullRequestMeta> {
  const { githubApiHeaders } = await import("./github-api.js");
  const { resolveGitHubToken } = await import("./github-app.js");
  const auth = token ?? (await resolveGitHubToken());
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
  const response = await fetch(apiUrl, {
    headers: githubApiHeaders(auth),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch PR #${number}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    title: string;
    base: { ref: string };
    head: { ref: string; sha: string; repo?: { clone_url?: string } };
    html_url: string;
  };

  return {
    owner,
    repo,
    number,
    title: data.title,
    baseBranch: data.base.ref,
    headBranch: data.head.ref,
    headSha: data.head.sha,
    url: data.html_url,
  };
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<
  Array<{
    filename: string;
    status: string;
    patch?: string;
    additions?: number;
    deletions?: number;
  }>
> {
  const { githubApiHeaders } = await import("./github-api.js");
  const { resolveGitHubToken } = await import("./github-app.js");
  const auth = token ?? (await resolveGitHubToken());
  const files: Array<{
    filename: string;
    status: string;
    patch?: string;
    additions?: number;
    deletions?: number;
  }> = [];

  for (let page = 1; page <= 10; page += 1) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const response = await fetch(apiUrl, {
      headers: githubApiHeaders(auth),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch PR files #${number}: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Array<{
      filename: string;
      status: string;
      patch?: string;
      additions?: number;
      deletions?: number;
    }>;

    if (data.length === 0) break;

    for (const file of data) {
      files.push({
        filename: file.filename,
        status: file.status,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      });
    }

    if (data.length < 100) break;
  }

  return files;
}
export async function getChangedFilesBetween(
  repoPath: string,
  baseRef: string,
  headRef = "HEAD",
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", `${baseRef}...${headRef}`],
    { cwd: repoPath },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export { path };

export {
  verifyGitHubWebhookSignature,
  listPullRequestIssueComments,
  createPullRequestComment,
  updateIssueComment,
  upsertPullRequestComment,
  type GitHubComment,
} from "./github-comments.js";

export {
  isGitHubAppConfigured,
  getGitHubAppConfig,
  createGitHubAppJwt,
  createInstallationAccessToken,
  resolveGitHubToken,
  type InstallationToken,
  type GitHubAppConfig,
} from "./github-app.js";

export {
  createCheckRun,
  completeCheckRun,
  formatCheckRunSummary,
  type CheckRun,
  type CheckConclusion,
} from "./check-runs.js";

export { githubApiHeaders } from "./github-api.js";

export {
  listOpenPullRequests,
} from "./pull-requests.js";
