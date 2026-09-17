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
} from "@gitimpact/shared";

function nodeId(type: NodeType, file: string, name?: string): string {
  return name ? `${type}:${file}:${name}` : `${type}:${file}`;
}

function edgeId(from: string, to: string, type: RelationType): string {
  return `${from}->${to}:${type}`;
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

export class DependencyGraphBuilder {
  build(files: ParsedFile[], routes: DetectedRoute[] = []): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const knownFiles = new Set(files.map((f) => f.path));
    const functionIndex = new Map<string, string[]>();

    const addNode = (node: GraphNode) => {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    };

    const addEdge = (
      from: string,
      to: string,
      type: RelationType,
      confidence: ConfidenceLevel = "HIGH",
    ) => {
      if (!nodes.has(from) || !nodes.has(to) || from === to) return;
      const id = edgeId(from, to, type);
      if (!edges.has(id)) {
        edges.set(id, { id, from, to, type, confidence });
      }
    };

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
        addEdge(fileNodeId, id, "EXPORTS", "HIGH");
        const list = functionIndex.get(fn.name) ?? [];
        list.push(id);
        functionIndex.set(fn.name, list);
      }

      for (const cls of file.classes) {
        const id = nodeId("CLASS", file.path, cls.name);
        addNode({
          id,
          type: "CLASS",
          name: cls.name,
          file: file.path,
          startLine: cls.startLine,
          endLine: cls.endLine,
          metadata: {
            exported: cls.exported,
            methods: cls.methods,
            extends: cls.extends,
          },
        });
        addEdge(fileNodeId, id, "EXPORTS", "HIGH");
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

    for (const file of files) {
      const fileNodeId = nodeId("FILE", file.path);

      for (const imp of file.imports) {
        const resolved = resolveImportPath(file.path, imp.moduleSpecifier, knownFiles);
        if (!resolved) continue;
        const targetFileId = nodeId("FILE", resolved);
        addEdge(fileNodeId, targetFileId, "IMPORTS", "HIGH");

        for (const named of imp.namedImports) {
          const targetFn = nodeId("FUNCTION", resolved, named);
          const targetClass = nodeId("CLASS", resolved, named);
          if (nodes.has(targetFn)) {
            addEdge(fileNodeId, targetFn, "USES", "HIGH");
          } else if (nodes.has(targetClass)) {
            addEdge(fileNodeId, targetClass, "USES", "HIGH");
          }
        }
      }

      for (const fn of file.functions) {
        const fromId = nodeId("FUNCTION", file.path, fn.name);
        for (const call of fn.calls) {
          const candidates = functionIndex.get(call) ?? [];
          for (const candidate of candidates) {
            if (candidate === fromId) continue;
            const candidateFile = nodes.get(candidate)?.file;
            if (!candidateFile) continue;
            const imported =
              candidateFile === file.path ||
              file.imports.some((imp) => {
                const resolved = resolveImportPath(
                  file.path,
                  imp.moduleSpecifier,
                  knownFiles,
                );
                return resolved === candidateFile;
              });
            addEdge(fromId, candidate, "CALLS", imported ? "HIGH" : "MEDIUM");
          }
        }
      }

      if (file.isTest) {
        for (const imp of file.imports) {
          const resolved = resolveImportPath(file.path, imp.moduleSpecifier, knownFiles);
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
          confidence: route.confidence,
        },
      });

      const fileNodeId = nodeId("FILE", route.file);
      addEdge(route.id, fileNodeId, "DEPENDS_ON", route.confidence);
      addEdge(fileNodeId, route.id, "CONFIGURES", route.confidence);

      if (route.handlerName && route.handlerName !== "default" && route.handlerName !== "ALL") {
        const handlerFn = nodeId("FUNCTION", route.file, route.handlerName);
        if (nodes.has(handlerFn)) {
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
