"use client";

import type {
  ChangeRecord,
  GraphNode,
  ImpactReport,
  PullRequestImpactOverview,
} from "@gitimpact/shared";

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
}: {
  overview: PullRequestImpactOverview;
  impact?: ImpactReport | null;
  onSelectNode?: (id: string) => void;
}) {
  const metrics: Array<[string, number]> = [
    ["Files Changed", overview.filesChanged],
    ["Functions Modified", overview.functionsModified],
    ["Direct Dependencies", overview.directDependencies],
    ["Indirect Dependencies", overview.indirectDependencies],
    ["API Routes Affected", overview.apiRoutesAffected],
    ["Database Models", overview.databaseModelsAffected],
    ["Frontend Components", overview.frontendComponentsAffected],
    ["Relevant Tests", overview.relevantTests],
    ["Potential Missing Tests", overview.potentialMissingTests],
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="rounded-full px-3 py-1 font-mono text-xs font-medium text-white"
          style={{ background: levelColor[overview.impactLevel] }}
        >
          Impact Level: {overview.impactLevel}
        </span>
        <span className="font-mono text-xs text-[var(--ink-soft)]">
          Complexity {overview.complexityScore}/100
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
            {(
              Object.entries(overview.changeBreakdown) as Array<[string, number]>
            ).map(([type, count]) => (
              <li key={type} className="flex justify-between font-mono text-xs">
                <span>{type}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-[var(--line)] p-4">
          <h3 className="font-display text-base font-semibold">Changed files</h3>
          <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
            {overview.changedFiles.map((file) => (
              <li key={file} className="truncate text-[var(--ink-soft)]">
                {file}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {impact && impact.missingTests.length > 0 && (
        <div className="rounded-2xl border border-[var(--high)]/40 bg-[#fff7ed] p-4">
          <h3 className="font-display text-base font-semibold text-[var(--high)]">
            Potential test gaps
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
    </div>
  );
}

export function PullRequestChangesPanel({
  changes,
  onSelectFile,
}: {
  changes: ChangeRecord[];
  onSelectFile?: (filePath: string) => void;
}) {
  return (
    <div className="p-6">
      <h3 className="font-display text-lg font-semibold">Changes</h3>
      <ul className="mt-4 divide-y divide-[var(--line)]">
        {changes.map((change) => (
          <li key={change.filePath} className="flex items-start justify-between gap-4 py-3">
            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => onSelectFile?.(change.filePath)}
            >
              <p className="truncate font-mono text-sm">{change.filePath}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">
                {change.status ?? "modified"}
                {change.symbols?.length
                  ? ` · ${change.symbols.join(", ")}`
                  : change.symbolName
                    ? ` · ${change.symbolName}`
                    : ""}
              </p>
            </button>
            <span className="shrink-0 rounded-full bg-[var(--fog)] px-2 py-1 font-mono text-[10px]">
              {change.changeType}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PullRequestNodeListPanel({
  title,
  empty,
  nodes,
  onSelect,
}: {
  title: string;
  empty: string;
  nodes: GraphNode[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="p-6">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {nodes.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ink-soft)]">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {nodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="w-full rounded-xl bg-[var(--fog)]/70 px-3 py-2 text-left hover:bg-[var(--fog)]"
                onClick={() => onSelect?.(node.id)}
              >
                <span className="block text-sm font-medium">{node.name}</span>
                <span className="font-mono text-[10px] text-[var(--ink-soft)]">
                  {node.type} · {node.file}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
