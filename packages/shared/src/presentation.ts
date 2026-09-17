import type {
  GraphNode,
  ImpactPathStep,
  ImpactReport,
  RelationType,
} from "./index.js";

const RELATION_LABELS: Record<RelationType, string> = {
  IMPORTS: "imports",
  CALLS: "calls",
  USES: "uses",
  EXTENDS: "extends",
  IMPLEMENTS: "implements",
  READS: "reads",
  WRITES: "writes",
  QUERIES: "queries",
  EMITS: "emits",
  LISTENS_TO: "listens to",
  DEPENDS_ON: "depends on",
  HANDLED_BY: "handled by",
  TESTS: "tests",
  RENDERS: "renders",
  FETCHES: "fetches",
  CONFIGURES: "configures",
  DEPLOYS: "deploys",
  EXPORTS: "exports",
  CONTAINS: "contains",
};

export function relationLabel(type: RelationType | string): string {
  return RELATION_LABELS[type as RelationType] ?? String(type).toLowerCase().replace(/_/g, " ");
}

export function formatRelationshipChain(
  steps: ImpactPathStep[],
  options?: { arrow?: string },
): string {
  const arrow = options?.arrow ?? "→";
  if (steps.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (i > 0 && step.edgeType) {
      parts.push(relationLabel(step.edgeType).toUpperCase());
    }
    parts.push(step.name);
  }
  // Prefer readable "A → CALLS → B" style when edge types present
  if (steps.some((s) => s.edgeType)) {
    return parts.join(` ${arrow} `);
  }
  return steps.map((s) => s.name).join(` ${arrow} `);
}

export function formatPlainImpactPath(steps: ImpactPathStep[]): string {
  return steps
    .map((step, index) => {
      if (index === 0) return step.name;
      const rel = step.edgeType ? ` ${relationLabel(step.edgeType)} ` : " → ";
      return `${rel}${step.name}`;
    })
    .join("");
}

export function formatImpactSummaryMarkdown(input: {
  componentName: string;
  impact: ImpactReport;
  paths?: Array<{ label?: string; steps: ImpactPathStep[] }>;
  analysisUrl?: string;
}): string {
  const { componentName, impact, paths = [], analysisUrl } = input;
  const keyPaths =
    paths.length > 0
      ? paths.slice(0, 5).map((p) => {
          const chain = formatRelationshipChain(p.steps, { arrow: "→" });
          return `• ${chain}`;
        })
      : impact.directImpact.slice(0, 5).map((item) => {
          const via =
            item.relationshipPath.length > 0
              ? item.relationshipPath
                  .map((id) => {
                    const leaf = id.split(":").pop() ?? id;
                    // Drop internal prefixes like METHOD/FUNCTION when present as first segment
                    return leaf.includes(".") || !id.includes(":")
                      ? leaf
                      : leaf;
                  })
                  .filter((part) => part && !/^(METHOD|FUNCTION|CLASS|FILE|API_ROUTE)$/.test(part))
                  .join(" → ")
              : item.node.name;
          return `• ${via || item.node.name}`;
        });

  const lines = [
    "GitImpact — Change Impact",
    "",
    "Component:",
    componentName,
    "",
    `Direct dependents: ${impact.directImpact.length}`,
    `Indirect dependents: ${impact.indirectImpact.length}`,
    `Affected APIs: ${impact.affectedApis.length}`,
    `Related tests: ${impact.relatedTests.length}`,
    `Potential test gaps: ${impact.missingTests.length}`,
    "",
  ];

  if (keyPaths.length > 0) {
    lines.push("Key impact paths:");
    lines.push(...keyPaths);
    lines.push("");
  }

  lines.push(`Complexity: ${impact.complexityScore}/100`);
  if (analysisUrl) {
    lines.push("");
    lines.push(`GitImpact: ${analysisUrl}`);
  }

  return lines.join("\n");
}

export function formatBlastRadiusExplanation(input: {
  componentName: string;
  impact: ImpactReport;
}): string {
  return [
    `What could be affected if ${input.componentName} changes?`,
    "",
    `Directly affected: ${input.impact.directImpact.length}`,
    `Indirectly affected: ${input.impact.indirectImpact.length}`,
    `Affected APIs: ${input.impact.affectedApis.length}`,
    `Affected tests: ${input.impact.relatedTests.length}`,
    `Potential coverage gaps: ${input.impact.missingTests.length}`,
  ].join("\n");
}

