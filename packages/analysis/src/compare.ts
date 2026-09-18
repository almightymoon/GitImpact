/**
 * v1.2 — build history snapshots and compare analyses.
 */
import type {
  AnalysisHistoryArchEdge,
  AnalysisHistoryEntry,
  AnalysisHistoryImpactMetrics,
  AnalysisHistorySnapshot,
  AnalysisHistorySystem,
  ArchitectureDiff,
  ChecksReport,
  DependencyGraph,
  ImpactReport,
  PullRequestImpactOverview,
  RepositoryIntelligence,
  AnalysisSummary,
} from "@gitimpact/shared";

export interface SnapshotSource {
  id: string;
  createdAt: string;
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
  pullRequest?: { number: number };
  summary: AnalysisSummary;
  graph: DependencyGraph;
  intelligence?: RepositoryIntelligence;
  impact?: ImpactReport;
  prOverview?: PullRequestImpactOverview;
  checks?: ChecksReport;
  routes?: unknown[];
}

function edgeTypeCounts(graph: DependencyGraph): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const edge of graph.edges) {
    counts[edge.type] = (counts[edge.type] ?? 0) + 1;
  }
  return counts;
}

function systemsFrom(intelligence?: RepositoryIntelligence): AnalysisHistorySystem[] {
  const components = intelligence?.architecture?.components ?? [];
  return components
    .filter((c) => (c.level ?? "SYSTEM") === "SYSTEM")
    .map((c) => ({
      id: c.id,
      title: c.title,
      role: c.role,
      pathHint: c.pathHint,
    }));
}

function archEdgesFrom(intelligence?: RepositoryIntelligence): AnalysisHistoryArchEdge[] {
  return (intelligence?.architecture?.edges ?? []).map((e) => ({
    from: e.from,
    to: e.to,
    label: e.label,
  }));
}

function impactMetrics(
  impact?: ImpactReport,
  prOverview?: PullRequestImpactOverview,
): AnalysisHistoryImpactMetrics | undefined {
  if (!impact && !prOverview) return undefined;
  return {
    directCount: impact?.directImpact.length ?? prOverview?.directDependencies ?? 0,
    indirectCount: impact?.indirectImpact.length ?? prOverview?.indirectDependencies ?? 0,
    affectedFiles: impact?.affectedFiles.length ?? prOverview?.filesChanged ?? 0,
    affectedApis: impact?.affectedApis.length ?? prOverview?.apiRoutesAffected ?? 0,
    relatedTests: impact?.relatedTests.length ?? prOverview?.relevantTests ?? 0,
    missingTests: impact?.missingTests.length ?? prOverview?.potentialMissingTests ?? 0,
    complexityScore: impact?.complexityScore ?? prOverview?.complexityScore,
    impactLevel: prOverview?.impactLevel,
    maxDepth: impact?.maxDepth,
  };
}

function checksSummary(checks?: ChecksReport): AnalysisHistorySnapshot["checks"] {
  if (!checks) return undefined;
  const bySeverity: Record<string, number> = {};
  for (const finding of checks.findings ?? []) {
    const sev = finding.severity ?? "unknown";
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }
  return {
    total: checks.findings?.length ?? 0,
    bySeverity,
  };
}

export function buildHistorySnapshot(source: SnapshotSource): AnalysisHistorySnapshot {
  return {
    schemaVersion: "1.2",
    repositoryType: source.intelligence?.repositoryType,
    typeLabel: source.intelligence?.typeLabel,
    frameworks: [...(source.summary.frameworks ?? [])].sort(),
    languages: source.summary.languages ?? [],
    summary: {
      files: source.summary.files,
      functions: source.summary.functions,
      classes: source.summary.classes,
      dependencies: source.summary.dependencies,
      tests: source.summary.tests,
      apiRoutes: source.summary.apiRoutes,
    },
    graph: {
      nodes: source.graph.nodes.length,
      edges: source.graph.edges.length,
      edgeTypeCounts: edgeTypeCounts(source.graph),
    },
    systems: systemsFrom(source.intelligence),
    architectureEdges: archEdgesFrom(source.intelligence),
    coverageConfidence: source.intelligence?.coverage?.confidence,
    blindSpots: source.intelligence?.coverage?.blindSpots ?? [],
    impact: impactMetrics(source.impact, source.prOverview),
    checks: checksSummary(source.checks),
  };
}

