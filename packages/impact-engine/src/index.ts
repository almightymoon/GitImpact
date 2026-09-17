import { GraphStore } from "@gitimpact/graph";
import {
  analyzeSemanticDiff,
  enclosingSymbolToNodeId,
  mapPatchToEnclosingSymbols,
  semanticEventsToChangeCategory,
} from "@gitimpact/parser";
import type {
  ChangeCategory,
  ChangeRecord,
  ComplexityFactor,
  ConfidenceLevel,
  GraphNode,
  ImpactPathStep,
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

function severityForDepth(depth: number, node: GraphNode): ImpactSeverity {
  const haystack = `${node.name} ${node.file}`.toLowerCase();
  const critical = CRITICAL_HINTS.some((hint) => haystack.includes(hint));
  if (depth === 0) return "CRITICAL";
  if (critical && depth <= 2) return "CRITICAL";
  if (depth === 1) return "HIGH";
  if (depth === 2) return "MEDIUM";
  return "NEUTRAL";
}

function confidenceFromPath(store: GraphStore, fromId: string, toId: string): ConfidenceLevel {
  const edge = store.getIncoming(toId).find((e) => e.from === fromId);
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
      // Skip pure CONTAINS parents bubbling as "impact" noise? No — incoming to a method
      // includes callers (CALLS) and class/file via CONTAINS (file→method). Incoming means
      // edges pointing TO the changed node. FILE CONTAINS METHOD means FILE→METHOD, so
      // incoming to METHOD includes FILE. That's wrong for blast radius — changing a method
      // shouldn't list the containing file as a dependent.
      // Dependents should be nodes that depend on the changed node (callers, importers).
      // Incoming edges: CALLS from caller→callee means caller is dependent. Good.
      // CONTAINS from file→method: file is NOT a dependent of method.
      // CONFIGURES from file→route: etc.
      const linkingEdges = store.getIncoming(current.node.id).filter((e) => e.from === dependent.id);
      const isStructuralContainer = linkingEdges.every(
        (e) => e.type === "CONTAINS" || e.type === "EXPORTS",
      );
      if (isStructuralContainer) continue;

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

function isAuthSensitive(nodes: GraphNode[]): boolean {
  return nodes.some((node) =>
    CRITICAL_HINTS.some((hint) => `${node.name} ${node.file}`.toLowerCase().includes(hint)),
  );
}

function buildComplexityBreakdown(input: {
  changedNodes: GraphNode[];
  directImpact: ImpactedNode[];
  indirectImpact: ImpactedNode[];
  affectedApis: GraphNode[];
  missingTests: GraphNode[];
}): { score: number; factors: ComplexityFactor[] } {
  const factors: ComplexityFactor[] = [];

  const changedPoints = input.changedNodes.length * 4;
  if (changedPoints > 0) {
    factors.push({
      label: "Changed symbols",
      points: changedPoints,
      detail: `${input.changedNodes.length} changed node(s)`,
    });
  }

  const directPoints = input.directImpact.length * 3;
  if (directPoints > 0) {
    factors.push({
      label: "Direct dependents",
      points: directPoints,
      detail: `${input.directImpact.length} direct dependent(s)`,
    });
  }

  const indirectPoints = input.indirectImpact.length;
  if (indirectPoints > 0) {
    factors.push({
      label: "Downstream dependencies",
      points: indirectPoints,
      detail: `${input.indirectImpact.length} indirect dependent(s)`,
    });
  }

  const apiPoints = input.affectedApis.length * 5;
  if (apiPoints > 0) {
    factors.push({
      label: "Public API surface",
      points: apiPoints,
      detail: `${input.affectedApis.length} API-related node(s)`,
    });
  }

  const gapPoints = input.missingTests.length * 6;
  if (gapPoints > 0) {
    factors.push({
      label: "Uncovered areas",
      points: gapPoints,
      detail: `${input.missingTests.length} dependent area(s) without direct tests`,
    });
  }

  const authBonus = isAuthSensitive([
    ...input.changedNodes,
    ...input.directImpact.map((i) => i.node),
  ])
    ? 15
    : 0;
  if (authBonus > 0) {
    factors.push({
      label: "Sensitive area",
      points: authBonus,
      detail: "Touches authentication/security-related symbols",
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.min(100, raw), factors };
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

  const affectedFiles = [...new Set(all.map((item) => item.node.file))].sort();

  const affectedApis = all.map((item) => item.node).filter(isApiNode);
  const relatedTests = all.map((item) => item.node).filter(isTestNode);

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
    const hasTest = relatedTests.some((test) =>
      store
        .getOutgoing(test.id)
        .some((edge) => edge.to === item.node.id || edge.to === `FILE:${item.node.file}`),
    );
    return !hasTest;
  });

  const { score, factors } = buildComplexityBreakdown({
    changedNodes,
    directImpact,
    indirectImpact,
    affectedApis,
    missingTests: consumersWithoutTests.map((c) => c.node),
  });

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
    complexityScore: score,
    complexityBreakdown: factors,
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
    parts.push(
      `${input.gapCount} dependent areas appear to lack directly associated tests.`,
    );
  }
  return parts.join(" ");
}

/** Prefer exact METHOD/FUNCTION/CLASS nodes over whole-file blast radius. */
export function mapChangedFilesToNodes(
  store: GraphStore,
  changedFiles: string[],
): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const file of changedFiles) {
    const symbols = store
      .findNodesByFile(file)
      .filter((n) => n.type === "FUNCTION" || n.type === "METHOD" || n.type === "CLASS");
    if (symbols.length > 0 && symbols.length <= 12) {
      nodes.push(...symbols);
      continue;
    }
    const fileNode = store.findFileNode(file);
    if (fileNode) nodes.push(fileNode);
  }
  return dedupeNodes(nodes);
}

