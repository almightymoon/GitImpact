import { GraphStore } from "@gitimpact/graph";
import type {
  ChangeCategory,
  ChangeRecord,
  ConfidenceLevel,
  GraphNode,
  ImpactReport,
  ImpactSeverity,
  ImpactedNode,
  PullRequestImpactOverview,
  PullRequestMeta,
} from "@gitimpact/shared";

const CRITICAL_HINTS = [
  "auth",
  "payment",
  "billing",
  "security",
  "migration",
  "deploy",
  "session",
  "password",
  "token",
  "permission",
  "rbac",
];

function severityForDepth(
  depth: number,
  node: GraphNode,
): ImpactSeverity {
  const haystack = `${node.name} ${node.file}`.toLowerCase();
  const critical = CRITICAL_HINTS.some((hint) => haystack.includes(hint));
  if (depth === 0) return "CRITICAL";
  if (critical && depth <= 2) return "CRITICAL";
  if (depth === 1) return "HIGH";
  if (depth === 2) return "MEDIUM";
  return "NEUTRAL";
}

function confidenceFromPath(store: GraphStore, fromId: string, toId: string): ConfidenceLevel {
  const edge = store
    .getIncoming(toId)
    .find((e) => e.from === fromId);
  return edge?.confidence ?? "MEDIUM";
}

export function calculateImpact(
  store: GraphStore,
  changedNodes: GraphNode[],
  maxDepth = 3,
): Map<string, ImpactedNode> {
  const impacted = new Map<string, ImpactedNode>();
  const queue: Array<{ node: GraphNode; depth: number; path: string[] }> = [];

  for (const node of changedNodes) {
    queue.push({ node, depth: 0, path: [node.id] });
    impacted.set(node.id, {
      node,
      depth: 0,
      severity: "CRITICAL",
      relationshipPath: [node.id],
      confidence: "HIGH",
    });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) continue;

    const dependents = store.getIncomingDependencies(current.node.id);
    for (const dependent of dependents) {
      const nextDepth = current.depth + 1;
      if (impacted.has(dependent.id)) continue;
      const path = [...current.path, dependent.id];
      impacted.set(dependent.id, {
        node: dependent,
        depth: nextDepth,
        severity: severityForDepth(nextDepth, dependent),
        relationshipPath: path,
        confidence: confidenceFromPath(store, dependent.id, current.node.id),
      });
      queue.push({ node: dependent, depth: nextDepth, path });
    }
  }

  return impacted;
}

function isApiNode(node: GraphNode): boolean {
  return (
    node.type === "API_ROUTE" ||
    /route|controller|api\//i.test(node.file) ||
    /route|controller/i.test(node.name)
  );
}

function isTestNode(node: GraphNode): boolean {
  return node.type === "TEST" || /\.(test|spec)\./.test(node.file);
}

export function buildImpactReport(
  store: GraphStore,
  changedNodes: GraphNode[],
  maxDepth = 3,
): ImpactReport {
  const impacted = calculateImpact(store, changedNodes, maxDepth);
  const all = [...impacted.values()];

  const directImpact = all.filter((item) => item.depth === 1);
  const indirectImpact = all.filter((item) => item.depth > 1);

  const affectedFiles = [
    ...new Set(all.map((item) => item.node.file)),
  ].sort();

  const affectedApis = all
    .map((item) => item.node)
    .filter(isApiNode);

  const relatedTests = all
    .map((item) => item.node)
    .filter(isTestNode);

  // Also pull tests that TEST changed files even if not in traversal
  for (const changed of changedNodes) {
    for (const edge of store.getIncoming(changed.id)) {
      if (edge.type === "TESTS") {
        const testNode = store.getNode(edge.from);
        if (testNode && !relatedTests.some((t) => t.id === testNode.id)) {
          relatedTests.push(testNode);
        }
      }
    }
    const fileNode = store.findFileNode(changed.file);
    if (fileNode) {
      for (const edge of store.getIncoming(fileNode.id)) {
        if (edge.type === "TESTS") {
          const testNode = store.getNode(edge.from);
          if (testNode && !relatedTests.some((t) => t.id === testNode.id)) {
            relatedTests.push(testNode);
          }
        }
      }
    }
  }

  const consumersWithoutTests = directImpact.filter((item) => {
    if (isTestNode(item.node)) return false;
    const hasTest = relatedTests.some((test) => {
      return store
        .getOutgoing(test.id)
        .some((edge) => edge.to === item.node.id || edge.to === `FILE:${item.node.file}`);
    });
    return !hasTest;
  });

  const complexityScore = Math.min(
    100,
    changedNodes.length * 4 +
      directImpact.length * 3 +
      indirectImpact.length +
      affectedApis.length * 5 +
      consumersWithoutTests.length * 6,
  );

  const primary = changedNodes[0];
  const summary = primary
    ? buildSummaryText({
        primary,
        directCount: directImpact.length,
        indirectCount: indirectImpact.length,
        apiCount: affectedApis.length,
        testCount: relatedTests.length,
        gapCount: consumersWithoutTests.length,
      })
    : "No changed nodes were identified.";

  return {
    changedNodes,
    directImpact,
    indirectImpact,
    affectedFiles,
    affectedApis,
    relatedTests,
    missingTests: consumersWithoutTests.map((c) => c.node),
    maxDepth,
    complexityScore,
    summary,
  };
}