function keySystem(s: AnalysisHistorySystem): string {
  return `${s.title}::${s.pathHint ?? ""}`;
}

function keyArchEdge(e: AnalysisHistoryArchEdge): string {
  return `${e.from}|${e.label}|${e.to}`;
}

function blastVerdict(
  directDelta: number,
  indirectDelta: number,
): ArchitectureDiff["blastRadius"] extends infer T
  ? T extends { verdict: infer V }
    ? V
    : never
  : never {
  const score = directDelta * 2 + indirectDelta;
  if (score > 0) return "increased";
  if (score < 0) return "decreased";
  return "unchanged";
}

export function compareHistorySnapshots(
  from: AnalysisHistoryEntry,
  to: AnalysisHistoryEntry,
): ArchitectureDiff {
  const a = from.snapshot;
  const b = to.snapshot;

  const fromFw = new Set(a.frameworks);
  const toFw = new Set(b.frameworks);
  const frameworksAdded = [...toFw].filter((f) => !fromFw.has(f));
  const frameworksRemoved = [...fromFw].filter((f) => !toFw.has(f));

  const fromSystems = new Map(a.systems.map((s) => [keySystem(s), s]));
  const toSystems = new Map(b.systems.map((s) => [keySystem(s), s]));
  const systemsAdded = [...toSystems.entries()]
    .filter(([k]) => !fromSystems.has(k))
    .map(([, s]) => s);
  const systemsRemoved = [...fromSystems.entries()]
    .filter(([k]) => !toSystems.has(k))
    .map(([, s]) => s);

  const fromEdges = new Map(a.architectureEdges.map((e) => [keyArchEdge(e), e]));
  const toEdges = new Map(b.architectureEdges.map((e) => [keyArchEdge(e), e]));
  const architectureEdgesAdded = [...toEdges.entries()]
    .filter(([k]) => !fromEdges.has(k))
    .map(([, e]) => e);
  const architectureEdgesRemoved = [...fromEdges.entries()]
    .filter(([k]) => !toEdges.has(k))
    .map(([, e]) => e);

  const summaryDeltas = {
    files: b.summary.files - a.summary.files,
    functions: b.summary.functions - a.summary.functions,
    classes: b.summary.classes - a.summary.classes,
    dependencies: b.summary.dependencies - a.summary.dependencies,
    tests: b.summary.tests - a.summary.tests,
    apiRoutes: b.summary.apiRoutes - a.summary.apiRoutes,
    graphNodes: b.graph.nodes - a.graph.nodes,
    graphEdges: b.graph.edges - a.graph.edges,
  };

  const repositoryTypeChanged =
    a.repositoryType !== b.repositoryType
      ? { from: a.repositoryType, to: b.repositoryType }
      : undefined;

  let blastRadius: ArchitectureDiff["blastRadius"];
  if (a.impact && b.impact) {
    const directDelta = b.impact.directCount - a.impact.directCount;
    const indirectDelta = b.impact.indirectCount - a.impact.indirectCount;
    const complexityDelta =
      a.impact.complexityScore != null && b.impact.complexityScore != null
        ? b.impact.complexityScore - a.impact.complexityScore
        : undefined;
    blastRadius = {
      directDelta,
      indirectDelta,
      complexityDelta,
      impactLevelFrom: a.impact.impactLevel,
      impactLevelTo: b.impact.impactLevel,
      verdict: blastVerdict(directDelta, indirectDelta),
    };
  }

  const narrative: string[] = [];
  const short = (sha?: string) => (sha ? sha.slice(0, 7) : "unknown");
  narrative.push(
    `Comparing ${short(from.commitSha ?? from.headSha)} → ${short(to.commitSha ?? to.headSha)}.`,
  );
  if (frameworksAdded.length || frameworksRemoved.length) {
    const bits: string[] = [];
    if (frameworksAdded.length) bits.push(`added ${frameworksAdded.join(", ")}`);
    if (frameworksRemoved.length) bits.push(`removed ${frameworksRemoved.join(", ")}`);
    narrative.push(`Frameworks ${bits.join("; ")}.`);
  }
  if (systemsAdded.length || systemsRemoved.length) {
    narrative.push(
      `Architecture systems: +${systemsAdded.length} / −${systemsRemoved.length}.`,
    );
  }
  if (summaryDeltas.apiRoutes !== 0) {
    narrative.push(
      `API routes ${summaryDeltas.apiRoutes > 0 ? "increased" : "decreased"} by ${Math.abs(summaryDeltas.apiRoutes)}.`,
    );
  }
  if (repositoryTypeChanged) {
    narrative.push(
      `Repository type changed ${repositoryTypeChanged.from ?? "?"} → ${repositoryTypeChanged.to ?? "?"}.`,
    );
  }
  if (blastRadius) {
    if (blastRadius.verdict === "increased") {
      narrative.push(
        `Blast radius increased (+${blastRadius.directDelta} direct, +${blastRadius.indirectDelta} indirect).`,
      );
    } else if (blastRadius.verdict === "decreased") {
      narrative.push(
        `Blast radius decreased (${blastRadius.directDelta} direct, ${blastRadius.indirectDelta} indirect).`,
      );
    } else {
      narrative.push("Blast radius unchanged.");
    }
  }
  if (narrative.length === 1) {
    narrative.push("No material architecture differences detected in the snapshot.");
  }

  return {
    from: {
      id: from.id,
      commitSha: from.commitSha ?? from.headSha,
      createdAt: from.createdAt,
      label: from.snapshot.typeLabel ?? from.repositoryId,
    },
    to: {
      id: to.id,
      commitSha: to.commitSha ?? to.headSha,
      createdAt: to.createdAt,
      label: to.snapshot.typeLabel ?? to.repositoryId,
    },
    frameworksAdded,
    frameworksRemoved,
    systemsAdded,
    systemsRemoved,
    architectureEdgesAdded,
    architectureEdgesRemoved,
    summaryDeltas,
    repositoryTypeChanged,
    blastRadius,
    narrative,
  };
}

