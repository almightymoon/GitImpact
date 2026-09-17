export function githubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitImpact/0.7",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const auth = token ?? process.env.GITHUB_TOKEN?.trim();
  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }
  return headers;
}
