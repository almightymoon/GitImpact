"use client";

import { useCallback, useEffect, useMemo, useState, memo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  Handle,
  Position,
  ConnectionMode,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  useNodesState,
  useEdgesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DatabaseSchemaModel, DatabaseTable } from "@gitimpact/shared";

type TableNodeData = {
  table: DatabaseTable;
  selected: boolean;
};

const ROW_H = 28;
const HEADER_H = 40;
const WIDTH = 260;

const handleStyle = {
  width: 8,
  height: 8,
  opacity: 0,
  background: "transparent",
  border: "none",
};

function TableNode({ data }: NodeProps) {
  const { table, selected } = data as TableNodeData;
  return (
    <div
      style={{
        width: WIDTH,
        borderRadius: 10,
        border: selected ? "1px solid #3ecf8e" : "1px solid #2a2f3a",
        background: "#1c1f26",
        color: "#e8eaed",
        boxShadow: selected
          ? "0 0 0 1px #3ecf8e55, 0 12px 32px rgba(0,0,0,0.45)"
          : "0 10px 28px rgba(0,0,0,0.35)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        overflow: "visible",
        position: "relative",
      }}
    >
      {/* Handles on every side so edges can reattach while dragging */}
      <Handle id="t-target" type="target" position={Position.Top} style={handleStyle} />
      <Handle id="t-source" type="source" position={Position.Top} style={handleStyle} />
      <Handle id="b-target" type="target" position={Position.Bottom} style={handleStyle} />
      <Handle id="b-source" type="source" position={Position.Bottom} style={handleStyle} />
      <Handle id="l-target" type="target" position={Position.Left} style={handleStyle} />
      <Handle id="l-source" type="source" position={Position.Left} style={handleStyle} />
      <Handle id="r-target" type="target" position={Position.Right} style={handleStyle} />
      <Handle id="r-source" type="source" position={Position.Right} style={handleStyle} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: HEADER_H,
          padding: "0 12px",
          borderBottom: "1px solid #2a2f3a",
          background: "#232833",
          fontWeight: 600,
          letterSpacing: "0.01em",
          borderRadius: "10px 10px 0 0",
          overflow: "hidden",
        }}
      >
        <span style={{ opacity: 0.7 }}>▦</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
          {table.name}
        </span>
        <span style={{ opacity: 0.35, fontSize: 11 }}>{table.columns.length}</span>
      </div>
      <div style={{ overflow: "hidden", borderRadius: "0 0 10px 10px" }}>
        {table.columns.map((col) => (
          <div
            key={col.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: ROW_H,
              padding: "0 12px",
              borderBottom: "1px solid #252a33",
            }}
          >
            <span style={{ width: 14, opacity: col.primaryKey ? 1 : 0.35 }}>
              {col.primaryKey ? "🔑" : "◇"}
            </span>
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: col.primaryKey ? "#f4f6f8" : "#c5cad3",
              }}
            >
              {col.name}
            </span>
            <span style={{ color: "#7d8696", fontSize: 11 }}>{col.type}</span>
          </div>
        ))}
        {table.columns.length === 0 ? (
          <div style={{ padding: "10px 12px", color: "#7d8696" }}>No columns parsed</div>
        ) : null}
      </div>
    </div>
  );
}

type NodeLike = {
  measured?: { width?: number; height?: number };
  internals: { positionAbsolute: { x: number; y: number } };
};

function nodeBox(node: NodeLike) {
  const width = node.measured?.width ?? WIDTH;
  const height = node.measured?.height ?? HEADER_H + ROW_H * 4;
  const x = node.internals.positionAbsolute.x;
  const y = node.internals.positionAbsolute.y;
  return {
    width,
    height,
    x,
    y,
    cx: x + width / 2,
    cy: y + height / 2,
  };
}

