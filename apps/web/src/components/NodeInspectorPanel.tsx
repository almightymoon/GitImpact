"use client";

import { useMemo, useState } from "react";
import type {
  GraphNode,
  ImpactPathStep,
  ImpactReport,
} from "@gitimpact/shared";
import {
  formatImpactSummaryMarkdown,
  formatRelationshipChain,
  relationLabel,
} from "@gitimpact/shared";
import { HelpTip, HELP } from "@/components/HelpTip";

type InspectorRelation = {
  node: GraphNode;
  edgeType: string;
  confidence: string;
  direction: "outgoing" | "incoming";
};

export function NodeInspectorPanel({
  selectedNode,
  impact,
  whyPath,
  whyTarget,
  pending,
  analysisUrl,
  relations,
  onSelect,
  onShowWhy,
  onClear,
  onCloseWhy,
}: {
  selectedNode?: GraphNode | null;
  impact?: ImpactReport | null;
  whyPath?: ImpactPathStep[] | null;
  whyTarget?: string | null;
  pending?: boolean;
  analysisUrl?: string;
  relations?: {
    directDependencies: InspectorRelation[];
    directDependents: InspectorRelation[];
  } | null;
  onSelect: (id: string) => void;
  onShowWhy: (id: string) => void;
  onClear: () => void;
  onCloseWhy: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const summaryText = useMemo(() => {
    if (!selectedNode || !impact) return "";
    const paths =
      whyPath && whyPath.length > 0
        ? [{ steps: whyPath }]
        : impact.directImpact.slice(0, 5).map((item) => ({
            steps: item.relationshipPath.map((id, index) => ({
              nodeId: id,
              name: id.split(":").pop() ?? id,
              file: "",
              type: "FUNCTION" as const,
              edgeType: index > 0 ? ("CALLS" as const) : undefined,
            })),
          }));
    return formatImpactSummaryMarkdown({
      componentName: selectedNode.name,
      impact,
      paths: paths.filter((p) => p.steps.length > 0),
      analysisUrl,
    });
  }, [selectedNode, impact, whyPath, analysisUrl]);

  async function copySummary() {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="min-w-0 space-y-4 overflow-hidden">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold">
            {selectedNode ? "Relationship inspector" : "Change impact"}
          </h3>
          {selectedNode ? (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)] hover:border-[var(--teal)]"
            >
              Deselect
            </button>
          ) : null}
        </div>

        {!selectedNode ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Select a node to inspect relationships and{" "}
            <HelpTip label="blast radius" text={HELP.blastRadius} />.
          </p>
        ) : pending ? (
          <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]">Computing…</p>
        ) : (
          <div className="mt-3 min-w-0 space-y-3 overflow-hidden">
            <div>
              <p className="font-display text-lg font-semibold">{selectedNode.name}</p>
              <p className="font-mono text-[11px] text-[var(--ink-soft)]">
                {selectedNode.type}
                {selectedNode.startLine
                  ? ` · L${selectedNode.startLine}${
                      selectedNode.endLine ? `–${selectedNode.endLine}` : ""
                    }`
                  : ""}
              </p>
              <p className="mt-1 truncate font-mono text-[10px] text-[var(--ink-soft)]/70">
                {selectedNode.file}
              </p>
            </div>

            {impact ? (
              <>
                <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
                  What could be affected if this component changes?
                </p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Metric
                    label={<HelpTip label="Direct" text={HELP.directDependency} />}
                    value={impact.directImpact.length}
                  />
                  <Metric
                    label={<HelpTip label="Indirect" text={HELP.indirectDependency} />}
                    value={impact.indirectImpact.length}
                  />
                  <Metric label="Affected APIs" value={impact.affectedApis.length} />
                  <Metric label="Affected tests" value={impact.relatedTests.length} />
                  <Metric
                    label={<HelpTip label="Test gaps" text={HELP.potentialTestGap} />}
                    value={impact.missingTests.length}
                  />
                  <Metric
                    label={<HelpTip label="Complexity" text={HELP.changeComplexity} />}
                    value={impact.complexityScore}
                  />
                </dl>
                <button
                  type="button"
                  onClick={() => void copySummary()}
                  className="w-full rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium hover:border-[var(--teal)]"
                >
                  {copied ? "Copied" : "Copy Impact Summary"}
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {selectedNode && relations ? (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          <h3 className="font-display text-base font-semibold">Why connected</h3>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            Deterministic edges only — no invented runtime data flow.
          </p>
          <RelationGroup
            title="Direct dependencies"
            items={relations.directDependencies}
            onSelect={onSelect}
          />
          <RelationGroup
            title="Direct dependents"
            items={relations.directDependents}
            onSelect={onSelect}
          />
        </div>
      ) : null}

      {impact && (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          <h3 className="font-display text-base font-semibold">
            <HelpTip label="Blast radius" text={HELP.blastRadius} />
          </h3>
          <ul className="mt-3 max-h-[280px] space-y-2 overflow-x-hidden overflow-y-auto">
            {[...impact.directImpact, ...impact.indirectImpact].slice(0, 40).map((item) => (
              <li key={item.node.id} className="min-w-0 text-xs">
                <button
                  type="button"
                  className="w-full overflow-hidden text-left hover:text-[var(--teal)]"
                  onClick={() => onSelect(item.node.id)}
                >
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                    {item.node.name}
                  </span>
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--ink-soft)]/70">
                    d{item.depth} · {item.confidence} · {item.node.type}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onShowWhy(item.node.id)}
                  className="mt-1 text-[10px] text-[var(--teal)] hover:underline"
                >
                  Show impact path
                </button>
              </li>
            ))}
          </ul>
          {impact.directImpact.length + impact.indirectImpact.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              No downstream dependency impact was detected.
            </p>
          ) : null}
        </div>
      )}

      {whyPath && whyPath.length > 0 ? (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--teal)]/40 bg-white/80 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-base font-semibold">Potential impact path</h3>
            <button
              type="button"
              onClick={onCloseWhy}
              className="text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              Close
            </button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-[var(--ink-soft)]/70">
            {formatRelationshipChain(whyPath)}
          </p>
          <ol className="mt-3 space-y-2">
            {whyPath.map((step, index) => (
              <li key={`${step.nodeId}-${index}`} className="min-w-0 text-xs">
                {index > 0 && step.edgeType ? (
                  <p className="mb-1 font-mono text-[10px] text-[var(--teal)]">
                    ↑ {relationLabel(step.edgeType).toUpperCase()}
                  </p>
                ) : (
                  <p className="mb-1 font-mono text-[10px] text-[var(--critical)]">change</p>
                )}
                <button
                  type="button"
                  className={`w-full overflow-hidden rounded-lg px-2 py-1.5 text-left hover:bg-[var(--fog)] ${
                    step.nodeId === whyTarget ? "bg-[var(--fog)]" : ""
                  }`}
                  onClick={() => onSelect(step.nodeId)}
                >
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                    {step.name}
                  </span>
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--ink-soft)]/70">
                    {step.type} · {step.file}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

function RelationGroup({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: InspectorRelation[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--ink-soft)]">None</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-2 overflow-auto">
          {items.slice(0, 20).map((item) => (
            <li key={`${item.direction}-${item.node.id}-${item.edgeType}`}>
              <button
                type="button"
                onClick={() => onSelect(item.node.id)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--fog)]"
              >
                <span className="block font-medium">{item.node.name}</span>
                <span className="font-mono text-[10px] text-[var(--teal)]">
                  {relationLabel(item.edgeType).toUpperCase()}
                  {" · "}
                  <HelpTip label={item.confidence} text={HELP.confidence} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: React.ReactNode;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-[var(--fog)]/70 px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
        {label}
      </dt>
      <dd className="font-display text-lg font-semibold">{value}</dd>
    </div>
  );
}
