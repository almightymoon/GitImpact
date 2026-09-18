import { resolveImportPath } from "@gitimpact/parser";
import type {
  ConfidenceLevel,
  DependencyGraph,
  DetectedRoute,
  GraphEdge,
  GraphNode,
  NodeType,
  ParsedFile,
  RelationType,
  ResolvedCall,
} from "@gitimpact/shared";

function nodeId(type: NodeType, file: string, name?: string): string {
  return name ? `${type}:${file}:${name}` : `${type}:${file}`;
}

function methodNodeId(file: string, className: string, methodName: string): string {
  return `METHOD:${file}:${className}.${methodName}`;
}

function edgeId(from: string, to: string, type: RelationType): string {
  return `${from}->${to}:${type}`;
}

function confidenceRank(level: ConfidenceLevel): number {
  if (level === "HIGH") return 3;
  if (level === "MEDIUM") return 2;
  return 1;
}

function inferFileType(file: ParsedFile): NodeType {
  const p = file.path.toLowerCase();
  if (file.isTest) return "TEST";
  if (p.includes("controller")) return "CONTROLLER";
  if (p.includes("service")) return "SERVICE";
  if (/\.(tsx|jsx)$/.test(p) || p.includes("/components/")) return "COMPONENT";
  if (p.includes("/hooks/") || /(^|\/)use[A-Z]/.test(p)) return "HOOK";
  if (
    p.includes("/app/api/") ||
    p.includes("/pages/api/") ||
    /(^|\/)route\.(ts|tsx|js|jsx)$/.test(p)
  ) {
    return "API_ROUTE";
  }
  if (p.includes("route") || p.includes("/api/")) return "API_ROUTE";
  if (p.includes("model") || p.includes("schema") || p.includes("entity")) {
    return "DATABASE_MODEL";
  }
  if (p.includes("config")) return "CONFIG";
  return "FILE";
}

function targetIdFromResolvedCall(call: ResolvedCall): string | undefined {
  if (call.resolvedKind === "UNRESOLVED") {
    return undefined;
  }
  if (call.resolvedKind === "EXTERNAL") {
    const host = call.resolvedSymbol ?? call.resolvedFile ?? "http";
    return `EXTERNAL_SERVICE:${host}`;
  }
  if (call.resolvedKind === "MODULE") {
    return call.resolvedFile ? nodeId("FILE", call.resolvedFile) : undefined;
  }
  if (call.resolvedKind === "QUERY") {
    // Synthetic model id — created during pass 2 when queries are wired
    if (call.resolvedClassName?.startsWith("Prisma.")) {
      const model = call.resolvedClassName.slice("Prisma.".length);
      return nodeId("DATABASE_MODEL", call.resolvedFile ?? "prisma", model);
    }
    return undefined;
  }
  if (!call.resolvedFile || !call.resolvedSymbol) {
    return undefined;
  }
  if (call.resolvedKind === "METHOD" && call.resolvedClassName) {
    return methodNodeId(call.resolvedFile, call.resolvedClassName, call.resolvedSymbol);
  }
  if (call.resolvedKind === "CLASS") {
    return nodeId("CLASS", call.resolvedFile, call.resolvedSymbol);
  }
  return nodeId("FUNCTION", call.resolvedFile, call.resolvedSymbol);
}

export class DependencyGraphBuilder {
  build(files: ParsedFile[], routes: DetectedRoute[] = []): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const knownFiles = new Set(files.map((f) => f.path));

    const addNode = (node: GraphNode) => {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    };

    const addEdge = (
      from: string,
      to: string,
      type: RelationType,
      confidence: ConfidenceLevel = "HIGH",
      evidence?: GraphEdge["evidence"],
    ) => {
      if (!nodes.has(from) || !nodes.has(to) || from === to) return;
      const id = edgeId(from, to, type);
      const existing = edges.get(id);
      if (!existing) {
        edges.set(id, { id, from, to, type, confidence, evidence });
        return;
      }
      // Prefer higher confidence + keep first evidence if already present
      if (
        confidenceRank(confidence) > confidenceRank(existing.confidence)
      ) {
        existing.confidence = confidence;
      }
      if (!existing.evidence && evidence) {
        existing.evidence = evidence;
      }
    };

