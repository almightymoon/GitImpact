"use client";

/**
 * Opens a GitHub issue draft so users can report incorrect analysis.
 * Uses the public GitImpact repo issues — no backend required.
 */
export function AnalysisFeedbackLink({
  repository,
  typeLabel,
  confidence,
  architectureSummary,
}: {
  repository: { owner: string; name: string; url: string };
  typeLabel?: string;
  confidence?: string;
  architectureSummary?: string;
}) {
  const title = encodeURIComponent(
    `Incorrect analysis: ${repository.owner}/${repository.name}`,
  );
  const body = encodeURIComponent(
    [
      `## What looked wrong`,
      ``,
      `<!-- Describe the miss: wrong framework, missing call, misleading overview, etc. -->`,
      ``,
      `## Repository`,
      `- ${repository.url}`,
      typeLabel ? `- Detected type: ${typeLabel}` : null,
      confidence ? `- Confidence: ${confidence}` : null,
      architectureSummary ? `- Summary: ${architectureSummary}` : null,
      ``,
      `## Expected`,
      ``,
      `<!-- What should GitImpact have shown? -->`,
      ``,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
  const href = `https://github.com/almightymoon/GitImpact/issues/new?title=${title}&body=${body}&labels=dogfood%2Caccuracy`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
    >
      Report incorrect analysis
    </a>
  );
}
