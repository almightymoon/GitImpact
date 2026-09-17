"use client";

import { useMemo, useState } from "react";
import type {
  CheckCategory,
  CheckFinding,
  ChecksReport,
} from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";

const CATEGORIES: Array<{ id: CheckCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "security", label: "Security" },
  { id: "quality", label: "Code Quality" },
  { id: "dependencies", label: "Dependencies" },
  { id: "cicd", label: "CI/CD" },
  { id: "infrastructure", label: "Infrastructure" },
];

const severityColor: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--warning)",
  low: "var(--medium)",
  info: "var(--neutral)",
};

export function ChecksPanel({
  checks,
  onSelectFile,
  onOpenGraph,
}: {
  checks?: ChecksReport;
  onSelectFile?: (filePath: string) => void;
  onOpenGraph?: () => void;
}) {
  const [category, setCategory] = useState<CheckCategory | "all">("all");

  const findings = useMemo(() => {
    const all = checks?.findings ?? [];
    if (category === "all") return all;
    return all.filter((f) => f.category === category);
  }, [checks, category]);

  if (!checks) {
    return (
      <div className="p-6">
        <EmptyState
          title="Checks not available"
          message="Re-run analysis to generate deterministic security, quality, and CI/CD findings."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Checks</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-soft)]">
          Deterministic code quality, security, dependency, and CI/CD signals — not AI review, and not
          a guarantee that something will break.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Findings", checks.totals.findings],
            ["Critical", checks.totals.critical],
            ["High", checks.totals.high],
            ["Medium", checks.totals.medium],
            ["Low", checks.totals.low],
            ["Info", checks.totals.info],
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

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              category === item.id
                ? "bg-[var(--ink)] text-white"
                : "border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--teal)]"
            }`}
          >
            {item.label}
            {item.id !== "all"
              ? ` (${checks.summaries.find((s) => s.category === item.id)?.findingCount ?? 0})`
              : ""}
          </button>
        ))}
      </div>

      {checks.configApplied &&
      (checks.configApplied.suppressed > 0 || checks.configApplied.severityOverrides > 0) ? (
        <p className="rounded-xl border border-[var(--line)] bg-[var(--fog)]/50 px-3 py-2 font-mono text-[11px] text-[var(--ink-soft)]">
          Config {checks.configApplied.path ?? ".gitimpact.yml"}:{" "}
          {checks.configApplied.suppressed > 0
            ? `${checks.configApplied.suppressed} suppressed`
            : null}
          {checks.configApplied.suppressed > 0 && checks.configApplied.severityOverrides > 0
            ? " · "
            : null}
          {checks.configApplied.severityOverrides > 0
            ? `${checks.configApplied.severityOverrides} severity override${
                checks.configApplied.severityOverrides === 1 ? "" : "s"
              }`
            : null}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {checks.summaries
          .filter((s) => category === "all" || s.category === category)
          .map((summary) => (
            <section
              key={summary.category}
              className="rounded-2xl border border-[var(--line)] bg-white/70 p-4"
            >
              <h3 className="font-display text-base font-semibold">{summary.label}</h3>
              <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">
                {summary.findingCount} finding{summary.findingCount === 1 ? "" : "s"}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--ink-soft)]">
                {summary.highlights.length === 0 ? (
                  <li>No findings in this category.</li>
                ) : (
                  summary.highlights.map((h) => <li key={h}>• {h}</li>)
                )}
              </ul>
            </section>
          ))}
      </div>

      {findings.length === 0 ? (
        <EmptyState
          title="No findings in this view"
          message="Nothing matched the selected category. Try All, or re-analyze after making changes."
        />
      ) : (
        <ul className="space-y-3">
          {findings.slice(0, 100).map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              onSelectFile={onSelectFile}
              onOpenGraph={onOpenGraph}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  onSelectFile,
  onOpenGraph,
}: {
  finding: CheckFinding;
  onSelectFile?: (filePath: string) => void;
  onOpenGraph?: () => void;
}) {
  return (
    <li className="rounded-2xl border border-[var(--line)] bg-white/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-white"
          style={{ background: severityColor[finding.severity] ?? severityColor.info }}
        >
          {finding.severity}
        </span>
        <span className="rounded-full bg-[var(--fog)] px-2.5 py-0.5 font-mono text-[10px]">
          {finding.category}
        </span>
        <span className="font-mono text-[10px] text-[var(--ink-soft)]">
          {finding.confidence} confidence
        </span>
      </div>
      <h4 className="mt-2 font-display text-base font-semibold">{finding.title}</h4>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">{finding.message}</p>
      {finding.evidence ? (
        <pre className="mt-2 overflow-auto rounded-lg bg-[var(--fog)]/80 p-2 font-mono text-[11px]">
          {finding.evidence}
        </pre>
      ) : null}
      {(finding.whyItMatters || finding.remediation) && (
        <dl className="mt-3 space-y-2 rounded-xl border border-[var(--line)]/80 bg-[var(--fog)]/40 px-3 py-2.5">
          {finding.whyItMatters ? (
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
                Why this matters
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-[var(--ink-soft)]">
                {finding.whyItMatters}
              </dd>
            </div>
          ) : null}
          {finding.remediation ? (
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
                Suggested action
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-[var(--ink-soft)]">
                {finding.remediation}
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-[var(--fog)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--ink-soft)]">
          {finding.ruleId}
        </span>
        {finding.file ? (
          <button
            type="button"
            onClick={() => {
              onSelectFile?.(finding.file!);
              onOpenGraph?.();
            }}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--teal)]"
          >
            {finding.file}
            {finding.startLine ? `:${finding.startLine}` : ""}
          </button>
        ) : null}
        {finding.symbolName ? (
          <span className="rounded-full bg-[var(--fog)] px-3 py-1 font-mono text-[11px]">
            {finding.symbolName}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function PrQualityReport({ checks }: { checks?: ChecksReport }) {
  if (!checks) return null;
  const { prHighlights } = checks;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white/80 p-5">
      <h3 className="font-display text-lg font-semibold">GitImpact PR Analysis</h3>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        Combined pre-merge signals from impact, quality, security, and CI/CD — informational only.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {prHighlights.changeImpact ? (
          <HighlightBlock title="Change Impact" items={prHighlights.changeImpact} />
        ) : null}
        <HighlightBlock title="Code Quality" items={prHighlights.codeQuality} />
        <HighlightBlock title="Security" items={prHighlights.security} />
        <HighlightBlock title="CI / Deployment" items={prHighlights.cicd} />
      </div>
    </section>
  );
}

function HighlightBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="font-display text-sm font-semibold">{title}</h4>
      <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
