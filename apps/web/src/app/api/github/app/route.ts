import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@gitimpact/git";

export const runtime = "nodejs";

/**
 * Public config for GitHub App install CTA (no secrets).
 */
export async function GET() {
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const appId = process.env.GITHUB_APP_ID?.trim();
  const explicitUrl = process.env.GITHUB_APP_INSTALL_URL?.trim();

  const installUrl =
    explicitUrl ||
    (slug ? `https://github.com/apps/${slug}/installations/new` : null);

  const configured = isGitHubAppConfigured();
  let setupHint: string | null = null;
  if (!installUrl) {
    setupHint = configured
      ? "Set GITHUB_APP_SLUG (or GITHUB_APP_INSTALL_URL) so Connect GitHub can open the install page."
      : "Create a GitHub App and set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_SLUG.";
  }

  return NextResponse.json({
    configured,
    installUrl,
    slug: slug ?? null,
    appId: appId ? "set" : null,
    setupHint,
  });
}