/** Pick the side of `node` closest to point (tx, ty). */
function closestSide(
  node: NodeLike,
  tx: number,
  ty: number,
): { x: number; y: number; position: Position } {
  const box = nodeBox(node);
  const candidates: Array<{ x: number; y: number; position: Position; d: number }> = [
    { x: box.cx, y: box.y, position: Position.Top, d: 0 },
    { x: box.cx, y: box.y + box.height, position: Position.Bottom, d: 0 },
    { x: box.x, y: box.cy, position: Position.Left, d: 0 },
    { x: box.x + box.width, y: box.cy, position: Position.Right, d: 0 },
  ];
  for (const c of candidates) {
    c.d = (c.x - tx) ** 2 + (c.y - ty) ** 2;
  }
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates[0]!;
  return { x: best.x, y: best.y, position: best.position };
}

function getFloatingEdgeParams(source: NodeLike, target: NodeLike) {
  const s = nodeBox(source);
  const t = nodeBox(target);
  // First guess: connect toward the other node's center
  const sourceHandle = closestSide(source, t.cx, t.cy);
  const targetHandle = closestSide(target, s.cx, s.cy);
  // Refine once using the chosen opposite handle points (avoids opposite-side detours)
  const sourcePoint = closestSide(source, targetHandle.x, targetHandle.y);
  const targetPoint = closestSide(target, sourcePoint.x, sourcePoint.y);
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: sourcePoint.position,
    targetPos: targetPoint.position,
  };
}

function FloatingRelationEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(
    sourceNode,
    targetNode,
  );

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    borderRadius: 12,
    offset: 24,
  });

  const edgeData = data as { column?: string } | undefined;
  const columnLabel =
    (typeof label === "string" ? label : undefined) ?? edgeData?.column;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "#6b7280",
          strokeWidth: 1.5,
          ...style,
        }}
      />
      {columnLabel ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              fontSize: 10,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              color: "#9ca3af",
              background: "rgba(17, 24, 39, 0.9)",
              border: "1px solid #2a2f3a",
              borderRadius: 4,
              padding: "1px 5px",
            }}
            className="nodrag nopan"
          >
            {columnLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { dbTable: memo(TableNode) };
const edgeTypes = { floating: FloatingRelationEdge };

function layoutTables(tables: DatabaseTable[], foreignKeys: DatabaseSchemaModel["foreignKeys"]): Node[] {
  // Relationship-aware grid: connected tables cluster toward shared columns.
  const degree = new Map<string, number>();
  for (const t of tables) degree.set(t.name, 0);
  for (const fk of foreignKeys) {
    degree.set(fk.fromTable, (degree.get(fk.fromTable) ?? 0) + 1);
    degree.set(fk.toTable, (degree.get(fk.toTable) ?? 0) + 1);
  }
  const ordered = [...tables].sort(
    (a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0) || a.name.localeCompare(b.name),
  );
  const cols = Math.max(2, Math.ceil(Math.sqrt(ordered.length)));
  return ordered.map((table, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const height = HEADER_H + Math.max(1, table.columns.length) * ROW_H;
    return {
      id: table.name,
      type: "dbTable",
      position: {
        x: col * (WIDTH + 120),
        y: row * (Math.min(height, 360) + 100),
      },
      data: { table, selected: false },
      style: { width: WIDTH },
    } satisfies Node;
  });
}

function buildEdges(model: DatabaseSchemaModel): Edge[] {
  const tableIds = new Set(model.tables.map((t) => t.name));
  return model.foreignKeys
    .filter((fk) => tableIds.has(fk.fromTable) && tableIds.has(fk.toTable))
    .map((fk) => ({
      id: fk.id,
      source: fk.fromTable,
      target: fk.toTable,
      type: "floating",
      animated: false,
      data: { column: fk.fromColumn },
      label: fk.fromColumn,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: "#6b7280",
      },
    }));
}

