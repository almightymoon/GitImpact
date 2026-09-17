"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, GraphNode } from "@gitimpact/shared";

const severityFill: Record<string, string> = {
  CRITICAL: "#9f1239",
  HIGH: "#c2410c",
  MEDIUM: "#0e7490",
  NEUTRAL: "#64748b",
};

function layoutNodes(
  nodes: GraphNode[],
  impacted: Map<string, string>,
  selectedId: string | null,
): Node[] {
  // Prefer impacted subgraph when available for readability
  const focus = impacted.size
    ? nodes.filter((n) => impacted.has(n.id) || impacted.has(`FILE:${n.file}`))
    : nodes;

  const pool = (focus.length > 0 ? focus : nodes).slice(0, 120);

  const columns = Math.max(3, Math.ceil(Math.sqrt(pool.length)));
  return pool.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const severity =
      impacted.get(node.id) ??
      impacted.get(`FILE:${node.file}`) ??
      "NEUTRAL";
    const isSelected = node.id === selectedId;
    return {
      id: node.id,
      position: { x: col * 220, y: row * 110 },
      data: {
        label: (
          <div className="px-1 py-0.5">
            <div className="text-[11px] font-semibold leading-tight">{node.name}</div>
            <div className="font-mono text-[9px] opacity-70">{node.type}</div>
          </div>
        ),
      },
      style: {
        border: `1.5px solid ${isSelected ? "#0f7a6c" : severityFill[severity]}`,
        background: isSelected ? "#0b1220" : "#ffffff",
        color: isSelected ? "#f7fafc" : "#0b1220",
        borderRadius: 12,
        fontSize: 12,
        width: 170,
        boxShadow: severity !== "NEUTRAL" ? `0 0 0 3px ${severityFill[severity]}22` : undefined,
      },
    } satisfies Node;
  });
}

function layoutEdges(edges: GraphEdge[], visibleIds: Set<string>): Edge[] {
  return edges
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .slice(0, 200)
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      animated: edge.type === "IMPORTS",
      style: { stroke: "#94a3b8", strokeWidth: 1.2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 16, height: 16 },
    }));
}

export function ImpactGraph({
  nodes,
  edges,
  impacted,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  impacted: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const initialNodes = useMemo(
    () => layoutNodes(nodes, impacted, selectedId),
    [nodes, impacted, selectedId],
  );
  const visibleIds = useMemo(
    () => new Set(initialNodes.map((n) => n.id)),
    [initialNodes],
  );
  const initialEdges = useMemo(
    () => layoutEdges(edges, visibleIds),
    [edges, visibleIds],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setRfNodes(initialNodes);
    setRfEdges(initialEdges);
  }, [initialNodes, initialEdges, setRfNodes, setRfEdges]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
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
          const severity = impacted.get(n.id) ?? "NEUTRAL";
          return severityFill[severity];
        }}
      />
      <Controls />
    </ReactFlow>
  );
}
