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

  return NextResponse.json({
    configured: isGitHubAppConfigured(),
    installUrl,
    slug: slug ?? null,
    appId: appId ? "set" : null,
  });
}