    // Pass 1: structural nodes
    for (const file of files) {
      const fileType = inferFileType(file);
      const fileNodeId = nodeId("FILE", file.path);
      addNode({
        id: fileNodeId,
        type: fileType === "FILE" ? "FILE" : fileType,
        name: file.path.split("/").pop() ?? file.path,
        file: file.path,
        metadata: {
          language: file.language,
          exports: file.exports,
          isTest: file.isTest,
        },
      });

      for (const fn of file.functions) {
        const id = nodeId("FUNCTION", file.path, fn.name);
        addNode({
          id,
          type: "FUNCTION",
          name: fn.name,
          file: file.path,
          startLine: fn.startLine,
          endLine: fn.endLine,
          metadata: { exported: fn.exported, parameters: fn.parameters },
        });
        addEdge(fileNodeId, id, "CONTAINS", "HIGH");
        if (fn.exported) {
          addEdge(fileNodeId, id, "EXPORTS", "HIGH");
        }
      }

      for (const cls of file.classes) {
        const classId = nodeId("CLASS", file.path, cls.name);
        addNode({
          id: classId,
          type: "CLASS",
          name: cls.name,
          file: file.path,
          startLine: cls.startLine,
          endLine: cls.endLine,
          metadata: {
            exported: cls.exported,
            extends: cls.extends,
            methodCount: cls.methods.length,
          },
        });
        addEdge(fileNodeId, classId, "CONTAINS", "HIGH");
        if (cls.exported) {
          addEdge(fileNodeId, classId, "EXPORTS", "HIGH");
        }

        for (const method of cls.methods) {
          const mid = methodNodeId(file.path, cls.name, method.name);
          addNode({
            id: mid,
            type: "METHOD",
            name: `${cls.name}.${method.name}`,
            file: file.path,
            startLine: method.startLine,
            endLine: method.endLine,
            metadata: {
              className: cls.name,
              methodName: method.name,
              parameters: method.parameters,
            },
          });
          addEdge(classId, mid, "CONTAINS", "HIGH");
          addEdge(fileNodeId, mid, "CONTAINS", "HIGH");
        }
      }

      for (const env of file.envVariables) {
        const id = nodeId("ENV_VARIABLE", file.path, env);
        addNode({
          id,
          type: "ENV_VARIABLE",
          name: env,
          file: file.path,
        });
        addEdge(fileNodeId, id, "READS", "HIGH");
      }
    }

