"use client";

import { useEffect, useMemo, useState, memo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  MarkerType,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, GraphNode } from "@gitimpact/shared";

const severityFill: Record<string, string> = {
  CRITICAL: "#9f1239",
  HIGH: "#c2410c",
  MEDIUM: "#0e7490",
  NEUTRAL: "#94a3b8",
};

type BandId = "delivery" | "orchestration" | "pipeline" | "persistence" | "shared";

const BANDS: Array<{
  id: BandId;
  label: string;
  hint: string;
  color: string;
  soft: string;
}> = [
  {
    id: "delivery",
    label: "Delivery",
    hint: "How people and clients enter the system",
    color: "#2563eb",
    soft: "#dbeafe",
  },
  {
    id: "orchestration",
    label: "Orchestration",
    hint: "Coordinates analysis, acquisition, and cache",
    color: "#c2410c",
    soft: "#ffedd5",
  },
  {
    id: "pipeline",
    label: "Analysis pipeline",
    hint: "Parse → graph → enrich → impact",
    color: "#15803d",
    soft: "#dcfce7",
  },
  {
    id: "persistence",
    label: "Persistence & external",
    hint: "Storage and outside systems",
    color: "#a21caf",
    soft: "#fae8ff",
  },
  {
    id: "shared",
    label: "Shared foundations",
    hint: "Types, contracts, and utilities",
    color: "#475569",
    soft: "#e2e8f0",
  },
];

type SystemModule = {
  id: string;
  root: string;
  title: string;
  role: string;
  band: BandId;
  files: GraphNode[];
  keyFiles: string[];
  impactedCount: number;
};

type StructureNodeData = {
  kind: "band" | "system";
  title: string;
  subtitle: string;
  color: string;
  soft: string;
  count?: number;
  impactedCount?: number;
  keyFiles?: string[];
  root?: string;
  severity: string;
  selected: boolean;
  fileId?: string;
};

function isFileLevel(node: GraphNode): boolean {
  return (
    node.id.startsWith("FILE:") ||
    node.type === "API_ROUTE" ||
    node.type === "COMPONENT" ||
    node.type === "HOOK" ||
    node.type === "CONTROLLER" ||
    node.type === "SERVICE" ||
    node.type === "DATABASE_MODEL" ||
    node.type === "DATABASE_TABLE" ||
    node.type === "TEST" ||
    node.type === "CONFIG"
  );
}

function moduleRootFor(file: string): string {
  const parts = file.split("/").filter(Boolean);
  if (parts[0] === "packages" && parts[1]) return `packages/${parts[1]}`;
  if (parts[0] === "apps" && parts[1]) return `apps/${parts[1]}`;
  if (parts[0] === "cli") return "cli";
  if (parts[0] === "src") {
    if (parts[1] === "app" && parts[2] === "api") return "src/app/api";
    if (parts[1] === "app") return "src/app";
    if (parts[1] === "components") return "src/components";
    if (parts[1] === "lib" || parts[1] === "services") return `src/${parts[1]}`;
    return "src";
  }
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return parts[0] ?? "root";
}

function titleCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeModule(
  root: string,
  files: GraphNode[],
): Omit<SystemModule, "files" | "impactedCount" | "keyFiles"> {
  const name = root.split("/").pop() ?? root;
  const lower = `${root} ${name}`.toLowerCase();
  const types = new Set(files.map((f) => f.type));

  if (/cli/.test(lower)) {
    return {
      id: root,
      root,
      title: "CLI",
      role: "Command-line entry for analysis requests",
      band: "delivery",
    };
  }
  if (/apps\/web|frontend|(^|\/)ui$/.test(lower) || (types.has("COMPONENT") && !/api/.test(lower))) {
    return {
      id: root,
      root,
      title: name === "web" || name === "app" || name === "components" ? "Web UI" : titleCase(name),
      role: "Workbench, graphs, and result panels",
      band: "delivery",
    };
  }
  if (/\/api$|pages\/api|app\/api/.test(lower) || types.has("API_ROUTE")) {
    return {
      id: root,
      root,
      title: "API routes",
      role: "HTTP entrypoints that kick off analysis",
      band: "delivery",
    };
  }
  if (/analysis/.test(lower)) {
    return {
      id: root,
      root,
      title: "Analysis orchestration",
      role: "Runs the end-to-end analyze workflow",
      band: "orchestration",
    };
  }
  if (/(^|\/)git$|acquisition|clone/.test(lower)) {
    return {
      id: root,
      root,
      title: "Git acquisition",
      role: "Fetches GitHub / local checkouts",
      band: "orchestration",
    };
  }
  if (/impact|engine/.test(lower)) {
    return {
      id: root,
      root,
      title: "Blast-radius engine",
      role: "Graph traversal for impact + confidence",
      band: "pipeline",
    };
  }
  if (/parser|ast|semantic/.test(lower)) {
    return {
      id: root,
      root,
      title: "AST & symbols",
      role: "TypeScript semantic parse + symbol extract",
      band: "pipeline",
    };
  }
  if (/graph/.test(lower)) {
    return {
      id: root,
      root,
      title: "Dependency graph",
      role: "Builds call / import / contains edges",
      band: "pipeline",
    };
  }
  if (/framework|detector/.test(lower)) {
    return {
      id: root,
      root,
      title: "Framework enrichment",
      role: "Detects routes and framework relationships",
      band: "pipeline",
    };
  }
  if (/db|database|drizzle|prisma|schema/.test(lower) || types.has("DATABASE_MODEL")) {
    return {
      id: root,
      root,
      title: "Persistence",
      role: "Optional Postgres / cache for analyses",
      band: "persistence",
    };
  }
  if (/shared|common|types|utils|config/.test(lower) || types.has("CONFIG")) {
    return {
      id: root,
      root,
      title: titleCase(name),
      role: "Shared contracts and utilities",
      band: "shared",
    };
  }
  if (types.has("CONTROLLER")) {
    return {
      id: root,
      root,
      title: "Controllers",
      role: "Request handlers bridging API → domain",
      band: "delivery",
    };
  }
  if (types.has("SERVICE")) {
    return {
      id: root,
      root,
      title: "Services",
      role: "Domain / business logic",
      band: "orchestration",
    };
  }
  if (types.has("TEST") || files.every((f) => f.type === "TEST")) {
    return {
      id: root,
      root,
      title: "Tests",
      role: "Coverage surface for changed symbols",
      band: "shared",
    };
  }

  return {
    id: root,
    root,
    title: titleCase(name),
    role: "Module in the repository",
    band: "shared",
  };
}

function severityFor(node: GraphNode, impacted: Map<string, string>): string {
  return impacted.get(node.id) ?? impacted.get(`FILE:${node.file}`) ?? "NEUTRAL";
}

function pickKeyFiles(files: GraphNode[], limit = 4): string[] {
  const scored = files.map((f) => {
    let score = 0;
    if (f.id.startsWith("FILE:")) score += 2;
    if (/(index|route|page|main|client|schema)\./i.test(f.name)) score += 5;
    if (f.type === "API_ROUTE" || f.type === "CONTROLLER" || f.type === "SERVICE") score += 3;
    if (f.type === "COMPONENT") score += 2;
    return { name: f.name, score };
  });
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of scored) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item.name);
    if (out.length >= limit) break;
  }
  return out;
}

function collapseSmallSystems(systems: SystemModule[]): SystemModule[] {
  if (systems.length <= 14) return systems;
  const keep = systems.filter((s) => s.files.length >= 2 || s.band !== "shared");
  const tiny = systems.filter((s) => !keep.includes(s));
  if (tiny.length === 0) return systems;
  const bucketFiles = tiny.flatMap((s) => s.files);
  keep.push({
    id: "other-modules",
    root: "…",
    title: "Other modules",
    role: "Smaller folders grouped for readability",
    band: "shared",
    files: bucketFiles,
    keyFiles: pickKeyFiles(bucketFiles),
    impactedCount: tiny.reduce((n, s) => n + s.impactedCount, 0),
  });
  return keep;
}

