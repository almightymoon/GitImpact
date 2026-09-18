"use client";

import { useEffect, useState } from "react";

/**
 * Connect GitHub App install CTA for private repository access.
 * Uses GITHUB_APP_SLUG / public install URL when configured.
 */
export function ConnectGitHubButton({
  className,
  installUrl: installUrlProp,
  appConfigured: appConfiguredProp,
}: {
  className?: string;
  installUrl?: string | null;
  appConfigured?: boolean;
}) {
  const [installUrl, setInstallUrl] = useState<string | null>(installUrlProp ?? null);
  const [appConfigured, setAppConfigured] = useState(Boolean(appConfiguredProp));

  useEffect(() => {
    if (installUrlProp != null) {
      setInstallUrl(installUrlProp);
      return;
    }
    let cancelled = false;
    void fetch("/api/github/app")
      .then((r) => r.json())
      .then((data: { installUrl?: string | null; configured?: boolean }) => {
        if (cancelled) return;
        setInstallUrl(data.installUrl ?? null);
        setAppConfigured(Boolean(data.configured));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [installUrlProp]);

  if (installUrl) {
    return (
      <a
        href={installUrl}
        target="_blank"
        rel="noreferrer"
        className={
          className ??
          "inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--teal)]"
        }
      >
        Connect GitHub
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled
      title={
        appConfigured === false
          ? "Set GITHUB_APP_SLUG to enable one-click install"
          : "GitHub App install URL is not configured"
      }
      className={
        className ??
        "inline-flex cursor-not-allowed items-center justify-center rounded-full border border-[var(--line)] bg-white/40 px-4 py-2 text-sm font-medium text-[var(--ink-soft)]"
      }
    >
      Connect GitHub
    </button>
  );
}