    // Pass 2: imports, resolved calls, tests
    for (const file of files) {
      const fileNodeId = nodeId("FILE", file.path);

      for (const imp of file.imports) {
        const resolved =
          imp.resolvedPath ??
          resolveImportPath(file.path, imp.moduleSpecifier, knownFiles);
        if (!resolved) continue;
        const targetFileId = nodeId("FILE", resolved);
        const importEvidence: GraphEdge["evidence"] = {
          file: file.path,
          snippet: imp.namedImports.length
            ? `import { ${imp.namedImports.slice(0, 4).join(", ")}${imp.namedImports.length > 4 ? ", …" : ""} } from "${imp.moduleSpecifier}"`
            : imp.defaultImport
              ? `import ${imp.defaultImport} from "${imp.moduleSpecifier}"`
              : `import "${imp.moduleSpecifier}"`,
          resolvedThrough: `${imp.moduleSpecifier} → ${resolved}`,
          symbol: imp.defaultImport ?? imp.namedImports[0],
        };
        addEdge(fileNodeId, targetFileId, "IMPORTS", "HIGH", importEvidence);

        for (const named of imp.namedImports) {
          const targetFn = nodeId("FUNCTION", resolved, named);
          const targetClass = nodeId("CLASS", resolved, named);
          const namedEvidence: GraphEdge["evidence"] = {
            file: file.path,
            snippet: `import { ${named} } from "${imp.moduleSpecifier}"`,
            resolvedThrough: `${imp.moduleSpecifier} → ${resolved}`,
            symbol: named,
          };
          if (nodes.has(targetFn)) {
            addEdge(fileNodeId, targetFn, "USES", "HIGH", namedEvidence);
          } else if (nodes.has(targetClass)) {
            addEdge(fileNodeId, targetClass, "USES", "HIGH", namedEvidence);
          } else {
            // Barrel re-export: find unique exported symbol with this name elsewhere
            const matches = [...nodes.values()].filter(
              (n) =>
                (n.type === "FUNCTION" || n.type === "CLASS") && n.name === named,
            );
            if (matches.length === 1) {
              addEdge(fileNodeId, matches[0].id, "USES", "MEDIUM", namedEvidence);
            }
          }
        }
      }

      const resolveCallTarget = (call: ResolvedCall): string | undefined => {
        let target = targetIdFromResolvedCall(call);
        if (target && call.resolvedKind === "EXTERNAL") {
          const host = call.resolvedSymbol ?? call.resolvedFile ?? "http";
          addNode({
            id: target,
            type: "EXTERNAL_SERVICE",
            name: host,
            file: file.path,
            metadata: { kind: "http", via: "fetch" },
          });
          return target;
        }
        if (target && call.resolvedKind === "QUERY") {
          const model = call.resolvedClassName?.replace(/^Prisma\./, "") ?? call.calleeName;
          addNode({
            id: target,
            type: "DATABASE_MODEL",
            name: model,
            file: call.resolvedFile ?? file.path,
            metadata: { orm: "prisma", method: call.calleeName },
          });
          return target;
        }
        if (target && nodes.has(target)) return target;
        // Dynamic import / barrel: resolve unique function by symbol name
        if (
          call.resolvedKind === "FUNCTION" &&
          call.resolvedSymbol &&
          (!target || !nodes.has(target))
        ) {
          const matches = [...nodes.values()].filter(
            (n) => n.type === "FUNCTION" && n.name === call.resolvedSymbol,
          );
          if (matches.length === 1) return matches[0].id;
        }
        if (target && call.resolvedKind === "MODULE" && nodes.has(target)) {
          return target;
        }
        return target && nodes.has(target) ? target : undefined;
      };

      const callEvidence = (call: ResolvedCall): GraphEdge["evidence"] => ({
        file: file.path,
        startLine: call.startLine,
        snippet: `${call.calleeName}(…)`,
        symbol: call.calleeName,
        resolvedThrough: call.resolvedFile
          ? `${call.resolvedKind.toLowerCase()} ${call.resolvedSymbol ?? call.calleeName} in ${call.resolvedFile}`
          : `${call.resolvedKind.toLowerCase()} ${call.resolvedSymbol ?? call.calleeName}`,
      });

      const wireCalls = (fromId: string, calls: ResolvedCall[]) => {
        for (const call of calls) {
          const target = resolveCallTarget(call);
          if (!target) continue;
          const evidence = callEvidence(call);
          if (call.resolvedKind === "MODULE") {
            addEdge(fromId, target, "IMPORTS", call.confidence, evidence);
            addEdge(fileNodeId, target, "IMPORTS", call.confidence, evidence);
            continue;
          }
          if (call.resolvedKind === "QUERY") {
            addEdge(fromId, target, "QUERIES", call.confidence, evidence);
            continue;
          }
          if (call.resolvedKind === "EXTERNAL") {
            addEdge(fromId, target, "FETCHES", call.confidence, evidence);
            continue;
          }
          addEdge(fromId, target, "CALLS", call.confidence, evidence);
        }
      };

      for (const fn of file.functions) {
        const fromId = nodeId("FUNCTION", file.path, fn.name);
        wireCalls(fromId, fn.calls);
        for (const query of fn.queries ?? []) {
          const modelId = nodeId("DATABASE_MODEL", file.path, query.model);
          addNode({
            id: modelId,
            type: "DATABASE_MODEL",
            name: query.model,
            file: file.path,
            metadata: {
              orm: file.language === "go" ? "gorm" : "prisma",
              method: query.method,
            },
          });
          addEdge(fromId, modelId, "QUERIES", "MEDIUM");
        }
      }

      for (const cls of file.classes) {
        const classId = nodeId("CLASS", file.path, cls.name);
        for (const dep of cls.dependencies ?? []) {
          const matches = [...nodes.values()].filter(
            (n) => n.type === "CLASS" && n.name === dep.typeName,
          );
          if (matches.length === 1) {
            addEdge(classId, matches[0].id, "DEPENDS_ON", "HIGH");
          } else {
            const local = nodeId("CLASS", file.path, dep.typeName);
            if (nodes.has(local)) {
              addEdge(classId, local, "DEPENDS_ON", "HIGH");
            }
          }
        }
        for (const method of cls.methods) {
          const fromId = methodNodeId(file.path, cls.name, method.name);
          wireCalls(fromId, method.calls);
          for (const query of method.queries ?? []) {
            const modelId = nodeId("DATABASE_MODEL", file.path, query.model);
            addNode({
              id: modelId,
              type: "DATABASE_MODEL",
              name: query.model,
              file: file.path,
              metadata: {
                orm: file.language === "go" ? "gorm" : "prisma",
                method: query.method,
              },
            });
            addEdge(fromId, modelId, "QUERIES", "MEDIUM");
          }
        }
      }

      if (file.isTest) {
        for (const imp of file.imports) {
          const resolved =
            imp.resolvedPath ??
            resolveImportPath(file.path, imp.moduleSpecifier, knownFiles);
          if (!resolved) continue;
          addEdge(fileNodeId, nodeId("FILE", resolved), "TESTS", "HIGH");
        }
      }
    }

