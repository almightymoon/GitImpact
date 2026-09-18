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
  setupHint: setupHintProp,
}: {
  className?: string;
  installUrl?: string | null;
  appConfigured?: boolean;
  setupHint?: string | null;
}) {
  const [installUrl, setInstallUrl] = useState<string | null>(installUrlProp ?? null);
  const [appConfigured, setAppConfigured] = useState(Boolean(appConfiguredProp));
  const [setupHint, setSetupHint] = useState<string | null>(setupHintProp ?? null);

  useEffect(() => {
    if (installUrlProp != null) {
      setInstallUrl(installUrlProp);
      if (appConfiguredProp != null) setAppConfigured(Boolean(appConfiguredProp));
      if (setupHintProp !== undefined) setSetupHint(setupHintProp);
      return;
    }
    let cancelled = false;
    void fetch("/api/github/app")
      .then((r) => r.json())
      .then(
        (data: {
          installUrl?: string | null;
          configured?: boolean;
          setupHint?: string | null;
        }) => {
          if (cancelled) return;
          setInstallUrl(data.installUrl ?? null);
          setAppConfigured(Boolean(data.configured));
          setSetupHint(data.setupHint ?? null);
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [installUrlProp, appConfiguredProp, setupHintProp]);

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
    <div className="space-y-2">
      <button
        type="button"
        disabled
        title={setupHint ?? "GitHub App install URL is not configured"}
        className={
          className ??
          "inline-flex cursor-not-allowed items-center justify-center rounded-full border border-[var(--line)] bg-white/40 px-4 py-2 text-sm font-medium text-[var(--ink-soft)]"
        }
      >
        Connect GitHub
      </button>
      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
        {setupHint ??
          (appConfigured
            ? "Set GITHUB_APP_SLUG so Connect GitHub can open the install page."
            : "GitHub App is not configured on this server.")}{" "}
        See <span className="font-mono">docs/github-app.md</span>.
      </p>
    </div>
  );
}
