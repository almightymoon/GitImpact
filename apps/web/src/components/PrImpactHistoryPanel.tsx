"use client";

import { useEffect, useMemo, useState } from "react";

interface HistoryRow {
  id: string;
  kind: string;
  commitSha?: string;
  headSha?: string;
  createdAt: string;
  impact?: {
    directCount: number;
    indirectCount: number;
    complexityScore?: number;
    impactLevel?: string;
  };
}

export function PrImpactHistoryPanel({
  owner,
  repo,
  prNumber,
}: {
  owner: string;
  repo: string;
  prNumber: number;
}) {
  const [entries, setEntries] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/history?kind=pull_request&pr=${prNumber}&limit=20`,
        );
        if (!res.ok) {
          if (!cancelled) setError("History unavailable");
          return;
        }
        const json = (await res.json()) as { entries?: HistoryRow[] };
        if (!cancelled) setEntries(json.entries ?? []);
      } catch {
        if (!cancelled) setError("History unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, prNumber]);

  const chart = useMemo(() => {
    const withImpact = [...entries]
      .filter((e) => e.impact)
      .reverse(); // oldest → newest for sparkline
    if (withImpact.length === 0) return null;
    const values = withImpact.map(
      (e) => (e.impact!.directCount ?? 0) + (e.impact!.indirectCount ?? 0),
    );
    const max = Math.max(...values, 1);
    const latest = withImpact[withImpact.length - 1]!;
    const earliest = withImpact[0]!;
    const latestTotal =
      (latest.impact?.directCount ?? 0) + (latest.impact?.indirectCount ?? 0);
    const earliestTotal =
      (earliest.impact?.directCount ?? 0) + (earliest.impact?.indirectCount ?? 0);
    const delta = latestTotal - earliestTotal;
    return { withImpact, values, max, delta, latest, earliest };
  }, [entries]);

  if (error) {
    return (
      <section className="rounded-2xl border border-[var(--line)] p-4">
        <h3 className="font-display text-base font-semibold">PR impact history</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{error}</p>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] p-4">
        <h3 className="font-display text-base font-semibold">PR impact history</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          No prior snapshots for this PR yet. Re-analyze as the head moves to track whether blast
          radius is increasing or decreasing.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] p-4">
      <h3 className="font-display text-base font-semibold">PR impact history</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Blast radius across analyzed head SHAs for PR #{prNumber}.
      </p>

      {chart ? (
        <>
          <div className="mt-4 flex h-16 items-end gap-1">
            {chart.values.map((v, i) => (
              <div
                key={`${chart.withImpact[i]!.id}-bar`}
                title={`${(chart.withImpact[i]!.headSha ?? chart.withImpact[i]!.commitSha ?? "").slice(0, 7)}: ${v}`}
                className="min-w-[6px] flex-1 rounded-t bg-[var(--teal)]/80"
                style={{ height: `${Math.max(8, Math.round((100 * v) / chart.max))}%` }}
              />
            ))}
          </div>
          <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]">
            Trend (first → latest):{" "}
            <span
              className={
                chart.delta > 0
                  ? "text-[var(--critical)]"
                  : chart.delta < 0
                    ? "text-[var(--medium)]"
                    : ""
              }
            >
              {chart.delta > 0 ? "increased" : chart.delta < 0 ? "decreased" : "unchanged"}
              {chart.delta !== 0 ? ` (${chart.delta > 0 ? "+" : ""}${chart.delta} dependents)` : ""}
            </span>
            {chart.latest.impact?.impactLevel
              ? ` · latest level ${chart.latest.impact.impactLevel}`
              : ""}
          </p>
        </>
      ) : null}

      <ul className="mt-3 space-y-1.5">
        {entries.slice(0, 8).map((entry) => {
          const sha = (entry.headSha ?? entry.commitSha ?? "—").slice(0, 7);
          const total =
            (entry.impact?.directCount ?? 0) + (entry.impact?.indirectCount ?? 0);
          return (
            <li
              key={entry.id}
              className="flex justify-between gap-2 rounded-xl bg-[var(--fog)]/60 px-3 py-2 font-mono text-[11px]"
            >
              <span>
                {entry.createdAt.slice(0, 19).replace("T", " ")} · {sha}
              </span>
              <span className="text-[var(--ink-soft)]">
                blast {entry.impact?.directCount ?? 0}/{entry.impact?.indirectCount ?? 0}
                {entry.impact?.complexityScore != null
                  ? ` · ${entry.impact.complexityScore}`
                  : ""}
                {total > 0 ? ` · Σ${total}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
