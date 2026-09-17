"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AnalyzeForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrorDetail(null);
    setErrorCode(null);
    const value = url
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    if (!value) {
      setError("Paste a GitHub repository or pull request URL.");
      return;
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
          detail?: string;
          code?: string;
          routePath?: string;
          id?: string;
        };
        if (!response.ok) {
          setError(data.error ?? "Analysis failed");
          setErrorDetail(data.detail ?? null);
          setErrorCode(data.code ?? null);
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

  const isPrivate =
    errorCode === "PRIVATE_REPOSITORY" || errorCode === "ACCESS_DENIED";

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
      {error ? (
        <div className="mt-3 rounded-xl border border-[var(--critical)]/25 bg-[#fff5f5] px-3 py-2">
          <p className="text-sm leading-relaxed text-[var(--critical)]">{error}</p>
          {errorDetail ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{errorDetail}</p>
          ) : null}
          {isPrivate ? (
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              Private repository support requires GitHub authorization.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]/60">
          Public repos work without auth · TypeScript / JavaScript
        </p>
      )}
    </form>
  );
}
