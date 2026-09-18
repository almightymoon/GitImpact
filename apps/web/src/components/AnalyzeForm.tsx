"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConnectGitHubButton } from "@/components/ConnectGitHubButton";

const PROGRESS_STEPS = [
  "Fetching repository",
  "Discovering files",
  "Parsing code",
  "Building graph",
  "Detecting APIs",
  "Running checks",
  "Building architecture",
  "Finalizing",
] as const;

export function AnalyzeForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  const isPrivate =
    errorCode === "PRIVATE_REPOSITORY" || errorCode === "ACCESS_DENIED";
  const canRetry =
    errorCode === "GITHUB_RATE_LIMITED" ||
    errorCode === "ANALYSIS_TIMEOUT" ||
    errorCode === "ANALYSIS_FAILED" ||
    errorCode === "RATE_LIMITED";

  useEffect(() => {
    if (isPrivate) {
      let cancelled = false;
      void fetch("/api/github/app")
        .then((r) => r.json())
        .then((data: { installUrl?: string | null }) => {
          if (!cancelled) setInstallUrl(data.installUrl ?? null);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
  }, [isPrivate]);

  useEffect(() => {
    if (!pending) {
      setProgressIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setProgressIndex((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1));
    }, 1800);
    return () => clearInterval(timer);
  }, [pending]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrorDetail(null);
    setErrorCode(null);
    setRequestId(null);
    const value = url
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    if (!value) {
      setError("Paste a GitHub repository or pull request URL.");
      return;
    }

    // Remember recent analyses locally (no account required).
    try {
      const key = "gitimpact:recent";
      const prev = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      const next = [value, ...prev.filter((u) => u !== value)].slice(0, 8);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repository: value }),
        });
        const data = (await response.json()) as {
          error?: string;
          message?: string;
          detail?: string;
          code?: string;
          routePath?: string;
          id?: string;
          requestId?: string;
        };
        if (!response.ok) {
          setError(data.message ?? data.error ?? "Analysis failed");
          setErrorDetail(data.detail ?? null);
          setErrorCode(data.code ?? null);
          setRequestId(data.requestId ?? response.headers.get("x-request-id"));
          return;
        }
        if (data.routePath) {
          router.push(data.routePath);
        }
      } catch {
        setError("Could not reach the analysis service.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-xl">
      <label className="mb-2 block font-mono text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
        Paste a GitHub repository or pull request URL
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="github.com/vercel/next.js"
          className="w-full flex-1 rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 font-mono text-sm outline-none transition focus:border-[var(--teal)] focus:ring-4 focus:ring-[var(--glow)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--ink-soft)] disabled:opacity-60"
        >
          {pending ? "Analyzing…" : "Analyze Impact"}
        </button>
      </div>
      {pending ? (
        <p className="mt-3 font-mono text-xs text-[var(--teal)]">
          {PROGRESS_STEPS[progressIndex]}…
        </p>
      ) : null}
      {error ? (
        <div className="mt-3 rounded-xl border border-[var(--critical)]/25 bg-[#fff5f5] px-3 py-2">
          {errorCode ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--critical)]">
              {errorCode}
            </p>
          ) : null}
          <p className="text-sm leading-relaxed text-[var(--critical)]">{error}</p>
          {errorDetail ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{errorDetail}</p>
          ) : null}
          {requestId ? (
            <p className="mt-1 font-mono text-[10px] text-[var(--ink-soft)]">
              Reference ID: {requestId}
            </p>
          ) : null}
          {isPrivate ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-[var(--ink-soft)]">
                Private repositories require GitHub App authorization.
              </p>
              <ConnectGitHubButton installUrl={installUrl} appConfigured />
            </div>
          ) : null}
          {canRetry ? (
            <button
              type="submit"
              className="mt-3 text-xs font-medium text-[var(--teal)] underline"
            >
              Retry analysis
            </button>
          ) : null}
        </div>
      ) : !pending ? (
        <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]/60">
          Public repos work without auth · Or connect GitHub for private repos
        </p>
      ) : null}
    </form>
  );
}