    for (const route of routes) {
      addNode({
        id: route.id,
        type: "API_ROUTE",
        name: `${route.method} ${route.path}`,
        file: route.file,
        startLine: route.startLine,
        metadata: {
          framework: route.framework,
          method: route.method,
          path: route.path,
          handlerName: route.handlerName,
          handlerClass: route.handlerClass,
          confidence: route.confidence,
        },
      });

      const fileNodeId = nodeId("FILE", route.file);
      addEdge(route.id, fileNodeId, "DEPENDS_ON", route.confidence);
      addEdge(fileNodeId, route.id, "CONFIGURES", route.confidence);

      if (route.handlerClass && route.handlerName) {
        const handlerFile = route.handlerFile ?? route.file;
        const handlerMethod = methodNodeId(handlerFile, route.handlerClass, route.handlerName);
        if (nodes.has(handlerMethod)) {
          addEdge(route.id, handlerMethod, "HANDLED_BY", route.confidence);
        }
      } else if (
        route.handlerName &&
        route.handlerName !== "default" &&
        route.handlerName !== "ALL"
      ) {
        const handlerFile = route.handlerFile ?? route.file;
        const handlerFn = nodeId("FUNCTION", handlerFile, route.handlerName);
        if (nodes.has(handlerFn)) {
          addEdge(route.id, handlerFn, "HANDLED_BY", route.confidence);
          addEdge(route.id, handlerFn, "USES", route.confidence);
        }
      }
    }

    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    };
  }
}

export class GraphStore {
  private nodes = new Map<string, GraphNode>();
  private outgoing = new Map<string, GraphEdge[]>();
  private incoming = new Map<string, GraphEdge[]>();

  constructor(graph?: DependencyGraph) {
    if (graph) this.load(graph);
  }

