import type {
  ChangeRecord,
  CheckCategory,
  CheckCategorySummary,
  CheckFinding,
  CheckSeverity,
  ChecksReport,
  DependencyGraph,
  ImpactReport,
  InfraSignal,
  ParsedFile,
  PullRequestImpactOverview,
} from "@gitimpact/shared";
import { runSecurityChecks, markAuthSensitiveChanges } from "./security.js";
import { runQualityChecks } from "./quality.js";
import { runCicdChecks } from "./cicd.js";
import { enrichFindingGuidance } from "./rule-catalog.js";
import { applyChecksConfig, loadGitImpactConfig } from "./config.js";

const SEVERITIES: CheckSeverity[] = ["critical", "high", "medium", "low", "info"];

const CATEGORY_LABELS: Record<CheckCategory, string> = {
  security: "Security",
  quality: "Code Quality",
  dependencies: "Dependencies",
  cicd: "CI/CD",
  infrastructure: "Infrastructure",
};

export async function buildChecksReport(input: {
  files: ParsedFile[];
  contentsByPath: Map<string, string>;
  graph: DependencyGraph;
  packageDeps?: Record<string, string>;
  clonePath?: string;
  allRelativeFiles?: string[];
  infraSignals?: InfraSignal[];
  changes?: ChangeRecord[];
  impact?: ImpactReport;
  prOverview?: PullRequestImpactOverview;
}): Promise<ChecksReport> {
  const allFiles = input.allRelativeFiles ?? input.files.map((f) => f.path);

  let security = await runSecurityChecks({
    files: input.files,
    contentsByPath: input.contentsByPath,
    packageDeps: input.packageDeps,
    clonePath: input.clonePath,
    allRelativeFiles: allFiles,
  });

  if (input.changes?.length) {
    security = markAuthSensitiveChanges(
      security,
      input.changes.map((c) => c.filePath),
    );
  }

  const quality = runQualityChecks({
    files: input.files,
    contentsByPath: input.contentsByPath,
    graph: input.graph,
  });

  const cicd = runCicdChecks({
    allRelativeFiles: allFiles,
    infraSignals: input.infraSignals ?? [],
    changes: input.changes,
  });

  // Filter PR-scoped quality noise: when PR analysis, emphasize changed files for some rules
  let findings = [...security, ...quality, ...cicd].map(enrichFindingGuidance);
  if (input.changes?.length) {
    const changed = new Set(input.changes.map((c) => c.filePath.replace(/\\/g, "/")));
    findings = findings.map((f) => {
      if (!f.file) return f;
      if (changed.has(f.file.replace(/\\/g, "/"))) return f;
      // Keep repo-wide cycles/secrets; downgrade remote quality hits to info for PR view
      if (f.category === "quality" && f.severity !== "info") {
        return { ...f, severity: "info" as const };
      }
      return f;
    });
  }

  const { config, path: configPath } = await loadGitImpactConfig(input.clonePath);
  const applied = applyChecksConfig(findings, config);
  findings = applied.findings;

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const summaries = buildSummaries(findings);
  const totals = {
    findings: findings.length,
    critical: countSeverity(findings, "critical"),
    high: countSeverity(findings, "high"),
    medium: countSeverity(findings, "medium"),
    low: countSeverity(findings, "low"),
    info: countSeverity(findings, "info"),
  };

  return {
    findings,
    summaries,
    totals,
    prHighlights: buildPrHighlights(findings, input.impact, input.prOverview),
    generatedAt: new Date().toISOString(),
    configApplied:
      configPath || applied.suppressed || applied.severityOverrides
        ? {
            path: configPath,
            suppressed: applied.suppressed,
            severityOverrides: applied.severityOverrides,
          }
        : undefined,
  };
}

function severityRank(s: CheckSeverity): number {
  return SEVERITIES.indexOf(s);
}

function countSeverity(findings: CheckFinding[], severity: CheckSeverity): number {
  return findings.filter((f) => f.severity === severity).length;
}

function buildSummaries(findings: CheckFinding[]): CheckCategorySummary[] {
  const categories: CheckCategory[] = [
    "security",
    "quality",
    "dependencies",
    "cicd",
    "infrastructure",
  ];
  return categories.map((category) => {
    const items = findings.filter((f) => f.category === category);
    const bySeverity = Object.fromEntries(
      SEVERITIES.map((s) => [s, items.filter((i) => i.severity === s).length]),
    ) as Record<CheckSeverity, number>;
    const highlights = items
      .filter((i) => i.severity !== "info")
      .slice(0, 5)
      .map((i) => i.title);
    if (highlights.length === 0 && items.length > 0) {
      highlights.push(
        ...items.slice(0, 3).map((i) => i.title),
      );
    }
    if (items.length === 0) {
      if (category === "security") highlights.push("No secrets or high-risk sinks detected");
      if (category === "quality") highlights.push("No high-severity quality issues detected");
    }
    return {
      category,
      label: CATEGORY_LABELS[category],
      findingCount: items.length,
      bySeverity,
      highlights,
    };
  });
}

