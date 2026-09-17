"use client";

import type { AnalysisErrorPayload } from "@gitimpact/shared";
import { useEffect, useState } from "react";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import { ConnectGitHubButton } from "@/components/ConnectGitHubButton";

export function AccessErrorPanel({
  error,
  githubUrl,
  title,
}: {
  error: AnalysisErrorPayload | { message: string; code?: string; detail?: string; action?: string };
  githubUrl?: string;
  title?: string;
}) {
  const isPrivate =
    error.code === "PRIVATE_REPOSITORY" || error.code === "ACCESS_DENIED";
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [appConfigured, setAppConfigured] = useState(false);

  useEffect(() => {
    if (!isPrivate) return;
    let cancelled = false;
    void fetch("/api/github/app")
      .then((r) => r.json())
      .then((data: { installUrl?: string | null; configured?: boolean }) => {
        if (cancelled) return;
        setInstallUrl(data.installUrl ?? null);
        setAppConfigured(Boolean(data.configured));
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [isPrivate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <a href="/" className="font-display text-lg font-bold">
        GitImpact
      </a>
      {title ? (
        <h1 className="mt-8 font-display text-3xl font-semibold">{title}</h1>
      ) : null}
      <div className="mt-6 rounded-2xl border border-[var(--critical)]/30 bg-[#fff5f5] p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--critical)]">
          {error.code ?? "ANALYSIS_FAILED"}
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold text-[var(--ink)]">
          {error.message}
        </h2>
        {error.detail ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">{error.detail}</p>
        ) : null}
        {isPrivate ? (
          <div className="mt-4 space-y-4 text-sm text-[var(--ink-soft)]">
            <ul className="list-disc space-y-1 pl-5">
              <li>Public repositories work without authentication.</li>
              <li>
                Private repositories require installing the GitImpact GitHub App so we can create
                short-lived installation tokens.
              </li>
            </ul>
            <ConnectGitHubButton installUrl={installUrl} appConfigured={appConfigured} />
          </div>
        ) : null}
      </div>
      {githubUrl ? (
        <div className="mt-8">
          <AnalyzeForm
            initialUrl={githubUrl.replace("https://", "").replace("local://", "")}
          />
        </div>
      ) : null}
    </main>
  );
}
