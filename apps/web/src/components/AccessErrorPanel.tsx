"use client";

import type { AnalysisErrorPayload } from "@gitimpact/shared";
import { AnalyzeForm } from "@/components/AnalyzeForm";

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
          <div className="mt-4 space-y-2 text-sm text-[var(--ink-soft)]">
            <p>Public repositories work without authentication.</p>
            <p>
              Private repository support requires GitHub authorization (GitHub App installation).
            </p>
            <p className="rounded-xl bg-white/80 px-3 py-2 font-mono text-xs">
              Private repository support requires GitHub authorization.
            </p>
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
