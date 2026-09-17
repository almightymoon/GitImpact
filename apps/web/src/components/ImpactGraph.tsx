"use client";

import { useEffect, useMemo, memo } from "react";
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

type ImpactNodeData = {
  title: string;
  subtitle: string;
  severity: string;
  selected: boolean;
};

function ImpactNode({ data }: NodeProps) {
  const nodeData = data as ImpactNodeData;
  const border = nodeData.selected
    ? "#0f7a6c"
    : severityFill[nodeData.severity] ?? severityFill.NEUTRAL;

  return (
    <div
      title={`${nodeData.title}\n${nodeData.subtitle}`}
      style={{
        width: 168,
        maxWidth: 168,
        overflow: "hidden",
        borderRadius: 12,
        border: `1.5px solid ${border}`,
        background: nodeData.selected ? "#0b1220" : "#ffffff",
        color: nodeData.selected ? "#f7fafc" : "#0b1220",
        boxShadow:
          nodeData.severity !== "NEUTRAL"
            ? `0 0 0 3px ${(severityFill[nodeData.severity] ?? "#64748b")}22`
            : undefined,
        padding: "8px 10px",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.25,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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

function layoutNodes(
  nodes: GraphNode[],
  impacted: Map<string, string>,
  selectedId: string | null,
): Node[] {
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

    return {
      id: node.id,
      type: "impact",
      position: { x: col * 200, y: row * 100 },
      data: {
        title: node.name,
        subtitle: node.type,
        severity,
        selected: node.id === selectedId,
      } satisfies ImpactNodeData,
    };
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
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#94a3b8",
        width: 16,
        height: 16,
      },
    }));
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
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onClear?.()}
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