function buildSystems(
  nodes: GraphNode[],
  impacted: Map<string, string>,
  focusImpacted: boolean,
): SystemModule[] {
  const fileNodes = nodes.filter(isFileLevel);
  const byFile = new Map<string, GraphNode>();
  for (const node of fileNodes) {
    const existing = byFile.get(node.file);
    if (!existing || node.id.startsWith("FILE:")) byFile.set(node.file, node);
  }

  let pool = [...byFile.values()];
  if (focusImpacted && impacted.size > 0) {
    const touched = pool.filter(
      (n) => impacted.has(n.id) || impacted.has(`FILE:${n.file}`),
    );
    if (touched.length > 0) pool = touched;
  }

  const grouped = new Map<string, GraphNode[]>();
  for (const node of pool) {
    const root = moduleRootFor(node.file);
    const list = grouped.get(root) ?? [];
    list.push(node);
    grouped.set(root, list);
  }

  const systems: SystemModule[] = [];
  for (const [root, files] of grouped) {
    const meta = describeModule(root, files);
    systems.push({
      ...meta,
      files,
      keyFiles: pickKeyFiles(files),
      impactedCount: files.filter((f) => severityFor(f, impacted) !== "NEUTRAL").length,
    });
  }

  return collapseSmallSystems(systems);
}

function systemSeverity(mod: SystemModule, impacted: Map<string, string>): string {
  let best = "NEUTRAL";
  const rank = (s: string) =>
    s === "CRITICAL" ? 0 : s === "HIGH" ? 1 : s === "MEDIUM" ? 2 : 3;
  for (const file of mod.files) {
    const s = severityFor(file, impacted);
    if (rank(s) < rank(best)) best = s;
  }
  return best;
}

