import type {
  ArchitectureCategory,
  ArchitectureComponent,
  ArchitectureEdge,
  ArchitectureLevel,
  ArchitectureMap,
  ArchitectureMode,
  ArchitectureWalkthroughStep,
  ConfidenceLevel,
  DependencyGraph,
  DetectedRoute,
  EdgeImportance,
  GraphEdge,
  GraphNode,
  InfraSignal,
  RepositoryType,
} from "@gitimpact/shared";
import { buildArchitectureMap, collectArchitectureArtifacts } from "../architecture-map.js";

export { collectArchitectureArtifacts };

const SYSTEM_CAP = 14;

function categoryFor(component: ArchitectureComponent): ArchitectureCategory {
  if (component.category) return component.category;
  const t = `${component.title} ${component.role}`.toLowerCase();
  if (component.shape === "actor" || component.band === "actors") return "external_actor";
  if (component.shape === "store" || /database|postgres|mysql|mongo|redis/i.test(t)) {
    return "database";
  }
  if (/auth/i.test(t)) return "authentication";
  if (/api|route|handler|controller/i.test(t)) return "api";
  if (/queue|worker|job|bull|kafka/i.test(t)) return "queue";
  if (/storage|s3|blob|file store/i.test(t)) return "storage";
  if (/ci|workflow|github actions/i.test(t)) return "ci_cd";
  if (component.band === "deployment" || /docker|k8s|helm|terraform|hosting|proxy|compose/i.test(t)) {
    return "deployment";
  }
  if (component.band === "client" || /frontend|browser|ui|client/i.test(t)) return "frontend";
  if (component.band === "server" || /backend|server|service/i.test(t)) return "backend";
  if (component.band === "persistence" || /data access|schema|prisma|drizzle/i.test(t)) {
    return "data";
  }
  if (/external|stripe|github|webhook/i.test(t)) return "external_service";
  if (component.band === "shared") return "shared";
  return "other";
}

function importanceForLabel(label: string, fromBand: string, toBand: string): EdgeImportance {
  const l = label.toLowerCase();
  if (/deploy|build|package|bundle|host|expose|configure/i.test(l)) return "DEPLOYMENT";
  if (/config/i.test(l)) return "CONFIGURATION";
  if (
    /address|load|fetch|call|quer|request|secur|use|own|host(?!ing)/i.test(l) ||
    (fromBand === "actors" && (toBand === "client" || toBand === "server")) ||
    (fromBand === "client" && toBand === "server") ||
    (fromBand === "server" && toBand === "persistence")
  ) {
    return "PRIMARY";
  }
  return "SECONDARY";
}

function modesForImportance(importance: EdgeImportance): ArchitectureMode[] {
  switch (importance) {
    case "PRIMARY":
      return ["architecture", "runtime", "data", "all"];
    case "SECONDARY":
      return ["architecture", "runtime", "all"];
    case "CONFIGURATION":
      return ["architecture", "all"];
    case "DEPLOYMENT":
      return ["deployment", "architecture", "all"];
    default:
      return ["all"];
  }
}

function describeSystem(component: ArchitectureComponent, category: ArchitectureCategory): string {
  if (component.description) return component.description;
  switch (category) {
    case "external_actor":
      return "Outside the system boundary — initiates requests or receives events.";
    case "frontend":
      return "User-facing application surface that loads in the browser.";
    case "backend":
      return "Server-side runtime that handles business logic and orchestration.";
    case "api":
      return "HTTP entrypoints that accept and route client requests.";
    case "authentication":
      return "Identity, session, and access-control logic.";
    case "data":
      return "Application data-access layer between services and storage.";
    case "database":
      return "Persistent store for application state.";
    case "storage":
      return "File or object storage outside the primary database.";
    case "deployment":
      return "How the system is packaged, shipped, and hosted.";
    case "ci_cd":
      return "Continuous integration and delivery pipelines.";
    case "queue":
      return "Asynchronous work and background processing.";
    case "external_service":
      return "Third-party systems the application integrates with.";
    case "shared":
      return "Shared contracts, utilities, and cross-cutting modules.";
    default:
      return component.role;
  }
}

