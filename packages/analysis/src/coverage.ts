import type {
  AnalysisCoverageReport,
  AnalysisHealth,
  AnalysisTrustLevel,
  ConfidenceLevel,
  FrameworkDetectionConfidence,
  GraphEdge,
  InfraSignal,
  ParsedFile,
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
  if (/\.lua$/i.test(base)) return "Lua";
  if (/\.sql$/i.test(base)) return "SQL";
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

const PRODUCT_FRAMEWORKS = new Set([
  "NestJS",
  "Next.js",
  "Remix",
  "tRPC",
  "TanStack Query",
  "Payload",
  "Drizzle",
  "Prisma",
  "Solid",
  "Lit",
  "BullMQ",
  "Zustand",
  "MSW",
  "Socket.IO",
  "Formik",
  "Vite",
  "Hono",
  "Fastify",
  "Koa",
  "Express",
  "React",
  "Vue",
  "Angular",
  "Zod",
  "Preact",
  "Flask",
  "FastAPI",
  "Django",
  "Celery",
  "SQLAlchemy",
]);

/** Score framework labels so adapters / supporting libs read as Medium when a product stack is present. */
export function scoreFrameworkConfidence(
  frameworks: string[],
): FrameworkDetectionConfidence[] {
  if (frameworks.length === 0) return [];
  const set = new Set(frameworks);
  const hasProduct = frameworks.some(
    (f) => PRODUCT_FRAMEWORKS.has(f) && f !== "Express" && f !== "React" && f !== "Zod",
  );

  return frameworks.map((name) => {
    let confidence: ConfidenceLevel = "HIGH";
    if (name === "Express" && (set.has("NestJS") || set.has("Remix") || set.has("tRPC"))) {
      confidence = "MEDIUM";
    } else if (name === "Zod" && set.has("Payload")) {
      confidence = "MEDIUM";
    } else if (name === "React" && hasProduct && !set.has("Next.js") && !set.has("Remix")) {
      confidence = "MEDIUM";
    } else if (!PRODUCT_FRAMEWORKS.has(name)) {
      confidence = "MEDIUM";
    }
    return { name, confidence };
  });
}

export function buildBlindSpots(input: {
  unsupportedGroups: UnsupportedFileGroup[];
  analysisHealth: AnalysisHealth;
  files?: ParsedFile[];
  graphEdges?: GraphEdge[];
}): string[] {
  const spots: string[] = [];
  const health = input.analysisHealth;

  if (health.truncated) {
    spots.push(
      `File cap reached (${health.maxFilesCap ?? "limit"}) — some source was skipped`,
    );
  }
  if (health.parseFailures > 0) {
    spots.push(
      `${health.parseFailures} parse failure${health.parseFailures === 1 ? "" : "s"}`,
    );
  }

  const languageBlind = new Set([
    "Go",
    "Rust",
    "Java",
    "Ruby",
    "Lua",
    "SQL",
    "Terraform (HCL)",
  ]);
  for (const group of input.unsupportedGroups) {
    if (languageBlind.has(group.kind) && group.fileCount > 0) {
      if (group.kind === "Lua") {
        spots.push(
          `${group.fileCount} Lua file${group.fileCount === 1 ? "" : "s"} unsupported — may contain Redis-side job/worker logic`,
        );
      } else if (group.kind === "SQL") {
        spots.push(
          `${group.fileCount} SQL file${group.fileCount === 1 ? "" : "s"} unsupported — schema/migration logic not in the graph`,
        );
      } else {
        spots.push(
          `${group.fileCount} ${group.kind} file${group.fileCount === 1 ? "" : "s"} unsupported`,
        );
      }
    }
  }

  let unresolvedDynamic = 0;
  for (const file of input.files ?? []) {
    for (const imp of file.imports) {
      if (imp.isDynamic && !imp.resolvedPath) unresolvedDynamic += 1;
    }
  }
  if (unresolvedDynamic > 0) {
    spots.push(
      `${unresolvedDynamic} dynamic import${unresolvedDynamic === 1 ? "" : "s"} unresolved`,
    );
  }

  const pythonFiles = (input.files ?? []).filter((f) => f.language === "python");
  if (pythonFiles.length > 0) {
    const py = input.analysisHealth.pythonProject;
    if (py && py.packageManagers.length === 0 && py.manifests.length === 0) {
      spots.push("Python files present without a detected packaging manifest");
    }
    // Honest limits of the heuristic Python surface
    spots.push(
      "Python analysis is heuristic — dynamic imports, monkeypatch, runtime decorators, and metaclasses may be missed",
    );
  }

  const lowEdges = (input.graphEdges ?? []).filter((e) => e.confidence === "LOW").length;
  if (lowEdges >= 10) {
    spots.push(`${lowEdges} low-confidence relationship edges`);
  }

  if (health.filesIgnored > 0 && health.filesIgnored >= 10) {
    spots.push(`${health.filesIgnored} paths ignored by inventory rules`);
  }

  return spots.slice(0, 8);
}

export function buildAnalysisCoverage(input: {
  analysisHealth: AnalysisHealth;
  graphEdges: GraphEdge[];
  graphNodeCount: number;
  allRelativeFiles?: string[];
  codeFilePaths?: string[];
  infraSignals?: InfraSignal[];
  frameworks?: string[];
  files?: ParsedFile[];
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
  const mediumPercent = edgeTotal > 0 ? Math.round((100 * medium) / edgeTotal) : null;
  const lowPercent = edgeTotal > 0 ? Math.round((100 * low) / edgeTotal) : null;

  const codePaths = new Set(
    (input.codeFilePaths ?? []).map((p) => p.replace(/\\/g, "/")),
  );
  const unsupportedGroups = groupUnsupportedFiles(
    input.allRelativeFiles ?? [],
    codePaths,
  );

  const frameworks = scoreFrameworkConfidence(input.frameworks ?? []);
  const blindSpots = buildBlindSpots({
    unsupportedGroups,
    analysisHealth: health,
    files: input.files,
    graphEdges: input.graphEdges,
  });

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
  // Explicit MEDIUM explanation when unsupported formats dwarf the parse surface
  if (
    health.filesUnsupported > health.filesParsed * 2 &&
    health.filesParsed > 0
  ) {
    const lua = unsupportedGroups.find((g) => g.kind === "Lua");
    const sql = unsupportedGroups.find((g) => g.kind === "SQL");
    const bits: string[] = [];
    if (lua) bits.push(`Lua scripts (${lua.fileCount}) that may hold Redis-side logic`);
    if (sql) bits.push(`SQL files (${sql.fileCount})`);
    const detail =
      bits.length > 0
        ? `, including ${bits.join(" and ")}`
        : ` (top: ${unsupportedGroups
            .slice(0, 2)
            .map((g) => g.kind)
            .join(", ")})`;
    reasons.push(
      `Medium confidence is intentional: ${health.filesUnsupported} files use unsupported formats${detail}.`,
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
    confidence = "MEDIUM";
  }

  // Infra-only with clear signals is trustworthy for that shape.
  if (infraPrimary && (input.infraSignals?.length ?? 0) >= 2 && !health.truncated) {
    confidence = "HIGH";
  }

  if (reasons.length === 0 && confidence === "HIGH") {
    reasons.push("Parse coverage and relationship resolution look solid for this repository.");
  }

  return {
    confidence,
    confidenceLabel: trustLabel(confidence),
    codeParseCoveragePercent,
    highConfidenceEdgePercent,
    edgeConfidence: {
      highPercent: highConfidenceEdgePercent,
      mediumPercent,
      lowPercent,
    },
    frameworks,
    blindSpots,
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