export function explainTestGap(input: {
  gapNode: GraphNode;
  changedNodes: GraphNode[];
}): { title: string; why: string } {
  const changed =
    input.changedNodes[0]?.name ??
    input.changedNodes[0]?.file ??
    "a changed symbol";
  return {
    title: "Potential test gap",
    why: `${input.gapNode.name} depends on ${changed}, which changed in this analysis, but GitImpact did not find a directly associated test covering that dependency.`,
  };
}

export function explainMissingTestForSymbol(input: {
  symbolName: string;
  gapName: string;
}): string {
  return `This ${input.gapName.includes("Service") || input.gapName.includes("Controller") ? "component" : "symbol"} (${input.gapName}) may be affected by changes to ${input.symbolName}, but no directly related test was identified.`;
}

const SEMANTIC_LABELS: Record<string, string> = {
  METHOD_ADDED: "Method added",
  METHOD_REMOVED: "Method removed",
  FUNCTION_ADDED: "Function added",
  FUNCTION_REMOVED: "Function removed",
  PARAMETER_ADDED: "Parameter added",
  PARAMETER_REMOVED: "Parameter removed",
  PARAMETER_RENAMED: "Parameter renamed",
  RETURN_TYPE_CHANGED: "Return type changed",
  CALL_ADDED: "Call added",
  CALL_REMOVED: "Call removed",
  BODY_CHANGED: "Body changed",
  CLASS_ADDED: "Class added",
  CLASS_REMOVED: "Class removed",
  EXPORT_ADDED: "Export added",
  EXPORT_REMOVED: "Export removed",
  SIGNATURE_CHANGED: "Signature changed",
  IMPORT_ADDED: "Import added",
  IMPORT_REMOVED: "Import removed",
};

export function humanizeSemanticEvent(kind: string): string {
  if (SEMANTIC_LABELS[kind]) return SEMANTIC_LABELS[kind];
  return kind
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const CHANGE_CATEGORY_LABELS: Record<string, string> = {
  STRUCTURAL: "Structural",
  INTERFACE: "Interface",
  BEHAVIORAL: "Behavioral",
  CONFIGURATION: "Configuration",
};

/** Human labels for ChangeCategory (STRUCTURAL → Structural, etc.) */
export function humanizeChangeCategory(category: string): string {
  if (CHANGE_CATEGORY_LABELS[category]) return CHANGE_CATEGORY_LABELS[category];
  return humanizeSemanticEvent(category);
}

const IMPACT_LEVEL_LABELS: Record<string, string> = {
  Low: "Low",
  Moderate: "Moderate",
  Elevated: "Elevated",
  Critical: "Critical",
};

export function humanizeImpactLevel(level: string): string {
  return IMPACT_LEVEL_LABELS[level] ?? humanizeSemanticEvent(level);
}

export function formatSemanticEventDetail(event: {
  kind: string;
  name: string;
  className?: string;
  details?: Record<string, unknown>;
}): { label: string; subject: string; detail?: string } {
  const label = humanizeSemanticEvent(event.kind);
  const subject = event.className ? `${event.className}.${event.name}` : event.name;
  const details = event.details ?? {};
  let detail: string | undefined;
  if (typeof details.parameter === "string") {
    detail = `Parameter: ${details.parameter}${
      typeof details.type === "string" ? `: ${details.type}` : ""
    }`;
  } else if (typeof details.addedParameter === "string") {
    detail = `Added parameter: ${details.addedParameter}${
      typeof details.type === "string" ? `: ${details.type}` : ""
    }`;
  } else if (typeof details.removedParameter === "string") {
    detail = `Removed parameter: ${details.removedParameter}`;
  } else if (typeof details.returnType === "string") {
    detail = `Return type: ${details.returnType}`;
  } else if (typeof details.callee === "string") {
    detail = `Call: ${details.callee}`;
  } else if (typeof details.before === "string" || typeof details.after === "string") {
    detail = [details.before, details.after].filter(Boolean).join(" → ");
  }
  return { label, subject, detail };
}