function countByFile(
  files: string[],
  graphNodes: GraphNode[],
  routes: DetectedRoute[],
): { symbolCount: number; routeCount: number; testCount: number; graphNodeIds: string[] } {
  const fileSet = new Set(files.map((f) => f.replace(/\\/g, "/")));
  const related = graphNodes.filter((n) => fileSet.has(n.file.replace(/\\/g, "/")));
  const symbolCount = related.filter(
    (n) =>
      n.type === "FUNCTION" ||
      n.type === "METHOD" ||
      n.type === "CLASS" ||
      n.type === "COMPONENT" ||
      n.type === "HOOK",
  ).length;
  const routeCount = routes.filter((r) => fileSet.has(r.file.replace(/\\/g, "/"))).length;
  const testCount = related.filter((n) => n.type === "TEST").length;
  return {
    symbolCount,
    routeCount,
    testCount,
    graphNodeIds: related.map((n) => n.id).slice(0, 80),
  };
}

function clusterDeployment(components: ArchitectureComponent[]): ArchitectureComponent[] {
  const deployKids = components.filter(
    (c) => c.band === "deployment" && c.level !== "COMPONENT" && c.level !== "CODE",
  );
  if (deployKids.length <= 1) return components;

  const others = components.filter((c) => !deployKids.includes(c));
  const files = [...new Set(deployKids.flatMap((c) => c.files))];
  const childIds = deployKids.map((c) => c.id);
  const parent: ArchitectureComponent = {
    id: "deployment:Deployment",
    band: "deployment",
    title: "Deployment",
    role: "CI, containers, and hosting",
    description: "Bundled packaging, CI/CD, and hosting systems.",
    files: files.slice(0, 12),
    shape: "box",
    level: "SYSTEM",
    category: "deployment",
    childIds,
    fileCount: files.length,
  };

  const children = deployKids.map((c) => ({
    ...c,
    level: "COMPONENT" as const,
    parentId: parent.id,
    category: categoryFor(c),
    childIds: c.childIds ?? [],
    fileCount: c.files.length,
    description: describeSystem(c, categoryFor(c)),
  }));

  return [...others, parent, ...children];
}

function buildCodeChildren(
  systems: ArchitectureComponent[],
  graphNodes: GraphNode[],
): ArchitectureComponent[] {
  const codeNodes: ArchitectureComponent[] = [];
  for (const system of systems) {
    if (system.level === "CODE" || system.level === "COMPONENT") continue;
    if (system.shape === "actor" || system.shape === "store") continue;
    if ((system.childIds?.length ?? 0) > 0) continue; // already has component children (deployment)

    const fileSet = new Set(system.files.map((f) => f.replace(/\\/g, "/")));
    const symbols = graphNodes
      .filter(
        (n) =>
          fileSet.has(n.file.replace(/\\/g, "/")) &&
          (n.type === "CLASS" ||
            n.type === "FUNCTION" ||
            n.type === "METHOD" ||
            n.type === "CONTROLLER" ||
            n.type === "SERVICE" ||
            n.type === "API_ROUTE" ||
            n.type === "FILE"),
      )
      .slice(0, 12);

    // Prefer grouping by file first as COMPONENT, then symbols as CODE under a synthetic component
    const byFile = new Map<string, GraphNode[]>();
    for (const sym of symbols) {
      const list = byFile.get(sym.file) ?? [];
      list.push(sym);
      byFile.set(sym.file, list);
    }

    const componentIds: string[] = [];
    for (const [file, syms] of [...byFile.entries()].slice(0, 6)) {
      const fileName = file.split("/").pop() ?? file;
      const componentId = `${system.id}/comp:${file}`;
      componentIds.push(componentId);
      const codeIds: string[] = [];
      for (const sym of syms.filter((s) => s.type !== "FILE").slice(0, 8)) {
        const codeId = `${componentId}/code:${sym.id}`;
        codeIds.push(codeId);
        codeNodes.push({
          id: codeId,
          band: system.band,
          title: sym.name,
          role: sym.type.toLowerCase(),
          description: `${sym.type} in ${fileName}`,
          pathHint: file,
          files: [file],
          shape: "box",
          level: "CODE",
          category: system.category,
          parentId: componentId,
          childIds: [],
          fileCount: 1,
          symbolCount: 1,
          graphNodeIds: [sym.id],
        });
      }
      codeNodes.push({
        id: componentId,
        band: system.band,
        title: fileName,
        role: "module file",
        description: `Implementation file under ${system.title}`,
        pathHint: file,
        files: [file],
        shape: "box",
        level: "COMPONENT",
        category: system.category,
        parentId: system.id,
        childIds: codeIds,
        fileCount: 1,
        symbolCount: syms.length,
        graphNodeIds: syms.map((s) => s.id),
      });
    }

    system.childIds = componentIds;
  }
  return codeNodes;
}

