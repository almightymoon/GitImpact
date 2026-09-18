export function githubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitImpact/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const auth = token ?? process.env.GITHUB_TOKEN?.trim();
  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }
  return headers;
}

export class GitHubRateLimitError extends Error {
  readonly code = "GITHUB_RATE_LIMITED" as const;
  readonly retryAfterSeconds: number;
  readonly resetAt?: string;

  constructor(message: string, retryAfterSeconds: number, resetAt?: string) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetAt = resetAt;
  }
}

function parseRetryAfterSeconds(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.max(1, Number(retryAfter));
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const seconds = Number(reset) - Math.floor(Date.now() / 1000);
    return Math.max(1, seconds);
  }
  return 60;
}

export function assertGitHubRateLimit(response: Response): void {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (remaining === "0" || /rate limit/i.test(response.headers.get("x-ratelimit-resource") ?? "")));

  if (!limited) return;

  const retryAfterSeconds = parseRetryAfterSeconds(response);
  const reset = response.headers.get("x-ratelimit-reset");
  const resetAt = reset
    ? new Date(Number(reset) * 1000).toISOString()
    : undefined;
  const when = resetAt
    ? ` Analysis can be retried after ${resetAt}.`
    : ` Retry after approximately ${retryAfterSeconds}s.`;
  throw new GitHubRateLimitError(
    `GitHub's API rate limit has been reached.${when}`,
    retryAfterSeconds,
    resetAt,
  );
}

/**
 * Fetch GitHub API with rate-limit awareness. Does not log tokens.
 */
export async function githubFetch(
  url: string,
  init?: RequestInit & { token?: string },
): Promise<Response> {
  const { token, headers, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...githubApiHeaders(token),
      ...(headers as Record<string, string> | undefined),
    },
  });
  assertGitHubRateLimit(response);
  return response;
}
