"use client";

/**
 * Connect GitHub App install CTA for private repository access.
 * Uses GITHUB_APP_SLUG / public install URL when configured.
 */
export function ConnectGitHubButton({
  className,
  installUrl,
  appConfigured,
}: {
  className?: string;
  installUrl?: string | null;
  appConfigured?: boolean;
}) {
  if (installUrl) {
    return (
      <a
        href={installUrl}
        target="_blank"
        rel="noreferrer"
        className={
          className ??
          "inline-flex items-center justify-center rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ink-soft)]"
        }
      >
        Connect GitHub
      </a>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled
        title={
          appConfigured === false
            ? "Set GITHUB_APP_SLUG (or GITHUB_APP_ID) to enable one-click install"
            : "GitHub App install URL is not configured"
        }
        className={
          className ??
          "inline-flex cursor-not-allowed items-center justify-center rounded-full bg-[var(--ink)]/50 px-4 py-2 text-sm font-medium text-white"
        }
      >
        Connect GitHub
      </button>
      <p className="text-xs text-[var(--ink-soft)]">
        Private repository support requires installing the GitImpact GitHub App on your
        account or organization. Ask your admin to configure{" "}
        <code className="font-mono">GITHUB_APP_SLUG</code>, then reload this page.
      </p>
    </div>
  );
}