function buildPrHighlights(
  findings: CheckFinding[],
  impact?: ImpactReport,
  prOverview?: PullRequestImpactOverview,
): ChecksReport["prHighlights"] {
  const changeImpact: string[] = [];
  if (prOverview) {
    changeImpact.push(
      `${prOverview.directDependencies + prOverview.indirectDependencies} downstream dependencies`,
    );
    changeImpact.push(`${prOverview.apiRoutesAffected} APIs affected`);
    changeImpact.push(`${prOverview.relevantTests} related tests`);
    changeImpact.push(`${prOverview.potentialMissingTests} potential test gaps`);
  } else if (impact) {
    changeImpact.push(
      `${impact.directImpact.length + impact.indirectImpact.length} downstream dependencies`,
    );
    changeImpact.push(`${impact.affectedApis.length} APIs affected`);
    changeImpact.push(`${impact.relatedTests.length} related tests`);
    changeImpact.push(`${impact.missingTests.length} potential test gaps`);
  }

  const bullet = (category: CheckFinding["category"], empty: string): string[] => {
    const items = findings.filter(
      (f) => f.category === category && f.severity !== "info",
    );
    if (items.length === 0) {
      const infos = findings.filter((f) => f.category === category);
      if (category === "security" && infos.some((i) => i.ruleId === "auth_sensitive_change")) {
        return infos
          .filter((i) => i.ruleId === "auth_sensitive_change")
          .slice(0, 3)
          .map((i) => i.title);
      }
      return [empty];
    }
    return summarizeByRule(items);
  };

  const cicdItems = findings.filter(
    (f) =>
      (f.category === "cicd" || f.category === "infrastructure") &&
      (f.ruleId.includes("changed") || f.severity !== "info"),
  );

  return {
    changeImpact: changeImpact.length ? changeImpact : undefined,
    codeQuality: bullet("quality", "No high-severity code quality issues detected"),
    security: bullet("security", "No secrets detected"),
    cicd:
      cicdItems.length > 0
        ? summarizeByRule(cicdItems)
        : ["No CI/CD or infrastructure files changed"],
  };
}

function summarizeByRule(items: CheckFinding[]): string[] {
  const counts = new Map<string, { count: number; title: string; severity: CheckSeverity }>();
  for (const item of items) {
    const cur = counts.get(item.ruleId) ?? {
      count: 0,
      title: item.title,
      severity: item.severity,
    };
    cur.count += 1;
    if (severityRank(item.severity) < severityRank(cur.severity)) {
      cur.severity = item.severity;
      cur.title = item.title;
    }
    counts.set(item.ruleId, cur);
  }
  return [...counts.values()]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 6)
    .map((c) => (c.count > 1 ? `${c.count}× ${c.title}` : c.title));
}

/** Build INFRASTRUCTURE graph nodes from CI/infra findings & signals for Structure view */
export function buildInfrastructureNodes(input: {
  infraSignals: InfraSignal[];
  findings: CheckFinding[];
}): { nodes: import("@gitimpact/shared").GraphNode[]; edges: import("@gitimpact/shared").GraphEdge[] } {
  const nodes: import("@gitimpact/shared").GraphNode[] = [];
  const edges: import("@gitimpact/shared").GraphEdge[] = [];
  const seen = new Set<string>();

  const add = (kind: string, path: string, label: string) => {
    const id = `INFRASTRUCTURE:${kind}:${path}`;
    if (seen.has(id)) return id;
    seen.add(id);
    nodes.push({
      id,
      type: "INFRASTRUCTURE",
      name: label,
      file: path,
      metadata: { kind },
    });
    return id;
  };

  for (const signal of input.infraSignals) {
    add(signal.kind, signal.path, signal.label);
  }

  // Layer edges for narrative Structure (Frontend→…→ArgoCD style is UX; here link related kinds)
  const byKind = new Map<string, string>();
  for (const node of nodes) {
    const kind = String(node.metadata?.kind ?? "");
    if (!byKind.has(kind)) byKind.set(kind, node.id);
  }
  const chain = ["docker", "kubernetes", "helm", "argocd", "terraform", "github_actions"];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = byKind.get(chain[i]!);
    const b = byKind.get(chain[i + 1]!);
    if (a && b) {
      edges.push({
        id: `DEPLOYS:${a}:${b}`,
        from: a,
        to: b,
        type: "DEPLOYS",
        confidence: "LOW",
      });
    }
  }

  return { nodes, edges };
}