function enrichEdges(
  edges: ArchitectureEdge[],
  components: ArchitectureComponent[],
): ArchitectureEdge[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  return edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const importance =
      edge.importance ??
      importanceForLabel(edge.label, from?.band ?? "", to?.band ?? "");
    return {
      ...edge,
      importance,
      confidence: edge.confidence ?? ("HIGH" as ConfidenceLevel),
      modes: edge.modes ?? modesForImportance(importance),
      evidence: edge.evidence ?? [
        {
          kind: "semantic",
          detail: `${edge.label} relationship inferred from repository structure`,
        },
      ],
    };
  });
}

function rewriteDeploymentEdges(
  edges: ArchitectureEdge[],
  components: ArchitectureComponent[],
): ArchitectureEdge[] {
  const deploymentParent = components.find(
    (c) => c.id === "deployment:Deployment" && c.level === "SYSTEM",
  );
  if (!deploymentParent) return edges;

  const childIds = new Set(deploymentParent.childIds ?? []);
  const rewritten: ArchitectureEdge[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const fromIsChild = childIds.has(edge.from);
    const toIsChild = childIds.has(edge.to);
    if (!fromIsChild && !toIsChild) {
      rewritten.push(edge);
      continue;
    }
    // Bundle: Deployment → target application node
    const target = fromIsChild ? edge.to : edge.from;
    if (childIds.has(target) || target === deploymentParent.id) continue;
    const key = `${deploymentParent.id}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rewritten.push({
      from: deploymentParent.id,
      to: target,
      label: "deploys",
      importance: "DEPLOYMENT",
      confidence: "HIGH",
      modes: ["deployment", "architecture", "all"],
      evidence: [
        {
          kind: "bundled",
          detail: "Multiple deployment artifacts collapsed into a single DEPLOYS edge",
        },
      ],
    });
  }

  return rewritten;
}

function pickPrimaryFlow(components: ArchitectureComponent[]): string[] {
  const systems = components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM");
  const find = (...preds: Array<(c: ArchitectureComponent) => boolean>) =>
    systems.find((c) => preds.every((p) => p(c)));

  const browser = find((c) => /browser/i.test(c.title) || c.category === "external_actor");
  const frontend = find((c) => c.category === "frontend" || c.band === "client");
  const api = find((c) => c.category === "api");
  const backend = find(
    (c) => c.category === "backend" || (c.band === "server" && c.category !== "api"),
  );
  const auth = find((c) => c.category === "authentication");
  const data = find((c) => c.category === "data");
  const database = find((c) => c.category === "database" || c.shape === "store");

  const flow: ArchitectureComponent[] = [];
  const push = (c?: ArchitectureComponent) => {
    if (c && !flow.includes(c)) flow.push(c);
  };

  push(browser);
  push(frontend);
  push(api);
  push(backend);
  push(auth);
  push(data);
  push(database);

  if (flow.length < 2) {
    // Fall back to band order
    const order = ["actors", "client", "server", "persistence"] as const;
    for (const band of order) {
      const hit = systems.find((c) => c.band === band);
      push(hit);
    }
  }

  return flow.map((c) => c.id).slice(0, 6);
}

function buildWalkthrough(
  components: ArchitectureComponent[],
  edges: ArchitectureEdge[],
  primaryFlow: string[],
  routes: DetectedRoute[],
): ArchitectureWalkthroughStep[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const steps: ArchitectureWalkthroughStep[] = [];

  for (let i = 0; i < primaryFlow.length; i++) {
    const id = primaryFlow[i]!;
    const node = byId.get(id);
    if (!node) continue;
    const nextId = primaryFlow[i + 1];
    const edge = nextId
      ? edges.find((e) => e.from === id && e.to === nextId) ??
        edges.find((e) => e.from === nextId && e.to === id)
      : undefined;

    let body = describeSystem(node, node.category ?? categoryFor(node));
    if (node.category === "api" || node.category === "frontend") {
      if (routes.length > 0) {
        body += ` Detected ${routes.length} API route${routes.length === 1 ? "" : "s"} in this analysis.`;
      }
    }
    if (edge) {
      body += ` Next: ${edge.label} → ${byId.get(nextId!)?.title ?? "downstream"}.`;
    }

    steps.push({
      id: `step-${i + 1}`,
      title: `Step ${i + 1}: ${node.title}`,
      body,
      highlightNodeIds: nextId ? [id, nextId] : [id],
      highlightEdgeIds: edge ? [`${edge.from}->${edge.to}`] : [],
    });
  }

  const deployment = components.find(
    (c) => c.category === "deployment" && (c.level ?? "SYSTEM") === "SYSTEM",
  );
  if (deployment) {
    steps.push({
      id: "step-deploy",
      title: `Step ${steps.length + 1}: ${deployment.title}`,
      body: `${deployment.description ?? deployment.role} Packaging and delivery stay visually separate from the runtime path.`,
      highlightNodeIds: [deployment.id],
      highlightEdgeIds: edges
        .filter((e) => e.from === deployment.id || e.to === deployment.id)
        .map((e) => `${e.from}->${e.to}`)
        .slice(0, 3),
    });
  }

  return steps;
}

function capSystems(components: ArchitectureComponent[]): ArchitectureComponent[] {
  const systems = components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM");
  if (systems.length <= SYSTEM_CAP) return components;

  // Merge smallest shared/other into "Other modules"
  const ranked = [...systems].sort(
    (a, b) => (a.fileCount ?? a.files.length) - (b.fileCount ?? b.files.length),
  );
  const keep = new Set(
    systems
      .filter((c) => c.shape === "actor" || c.shape === "store" || c.category === "deployment")
      .map((c) => c.id),
  );
  for (const s of systems) {
    if (keep.size >= SYSTEM_CAP - 1) break;
    if (
      s.category === "frontend" ||
      s.category === "backend" ||
      s.category === "api" ||
      s.category === "authentication" ||
      s.category === "data" ||
      s.category === "database"
    ) {
      keep.add(s.id);
    }
  }
  for (const s of ranked.reverse()) {
    if (keep.size >= SYSTEM_CAP - 1) break;
    keep.add(s.id);
  }

  const dropped = systems.filter((s) => !keep.has(s.id));
  if (dropped.length === 0) return components;

  const rest = components.filter(
    (c) => (c.level ?? "SYSTEM") !== "SYSTEM" || keep.has(c.id),
  );
  const files = [...new Set(dropped.flatMap((d) => d.files))];
  rest.push({
    id: "shared:Other modules",
    band: "shared",
    title: "Other modules",
    role: "smaller systems grouped for readability",
    description: "Low-signal modules collapsed so the default view stays scannable.",
    files: files.slice(0, 12),
    shape: "box",
    level: "SYSTEM",
    category: "shared",
    childIds: [],
    fileCount: files.length,
  });
  return rest;
}

/**
 * Build the Architecture Experience projection:
 * SYSTEM (default) → COMPONENT → CODE, with edge importance and walkthrough.
 */
export function buildArchitectureExperience(input: {
  codeFiles: Array<{ path: string; type?: string }>;
  artifacts?: string[];
  infraSignals?: InfraSignal[];
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  routes?: DetectedRoute[];
  repositoryType?: RepositoryType;
  graph?: DependencyGraph;
}): ArchitectureMap {
  const base = buildArchitectureMap({
    codeFiles: input.codeFiles,
    artifacts: input.artifacts,
    infraSignals: input.infraSignals,
    graphNodes: input.graphNodes,
  });

  const graphNodes = input.graphNodes ?? input.graph?.nodes ?? [];
  const routes = input.routes ?? [];

  let components: ArchitectureComponent[] = base.components.map((c) => {
    const category = categoryFor(c);
    const counts = countByFile(c.files, graphNodes, routes);
    return {
      ...c,
      level: "SYSTEM" as ArchitectureLevel,
      category,
      description: describeSystem(c, category),
      childIds: [] as string[],
      fileCount: c.files.length,
      symbolCount: counts.symbolCount,
      routeCount: counts.routeCount,
      testCount: counts.testCount,
      graphNodeIds: counts.graphNodeIds,
    };
  });

  components = clusterDeployment(components);
  const codeChildren = buildCodeChildren(components, graphNodes);
  components = [...components, ...codeChildren];
  components = capSystems(components);

  // Drop edges that reference removed system nodes
  const ids = new Set(components.map((c) => c.id));
  let edges = enrichEdges(
    base.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    components,
  );
  edges = rewriteDeploymentEdges(edges, components);
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  // Add graph-derived PRIMARY edges between systems when imports cross files
  if (input.graphEdges?.length && graphNodes.length) {
    const fileToSystem = new Map<string, string>();
    for (const c of components) {
      if ((c.level ?? "SYSTEM") !== "SYSTEM") continue;
      for (const f of c.files) fileToSystem.set(f.replace(/\\/g, "/"), c.id);
    }
    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    const pair = new Map<string, number>();
    for (const edge of input.graphEdges) {
      if (edge.type !== "IMPORTS" && edge.type !== "CALLS" && edge.type !== "FETCHES") continue;
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (!a || !b) continue;
      const sa = fileToSystem.get(a.file.replace(/\\/g, "/"));
      const sb = fileToSystem.get(b.file.replace(/\\/g, "/"));
      if (!sa || !sb || sa === sb) continue;
      const key = `${sa}->${sb}`;
      pair.set(key, (pair.get(key) ?? 0) + 1);
    }
    for (const [key, count] of pair) {
      if (count < 1) continue;
      const [from, to] = key.split("->") as [string, string];
      if (edges.some((e) => e.from === from && e.to === to)) continue;
      edges.push({
        from,
        to,
        label: "depends on",
        importance: "SECONDARY",
        confidence: "MEDIUM",
        modes: ["architecture", "runtime", "all"],
        evidence: [{ kind: "import_graph", detail: `${count} cross-system import/call edge(s)` }],
      });
    }
  }

  const primaryFlow = pickPrimaryFlow(components);
  const walkthrough = buildWalkthrough(components, edges, primaryFlow, routes);

  const systems = components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM");
  const layerCount = new Set(systems.map((c) => c.band)).size;
  const summary = {
    layerCount,
    componentCount: systems.length,
    apiRouteCount: routes.length,
    externalServiceCount: systems.filter(
      (c) => c.category === "external_actor" || c.category === "external_service",
    ).length,
    deploymentSystemCount: systems.filter((c) => c.category === "deployment" || c.category === "ci_cd")
      .length,
    primaryFlowLabel: primaryFlow
      .map((id) => components.find((c) => c.id === id)?.title)
      .filter(Boolean)
      .join(" → "),
  };

  const narrative = [
    summary.primaryFlowLabel
      ? `Primary flow: ${summary.primaryFlowLabel}.`
      : "Primary flow inferred from system roles.",
    `${summary.layerCount} layers · ${summary.componentCount} systems · ${summary.apiRouteCount} API routes.`,
    "Default view shows SYSTEM level only — expand a node for components and code.",
    ...base.narrative.slice(0, 2),
  ];

  return {
    components,
    edges,
    narrative,
    primaryFlow,
    walkthrough,
    summary,
    defaultMode: input.repositoryType === "GITOPS" || input.repositoryType === "DEVOPS"
      ? "deployment"
      : "architecture",
    repositoryType: input.repositoryType,
  };
}