function buildSummaryText(input: {
  primary: GraphNode;
  directCount: number;
  indirectCount: number;
  apiCount: number;
  testCount: number;
  gapCount: number;
}): string {
  const parts = [
    `Changing ${input.primary.name} in ${input.primary.file} has a blast radius of ${input.directCount} direct and ${input.indirectCount} indirect dependents.`,
  ];
  if (input.apiCount > 0) {
    parts.push(`${input.apiCount} API-related nodes may be affected.`);
  }
  if (input.testCount > 0) {
    parts.push(`${input.testCount} related tests were identified.`);
  }
  if (input.gapCount > 0) {
    parts.push(`${input.gapCount} dependent areas appear to lack directly associated tests.`);
  }
  return parts.join(" ");
}

export function mapChangedFilesToNodes(
  store: GraphStore,
  changedFiles: string[],
): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const file of changedFiles) {
    const fileNodes = store.findNodesByFile(file);
    if (fileNodes.length === 0) continue;
    const fileNode = store.findFileNode(file);
    if (fileNode) nodes.push(fileNode);
    else nodes.push(...fileNodes.filter((n) => n.type === "FUNCTION" || n.type === "CLASS").slice(0, 5));
  }
  return nodes;
}

export function classifyDiffHunk(
  patch?: string,
  status?: string,
): ChangeRecord["changeType"] {
  if (status === "removed" || status === "renamed" || status === "added") {
    return "STRUCTURAL";
  }
  if (!patch) return "BEHAVIORAL";
  if (/process\.env|Dockerfile|docker-compose|\.ya?ml|terraform|\.env/i.test(patch)) {
    return "CONFIGURATION";
  }
  if (
    /[\+\-]\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)/.test(patch) ||
    /[\+\-]\s*(?:export\s+)?(?:interface|type|class)\s+\w+/.test(patch) ||
    /[\+\-].*\([^)]*\)\s*:\s*\w+/.test(patch)
  ) {
    return "INTERFACE";
  }
  if (/deleted file mode|new file mode|rename from|rename to/.test(patch)) {
    return "STRUCTURAL";
  }
  return "BEHAVIORAL";
}

export function extractChangedSymbols(patch?: string): string[] {
  if (!patch) return [];
  const names = new Set<string>();
  const patterns = [
    /^[\+\-]\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w$]*)/gm,
    /^[\+\-]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w$]*)\s*=/gm,
    /^[\+\-]\s*(?:export\s+)?class\s+([A-Za-z_][\w$]*)/gm,
    /^[\+\-]\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_][\w$]*)/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(patch)) !== null) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function impactLevelFromScore(
  score: number,
): PullRequestImpactOverview["impactLevel"] {
  if (score >= 70) return "Critical";
  if (score >= 45) return "Elevated";
  if (score >= 20) return "Moderate";
  return "Low";
}

export function buildPullRequestOverview(
  impact: ImpactReport,
  changes: ChangeRecord[],
  pullRequest: PullRequestMeta,
): PullRequestImpactOverview {
  const functionsModified = new Set(
    changes.flatMap((c) => c.symbols ?? (c.symbolName ? [c.symbolName] : [])),
  );

  const changeBreakdown: Record<ChangeCategory, number> = {
    STRUCTURAL: 0,
    INTERFACE: 0,
    BEHAVIORAL: 0,
    CONFIGURATION: 0,
  };
  for (const change of changes) {
    changeBreakdown[change.changeType] += 1;
  }

  const frontendComponentsAffected = [
    ...impact.directImpact,
    ...impact.indirectImpact,
  ].filter(
    (item) =>
      item.node.type === "COMPONENT" ||
      /\.(tsx|jsx)$/.test(item.node.file) ||
      /components?\//i.test(item.node.file),
  ).length;

  const databaseModelsAffected = [
    ...impact.changedNodes,
    ...impact.directImpact.map((i) => i.node),
    ...impact.indirectImpact.map((i) => i.node),
  ].filter(
    (node) =>
      node.type === "DATABASE_MODEL" ||
      /model|schema|entity|prisma/i.test(node.file),
  ).length;

  const summary = [
    `PR #${pullRequest.number} “${pullRequest.title}” changes ${changes.length} files.`,
    impact.summary,
    changeBreakdown.INTERFACE > 0
      ? `${changeBreakdown.INTERFACE} file(s) include interface/signature changes.`
      : null,
    impact.missingTests.length > 0
      ? `${impact.missingTests.length} dependent area(s) may lack direct tests.`
      : "Relevant tests were mapped where possible.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    filesChanged: changes.length,
    functionsModified: functionsModified.size || impact.changedNodes.filter((n) => n.type === "FUNCTION").length,
    directDependencies: impact.directImpact.length,
    indirectDependencies: impact.indirectImpact.length,
    apiRoutesAffected: impact.affectedApis.length,
    databaseModelsAffected,
    frontendComponentsAffected,
    relevantTests: impact.relatedTests.length,
    potentialMissingTests: impact.missingTests.length,
    complexityScore: impact.complexityScore,
    impactLevel: impactLevelFromScore(impact.complexityScore),
    summary,
    changedFiles: changes.map((c) => c.filePath),
    changeBreakdown,
  };
}
