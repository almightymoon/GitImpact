"use client";

import { useState } from "react";

export function HelpTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`About ${label}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--line)] font-mono text-[9px] text-[var(--ink-soft)] hover:border-[var(--teal)]"
      >
        ?
      </button>
      {open ? (
        <span className="absolute left-0 top-6 z-20 w-56 rounded-lg border border-[var(--line)] bg-white p-2 text-left text-[11px] leading-relaxed text-[var(--ink-soft)] shadow-lg">
          {text}
        </span>
      ) : null}
    </span>
  );
}

export const HELP = {
  blastRadius:
    "Components that may be affected if this symbol changes, based on static dependency edges — not a prediction that something will break.",
  directDependency:
    "A symbol this node directly imports, calls, or otherwise depends on in one hop.",
  indirectDependency:
    "A symbol reachable through two or more dependency hops from the selected node.",
  confidence:
    "How confidently GitImpact resolved this relationship from static analysis (HIGH / MEDIUM / LOW).",
  changeComplexity:
    "A deterministic 0–100 score summarizing how wide and deep this change’s dependency impact appears. It is not a probability of failure.",
  potentialTestGap:
    "A changed or dependent symbol for which GitImpact did not find a directly associated test.",
} as const;
