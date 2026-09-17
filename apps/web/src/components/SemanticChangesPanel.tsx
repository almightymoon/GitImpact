"use client";

import type { ChangeRecord } from "@gitimpact/shared";
import { formatSemanticEventDetail, humanizeSemanticEvent } from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";

export function SemanticChangesPanel({
  changes,
  onSelectFile,
}: {
  changes: ChangeRecord[];
  onSelectFile?: (filePath: string) => void;
}) {
  const events = changes.flatMap((change) =>
    (change.semanticEvents ?? []).map((event) => ({
      ...event,
      filePath: change.filePath,
      changeType: change.changeType,
    })),
  );

  if (changes.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No pull request changes"
          message="Open a PR analysis to inspect semantic change events for this repository."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Semantic changes</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Deterministic AST-level events from the PR diff — readable without opening the raw patch.
        </p>
      </div>

      {events.length > 0 ? (
        <ul className="space-y-3">
          {events.map((event, index) => {
            const formatted = formatSemanticEventDetail(event);
            return (
              <li
                key={`${event.symbolId}-${event.kind}-${index}`}
                className="rounded-2xl border border-[var(--line)] bg-white/80 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--fog)] px-2.5 py-1 font-mono text-[11px]">
                    {formatted.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ink-soft)]">
                    {event.changeType}
                  </span>
                </div>
                <p className="mt-2 font-display text-base font-semibold">{formatted.subject}</p>
                {formatted.detail ? (
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{formatted.detail}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelectFile?.(event.filePath)}
                  className="mt-2 font-mono text-[11px] text-[var(--teal)] hover:underline"
                >
                  {event.filePath}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title="No semantic events extracted"
          message="Changed files are listed below. Semantic events appear when Diff-to-AST can map hunks to symbols."
        />
      )}

      <div>
        <h3 className="font-display text-lg font-semibold">Changed files</h3>
        <ul className="mt-3 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white/70">
          {changes.map((change) => (
            <li key={change.filePath} className="flex items-start justify-between gap-4 px-4 py-3">
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
                  {(change.semanticEvents?.length ?? 0) > 0
                    ? ` · ${change.semanticEvents!.length} semantic event${
                        change.semanticEvents!.length === 1 ? "" : "s"
                      }`
                    : ""}
                </p>
              </button>
              <span className="shrink-0 rounded-full bg-[var(--fog)] px-2 py-1 font-mono text-[10px]">
                {humanizeSemanticEvent(change.changeType)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