  load(graph: DependencyGraph): void {
    this.nodes.clear();
    this.outgoing.clear();
    this.incoming.clear();
    for (const node of graph.nodes) {
      this.nodes.set(node.id, node);
    }
    for (const edge of graph.edges) {
      const out = this.outgoing.get(edge.from) ?? [];
      out.push(edge);
      this.outgoing.set(edge.from, out);
      const inn = this.incoming.get(edge.to) ?? [];
      inn.push(edge);
      this.incoming.set(edge.to, inn);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getEdges(): GraphEdge[] {
    return [...this.outgoing.values()].flat();
  }

  getOutgoing(id: string): GraphEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  getIncoming(id: string): GraphEdge[] {
    return this.incoming.get(id) ?? [];
  }

  getIncomingDependencies(id: string): GraphNode[] {
    return this.getIncoming(id)
      .map((edge) => this.nodes.get(edge.from))
      .filter((node): node is GraphNode => Boolean(node));
  }

  getOutgoingDependencies(id: string): GraphNode[] {
    return this.getOutgoing(id)
      .map((edge) => this.nodes.get(edge.to))
      .filter((node): node is GraphNode => Boolean(node));
  }

  findNodesByFile(filePath: string): GraphNode[] {
    return this.getNodes().filter((node) => node.file === filePath);
  }

  findFileNode(filePath: string): GraphNode | undefined {
    return (
      this.nodes.get(`FILE:${filePath}`) ??
      this.getNodes().find(
        (n) =>
          n.file === filePath &&
          (n.type === "FILE" ||
            n.type === "SERVICE" ||
            n.type === "CONTROLLER" ||
            n.type === "COMPONENT" ||
            n.type === "TEST" ||
            n.type === "API_ROUTE" ||
            n.type === "CONFIG" ||
            n.type === "DATABASE_MODEL" ||
            n.type === "HOOK"),
      )
    );
  }

  findSymbolNodes(filePath: string, symbolName: string): GraphNode[] {
    const results: GraphNode[] = [];
    const fn = this.nodes.get(`FUNCTION:${filePath}:${symbolName}`);
    const cls = this.nodes.get(`CLASS:${filePath}:${symbolName}`);
    if (fn) results.push(fn);
    if (cls) results.push(cls);

    for (const node of this.getNodes()) {
      if (node.file !== filePath) continue;
      if (node.type === "METHOD") {
        const methodName = String(node.metadata?.methodName ?? "");
        const className = String(node.metadata?.className ?? "");
        if (
          methodName === symbolName ||
          node.name === symbolName ||
          node.name.endsWith(`.${symbolName}`) ||
          `${className}.${methodName}` === symbolName
        ) {
          results.push(node);
        }
      }
    }
    return results;
  }

  explainPath(pathIds: string[]): Array<{
    node: GraphNode;
    edgeType?: RelationType;
  }> {
    const steps: Array<{ node: GraphNode; edgeType?: RelationType }> = [];
    for (let i = 0; i < pathIds.length; i += 1) {
      const node = this.nodes.get(pathIds[i]);
      if (!node) continue;
      let edgeType: RelationType | undefined;
      if (i > 0) {
        const prev = pathIds[i - 1];
        // path is stored changed → ... → dependent (incoming traversal)
        // edge from current(dependent side) to previous? Actually path is [changed, d1, d2]
        // edge is from d1 → changed (incoming to changed). So from path[i] to path[i-1]
        const edge = this.getOutgoing(pathIds[i]).find((e) => e.to === prev)
          ?? this.getIncoming(prev).find((e) => e.from === pathIds[i]);
        edgeType = edge?.type;
      }
      steps.push({ node, edgeType });
    }
    return steps;
  }

  search(query: string, limit = 25): GraphNode[] {
    const q = query.toLowerCase();
    return this.getNodes()
      .filter(
        (node) =>
          node.name.toLowerCase().includes(q) ||
          node.file.toLowerCase().includes(q) ||
          node.id.toLowerCase().includes(q),
      )
      .slice(0, limit);
  }

  toJSON(): DependencyGraph {
    return {
      nodes: this.getNodes(),
      edges: this.getEdges(),
    };
  }
}

export function buildGraph(
  files: ParsedFile[],
  routes: DetectedRoute[] = [],
): DependencyGraph {
  return new DependencyGraphBuilder().build(files, routes);
}
