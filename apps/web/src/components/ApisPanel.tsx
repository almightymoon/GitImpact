"use client";

import type {
  DetectedRoute,
  GraphEdge,
  GraphNode,
  RepositoryType,
} from "@gitimpact/shared";
import { EmptyState } from "@/components/EmptyState";

function buildApiChain(
  route: DetectedRoute,
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[] {
  const chain: string[] = [`${route.method} ${route.path}`];
  if (route.handlerClass && route.handlerName) {
    chain.push(`${route.handlerClass}.${route.handlerName}`);
  } else if (route.handlerName) {
    chain.push(route.handlerName);
  }

  const handlerNode =
    nodes.find((n) => n.id === route.id) ??
    nodes.find(
      (n) =>
        (n.type === "METHOD" || n.type === "FUNCTION" || n.type === "CONTROLLER") &&
        n.file === route.file &&
        (n.name === route.handlerName ||
          n.name === `${route.handlerClass}.${route.handlerName}` ||
          n.name.endsWith(`.${route.handlerName}`)),
    ) ??
    nodes.find(
      (n) =>
        n.type === "API_ROUTE" &&
        n.file === route.file &&
        (n.metadata?.path === route.path || n.name === `${route.method} ${route.path}`),
    );

  if (!handlerNode) return chain;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  let current = handlerNode.id;
  const seen = new Set<string>([current]);
  for (let depth = 0; depth < 4; depth++) {
    const nextEdge = edges.find(
      (e) =>
        e.from === current &&
        (e.type === "CALLS" || e.type === "DEPENDS_ON" || e.type === "USES"),
    );
    if (!nextEdge) break;
    if (seen.has(nextEdge.to)) break;
    seen.add(nextEdge.to);
    const target = byId.get(nextEdge.to);
    if (!target) break;
    if (
      target.type === "FUNCTION" ||
      target.type === "METHOD" ||
      target.type === "SERVICE" ||
      target.type === "DATABASE_MODEL"
    ) {
      chain.push(target.name);
    }
    current = nextEdge.to;
  }
  return chain;
}

export function ApisPanel({
  routes,
  nodes,
  edges,
  repositoryType,
  infraLabels,
  repository,
  onSelectRoute,
  onSelectFile,
  onOpenGraph,
  onOpenTests,
}: {
  routes: DetectedRoute[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  repositoryType?: RepositoryType;
  infraLabels?: string[];
  repository?: { owner: string; name: string; defaultBranch?: string };
  onSelectRoute?: (route: DetectedRoute) => void;
  onSelectFile?: (filePath: string, startLine?: number) => void;
  onOpenGraph?: () => void;
  onOpenTests?: () => void;
}) {
  const isInfra =
    repositoryType === "INFRASTRUCTURE" ||
    repositoryType === "GITOPS" ||
    repositoryType === "DEVOPS";

  const sourceUrl = (route: DetectedRoute) => {
    if (!repository?.owner || !repository?.name) return null;
    const branch = repository.defaultBranch || "main";
    const file = route.file.replace(/^\/+/, "");
    const base = `https://github.com/${repository.owner}/${repository.name}/blob/${branch}/${file}`;
    return route.startLine ? `${base}#L${route.startLine}` : base;
  };

  if (routes.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No HTTP API endpoints were detected in this repository."
          message={
            isInfra
              ? "This appears to be an infrastructure/GitOps repository, so application API endpoints may not exist."
              : "GitImpact looks for Next.js, Express, and NestJS route patterns. Other frameworks may not be detected yet."
          }
          action={
            isInfra && (infraLabels?.length ?? 0) > 0 ? (
              <div className="rounded-xl bg-[var(--fog)]/80 p-3 text-sm">
                <p className="font-medium">Detected instead:</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-[var(--ink-soft)]">
                  {infraLabels!.slice(0, 8).map((label) => (
                    <li key={label}>• {label}</li>
                  ))}
                </ul>
              </div>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">APIs</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Detected HTTP endpoints with handler chains from static analysis.
        </p>
      </div>
      <ul className="space-y-3">
        {routes.map((route) => {
          const chain = buildApiChain(route, nodes, edges);
          const githubSource = sourceUrl(route);
          return (
            <li
              key={route.id}
              className="rounded-2xl border border-[var(--line)] bg-white/80 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 font-mono text-[11px] text-white">
                  {route.method}
                </span>
                <span className="font-mono text-sm">{route.path}</span>
                <span className="rounded-full bg-[var(--fog)] px-2 py-0.5 font-mono text-[10px]">
                  {route.framework}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelectFile?.(route.file, route.startLine)}
                className="mt-2 font-mono text-[11px] text-[var(--teal)] hover:underline"
              >
                {route.file}
                {route.startLine ? `:${route.startLine}` : ""}
              </button>
              {route.handlerName ? (
                <p className="mt-1 text-sm">
                  Handler:{" "}
                  <span className="font-medium">
                    {route.handlerClass
                      ? `${route.handlerClass}.${route.handlerName}`
                      : route.handlerName}
                  </span>
                </p>
              ) : null}
              <p className="mt-3 font-mono text-xs leading-relaxed text-[var(--ink-soft)]">
                {chain.join(" → ")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelectRoute?.(route);
                    onOpenGraph?.();
                  }}
                  className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--teal)]"
                >
                  Open in Graph
                </button>
                <button
                  type="button"
                  onClick={onOpenTests}
                  className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--teal)]"
                >
                  Related tests
                </button>
                {githubSource ? (
                  <a
                    href={githubSource}
                    className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--teal)]"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source file
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectFile?.(route.file, route.startLine);
                      onOpenGraph?.();
                    }}
                    className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--teal)]"
                  >
                    Source file
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