export function mapChangesToSymbolNodes(
  store: GraphStore,
  changes: ChangeRecord[],
  contentsByPath?: Map<string, string>,
): GraphNode[] {
  const nodes: GraphNode[] = [];

  for (const change of changes) {
    const content = contentsByPath?.get(change.filePath);
    let mappedFromAst = false;

    // Semantic Diff (v0.4): old AST vs new AST → exact changed symbols
    if (content && change.patch) {
      const semantic = analyzeSemanticDiff(change.filePath, content, change.patch);
      change.semanticEvents = semantic.events;
      if (!change.symbols?.length && semantic.changedSymbolIds.length) {
        change.symbols = semantic.changedSymbols.map((s) => s.name);
      }
      if (semantic.events.length) {
        change.changeType = semanticEventsToChangeCategory(semantic.events);
      }

      for (const symbol of semantic.changedSymbols) {
        const id = enclosingSymbolToNodeId(symbol);
        const node = store.getNode(id);
        if (node) {
          nodes.push(node);
          mappedFromAst = true;
        } else {
          // Removed symbols may be absent from the HEAD graph — try name lookup.
          const found = store.findSymbolNodes(change.filePath, symbol.name);
          if (found.length) {
            nodes.push(...found);
            mappedFromAst = true;
          }
        }
      }

      // Diff-to-AST fallback for residual line anchors
      if (!mappedFromAst) {
        const enclosing = mapPatchToEnclosingSymbols(
          change.filePath,
          content,
          change.patch,
        );
        for (const symbol of enclosing) {
          const id = enclosingSymbolToNodeId(symbol);
          const node = store.getNode(id);
          if (node) {
            nodes.push(node);
            mappedFromAst = true;
          } else {
            const found = store.findSymbolNodes(change.filePath, symbol.name);
            if (found.length) {
              nodes.push(...found);
              mappedFromAst = true;
            }
          }
        }
      }
    }

    if (mappedFromAst) continue;

    // Fallback: regex symbol names from the patch
    const symbols = change.symbols?.length
      ? change.symbols
      : change.symbolName
        ? [change.symbolName]
        : extractChangedSymbols(change.patch);

    if (symbols.length > 0) {
      for (const symbol of symbols) {
        nodes.push(...store.findSymbolNodes(change.filePath, symbol));
      }
      continue;
    }

    const fileNode = store.findFileNode(change.filePath);
    if (fileNode) nodes.push(fileNode);
  }

  const deduped = dedupeNodes(nodes);
  if (deduped.length > 0) return deduped;

  return mapChangedFilesToNodes(
    store,
    changes.map((c) => c.filePath),
  );
}

function dedupeNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

export function explainImpactPath(
  store: GraphStore,
  relationshipPath: string[],
): ImpactPathStep[] {
  const steps = store.explainPath(relationshipPath);
  return steps.map((step) => ({
    nodeId: step.node.id,
    name: step.node.name,
    file: step.node.file,
    type: step.node.type,
    edgeType: step.edgeType,
  }));
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
    // class methods: +  generateToken(user) or + async generateToken(
    /^[\+\-]\s+(?:public\s+|private\s+|protected\s+|async\s+|static\s+)*(?:async\s+)?([A-Za-z_][\w$]*)\s*\(/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(patch)) !== null) {
      const name = match[1];
      if (
        !["if", "for", "while", "switch", "catch", "return", "await", "typeof"].includes(name)
      ) {
        names.add(name);
      }
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
    functionsModified:
      functionsModified.size ||
      impact.changedNodes.filter((n) => n.type === "FUNCTION" || n.type === "METHOD")
        .length,
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
