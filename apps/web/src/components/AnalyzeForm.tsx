"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConnectGitHubButton } from "@/components/ConnectGitHubButton";

type JobPoll = {
  id: string;
  status: string;
  phase?: string;
  phaseLabel?: string;
  routePath?: string;
  lastError?: string;
  result?: { analysisId?: string; routePath?: string; fromCache?: boolean };
};

async function pollJobUntilDone(
  jobId: string,
  onPhase: (label: string) => void,
  signal: AbortSignal,
): Promise<JobPoll> {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;

  while (!signal.aborted) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Analysis is taking longer than expected. Check job status later.");
    }

    const response = await fetch(`/api/jobs/${jobId}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    const data = (await response.json()) as JobPoll & {
      message?: string;
      code?: string;
    };
    if (!response.ok) {
      throw Object.assign(new Error(data.message ?? "Job not found"), {
        code: data.code,
      });
    }

    onPhase(data.phaseLabel ?? data.phase ?? "Working");

    if (data.status === "SUCCEEDED") {
      return data;
    }
    if (data.status === "DEAD_LETTER" || data.status === "FAILED") {
      throw Object.assign(new Error(data.lastError ?? "Analysis failed"), {
        code: "ANALYSIS_FAILED",
        detail: data.lastError,
      });
    }

    await new Promise((r) => setTimeout(r, 900));
  }

  throw new Error("Analysis cancelled");
}

export function AnalyzeForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPrivate =
    errorCode === "PRIVATE_REPOSITORY" || errorCode === "ACCESS_DENIED";
  const canRetry =
    errorCode === "GITHUB_RATE_LIMITED" ||
    errorCode === "ANALYSIS_TIMEOUT" ||
    errorCode === "ANALYSIS_FAILED" ||
    errorCode === "RATE_LIMITED" ||
    errorCode === "QUEUE_UNAVAILABLE";

  useEffect(() => {
    if (!isPrivate) return;
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
  }, [isPrivate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrorDetail(null);
    setErrorCode(null);
    setRequestId(null);
    setPhaseLabel(null);
    const value = url
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    if (!value) {
      setError("Paste a GitHub repository or pull request URL.");
      return;
    }

    try {
      const key = "gitimpact:recent";
      const prev = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      const next = [value, ...prev.filter((u) => u !== value)].slice(0, 8);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }

    startTransition(async () => {
      const controller = new AbortController();
      try {
        setPhaseLabel("Queuing analysis");
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repository: value }),
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          error?: string;
          message?: string;
          detail?: string;
          code?: string;
          routePath?: string;
          id?: string;
          jobId?: string;
          status?: string;
          fromCache?: boolean;
          requestId?: string;
          phaseLabel?: string;
        };

        setRequestId(data.requestId ?? response.headers.get("x-request-id"));

        if (!response.ok && response.status !== 202) {
          setError(data.message ?? data.error ?? "Analysis failed");
          setErrorDetail(data.detail ?? null);
          setErrorCode(data.code ?? null);
          setPhaseLabel(null);
          return;
        }

        // Cache hit — ready immediately
        if (data.routePath && (response.status === 200 || data.fromCache)) {
          router.push(data.routePath);
          return;
        }

        if (!data.jobId) {
          setError("Analysis did not return a job id.");
          setPhaseLabel(null);
          return;
        }

        setPhaseLabel("Queued");
        const done = await pollJobUntilDone(data.jobId, setPhaseLabel, controller.signal);
        const routePath = done.routePath ?? done.result?.routePath;
        if (routePath) {
          router.push(routePath);
          return;
        }
        setError("Analysis finished but no repository path was returned.");
        setPhaseLabel(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not reach the analysis service.";
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code)
            : "ANALYSIS_FAILED";
        const detail =
          err && typeof err === "object" && "detail" in err
            ? String((err as { detail?: string }).detail)
            : null;
        setError(message);
        setErrorDetail(detail);
        setErrorCode(code);
        setPhaseLabel(null);
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
      {pending && phaseLabel ? (
        <p className="mt-3 font-mono text-xs text-[var(--teal)]">{phaseLabel}…</p>
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
