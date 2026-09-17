"use client";

import Link from "next/link";
import type { OpenPullRequestSummary, RepositoryIntelligence } from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";

function formatDate(value?: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

export function PullRequestsPanel({
  repository,
  intelligence,
  onAnalyzePr,
}: {
  repository: { owner: string; name: string };
  intelligence?: RepositoryIntelligence;
  onAnalyzePr?: (pr: OpenPullRequestSummary) => void;
}) {
  const prs = intelligence?.openPullRequests ?? [];

  if (prs.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No open pull requests"
          message="There are no open PRs to analyze right now. When PRs are opened, GitImpact can show potential impact before merge."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Pull Requests</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Open PRs for {repository.owner}/{repository.name}. Click a PR to see potential impact if
          merged.
        </p>
      </div>
      <ul className="space-y-3">
        {prs.map((pr) => (
          <li
            key={pr.number}
            className="rounded-2xl border border-[var(--line)] bg-white/80 p-4 transition hover:border-[var(--teal)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[var(--teal)]">#{pr.number}</span>
                  {pr.draft ? (
                    <span className="rounded-full bg-[var(--fog)] px-2 py-0.5 font-mono text-[10px]">
                      draft
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-1 font-display text-lg font-semibold">{pr.title}</h3>
                <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">
                  {pr.author ? `${pr.author} · ` : ""}
                  {pr.baseBranch} ← {pr.headBranch}
                  {pr.updatedAt ? ` · updated ${formatDate(pr.updatedAt)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href={`/${repository.owner}/${repository.name}/pull/${pr.number}`}
                  onClick={() => onAnalyzePr?.(pr)}
                  className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--ink-soft)]"
                >
                  View impact
                </Link>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--teal)]"
                >
                  GitHub
                </a>
              </div>
            </div>
            {(pr.complexityScore != null ||
              pr.changedSymbols != null ||
              pr.affectedApis != null) && (
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {pr.complexityScore != null ? (
                  <Metric label="Complexity" value={`${pr.complexityScore}/100`} />
                ) : null}
                {pr.changedSymbols != null ? (
                  <Metric label="Symbols" value={String(pr.changedSymbols)} />
                ) : null}
                {pr.affectedApis != null ? (
                  <Metric label="APIs" value={String(pr.affectedApis)} />
                ) : null}
                {pr.relevantTests != null ? (
                  <Metric label="Tests" value={String(pr.relevantTests)} />
                ) : null}
                {pr.potentialTestGaps != null ? (
                  <Metric label="Test gaps" value={String(pr.potentialTestGaps)} />
                ) : null}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--fog)]/70 px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
        {label}
      </dt>
      <dd className="font-mono text-sm font-medium">{value}</dd>
    </div>
  );
}
