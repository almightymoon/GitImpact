import type {
  GraphNode,
  ImpactPathStep,
  ImpactReport,
  ImpactedNode,
  PullRequestImpactOverview,
  PullRequestMeta,
} from "@gitimpact/shared";

export const GITIMPACT_COMMENT_MARKER = "<!-- gitimpact-bot -->";

export interface PrCommentInput {
  pullRequest: PullRequestMeta;
  impact: ImpactReport;
  overview: PullRequestImpactOverview;
  /** Optional explainable path for a notable affected node */
  whyPath?: {
    targetName: string;
    steps: ImpactPathStep[];
  };
  analysisUrl?: string;
}

function displaySymbol(node: GraphNode): string {
  return node.name;
}

function pickWhyTarget(impact: ImpactReport): ImpactedNode | undefined {
  const pool = [...impact.indirectImpact, ...impact.directImpact];
  const preferred = pool.find(
    (item) =>
      item.node.type === "API_ROUTE" ||
      item.node.type === "CONTROLLER" ||
      item.node.type === "COMPONENT" ||
      /login|admin|auth|payment/i.test(item.node.name),
  );
  return preferred ?? pool.find((item) => (item.relationshipPath?.length ?? 0) > 1);
}

export function selectWhyPath(impact: ImpactReport): {
  targetName: string;
  path: string[];
} | null {
  const target = pickWhyTarget(impact);
  if (!target?.relationshipPath?.length) return null;
  return {
    targetName: displaySymbol(target.node),
    path: target.relationshipPath,
  };
}

/**
 * Deterministic GitHub PR comment body for v0.6 productization.
 */
export function formatPullRequestComment(input: PrCommentInput): string {
  const { impact, overview, pullRequest, whyPath, analysisUrl } = input;
  const changedSymbols = impact.changedNodes
    .filter((n) => n.type === "FUNCTION" || n.type === "METHOD" || n.type === "CLASS")
    .map(displaySymbol);

  const uniqueSymbols = [...new Set(changedSymbols)].slice(0, 12);
  const lines: string[] = [
    GITIMPACT_COMMENT_MARKER,
    "## GitImpact Analysis",
    "",
    `**Change Complexity:** ${overview.complexityScore}/100 (${overview.impactLevel})`,
    "",
    "### Changed symbols",
  ];

  if (uniqueSymbols.length === 0) {
    lines.push("_No exact symbols mapped — file-level impact used._");
  } else {
    for (const symbol of uniqueSymbols) {
      lines.push(`• \`${symbol}\``);
    }
  }

  lines.push(
    "",
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| Direct dependents | ${overview.directDependencies} |`,
    `| Indirect dependents | ${overview.indirectDependencies} |`,
    `| Affected APIs | ${overview.apiRoutesAffected} |`,
    `| Relevant tests | ${overview.relevantTests} |`,
    `| Potential test gaps | ${overview.potentialMissingTests} |`,
    "",
  );

  if (whyPath && whyPath.steps.length > 0) {
    lines.push(`### Why is \`${whyPath.targetName}\` affected?`, "");
    const chain = whyPath.steps.map((step) => step.name);
    // relationshipPath is [changed, ..., dependent]; reverse for dependent-first narrative
    const presentation = [...chain].reverse();
    lines.push(presentation.join("  \n→ "));
    lines.push("");
  }

  lines.push(
    "<details>",
    "<summary>Summary</summary>",
    "",
    overview.summary || impact.summary,
    "",
    `PR: [#${pullRequest.number} ${pullRequest.title}](${pullRequest.url})`,
  );

  if (analysisUrl) {
    lines.push(`Workbench: ${analysisUrl}`);
  }

  lines.push("", "</details>", "");
  lines.push("_Deterministic static analysis — no AI guesses in this report._");

  return lines.join("\n");
}
