"use client";

import { useState } from "react";
import type {
  AnalysisSummary,
  RepositoryIntelligence,
} from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";

export function RepoOverviewPanel({
  summary,
  repository,
  intelligence,
  onOpenGraph,
  onOpenStructure,
  onOpenPrs,
  onOpenApis,
  onOpenModule,
}: {
  summary: AnalysisSummary;
  repository: { owner: string; name: string; defaultBranch: string; url: string };
  intelligence?: RepositoryIntelligence;
  onOpenGraph: () => void;
  onOpenStructure: () => void;
  onOpenPrs: () => void;
  onOpenApis: () => void;
  onOpenModule?: (path: string) => void;
}) {
  const [showFullReadme, setShowFullReadme] = useState(false);
  const readme = intelligence?.readme;
  const health = intelligence?.analysisHealth;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
            About this repository
          </p>
          <h2 className="mt-1 font-display text-3xl font-semibold">
            {repository.owner}/{repository.name}
          </h2>
          {intelligence?.typeLabel ? (
            <p className="mt-2 inline-flex rounded-full bg-[var(--fog)] px-3 py-1 font-mono text-xs">
              Repository type · {intelligence.typeLabel}
            </p>
          ) : null}
          <p className="mt-3 text-base leading-relaxed text-[var(--ink-soft)]">
            {readme?.description ??
              intelligence?.architectureSummary ??
              "Repository analysis is ready. Explore structure, relationships, PRs, tests, and APIs."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenGraph}
            className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ink-soft)]"
          >
            Open Graph
          </button>
          <button
            type="button"
            onClick={onOpenStructure}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
          >
            Open Structure
          </button>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Files", summary.files],
            ["Functions", summary.functions],
            ["Tests", summary.tests],
            ["API endpoints", summary.apiRoutes],
            ["Open PRs", intelligence?.openPrCount ?? 0],
            ["Dependencies", summary.dependencies],
            ["Classes", summary.classes],
            ["Frameworks", summary.frameworks.length],
          ] as Array<[string, number]>
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-[var(--fog)]/80 px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
              {label}
            </dt>
            <dd className="mt-1 font-display text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
          <h3 className="font-display text-lg font-semibold">Architecture summary</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            {intelligence?.architectureSummary ?? "Architecture details unavailable."}
          </p>
          {summary.languages.length > 0 ? (
            <ul className="mt-4 space-y-1 font-mono text-xs text-[var(--ink-soft)]">
              {summary.languages.map((lang) => (
                <li key={lang.language}>
                  {lang.language} · {Math.round(lang.percentage)}% · {lang.fileCount} files
                </li>
              ))}
            </ul>
          ) : null}
          {summary.frameworks.length > 0 ? (
            <p className="mt-3 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Frameworks
              </span>
              <span className="mt-1 block">{summary.frameworks.join(", ")}</span>
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
          <h3 className="font-display text-lg font-semibold">Important modules</h3>
          {(intelligence?.importantModules.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">No module groupings detected.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {intelligence!.importantModules.map((mod) => (
                <li key={mod.path}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenModule?.(mod.path);
                      onOpenStructure();
                    }}
                    className="w-full rounded-xl bg-[var(--fog)]/70 px-3 py-2 text-left hover:bg-[var(--fog)]"
                  >
                    <span className="block text-sm font-medium">{mod.label}</span>
                    <span className="font-mono text-[10px] text-[var(--ink-soft)]">
                      {mod.fileCount} files
                      {mod.role ? ` · ${mod.role}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {readme ? (
        <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">
              {readme.title ?? "README highlights"}
            </h3>
            {readme.rawAvailable ? (
              <button
                type="button"
                onClick={() => setShowFullReadme((v) => !v)}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--teal)]"
              >
                {showFullReadme ? "Hide full README" : "View full README"}
              </button>
            ) : null}
          </div>
          {readme.technologies.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {readme.technologies.map((tech) => (
                <span
                  key={tech}
                  className="rounded-full bg-[var(--fog)] px-2.5 py-1 font-mono text-[11px]"
                >
                  {tech}
                </span>
              ))}
            </div>
          ) : null}
          {readme.features.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm text-[var(--ink-soft)]">
              {readme.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
          ) : null}
          {readme.installation ? (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Install / run
              </p>
              <pre className="mt-2 overflow-auto rounded-xl bg-[var(--fog)]/80 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {readme.installation}
              </pre>
            </div>
          ) : null}
          {readme.architecture ? (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Architecture notes
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                {readme.architecture}
              </p>
            </div>
          ) : null}
          {showFullReadme && readme.rawExcerpt ? (
            <pre className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-[var(--line)] bg-[var(--mist)]/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {readme.rawExcerpt}
            </pre>
          ) : null}
        </section>
      ) : (
        <EmptyState
          title="No README found"
          message="GitImpact could not find a README.md to summarize. Architecture and module detection still come from the codebase."
        />
      )}

      {health ? (
        <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
          <h3 className="font-display text-lg font-semibold">Repository analysis</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Analysis completeness — why the graph or structure may look smaller than the full repo.
          </p>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ["Discovered", health.filesDiscovered],
                ["Parsed", health.filesParsed],
                ["Ignored", health.filesIgnored],
                ["Unsupported", health.filesUnsupported],
                ["Parse failures", health.parseFailures],
              ] as Array<[string, number]>
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[var(--fog)]/70 px-3 py-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
                  {label}
                </dt>
                <dd className="font-display text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {health.truncated ? (
            <p className="mt-3 text-xs text-[var(--warning)]">
              File cap reached ({health.maxFilesCap}). Raise GITIMPACT_MAX_FILES for larger analyses.
            </p>
          ) : null}
        </section>
      ) : null}

      {(intelligence?.infraSignals.length ?? 0) > 0 ? (
        <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
          <h3 className="font-display text-lg font-semibold">Infrastructure signals</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {intelligence!.infraSignals.slice(0, 12).map((signal) => (
              <li
                key={`${signal.kind}-${signal.path}`}
                className="rounded-xl bg-[var(--fog)]/70 px-3 py-2 text-sm"
              >
                <span className="font-medium">{signal.label}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--ink-soft)]">
                  {signal.path}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenPrs}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
        >
          View open PRs ({intelligence?.openPrCount ?? 0})
        </button>
        <button
          type="button"
          onClick={onOpenApis}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
        >
          View APIs ({summary.apiRoutes})
        </button>
      </div>
    </div>
  );
}