export function DatabaseSchemaDiagram({
  model,
}: {
  model: DatabaseSchemaModel;
}) {
  const initialNodes = useMemo(
    () => layoutTables(model.tables, model.foreignKeys),
    [model.tables, model.foreignKeys],
  );
  const initialEdges = useMemo(() => buildEdges(model), [model]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<string | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);

  // Reset layout only when the schema model identity changes — never on selection.
  useEffect(() => {
    setNodes(layoutTables(model.tables, model.foreignKeys));
    setEdges(buildEdges(model));
    setSelected(null);
    setLayoutKey((k) => k + 1);
  }, [model, setNodes, setEdges]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...(n.data as TableNodeData),
          selected: n.id === selected,
        },
      })),
    );
  }, [selected, setNodes]);

  const onNodeDragStop = useCallback(() => {
    // Force edge re-measure after drag settles (floating edges read live positions).
    setEdges((eds) => eds.map((e) => ({ ...e })));
  }, [setEdges]);

  const selectedTable = model.tables.find((t) => t.name === selected);

  if (model.tables.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0f1115] px-6 text-center text-sm text-[#9ca3af]">
        <p className="font-medium text-[#e5e7eb]">No tables parsed yet</p>
        <p className="max-w-md">
          Found {model.sourceFiles.length} migration/seed/schema file
          {model.sourceFiles.length === 1 ? "" : "s"}
          {model.summary.recentFileCount
            ? ` (${model.summary.recentFileCount} changed in the last ${model.lookbackDays} days)`
            : ""}
          , but could not extract CREATE TABLE / Prisma models. Supported: SQL DDL and{" "}
          <code className="text-[#d1d5db]">schema.prisma</code>.
        </p>
        {model.sourceFiles.length ? (
          <ul className="mt-2 max-h-40 overflow-auto text-left font-mono text-xs text-[#6b7280]">
            {model.sourceFiles.slice(0, 20).map((f) => (
              <li key={f.path}>
                {f.recent ? "● " : "○ "}
                {f.path}{" "}
                <span className="opacity-60">({f.kind})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[640px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[#0f1115]">
      <div className="min-w-0 flex-1">
        <ReactFlow
          key={layoutKey}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={1.5}
          nodesConnectable={false}
          edgesReconnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => setSelected(node.id)}
          onPaneClick={() => setSelected(null)}
          style={{ background: "#0f1115" }}
          defaultEdgeOptions={{
            type: "floating",
            interactionWidth: 24,
          }}
        >
          <Background gap={18} size={1} color="#1f2430" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(0,0,0,0.55)"
            nodeColor="#2a3140"
            style={{ background: "#151821" }}
          />
        </ReactFlow>
      </div>
      <aside className="hidden w-[300px] shrink-0 border-l border-[#1f2430] bg-[#12151c] p-4 text-sm text-[#c5cad3] lg:block">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#6b7280]">
          Database schema
        </p>
        <p className="mt-2 text-[#e5e7eb]">
          {model.summary.tableCount} tables · {model.summary.columnCount} columns ·{" "}
          {model.summary.foreignKeyCount} relations
        </p>
        <p className="mt-1 text-xs text-[#6b7280]">
          {model.sourceFiles.length} source file
          {model.sourceFiles.length === 1 ? "" : "s"}
          {model.summary.recentFileCount
            ? ` · ${model.summary.recentFileCount} in last ${model.lookbackDays}d`
            : ""}
        </p>
        <p className="mt-3 text-[11px] text-[#6b7280]">
          Drag tables freely — relation lines reattach to the nearest side.
        </p>

        {selectedTable ? (
          <div className="mt-5">
            <h3 className="font-mono text-base font-semibold text-white">
              {selectedTable.name}
            </h3>
            <ul className="mt-3 space-y-1.5 font-mono text-xs">
              {selectedTable.columns.map((col) => (
                <li
                  key={col.name}
                  className="flex items-center justify-between gap-2 border-b border-[#1f2430] py-1.5"
                >
                  <span>
                    {col.primaryKey ? "🔑 " : ""}
                    {col.name}
                  </span>
                  <span className="text-[#7d8696]">{col.type}</span>
                </li>
              ))}
            </ul>
            {selectedTable.sourceFiles.length ? (
              <p className="mt-4 text-[11px] text-[#6b7280]">
                From {selectedTable.sourceFiles.join(", ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-5 text-xs text-[#6b7280]">
            Click a table to inspect columns. Edges are foreign keys parsed from SQL /
            Prisma.
          </p>
        )}
      </aside>
    </div>
  );
}
