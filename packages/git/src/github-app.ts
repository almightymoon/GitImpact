import { createSign, createPrivateKey } from "node:crypto";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID?.trim() &&
      (process.env.GITHUB_APP_PRIVATE_KEY?.trim() ||
        process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim()),
  );
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId) return null;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
    return { appId, privateKey };
  }
  return null;
}

/**
 * Create a short-lived GitHub App JWT (RS256).
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function createGitHubAppJwt(config: GitHubAppConfig = getGitHubAppConfig()!): string {
  if (!config?.appId || !config.privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: config.appId,
    }),
  ).toString("base64url");

  const data = `${header}.${payload}`;
  const key = createPrivateKey(config.privateKey);
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(key).toString("base64url");
  return `${data}.${signature}`;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  installationId: number;
}

const installationTokenCache = new Map<
  number,
  { token: string; expiresAtMs: number }
>();

/**
 * Exchange App JWT for an installation access token (1 hour, cached ~50 min).
 */
export async function createInstallationAccessToken(
  installationId: number,
): Promise<InstallationToken> {
  const cached = installationTokenCache.get(installationId);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return {
      token: cached.token,
      expiresAt: new Date(cached.expiresAtMs).toISOString(),
      installationId,
    };
  }

  const jwt = createGitHubAppJwt();
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "GitImpact/0.7",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create installation token for ${installationId}: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const expiresAtMs = Date.parse(data.expires_at);
  installationTokenCache.set(installationId, { token: data.token, expiresAtMs });
  return {
    token: data.token,
    expiresAt: data.expires_at,
    installationId,
  };
}

/**
 * Resolve a token for API calls: installation token preferred, else GITHUB_TOKEN.
 */
export async function resolveGitHubToken(options?: {
  installationId?: number | null;
}): Promise<string | undefined> {
  if (options?.installationId && isGitHubAppConfigured()) {
    const { token } = await createInstallationAccessToken(options.installationId);
    return token;
  }
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}
