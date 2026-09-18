"use client";

import { useEffect, useState } from "react";

interface HistoryRow {
  id: string;
  kind: string;
  commitSha?: string;
  headSha?: string;
  prNumber?: number;
  createdAt: string;
  typeLabel?: string;
  frameworks?: string[];
  summary?: { apiRoutes?: number; files?: number };
  impact?: {
    directCount: number;
    indirectCount: number;
    complexityScore?: number;
    impactLevel?: string;
  };
}

export function AnalysisHistoryPanel({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const [entries, setEntries] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compareFrom, setCompareFrom] = useState<string>("");
  const [compareTo, setCompareTo] = useState<string>("");
  const [diffNarrative, setDiffNarrative] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/history?limit=12`,
        );
        if (!res.ok) {
          if (!cancelled) setError("History unavailable");
          return;
        }
        const json = (await res.json()) as { entries?: HistoryRow[] };
        if (!cancelled) {
          setEntries(json.entries ?? []);
          if ((json.entries?.length ?? 0) >= 2) {
            setCompareTo(json.entries![0]!.id);
            setCompareFrom(json.entries![1]!.id);
          }
        }
      } catch {
        if (!cancelled) setError("History unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  async function runCompare() {
    if (!compareFrom || !compareTo) return;
    setDiffNarrative(null);
    const res = await fetch(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/history?from=${encodeURIComponent(compareFrom)}&to=${encodeURIComponent(compareTo)}`,
    );
    if (!res.ok) {
      setDiffNarrative(["Compare failed — entries may have expired."]);
      return;
    }
    const json = (await res.json()) as { diff?: { narrative?: string[]; blastRadius?: { verdict: string } } };
    setDiffNarrative(json.diff?.narrative ?? ["No differences recorded."]);
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
        <h3 className="font-display text-lg font-semibold">Analysis history</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">Loading…</p>
      </section>
    );
  }

  if (error || entries.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
        <h3 className="font-display text-lg font-semibold">Analysis history</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {error ??
            "No prior snapshots yet. Re-analyze this repository (with a database) to start recording history for architecture compare."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <h3 className="font-display text-lg font-semibold">Analysis history</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Snapshots of architecture and blast-radius metrics across commits.
      </p>
      <ul className="mt-4 space-y-2">
        {entries.map((entry) => {
          const sha = (entry.commitSha ?? entry.headSha ?? "—").slice(0, 7);
          const kind =
            entry.kind === "pull_request" ? `PR #${entry.prNumber}` : "repository";
          return (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-[var(--fog)]/60 px-3 py-2 font-mono text-xs"
            >
              <span>
                {entry.createdAt.slice(0, 19).replace("T", " ")} · {sha} · {kind}
              </span>
              <span className="text-[var(--ink-soft)]">
                {entry.typeLabel ?? "—"}
                {entry.summary?.apiRoutes != null
                  ? ` · ${entry.summary.apiRoutes} routes`
                  : ""}
                {entry.impact
                  ? ` · blast ${entry.impact.directCount}/${entry.impact.indirectCount}`
                  : ""}
              </span>
            </li>
          );
        })}
      </ul>

      {entries.length >= 2 ? (
        <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
            Compare snapshots
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-xs"
              value={compareFrom}
              onChange={(e) => setCompareFrom(e.target.value)}
            >
              {entries.map((e) => (
                <option key={`from-${e.id}`} value={e.id}>
                  From {(e.commitSha ?? e.headSha ?? e.id).slice(0, 7)}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-xs"
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
            >
              {entries.map((e) => (
                <option key={`to-${e.id}`} value={e.id}>
                  To {(e.commitSha ?? e.headSha ?? e.id).slice(0, 7)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--paper)]"
              onClick={() => void runCompare()}
            >
              Compare
            </button>
          </div>
          {diffNarrative ? (
            <ul className="space-y-1 text-sm text-[var(--ink-soft)]">
              {diffNarrative.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