export function compareAnalyses(
  from: SnapshotSource,
  to: SnapshotSource,
): ArchitectureDiff {
  const fromEntry: AnalysisHistoryEntry = {
    id: `ephemeral:${from.id}`,
    repositoryId: from.id,
    analysisId: from.id,
    kind: from.pullRequest ? "pull_request" : "repository",
    commitSha: from.commitSha,
    baseSha: from.baseSha,
    headSha: from.headSha,
    prNumber: from.pullRequest?.number,
    createdAt: from.createdAt,
    snapshot: buildHistorySnapshot(from),
  };
  const toEntry: AnalysisHistoryEntry = {
    id: `ephemeral:${to.id}`,
    repositoryId: to.id,
    analysisId: to.id,
    kind: to.pullRequest ? "pull_request" : "repository",
    commitSha: to.commitSha,
    baseSha: to.baseSha,
    headSha: to.headSha,
    prNumber: to.pullRequest?.number,
    createdAt: to.createdAt,
    snapshot: buildHistorySnapshot(to),
  };
  return compareHistorySnapshots(fromEntry, toEntry);
}

/** Deterministic team review report (markdown). */
export function buildReviewReportMarkdown(source: SnapshotSource): string {
  const snap = buildHistorySnapshot(source);
  const lines: string[] = [];
  const repo = source.id;
  lines.push(`# GitImpact review report`);
  lines.push("");
  lines.push(`**Repository:** \`${repo}\``);
  if (source.commitSha) lines.push(`**Commit:** \`${source.commitSha}\``);
  if (source.pullRequest) lines.push(`**Pull request:** #${source.pullRequest.number}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Type:** ${snap.typeLabel ?? "unknown"}`);
  if (snap.frameworks.length) {
    lines.push(`**Stack:** ${snap.frameworks.join(", ")}`);
  }
  if (snap.coverageConfidence) {
    lines.push(`**Coverage confidence:** ${snap.coverageConfidence}`);
  }
  lines.push("");

  lines.push("## Snapshot");
  lines.push("");
  lines.push(
    `| Files | Functions | Classes | Imports | Tests | API routes | Graph nodes | Graph edges |`,
  );
  lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  lines.push(
    `| ${snap.summary.files} | ${snap.summary.functions} | ${snap.summary.classes} | ${snap.summary.dependencies} | ${snap.summary.tests} | ${snap.summary.apiRoutes} | ${snap.graph.nodes} | ${snap.graph.edges} |`,
  );
  lines.push("");

  if (snap.systems.length) {
    lines.push("## Systems");
    lines.push("");
    for (const system of snap.systems) {
      const hint = system.pathHint ? ` (\`${system.pathHint}\`)` : "";
      lines.push(`- **${system.title}**${hint} — ${system.role}`);
    }
    lines.push("");
  }

  if (snap.architectureEdges.length) {
    lines.push("## Architecture relationships");
    lines.push("");
    const byId = new Map(snap.systems.map((s) => [s.id, s.title]));
    for (const edge of snap.architectureEdges) {
      const from = byId.get(edge.from) ?? edge.from;
      const to = byId.get(edge.to) ?? edge.to;
      lines.push(`- ${from} → ${to} (${edge.label})`);
    }
    lines.push("");
  }

  if (snap.impact) {
    lines.push("## Blast radius");
    lines.push("");
    lines.push(`- Direct dependents: ${snap.impact.directCount}`);
    lines.push(`- Indirect dependents: ${snap.impact.indirectCount}`);
    lines.push(`- Affected files: ${snap.impact.affectedFiles}`);
    lines.push(`- Affected APIs: ${snap.impact.affectedApis}`);
    lines.push(`- Related tests: ${snap.impact.relatedTests}`);
    lines.push(`- Potential test gaps: ${snap.impact.missingTests}`);
    if (snap.impact.complexityScore != null) {
      lines.push(
        `- Complexity: ${snap.impact.complexityScore}/100` +
          (snap.impact.impactLevel ? ` (${snap.impact.impactLevel})` : ""),
      );
    }
    lines.push("");
  }

  if (snap.checks && snap.checks.total > 0) {
    lines.push("## Checks");
    lines.push("");
    lines.push(`Total findings: ${snap.checks.total}`);
    for (const [sev, n] of Object.entries(snap.checks.bySeverity)) {
      lines.push(`- ${sev}: ${n}`);
    }
    lines.push("");
  }

  if (snap.blindSpots.length) {
    lines.push("## Blind spots");
    lines.push("");
    for (const spot of snap.blindSpots) {
      lines.push(`- ${spot}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Deterministic report generated by GitImpact v1.2 — no AI.");
  return `${lines.join("\n")}\n`;
}

export function formatArchitectureDiffMarkdown(diff: ArchitectureDiff): string {
  const lines: string[] = [];
  lines.push(`# Architecture comparison`);
  lines.push("");
  lines.push(
    `**From:** \`${diff.from.commitSha?.slice(0, 7) ?? diff.from.label}\` (${diff.from.createdAt})`,
  );
  lines.push(
    `**To:** \`${diff.to.commitSha?.slice(0, 7) ?? diff.to.label}\` (${diff.to.createdAt})`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const line of diff.narrative) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  if (diff.frameworksAdded.length || diff.frameworksRemoved.length) {
    lines.push("## Frameworks");
    lines.push("");
    if (diff.frameworksAdded.length) {
      lines.push(`- Added: ${diff.frameworksAdded.join(", ")}`);
    }
    if (diff.frameworksRemoved.length) {
      lines.push(`- Removed: ${diff.frameworksRemoved.join(", ")}`);
    }
    lines.push("");
  }

  if (diff.systemsAdded.length || diff.systemsRemoved.length) {
    lines.push("## Systems");
    lines.push("");
    for (const s of diff.systemsAdded) {
      lines.push(`- + **${s.title}** — ${s.role}`);
    }
    for (const s of diff.systemsRemoved) {
      lines.push(`- − **${s.title}** — ${s.role}`);
    }
    lines.push("");
  }

  if (diff.blastRadius) {
    lines.push("## Blast radius delta");
    lines.push("");
    lines.push(`- Verdict: **${diff.blastRadius.verdict}**`);
    lines.push(`- Direct: ${diff.blastRadius.directDelta >= 0 ? "+" : ""}${diff.blastRadius.directDelta}`);
    lines.push(
      `- Indirect: ${diff.blastRadius.indirectDelta >= 0 ? "+" : ""}${diff.blastRadius.indirectDelta}`,
    );
    if (diff.blastRadius.complexityDelta != null) {
      lines.push(
        `- Complexity: ${diff.blastRadius.complexityDelta >= 0 ? "+" : ""}${diff.blastRadius.complexityDelta}`,
      );
    }
    lines.push("");
  }

  lines.push("## Metric deltas");
  lines.push("");
  for (const [key, value] of Object.entries(diff.summaryDeltas)) {
    if (value === 0) continue;
    lines.push(`- ${key}: ${value > 0 ? "+" : ""}${value}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Generated by GitImpact v1.2");
  return `${lines.join("\n")}\n`;
}
