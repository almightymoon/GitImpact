"use client";

import type {
  ImpactReport,
  PullRequestImpactOverview,
} from "@gitimpact/shared";
import { humanizeChangeCategory } from "@gitimpact/shared";
import { HelpTip, HELP } from "@/components/HelpTip";
import { EmptyState } from "@/components/EmptyState";

const levelColor: Record<PullRequestImpactOverview["impactLevel"], string> = {
  Low: "var(--medium)",
  Moderate: "var(--warning)",
  Elevated: "var(--high)",
  Critical: "var(--critical)",
};

export function PullRequestOverviewPanel({
  overview,
  impact,
  onSelectNode,
  onOpenGraph,
  onOpenTests,
  onOpenApis,
}: {
  overview: PullRequestImpactOverview;
  impact?: ImpactReport | null;
  onSelectNode?: (id: string) => void;
  onOpenGraph?: () => void;
  onOpenTests?: () => void;
  onOpenApis?: () => void;
}) {
  const metrics: Array<[string, number]> = [
    ["Files changed", overview.filesChanged],
    ["Changed symbols", overview.functionsModified],
    ["Direct dependents", overview.directDependencies],
    ["Indirect dependents", overview.indirectDependencies],
    ["Affected APIs", overview.apiRoutesAffected],
    ["Database models", overview.databaseModelsAffected],
    ["Frontend components", overview.frontendComponentsAffected],
    ["Related tests", overview.relevantTests],
    ["Potential test gaps", overview.potentialMissingTests],
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
          Potential impact if merged
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold">
          What may be affected by this pull request
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--ink-soft)]">
          These findings describe possible dependency impact from static analysis. They do not claim
          that the PR will break production.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span
          className="rounded-full px-3 py-1 font-mono text-xs font-medium text-white"
          style={{ background: levelColor[overview.impactLevel] }}
        >
          Impact context: {overview.impactLevel}
        </span>
        <span className="font-mono text-xs text-[var(--ink-soft)]">
          <HelpTip label="Change complexity" text={HELP.changeComplexity} />{" "}
          {overview.complexityScore}/100
        </span>
      </div>

      <p className="max-w-3xl text-base leading-relaxed text-[var(--ink-soft)]">
        {overview.summary}
      </p>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-[var(--fog)]/80 px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
              {label}
            </dt>
            <dd className="mt-1 font-display text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--line)] p-4">
          <h3 className="font-display text-base font-semibold">Change types</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(Object.entries(overview.changeBreakdown) as Array<[string, number]>).map(
              ([type, count]) => (
                <li key={type} className="flex justify-between font-mono text-xs">
                  <span>{humanizeChangeCategory(type)}</span>
                  <span>{count}</span>
                </li>
              ),
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-[var(--line)] p-4">
          <h3 className="font-display text-base font-semibold">Changed files</h3>
          {overview.changedFiles.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">No changed files listed.</p>
          ) : (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
              {overview.changedFiles.map((file) => (
                <li key={file}>
                  <button
                    type="button"
                    className="truncate text-[var(--ink-soft)] hover:text-[var(--teal)]"
                    onClick={() => onSelectNode?.(`FILE:${file}`)}
                  >
                    {file}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {impact && impact.directImpact.length + impact.indirectImpact.length > 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          <h3 className="font-display text-base font-semibold">
            <HelpTip label="Blast radius paths" text={HELP.blastRadius} />
          </h3>
          <ul className="mt-3 space-y-2">
            {[...impact.directImpact, ...impact.indirectImpact].slice(0, 10).map((item) => (
              <li key={item.node.id} className="text-sm">
                <button
                  type="button"
                  className="text-left hover:text-[var(--teal)]"
                  onClick={() => onSelectNode?.(item.node.id)}
                >
                  <span className="font-medium">{item.node.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-[var(--ink-soft)]">
                    may affect · d{item.depth} · {item.confidence}
                  </span>
                </button>
                {item.relationshipPath.length > 1 ? (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--ink-soft)]/70">
                    {item.relationshipPath
                      .map((id) => id.split(":").pop())
                      .filter(Boolean)
                      .join(" → ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState
          title="No downstream dependency impact was detected"
          message="Changed symbols were mapped, but GitImpact did not find dependents within the configured depth."
        />
      )}

      {impact && impact.missingTests.length > 0 && (
        <div className="rounded-2xl border border-[var(--high)]/40 bg-[#fff7ed] p-4">
          <h3 className="font-display text-base font-semibold text-[var(--high)]">
            <HelpTip label="Potential test gaps" text={HELP.potentialTestGap} />
          </h3>
          <ul className="mt-3 space-y-2">
            {impact.missingTests.slice(0, 12).map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="text-left text-sm hover:text-[var(--teal)]"
                  onClick={() => onSelectNode?.(node.id)}
                >
                  <span className="font-medium">{node.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-[var(--ink-soft)]">
                    {node.file}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenGraph}
          className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white"
        >
          Open Graph
        </button>
        <button
          type="button"
          onClick={onOpenTests}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
        >
          View Tests
        </button>
        <button
          type="button"
          onClick={onOpenApis}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
        >
          View APIs
        </button>
      </div>
    </div>
  );
}
