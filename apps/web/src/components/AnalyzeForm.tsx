"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AnalyzeForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
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
          routePath?: string;
          id?: string;
        };
        if (!response.ok) {
          setError(data.error ?? "Analysis failed");
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
      {error ? (
        <p className="mt-3 text-sm leading-relaxed text-[var(--critical)]">{error}</p>
      ) : (
        <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]/60">
          MVP: public repos · TypeScript / JavaScript
        </p>
      )}
    </form>
  );
}
