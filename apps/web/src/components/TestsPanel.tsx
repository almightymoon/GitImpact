"use client";

import type {
  ChangeRecord,
  GraphNode,
  ImpactReport,
  RepositoryType,
} from "@gitimpact/shared";
import { formatSemanticEventDetail } from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";
import { HelpTip, HELP } from "@/components/HelpTip";

export function TestsPanel({
  relatedTests,
  missingTests,
  changedNodes,
  changes,
  impact,
  repositoryType,
  onSelect,
  onOpenGraph,
}: {
  relatedTests: GraphNode[];
  missingTests: GraphNode[];
  changedNodes: GraphNode[];
  changes?: ChangeRecord[];
  impact?: ImpactReport | null;
  repositoryType?: RepositoryType;
  onSelect?: (id: string) => void;
  onOpenGraph?: () => void;
}) {
  const changedName = changedNodes[0]?.name ?? "a changed symbol";

  const potentialBreakages = (changes ?? [])
    .flatMap((change) =>
      (change.semanticEvents ?? [])
        .filter((event) =>
          [
            "PARAMETER_ADDED",
            "PARAMETER_REMOVED",
            "RETURN_TYPE_CHANGED",
            "SIGNATURE_CHANGED",
          ].includes(event.kind),
        )
        .map((event) => ({ change, event })),
    )
    .flatMap(({ event }) => {
      const formatted = formatSemanticEventDetail(event);
      const callers = (impact?.directImpact ?? []).slice(0, 8);
      if (callers.length === 0) {
        return [
          {
            title: "Potential interface mismatch",
            subject: formatted.subject,
            detail: formatted.detail,
            why: `Semantic diff detected ${formatted.label.toLowerCase()} on ${formatted.subject}. Review callers manually — dependents were not confidently listed in this view.`,
            callerId: undefined as string | undefined,
          },
        ];
      }
      return callers.map((caller) => ({
        title: "Potential interface mismatch",
        subject: formatted.subject,
        detail: formatted.detail,
        why: `The caller ${caller.node.name} depends on the changed method signature (${formatted.label.toLowerCase()}${
          formatted.detail ? `: ${formatted.detail}` : ""
        }).`,
        callerId: caller.node.id,
      }));
    });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Tests</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Relevant tests, potential test gaps, and possible interface mismatches derived from static
          relationships.
        </p>
      </div>

      <section>
        <h3 className="font-display text-lg font-semibold">Relevant tests</h3>
        {relatedTests.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No related tests were identified"
              message={
                repositoryType === "INFRASTRUCTURE" ||
                repositoryType === "GITOPS" ||
                repositoryType === "DEVOPS"
                  ? "Infrastructure / GitOps repositories often have few application unit tests mapped to symbols."
                  : "GitImpact did not find test nodes connected to the current selection or PR impact set."
              }
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {relatedTests.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="w-full rounded-xl bg-[var(--fog)]/70 px-3 py-2 text-left hover:bg-[var(--fog)]"
                  onClick={() => {
                    onSelect?.(node.id);
                    onOpenGraph?.();
                  }}
                >
                  <span className="block text-sm font-medium">{node.name}</span>
                  <span className="font-mono text-[10px] text-[var(--ink-soft)]">
                    {node.file}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                    Why listed: statically related to impacted symbols in this analysis.
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-display text-lg font-semibold">
          <HelpTip label="Potential test gaps" text={HELP.potentialTestGap} />
        </h3>
        {missingTests.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No potential test gaps flagged"
              message="For the current impact set, GitImpact did not find changed symbols lacking an associated test relationship."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {missingTests.map((node) => (
              <li
                key={node.id}
                className="rounded-2xl border border-[var(--high)]/35 bg-[#fff7ed] p-4"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--high)]">
                  Potential test gap
                </p>
                <button
                  type="button"
                  className="mt-1 text-left font-display text-base font-semibold hover:text-[var(--teal)]"
                  onClick={() => {
                    onSelect?.(node.id);
                    onOpenGraph?.();
                  }}
                >
                  {node.name}
                </button>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                  Why flagged: this symbol may be affected by changes to{" "}
                  <span className="font-medium text-[var(--ink)]">{changedName}</span>, but
                  GitImpact did not find a directly associated test covering that dependency.
                </p>
                <p className="mt-2 font-mono text-[10px] text-[var(--ink-soft)]">{node.file}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-display text-lg font-semibold">Potential breakages</h3>
        {potentialBreakages.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No deterministic interface mismatches flagged"
              message="Potential breakages appear when semantic diff detects signature changes (for example a parameter added) with callers that depend on the prior signature."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {potentialBreakages.slice(0, 12).map((item, index) => (
              <li
                key={`${item.subject}-${item.callerId ?? index}`}
                className="rounded-2xl border border-[var(--warning)]/35 bg-[#fffbeb] p-4"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--warning)]">
                  {item.title}
                </p>
                <p className="mt-1 font-display text-base font-semibold">{item.subject}</p>
                {item.detail ? (
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{item.detail}</p>
                ) : null}
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{item.why}</p>
                {item.callerId ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-[var(--teal)] hover:underline"
                    onClick={() => {
                      onSelect?.(item.callerId!);
                      onOpenGraph?.();
                    }}
                  >
                    Open caller in Graph
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
