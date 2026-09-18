"use client";

import { useCallback, useEffect, useMemo, useState, memo } from "react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, GraphNode } from "@gitimpact/shared";

const severityFill: Record<string, string> = {
  CRITICAL: "#9f1239",
  HIGH: "#c2410c",
  MEDIUM: "#0e7490",
  NEUTRAL: "#64748b",
};

/** Distinct path colors for multi-select connections */
const PATH_COLORS = [
  "#0f7a6c", // teal
  "#c2410c", // orange
  "#7c3aed", // violet
  "#0369a1", // blue
  "#be185d", // pink
  "#ca8a04", // gold
];

type ImpactNodeData = {
  title: string;
  subtitle: string;
  severity: string;
  selected: boolean;
  selectionIndex: number; // -1 if not in path selection
  selectionColor?: string;
};

function ImpactNode({ data }: NodeProps) {
  const nodeData = data as ImpactNodeData;
  const inPath = nodeData.selectionIndex >= 0;
  const border = inPath
    ? nodeData.selectionColor ?? "#0f7a6c"
    : nodeData.selected
      ? "#0f7a6c"
      : severityFill[nodeData.severity] ?? severityFill.NEUTRAL;

  return (
    <div
      title={`${nodeData.title}\n${nodeData.subtitle}${
        inPath ? `\nSelected #${nodeData.selectionIndex + 1}` : ""
      }`}
      style={{
        width: 168,
        maxWidth: 168,
        overflow: "hidden",
        borderRadius: 12,
        border: `2px solid ${border}`,
        background: inPath || nodeData.selected ? "#0b1220" : "#ffffff",
        color: inPath || nodeData.selected ? "#f7fafc" : "#0b1220",
        boxShadow: inPath
          ? `0 0 0 3px ${(nodeData.selectionColor ?? "#0f7a6c")}33`
          : nodeData.severity !== "NEUTRAL"
            ? `0 0 0 3px ${(severityFill[nodeData.severity] ?? "#64748b")}22`
            : undefined,
        padding: "8px 10px",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {inPath ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: nodeData.selectionColor,
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          }}
        >
          {nodeData.selectionIndex + 1}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.25,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          paddingRight: inPath ? 18 : 0,
        }}
      >
        {nodeData.title}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 9,
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          opacity: 0.7,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nodeData.subtitle}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { impact: memo(ImpactNode) };

function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a) ?? [];
    list.push(b);
    adj.set(a, list);
  };
  for (const edge of edges) {
    // Undirected for "connecting path" discovery
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }
  return adj;
}

/** BFS shortest path between two nodes (undirected). */
function shortestPath(
  adj: Map<string, string[]>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  if (!adj.has(from) || !adj.has(to)) return null;

  const queue = [from];
  const prev = new Map<string, string | null>();
  prev.set(from, null);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path: string[] = [];
        let walk: string | null = to;
        while (walk) {
          path.push(walk);
          walk = prev.get(walk) ?? null;
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

type LitEdge = {
  color: string;
  pathIndex: number;
};

function layoutNodes(
  nodes: GraphNode[],
  impacted: Map<string, string>,
  selectedId: string | null,
  pathSelection: string[],
): Node[] {
  const focus = impacted.size
    ? nodes.filter((n) => impacted.has(n.id) || impacted.has(`FILE:${n.file}`))
    : nodes;

  const pool = (focus.length > 0 ? focus : nodes).slice(0, 120);
  const columns = Math.max(3, Math.ceil(Math.sqrt(pool.length)));
  const selectionIndex = new Map(pathSelection.map((id, i) => [id, i]));

  return pool.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const severity =
      impacted.get(node.id) ??
      impacted.get(`FILE:${node.file}`) ??
      "NEUTRAL";
    const selIdx = selectionIndex.get(node.id) ?? -1;

    return {
      id: node.id,
      type: "impact",
      position: { x: col * 200, y: row * 100 },
      data: {
        title: node.name,
        subtitle: node.type,
        severity,
        selected: node.id === selectedId,
        selectionIndex: selIdx,
        selectionColor: selIdx >= 0 ? PATH_COLORS[selIdx % PATH_COLORS.length] : undefined,
      } satisfies ImpactNodeData,
      zIndex: selIdx >= 0 ? 10 : 1,
    };
  });
}

function layoutEdges(
  edges: GraphEdge[],
  visibleIds: Set<string>,
  litEdges: Map<string, LitEdge>,
  selectedEdgeId: string | null,
): Edge[] {
  return edges
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .slice(0, 200)
    .map((edge) => {
      const lit = litEdges.get(edgeKey(edge.from, edge.to));
      const selected = edge.id === selectedEdgeId;
      const stroke = selected ? "var(--teal)" : lit?.color ?? "#94a3b8";
      const width = selected ? 3.4 : lit ? 3.2 : 1.2;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        animated: Boolean(lit) || selected || edge.type === "IMPORTS",
        className: lit || selected ? "impact-edge" : undefined,
        data: { graphEdge: edge },
        style: {
          stroke,
          strokeWidth: width,
          opacity: selected || lit ? 1 : 0.45,
        },
        zIndex: selected || lit ? 5 : 0,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: lit || selected ? 18 : 14,
          height: lit || selected ? 18 : 14,
        },
        label: selected || lit ? edge.type : undefined,
        labelStyle:
          selected || lit
            ? {
                fontSize: 9,
                fill: selected ? "var(--teal)" : lit!.color,
                fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                fontWeight: 600,
              }
            : undefined,
        labelBgStyle:
          selected || lit ? { fill: "#f7fafc", fillOpacity: 0.9 } : undefined,
        labelBgPadding: selected || lit ? ([3, 5] as [number, number]) : undefined,
        labelBgBorderRadius: 4,
      };
    });
}

export function ImpactGraph({
  nodes,
  edges,
  impacted,
  selectedId,
  onSelect,
  onClear,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  impacted: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear?: () => void;
}) {
  const [pathSelection, setPathSelection] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Parent cleared → clear path chain. Parent picked a new root outside the chain → restart.
  useEffect(() => {
    if (!selectedId) {
      setPathSelection((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    setSelectedEdgeId(null);
    setPathSelection((prev) => {
      if (prev.length === 0) return [selectedId];
      if (prev.includes(selectedId)) return prev;
      return [selectedId];
    });
  }, [selectedId]);

  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);

  const litEdges = useMemo(() => {
    const map = new Map<string, LitEdge>();
    for (let i = 0; i < pathSelection.length - 1; i++) {
      const from = pathSelection[i]!;
      const to = pathSelection[i + 1]!;
      const path = shortestPath(adjacency, from, to);
      if (!path || path.length < 2) continue;
      const color = PATH_COLORS[i % PATH_COLORS.length]!;
      for (let j = 0; j < path.length - 1; j++) {
        const key = edgeKey(path[j]!, path[j + 1]!);
        if (!map.has(key)) map.set(key, { color, pathIndex: i });
      }
    }
    return map;
  }, [adjacency, pathSelection]);

  const initialNodes = useMemo(
    () => layoutNodes(nodes, impacted, selectedId, pathSelection),
    [nodes, impacted, selectedId, pathSelection],
  );
  const visibleIds = useMemo(() => new Set(initialNodes.map((n) => n.id)), [initialNodes]);
  const initialEdges = useMemo(
    () => layoutEdges(edges, visibleIds, litEdges, selectedEdgeId),
    [edges, visibleIds, litEdges, selectedEdgeId],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setRfNodes(initialNodes);
    setRfEdges(initialEdges);
  }, [initialNodes, initialEdges, setRfNodes, setRfEdges]);

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [edges, selectedEdgeId],
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      setSelectedEdgeId(null);
      // Replace selection — do not push browser history for node picks
      setPathSelection([id]);
      queueMicrotask(() => {
        if (id !== selectedId) onSelect(id);
      });
    },
    [onSelect, selectedId],
  );

  const handleEdgeClick = useCallback((edgeId: string) => {
    setPathSelection([]);
    setSelectedEdgeId(edgeId);
  }, []);

  const handleClear = useCallback(() => {
    setPathSelection([]);
    setSelectedEdgeId(null);
    onClear?.();
  }, [onClear]);

  const nameFor = useCallback(
    (id: string) => nodes.find((n) => n.id === id)?.name ?? id.split(":").pop() ?? id,
    [nodes],
  );

  return (
    <div className="impact-graph relative h-full w-full">
      {pathSelection.length > 0 ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(420px,70%)]">
          <div className="pointer-events-auto rounded-xl border border-[var(--line)] bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Selected · click empty space to deselect
              </p>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full px-2 py-0.5 text-[11px] text-[var(--teal)] hover:underline"
              >
                Deselect
              </button>
            </div>
            <p className="mt-1.5 text-[11px] font-medium">{nameFor(pathSelection[0]!)}</p>
          </div>
        </div>
      ) : null}

      {selectedEdge ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-[min(380px,75%)]">
          <div className="pointer-events-auto rounded-xl border border-[var(--line)] bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Why this relationship exists
              </p>
              <button
                type="button"
                onClick={() => setSelectedEdgeId(null)}
                className="rounded-full px-2 py-0.5 text-[11px] text-[var(--teal)] hover:underline"
              >
                Close
              </button>
            </div>
            <p className="mt-1.5 text-sm font-medium">
              {nameFor(selectedEdge.from)}
              <span className="mx-1.5 text-[var(--ink-soft)]">→</span>
              {nameFor(selectedEdge.to)}
            </p>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">Relationship</dt>
                <dd className="font-mono font-medium">{selectedEdge.type}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">Confidence</dt>
                <dd className="font-mono font-medium">{selectedEdge.confidence}</dd>
              </div>
              {selectedEdge.evidence?.file ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ink-soft)]">Source</dt>
                  <dd className="max-w-[220px] truncate font-mono" title={selectedEdge.evidence.file}>
                    {selectedEdge.evidence.file}
                    {selectedEdge.evidence.startLine
                      ? `:${selectedEdge.evidence.startLine}`
                      : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
            {selectedEdge.evidence?.snippet ? (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--fog)] px-2 py-1.5 font-mono text-[10px] leading-relaxed">
                {selectedEdge.evidence.snippet}
              </pre>
            ) : null}
            {selectedEdge.evidence?.resolvedThrough ? (
              <p className="mt-2 text-[10px] text-[var(--ink-soft)]">
                Resolved through:{" "}
                <span className="font-mono text-[var(--ink)]">
                  {selectedEdge.evidence.resolvedThrough}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[10px] text-[var(--ink-soft)]">
                No source snippet for this edge type yet.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => handleNodeClick(node.id)}
        onEdgeClick={(_, edge) => handleEdgeClick(edge.id)}
        onPaneClick={handleClear}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#d5dee8" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const data = n.data as ImpactNodeData | undefined;
            if (data && data.selectionIndex >= 0 && data.selectionColor) {
              return data.selectionColor;
            }
            const severity = impacted.get(n.id) ?? "NEUTRAL";
            return severityFill[severity];
          }}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
