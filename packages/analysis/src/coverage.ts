import type {
  AnalysisCoverageReport,
  AnalysisHealth,
  AnalysisTrustLevel,
  GraphEdge,
  InfraSignal,
  UnsupportedFileGroup,
} from "@gitimpact/shared";

function extensionKind(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  if (/^Dockerfile/i.test(base) || /docker-compose/i.test(base)) return "Docker";
  if (/\.tf$/i.test(base)) return "Terraform (HCL)";
  if (/\.ya?ml$/i.test(base)) return "YAML";
  if (/\.md$/i.test(base)) return "Markdown";
  if (/\.jsonnet$/i.test(base) || /\.libsonnet$/i.test(base)) return "Jsonnet";
  if (/\.py$/i.test(base)) return "Python";
  if (/\.go$/i.test(base)) return "Go";
  if (/\.rs$/i.test(base)) return "Rust";
  if (/\.java$/i.test(base)) return "Java";
  if (/\.rb$/i.test(base)) return "Ruby";
  if (/\.(ts|tsx)$/i.test(base)) return "TypeScript";
  if (/\.(js|jsx|mjs|cjs)$/i.test(base)) return "JavaScript";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "other";
  return ext || "other";
}

export function groupUnsupportedFiles(
  allRelativeFiles: string[],
  codePaths: Set<string>,
): UnsupportedFileGroup[] {
  const counts = new Map<string, { count: number; examples: string[] }>();
  for (const filePath of allRelativeFiles) {
    const normalized = filePath.replace(/\\/g, "/");
    if (codePaths.has(normalized)) continue;
    if (/(^|\/)\.git\//.test(normalized)) continue;
    const kind = extensionKind(normalized);
    // Skip lockfiles / noise from the trust panel
    if (/^(lock|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|map)$/i.test(kind)) continue;
    const cur = counts.get(kind) ?? { count: 0, examples: [] };
    cur.count += 1;
    if (cur.examples.length < 3) cur.examples.push(normalized);
    counts.set(kind, cur);
  }
  return [...counts.entries()]
    .map(([kind, value]) => ({
      kind,
      fileCount: value.count,
      examples: value.examples,
    }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 8);
}

function trustLabel(level: AnalysisTrustLevel): string {
  switch (level) {
    case "HIGH":
      return "High confidence";
    case "MEDIUM":
      return "Medium confidence";
    case "LOW":
      return "Low confidence";
    case "INCOMPLETE":
      return "Incomplete analysis";
  }
}

export function buildAnalysisCoverage(input: {
  analysisHealth: AnalysisHealth;
  graphEdges: GraphEdge[];
  graphNodeCount: number;
  allRelativeFiles?: string[];
  codeFilePaths?: string[];
  infraSignals?: InfraSignal[];
}): AnalysisCoverageReport {
  const health = input.analysisHealth;
  const infraPrimary =
    health.filesDiscovered === 0 && (input.infraSignals?.length ?? 0) > 0;

  const codeParseCoveragePercent =
    health.filesDiscovered > 0
      ? Math.round((100 * health.filesParsed) / health.filesDiscovered)
      : infraPrimary
        ? null
        : health.filesParsed > 0
          ? 100
          : null;

  let high = 0;
  let medium = 0;
  let low = 0;
  for (const edge of input.graphEdges) {
    if (edge.confidence === "HIGH") high += 1;
    else if (edge.confidence === "MEDIUM") medium += 1;
    else low += 1;
  }
  const edgeTotal = input.graphEdges.length;
  const highConfidenceEdgePercent =
    edgeTotal > 0 ? Math.round((100 * high) / edgeTotal) : null;

  const codePaths = new Set(
    (input.codeFilePaths ?? []).map((p) => p.replace(/\\/g, "/")),
  );
  const unsupportedGroups = groupUnsupportedFiles(
    input.allRelativeFiles ?? [],
    codePaths,
  );

  const reasons: string[] = [];
  if (health.truncated) {
    reasons.push(
      `File cap reached (${health.maxFilesCap ?? "limit"}). Some source files were not parsed.`,
    );
  }
  if (health.parseFailures > 0) {
    reasons.push(
      `${health.parseFailures} file${health.parseFailures === 1 ? "" : "s"} failed to parse.`,
    );
  }
  if (
    codeParseCoveragePercent !== null &&
    codeParseCoveragePercent < 100 &&
    health.filesDiscovered > 0
  ) {
    reasons.push(
      `Parsed ${health.filesParsed} of ${health.filesDiscovered} discovered code files (${codeParseCoveragePercent}%).`,
    );
  }
  if (health.filesUnsupported > 0) {
    const top = unsupportedGroups
      .slice(0, 3)
      .map((g) => `${g.kind} (${g.fileCount})`)
      .join(", ");
    reasons.push(
      top
        ? `${health.filesUnsupported} non-JS/TS inventory files were not parsed as code — top: ${top}.`
        : `${health.filesUnsupported} non-JS/TS inventory files were not parsed as code.`,
    );
  }
  if (highConfidenceEdgePercent !== null && highConfidenceEdgePercent < 60) {
    reasons.push(
      `Only ${highConfidenceEdgePercent}% of graph edges are high-confidence resolutions.`,
    );
  }
  if (infraPrimary) {
    reasons.push(
      "No JS/TS source was parsed; overview is driven by infrastructure manifests and inventory languages.",
    );
  }
  if (edgeTotal === 0 && health.filesParsed > 0) {
    reasons.push("No relationship edges were produced for parsed source files.");
  }

  let confidence: AnalysisTrustLevel = "HIGH";
  if (health.truncated || (health.filesDiscovered > 0 && (codeParseCoveragePercent ?? 100) < 50)) {
    confidence = "INCOMPLETE";
  } else if (
    (codeParseCoveragePercent !== null && codeParseCoveragePercent < 75) ||
    (highConfidenceEdgePercent !== null && highConfidenceEdgePercent < 40) ||
    health.parseFailures > Math.max(3, Math.floor(health.filesParsed * 0.05))
  ) {
    confidence = "LOW";
  } else if (
    (codeParseCoveragePercent !== null && codeParseCoveragePercent < 95) ||
    (highConfidenceEdgePercent !== null && highConfidenceEdgePercent < 70) ||
    health.filesUnsupported > health.filesParsed * 2 ||
    infraPrimary
  ) {
    confidence = infraPrimary && (input.infraSignals?.length ?? 0) >= 2 ? "MEDIUM" : "MEDIUM";
  } else if (infraPrimary) {
    confidence = "MEDIUM";
  }

  // Infra-only with clear signals is trustworthy for that shape.
  if (infraPrimary && (input.infraSignals?.length ?? 0) >= 2 && !health.truncated) {
    confidence = "HIGH";
    // Keep the infra-primary reason; drop edge-ratio noise
  }

  if (reasons.length === 0 && confidence === "HIGH") {
    reasons.push("Parse coverage and relationship resolution look solid for this repository.");
  }

  return {
    confidence,
    confidenceLabel: trustLabel(confidence),
    codeParseCoveragePercent,
    highConfidenceEdgePercent,
    reasons: reasons.slice(0, 6),
    inventory: { ...health },
    unsupportedGroups,
    graph: {
      nodes: input.graphNodeCount,
      edges: edgeTotal,
      highConfidenceEdges: high,
      mediumConfidenceEdges: medium,
      lowConfidenceEdges: low,
    },
    infraPrimary,
  };
}