function StructureNode({ data }: NodeProps) {
  const d = data as StructureNodeData;

  if (d.kind === "band") {
    return (
      <div
        style={{
          width: 176,
          minHeight: 120,
          borderRadius: 16,
          border: `1.5px solid ${d.color}44`,
          background: d.soft,
          padding: "12px 14px",
          overflow: "visible",
        }}
      >
        <div
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: d.color,
          }}
        >
          {d.title}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#1c2a3a", opacity: 0.72, lineHeight: 1.35 }}>
          {d.subtitle}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 11,
            color: "#64748b",
          }}
        >
          {d.count ?? 0} systems
          {(d.impactedCount ?? 0) > 0 ? (
            <span style={{ color: "#9f1239" }}> · {d.impactedCount}●</span>
          ) : null}
        </div>
      </div>
    );
  }

  const border =
    d.selected
      ? "#0f7a6c"
      : d.severity !== "NEUTRAL"
        ? severityFill[d.severity]
        : `${d.color}66`;

  return (
    <div
      title={`${d.title}\n${d.root ?? ""}\n${d.subtitle}`}
      style={{
        width: 240,
        minHeight: 168,
        borderRadius: 16,
        border: `2px solid ${border}`,
        background: d.selected ? "#0b1220" : "#ffffff",
        color: d.selected ? "#f7fafc" : "#0b1220",
        boxShadow:
          d.severity !== "NEUTRAL"
            ? `0 0 0 4px ${(severityFill[d.severity] ?? "#64748b")}22`
            : "0 8px 22px rgba(11,18,32,0.07)",
        padding: "14px 14px 16px",
        position: "relative",
        overflow: "visible",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        style={{ width: 8, height: 8, background: d.color, border: "2px solid white" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={{ width: 8, height: 8, background: d.color, border: "2px solid white" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        style={{ width: 8, height: 8, background: d.color, border: "2px solid white", opacity: 0.35 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        style={{ width: 8, height: 8, background: d.color, border: "2px solid white", opacity: 0.35 }}
      />
      <div
        style={{
          position: "absolute",
          inset: "10px auto 10px 0",
          width: 4,
          borderRadius: 999,
          background: d.color,
        }}
      />
      <div style={{ paddingLeft: 8 }}>
        <div
          style={{
            fontFamily: "Syne, IBM Plex Sans, sans-serif",
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {d.title}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4, opacity: 0.78 }}>
          {d.subtitle}
        </div>
        {d.root ? (
          <div
            style={{
              marginTop: 8,
              fontFamily: "IBM Plex Mono, ui-monospace, monospace",
              fontSize: 10,
              opacity: 0.55,
              wordBreak: "break-all",
            }}
          >
            [{d.root}]
          </div>
        ) : null}
        {d.keyFiles && d.keyFiles.length > 0 ? (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
            {d.keyFiles.map((file) => (
              <li
                key={file}
                style={{
                  fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                  fontSize: 10,
                  opacity: 0.75,
                  marginTop: 4,
                  wordBreak: "break-word",
                }}
              >
                · {file}
              </li>
            ))}
          </ul>
        ) : null}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 10,
          }}
        >
          <span style={{ opacity: 0.65 }}>{d.count ?? 0} files</span>
          {(d.impactedCount ?? 0) > 0 ? (
            <span
              style={{
                borderRadius: 999,
                background: "rgba(159,18,57,0.12)",
                color: d.selected ? "#fecdd3" : "#9f1239",
                padding: "2px 7px",
                fontWeight: 600,
              }}
            >
              {d.impactedCount} impact
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { structure: memo(StructureNode) };

function buildNarrative(
  activeBands: typeof BANDS,
  byBand: Map<BandId, SystemModule[]>,
  systems: SystemModule[],
): string[] {
  const lines: string[] = [];
  const delivery = byBand.get("delivery") ?? [];
  const orch = byBand.get("orchestration") ?? [];
  const pipe = byBand.get("pipeline") ?? [];
  const persist = byBand.get("persistence") ?? [];

  if (delivery.length) {
    lines.push(
      `Entry: ${delivery.map((s) => s.title).join(", ")} accept requests and render results.`,
    );
  }
  if (orch.length) {
    lines.push(
      `Orchestration: ${orch.map((s) => s.title).join(", ")} coordinate source acquisition and analysis runs.`,
    );
  }
  if (pipe.length) {
    lines.push(
      `Pipeline: ${pipe.map((s) => s.title).join(" → ")} turn source into graph-backed blast radius.`,
    );
  }
  if (persist.length) {
    lines.push(
      `Persistence: ${persist.map((s) => s.title).join(", ")} hold analyses and talk to external sources.`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      `${systems.length} systems inferred from package/folder boundaries and symbol types.`,
    );
  } else {
    lines.push("Arrows show architecture flow between systems (plus any resolved import edges).");
  }
  void activeBands;
  return lines;
}

function buildLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  impacted: Map<string, string>,
  selectedId: string | null,
  focusImpacted: boolean,
): {
  nodes: Node[];
  edges: Edge[];
  systems: SystemModule[];
  narrative: string[];
  bandStats: Array<{ id: BandId; count: number; impacted: number }>;
} {
  const systems = buildSystems(nodes, impacted, focusImpacted);
  const byBand = new Map<BandId, SystemModule[]>();
  for (const band of BANDS) byBand.set(band.id, []);
  for (const system of systems) byBand.get(system.band)!.push(system);

  const activeBands = BANDS.filter((b) => (byBand.get(b.id)?.length ?? 0) > 0);
  const rfNodes: Node[] = [];
  const systemIdByFile = new Map<string, string>();
  for (const system of systems) {
    for (const file of system.files) systemIdByFile.set(file.file, system.id);
  }

  const bandStats: Array<{ id: BandId; count: number; impacted: number }> = [];
  let y = 0;
  const cardW = 252;
  const cardGap = 32;
  const bandLabelX = 0;
  const systemsStartX = 200;

  for (const band of activeBands) {
    const members = byBand.get(band.id) ?? [];
    members.sort((a, b) => b.files.length - a.files.length || a.title.localeCompare(b.title));
    const impactedCount = members.reduce((n, m) => n + m.impactedCount, 0);
    bandStats.push({ id: band.id, count: members.length, impacted: impactedCount });

    rfNodes.push({
      id: `band:${band.id}`,
      type: "structure",
      className: "structure-node",
      position: { x: bandLabelX, y: y + 24 },
      data: {
        kind: "band",
        title: band.label,
        subtitle: band.hint,
        color: band.color,
        soft: band.soft,
        count: members.length,
        impactedCount,
        severity: "NEUTRAL",
        selected: false,
      } satisfies StructureNodeData,
      draggable: false,
      selectable: false,
      zIndex: 0,
    });

    members.forEach((mod, index) => {
      const selected =
        selectedId != null &&
        mod.files.some((f) => f.id === selectedId || `FILE:${f.file}` === selectedId);

      rfNodes.push({
        id: `sys:${mod.id}`,
        type: "structure",
        className: "structure-node",
        position: { x: systemsStartX + index * (cardW + cardGap), y },
        data: {
          kind: "system",
          title: mod.title,
          subtitle: mod.role,
          color: band.color,
          soft: band.soft,
          count: mod.files.length,
          impactedCount: mod.impactedCount,
          keyFiles: mod.keyFiles,
          root: mod.root,
          severity: systemSeverity(mod, impacted),
          selected,
          fileId: mod.files.find((f) => f.id.startsWith("FILE:"))?.id ?? mod.files[0]?.id,
        } satisfies StructureNodeData,
        zIndex: 2,
      });
    });

    y += 280;
  }

  const pairCounts = collectSystemEdges(systems, nodes, edges, systemIdByFile, impacted);

  const rfEdges: Edge[] = [...pairCounts.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "resolved" ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, 56)
    .map((pair) => {
      const stroke =
        pair.kind === "resolved"
          ? pair.hot
            ? "#0f7a6c"
            : "#334155"
          : pair.hot
            ? "#0f7a6c"
            : "#64748b";
      return {
        id: `${pair.kind}:${pair.from}->${pair.to}`,
        source: `sys:${pair.from}`,
        target: `sys:${pair.to}`,
        sourceHandle: "b",
        targetHandle: "t",
        type: "smoothstep",
        label: pair.label,
        animated: true,
        className: pair.hot ? "impact-edge" : undefined,
        style: {
          stroke,
          strokeWidth: pair.kind === "resolved" ? 2.4 : 1.8,
          strokeDasharray: pair.kind === "flow" ? "6 4" : undefined,
          opacity: pair.kind === "resolved" ? 0.9 : 0.75,
        },
        labelStyle: {
          fontSize: 10,
          fill: "#475569",
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        },
        labelBgStyle: { fill: "#f7fafc", fillOpacity: 0.92 },
        labelBgPadding: [4, 6] as [number, number],
        labelBgBorderRadius: 6,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 18,
          height: 18,
        },
        zIndex: 1,
      };
    });

  return {
    nodes: rfNodes,
    edges: rfEdges,
    systems,
    narrative: buildNarrative(activeBands, byBand, systems),
    bandStats,
  };
}

type SystemEdge = {
  from: string;
  to: string;
  count: number;
  hot: boolean;
  kind: "resolved" | "flow";
  label?: string;
};

function collectSystemEdges(
  systems: SystemModule[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  systemIdByFile: Map<string, string>,
  impacted: Map<string, string>,
): Map<string, SystemEdge> {
  const pairCounts = new Map<string, SystemEdge>();
  const add = (
    from: string,
    to: string,
    opts: { count?: number; hot?: boolean; kind: "resolved" | "flow"; label?: string },
  ) => {
    if (!from || !to || from === to) return;
    const key = `${opts.kind}:${from}->${to}`;
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count += opts.count ?? 1;
      existing.hot = existing.hot || Boolean(opts.hot);
      return;
    }
    pairCounts.set(key, {
      from,
      to,
      count: opts.count ?? 1,
      hot: Boolean(opts.hot),
      kind: opts.kind,
      label: opts.label,
    });
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    if (edge.type !== "IMPORTS" && edge.type !== "CALLS" && edge.type !== "DEPENDS_ON") continue;
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const fromSys = systemIdByFile.get(fromNode.file);
    const toSys = systemIdByFile.get(toNode.file);
    if (!fromSys || !toSys || fromSys === toSys) continue;
    add(fromSys, toSys, {
      kind: "resolved",
      hot:
        severityFor(fromNode, impacted) !== "NEUTRAL" ||
        severityFor(toNode, impacted) !== "NEUTRAL",
      label: edge.type === "CALLS" ? "calls" : "imports",
    });
  }

  // Architecture flow when cross-package imports aren't resolved in the graph yet.
  const byBand = new Map<BandId, SystemModule[]>();
  for (const band of BANDS) byBand.set(band.id, []);
  for (const system of systems) byBand.get(system.band)!.push(system);

  const delivery = byBand.get("delivery") ?? [];
  const orch = byBand.get("orchestration") ?? [];
  const pipe = byBand.get("pipeline") ?? [];
  const persist = byBand.get("persistence") ?? [];
  const shared = byBand.get("shared") ?? [];

  const isExample = (s: SystemModule) =>
    /example|fixture|demo|sample/i.test(s.root) || /example|fixture|demo/i.test(s.title);

  const primaryDelivery = delivery.filter((s) => !isExample(s));
  const entrySystems = primaryDelivery.length > 0 ? primaryDelivery : delivery;

  for (const from of entrySystems) {
    for (const to of orch) {
      add(from.id, to.id, {
        kind: "flow",
        label: "requests",
        hot: from.impactedCount > 0 || to.impactedCount > 0,
      });
    }
  }

  for (const from of orch) {
    for (const to of pipe) {
      add(from.id, to.id, {
        kind: "flow",
        label: "runs",
        hot: from.impactedCount > 0 || to.impactedCount > 0,
      });
    }
    for (const to of persist) {
      add(from.id, to.id, {
        kind: "flow",
        label: "persists",
        hot: from.impactedCount > 0 || to.impactedCount > 0,
      });
    }
  }

  // Pipeline sequence: parser → graph → framework → impact
  const pipeRank = (s: SystemModule) => {
    const t = `${s.title} ${s.root}`.toLowerCase();
    if (/parser|ast|symbol/.test(t)) return 0;
    if (/graph/.test(t)) return 1;
    if (/framework|detector/.test(t)) return 2;
    if (/impact|engine|blast/.test(t)) return 3;
    return 4;
  };
  const orderedPipe = [...pipe].sort((a, b) => pipeRank(a) - pipeRank(b) || a.title.localeCompare(b.title));
  for (let i = 0; i < orderedPipe.length - 1; i++) {
    add(orderedPipe[i]!.id, orderedPipe[i + 1]!.id, {
      kind: "flow",
      label: "feeds",
      hot: orderedPipe[i]!.impactedCount > 0 || orderedPipe[i + 1]!.impactedCount > 0,
    });
  }

  // Last pipeline stage often returns results toward delivery UI
  const lastPipe = orderedPipe[orderedPipe.length - 1];
  const webUi = entrySystems.find((s) => /web|ui|app/i.test(s.title) || /apps\//.test(s.root));
  if (lastPipe && webUi) {
    add(lastPipe.id, webUi.id, {
      kind: "flow",
      label: "results",
      hot: lastPipe.impactedCount > 0 || webUi.impactedCount > 0,
    });
  }

  for (const to of shared) {
    if (shared.length > 1 && !/shared/i.test(to.root) && !/shared/i.test(to.title)) continue;
    for (const from of [...orch, ...pipe, ...persist, ...entrySystems]) {
      if (from.id === to.id) continue;
      add(from.id, to.id, {
        kind: "flow",
        label: "uses",
        hot: from.impactedCount > 0 || to.impactedCount > 0,
      });
    }
  }

  // Package-name dependency hints for common monorepo shapes
  const find = (re: RegExp) => systems.find((s) => re.test(s.root) || re.test(s.title));
  const analysis = find(/analysis/);
  const git = find(/(^|\/)git$/i);
  const db = find(/db|persistence/i);
  const parser = find(/parser|ast/i);
  const graph = find(/graph/i);
  const impact = find(/impact|engine/i);
  const framework = find(/framework|detector/i);
  const web = find(/apps\/web|web ui/i);
  const cli = find(/^cli$|cli/i);

  if (web && analysis) add(web.id, analysis.id, { kind: "flow", label: "analyze" });
  if (cli && analysis) add(cli.id, analysis.id, { kind: "flow", label: "analyze" });
  if (analysis && git) add(analysis.id, git.id, { kind: "flow", label: "checkout" });
  if (analysis && db) add(analysis.id, db.id, { kind: "flow", label: "cache" });
  if (analysis && parser) add(analysis.id, parser.id, { kind: "flow", label: "parse" });
  if (analysis && graph) add(analysis.id, graph.id, { kind: "flow", label: "graph" });
  if (analysis && impact) add(analysis.id, impact.id, { kind: "flow", label: "impact" });
  if (analysis && framework) add(analysis.id, framework.id, { kind: "flow", label: "enrich" });
  if (impact && graph) add(impact.id, graph.id, { kind: "flow", label: "traverse" });

  return pairCounts;
}

export function StructureDiagram({
  nodes,
  edges,
  impacted,
  selectedId,
  onSelect,
  onClear,
  repositoryName,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  impacted: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear?: () => void;
  repositoryName?: string;
}) {
  // Full structure by default; impact paints on top without hiding systems.
  const [focusImpacted, setFocusImpacted] = useState(false);

  const layout = useMemo(
    () => buildLayout(nodes, edges, impacted, selectedId, focusImpacted),
    [nodes, edges, impacted, selectedId, focusImpacted],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(layout.nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(layout.edges);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    setRfNodes(layout.nodes);
    setRfEdges(layout.edges);
  }, [layout.nodes, layout.edges, setRfNodes, setRfEdges]);

  useEffect(() => {
    if (!flow) return;
    const id = window.setTimeout(() => {
      flow.fitView({ padding: 0.16, duration: 220 });
    }, 50);
    return () => window.clearTimeout(id);
  }, [flow, layout.nodes, focusImpacted]);

  const fileCount = layout.systems.reduce((n, s) => n + s.files.length, 0);
  const impactedFiles = useMemo(() => {
    let count = 0;
    for (const [id, severity] of impacted) {
      if (id.startsWith("FILE:") && severity !== "NEUTRAL") count += 1;
    }
    return count;
  }, [impacted]);

  const showBack = Boolean(selectedId || focusImpacted);

  const handleBack = () => {
    setFocusImpacted(false);
    onClear?.();
    window.setTimeout(() => flow?.fitView({ padding: 0.16, duration: 220 }), 60);
  };

  return (
    <div className="structure-diagram flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-[var(--line)] bg-white/70 lg:w-[300px] lg:border-b-0 lg:border-r">
        <div className="border-b border-[var(--line)] p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
                How this repo works
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold">
                {repositoryName ?? "Repository"} structure
              </h2>
            </div>
            {showBack ? (
              <button
                type="button"
                onClick={handleBack}
                className="shrink-0 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--ink-soft)]"
              >
                ← Back
              </button>
            ) : null}
          </div>
          <ol className="mt-3 space-y-2.5">
            {layout.narrative.map((line) => (
              <li key={line} className="text-sm leading-relaxed text-[var(--ink-soft)]">
                {line}
              </li>
            ))}
          </ol>
        </div>
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
            Architecture bands
          </p>
          <ul className="mt-2 space-y-2">
            {layout.bandStats.map((stat) => {
              const band = BANDS.find((b) => b.id === stat.id)!;
              return (
                <li key={stat.id} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: band.color }}
                    aria-hidden
                  />
                  <span className="font-medium">{band.label}</span>
                  <span className="ml-auto font-mono text-[var(--ink-soft)]/70">{stat.count}</span>
                  {stat.impacted > 0 ? (
                    <span className="font-mono text-[var(--critical)]">{stat.impacted}●</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-auto px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {impacted.size > 0 ? (
              <button
                type="button"
                onClick={() => setFocusImpacted((v) => !v)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  focusImpacted
                    ? "bg-[var(--ink)] text-white"
                    : "border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--teal)]"
                }`}
              >
                {focusImpacted ? "Showing impact only" : "Focus impact"}
              </button>
            ) : null}
            <span className="rounded-full bg-[var(--fog)] px-3 py-1.5 font-mono text-[11px] text-[var(--ink-soft)]">
              {layout.systems.length} systems · {fileCount} files
              {impactedFiles > 0 ? ` · ${impactedFiles} touched` : ""}
            </span>
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-[var(--ink-soft)]/70">
            Systems from real packages/folders. Solid arrows = resolved imports; dashed =
            architecture flow.
          </p>
        </div>
      </aside>

      <div className="relative min-h-0 flex-1 bg-[var(--mist)]/35">
        {showBack ? (
          <div className="absolute left-3 top-3 z-10">
            <button
              type="button"
              onClick={handleBack}
              className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[var(--ink-soft)]"
            >
              ← Back to full structure
            </button>
          </div>
        ) : null}
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={setFlow}
          onNodeClick={(_, node) => {
            if (node.id.startsWith("band:")) return;
            const fileId = (node.data as StructureNodeData).fileId;
            if (fileId) onSelect(fileId);
          }}
          onPaneClick={handleBack}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.12}
          maxZoom={1.4}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#c9d5e1" />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              if (String(n.id).startsWith("band:")) return "#e8eef4";
              const severity = (n.data as StructureNodeData)?.severity ?? "NEUTRAL";
              return severityFill[severity] ?? "#94a3b8";
            }}
          />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

