"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  AnalysisSummary,
  ChangeRecord,
  ChecksReport,
  DetectedRoute,
  GraphEdge,
  GraphNode,
  ImpactPathStep,
  ImpactReport,
  PullRequestImpactOverview,
  RepositoryIntelligence,
} from "@gitimpact/shared";
import { ImpactGraph } from "@/components/ImpactGraph";
import { StructureDiagram } from "@/components/StructureDiagram";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import { AccessErrorPanel } from "@/components/AccessErrorPanel";
import { RepoOverviewPanel } from "@/components/RepoOverviewPanel";
import { PullRequestsPanel } from "@/components/PullRequestsPanel";
import { SemanticChangesPanel } from "@/components/SemanticChangesPanel";
import { TestsPanel } from "@/components/TestsPanel";
import { ApisPanel } from "@/components/ApisPanel";
import { NodeInspectorPanel } from "@/components/NodeInspectorPanel";
import { EmptyState } from "@/components/EmptyState";
import { HelpTip, HELP } from "@/components/HelpTip";
import {
  PullRequestOverviewPanel,
} from "@/components/PullRequestPanels";
import { ChecksPanel, PrQualityReport } from "@/components/ChecksPanel";

type TabId =
  | "overview"
  | "graph"
  | "structure"
  | "prs"
  | "changes"
  | "tests"
  | "apis"
  | "checks";

type AnalysisPayload = {
  id: string;
  repository: {
    owner: string;
    name: string;
    url: string;
    defaultBranch: string;
  };
  summary: AnalysisSummary;
  intelligence?: RepositoryIntelligence;
  checks?: ChecksReport;
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    baseBranch?: string;
    headBranch?: string;
  };
  changes?: ChangeRecord[];
  impact?: ImpactReport;
  prOverview?: PullRequestImpactOverview;
  routes?: DetectedRoute[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  error?: string;
  code?: string;
  detail?: string;
};

type InspectorPayload = {
  node: GraphNode;
  directDependencies: Array<{
    node: GraphNode;
    edgeType: string;
    confidence: string;
    direction: "outgoing";
  }>;
  directDependents: Array<{
    node: GraphNode;
    edgeType: string;
    confidence: string;
    direction: "incoming";
  }>;
  relatedApis: GraphNode[];
  relatedTests: GraphNode[];
  impact: ImpactReport;
};

const TABS_REPO: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Graph" },
  { id: "structure", label: "Structure" },
  { id: "prs", label: "PRs" },
  { id: "checks", label: "Checks" },
  { id: "tests", label: "Tests" },
  { id: "apis", label: "APIs" },
];

const TABS_PR: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Graph" },
  { id: "changes", label: "Semantic Changes" },
  { id: "checks", label: "Checks" },
  { id: "tests", label: "Tests" },
  { id: "apis", label: "APIs" },
  { id: "structure", label: "Structure" },
];

export function RepositoryWorkbench({
  analysisId,
  title,
  githubUrl,
  isPullRequest = false,
}: {
  analysisId: string;
  title: string;
  githubUrl: string;
  isPullRequest?: boolean;
}) {
  const [data, setData] = useState<AnalysisPayload | null>(null);
  const [error, setError] = useState<{
    message: string;
    code?: string;
    detail?: string;
    action?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [inspector, setInspector] = useState<InspectorPayload | null>(null);
  const [whyPath, setWhyPath] = useState<ImpactPathStep[] | null>(null);
  const [whyTarget, setWhyTarget] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${analysisId}`);
      const payload = (await response.json()) as AnalysisPayload;
      if (!response.ok) {
        setError({
          message: payload.error ?? "Failed to load analysis",
          code: payload.code,
          detail: payload.detail,
        });
        setData(null);
        return;
      }
      setData(payload);
      if (payload.impact) {
        setImpact(payload.impact);
        setSelectedNodeId(payload.impact.changedNodes[0]?.id ?? null);
      }
      setTab("overview");
    } catch {
      setError({ message: "Failed to load analysis", code: "ANALYSIS_FAILED" });
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchImpact = useCallback(
    (nodeId: string, nextDepth = depth, options?: { stay?: boolean }) => {
      startTransition(async () => {
        const [impactRes, inspectRes] = await Promise.all([
          fetch(
            `/api/repositories/${analysisId}?nodeId=${encodeURIComponent(nodeId)}&depth=${nextDepth}`,
          ),
          fetch(
            `/api/repositories/${analysisId}?inspect=${encodeURIComponent(nodeId)}&depth=${nextDepth}`,
          ),
        ]);
        const impactPayload = (await impactRes.json()) as {
          impact?: ImpactReport;
          error?: string;
        };
        const inspectPayload = (await inspectRes.json()) as {
          inspector?: InspectorPayload;
        };
        if (impactRes.ok && impactPayload.impact) {
          setImpact(impactPayload.impact);
          setSelectedNodeId(nodeId);
          if (!options?.stay) setTab("graph");
        }
        if (inspectRes.ok && inspectPayload.inspector) {
          setInspector(inspectPayload.inspector);
        }
      });
    },
    [analysisId, depth],
  );

  const selectFile = useCallback(
    (filePath: string) => {
      fetchImpact(`FILE:${filePath}`);
    },
    [fetchImpact],
  );

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setImpact(data?.impact ?? null);
    setInspector(null);
    setWhyPath(null);
    setWhyTarget(null);
  }, [data?.impact]);

  const showWhy = useCallback(
    (targetNodeId: string) => {
      startTransition(async () => {
        const params = new URLSearchParams({ why: targetNodeId });
        if (selectedNodeId) params.set("from", selectedNodeId);
        const response = await fetch(`/api/repositories/${analysisId}?${params}`);
        const payload = (await response.json()) as {
          path?: ImpactPathStep[];
          error?: string;
        };
        if (response.ok && payload.path) {
          setWhyPath(payload.path);
          setWhyTarget(targetNodeId);
        }
      });
    },
    [analysisId, selectedNodeId],
  );

  const impactedIds = useMemo(() => {
    if (!impact) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const node of impact.changedNodes) map.set(node.id, "CRITICAL");
    for (const item of impact.directImpact) map.set(item.node.id, item.severity);
    for (const item of impact.indirectImpact) map.set(item.node.id, item.severity);
    for (const file of impact.affectedFiles) {
      const fileId = `FILE:${file}`;
      if (!map.has(fileId)) {
        const match = [...impact.directImpact, ...impact.indirectImpact].find(
          (i) => i.node.file === file,
        );
        map.set(fileId, match?.severity ?? "MEDIUM");
      }
    }
    return map;
  }, [impact]);

  const filteredNodes = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.graph.nodes;
    return data.graph.nodes.filter(
      (n) => n.name.toLowerCase().includes(q) || n.file.toLowerCase().includes(q),
    );
  }, [data, query]);

  const showPrChrome = Boolean(data?.pullRequest || data?.prOverview || isPullRequest);
  const visibleTabs = showPrChrome ? TABS_PR : TABS_REPO;
  const selectedNode =
    inspector?.node ??
    data?.graph.nodes.find((n) => n.id === selectedNodeId) ??
    null;

  const testRelated =
    impact?.relatedTests ??
    data?.graph.nodes.filter((n) => n.type === "TEST") ??
    [];
  const testGaps = impact?.missingTests ?? [];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-mono text-sm text-[var(--ink-soft)]">Loading analysis…</p>
      </div>
    );
  }

  if (error || !data) {
    if (
      error?.code === "PRIVATE_REPOSITORY" ||
      error?.code === "ACCESS_DENIED" ||
      /private|authorization|denied/i.test(error?.message ?? "")
    ) {
      return (
        <AccessErrorPanel
          title={title}
          githubUrl={githubUrl}
          error={{
            code: (error?.code as "PRIVATE_REPOSITORY") ?? "PRIVATE_REPOSITORY",
            message:
              error?.message ?? "GitImpact cannot access this private repository.",
            detail: error?.detail,
            action: "connect_github",
          }}
        />
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
        <Link href="/" className="font-display text-lg font-bold">
          GitImpact
        </Link>
        <h1 className="mt-8 font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          {error?.message ?? "No cached analysis found for this URL."}
        </p>
        {error?.detail ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">{error.detail}</p>
        ) : null}
        <div className="mt-8">
          <AnalyzeForm
            initialUrl={githubUrl.replace("https://", "").replace("local://", "")}
          />
        </div>
      </main>
    );
  }

  // Empty analysis with zero parsed files — treat as access/empty issue when appropriate
  const emptyAnalysis =
    data.summary.files === 0 &&
    (data.intelligence?.analysisHealth.filesDiscovered ?? 0) === 0;

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--line)]/80 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" className="shrink-0 font-display text-lg font-bold">
              GitImpact
            </Link>
            <div className="min-w-0 overflow-hidden">
              <p
                className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm text-[var(--ink)]"
                title={title}
              >
                {title}
              </p>
              {data.pullRequest ? (
                <p className="text-xs text-[var(--ink-soft)]/80">
                  {data.pullRequest.title}
                  {data.pullRequest.baseBranch && data.pullRequest.headBranch
                    ? ` · ${data.pullRequest.baseBranch} ← ${data.pullRequest.headBranch}`
                    : ""}
                </p>
              ) : (
                <p className="text-xs text-[var(--ink-soft)]/80">
                  {data.intelligence?.typeLabel ?? data.repository.defaultBranch}
                  {data.summary.frameworks.length
                    ? ` · ${data.summary.frameworks.join(", ")}`
                    : ""}
                </p>
              )}
            </div>
          </div>
          {githubUrl.startsWith("http") ? (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm hover:border-[var(--teal)]"
            >
              Open on GitHub
            </a>
          ) : null}
        </div>
        <div className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-6 pb-3">
          {visibleTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                tab === item.id
                  ? "bg-[var(--ink)] text-white"
                  : "text-[var(--ink-soft)] hover:bg-[var(--fog)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {emptyAnalysis ? (
        <div className="mx-auto max-w-[1400px] p-6">
          <EmptyState
            title="No supported source files were parsed"
            message="This may be an empty repository, an unsupported language stack, or an access problem. Check Overview analysis health and repository type."
            action={
              <button
                type="button"
                onClick={() => setTab("overview")}
                className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm text-white"
              >
                Open Overview
              </button>
            }
          />
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="mx-auto max-w-[1400px]">
          {data.prOverview ? (
            <div className="space-y-6 p-6 pt-0">
              <div className="pt-6">
                <PrQualityReport checks={data.checks} />
              </div>
              <PullRequestOverviewPanel
                overview={data.prOverview}
                impact={impact ?? data.impact}
                onSelectNode={fetchImpact}
                onOpenGraph={() => setTab("graph")}
                onOpenTests={() => setTab("tests")}
                onOpenApis={() => setTab("apis")}
              />
            </div>
          ) : (
            <RepoOverviewPanel
              summary={data.summary}
              repository={data.repository}
              intelligence={data.intelligence}
              onOpenGraph={() => setTab("graph")}
              onOpenStructure={() => setTab("structure")}
              onOpenPrs={() => setTab("prs")}
              onOpenApis={() => setTab("apis")}
            />
          )}
        </div>
      ) : null}

      {tab === "prs" ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestsPanel
            repository={data.repository}
            intelligence={data.intelligence}
          />
        </div>
      ) : null}

      {tab === "changes" ? (
        <div className="mx-auto max-w-[1400px]">
          <SemanticChangesPanel
            changes={data.changes ?? []}
            onSelectFile={selectFile}
          />
        </div>
      ) : null}

      {tab === "checks" ? (
        <div className="mx-auto max-w-[1400px]">
          <ChecksPanel
            checks={data.checks}
            onSelectFile={selectFile}
            onOpenGraph={() => setTab("graph")}
          />
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="mx-auto max-w-[1400px]">
          <TestsPanel
            relatedTests={testRelated}
            missingTests={testGaps}
            changedNodes={impact?.changedNodes ?? data.impact?.changedNodes ?? []}
            changes={data.changes}
            impact={impact ?? data.impact}
            repositoryType={data.intelligence?.repositoryType}
            onSelect={fetchImpact}
            onOpenGraph={() => setTab("graph")}
          />
        </div>
      ) : null}

      {tab === "apis" ? (
        <div className="mx-auto max-w-[1400px]">
          <ApisPanel
            routes={data.routes ?? []}
            nodes={data.graph.nodes}
            edges={data.graph.edges}
            repositoryType={data.intelligence?.repositoryType}
            infraLabels={data.intelligence?.infraSignals.map(
              (s) => `${s.label} (${s.path})`,
            )}
            repository={{
              owner: data.repository.owner,
              name: data.repository.name,
              defaultBranch: data.repository.defaultBranch,
            }}
            onSelectRoute={(route) => {
              const match =
                data.graph.nodes.find((n) => n.id === route.id) ??
                data.graph.nodes.find(
                  (n) =>
                    n.type === "API_ROUTE" &&
                    n.file === route.file &&
                    (n.metadata?.path === route.path ||
                      n.name === `${route.method} ${route.path}`),
                ) ??
                data.graph.nodes.find(
                  (n) =>
                    n.file === route.file &&
                    (n.name === route.handlerName ||
                      n.name === `${route.handlerClass}.${route.handlerName}` ||
                      n.name.endsWith(`.${route.handlerName}`)),
                ) ??
                data.graph.nodes.find((n) => n.id === `FILE:${route.file}`);
              if (match) fetchImpact(match.id);
              else selectFile(route.file);
            }}
            onSelectFile={(filePath) => {
              selectFile(filePath);
              setTab("graph");
            }}
            onOpenGraph={() => setTab("graph")}
            onOpenTests={() => setTab("tests")}
          />
        </div>
      ) : null}

      {tab === "structure" ? (
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          {data.intelligence?.analysisHealth ? (
            <div className="mb-4 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Repository analysis
              </p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {data.intelligence.coverage
                  ? `${data.intelligence.coverage.confidenceLabel} · `
                  : ""}
                {data.intelligence.analysisHealth.filesDiscovered} code files found ·{" "}
                {data.intelligence.analysisHealth.filesParsed} parsed ·{" "}
                {data.intelligence.analysisHealth.filesIgnored} ignored paths ·{" "}
                {data.intelligence.analysisHealth.filesUnsupported} unsupported
                {data.intelligence.coverage?.codeParseCoveragePercent != null
                  ? ` · ${data.intelligence.coverage.codeParseCoveragePercent}% parse coverage`
                  : ""}
                {data.intelligence.analysisHealth.parseFailures
                  ? ` · ${data.intelligence.analysisHealth.parseFailures} parse failures`
                  : ""}
                {data.intelligence.analysisHealth.truncated
                  ? ` · capped at ${data.intelligence.analysisHealth.maxFilesCap}`
                  : ""}
              </p>
            </div>
          ) : null}
          <div className="h-[780px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
            <StructureDiagram
              nodes={data.graph.nodes}
              edges={data.graph.edges}
              impacted={impactedIds}
              selectedId={selectedNodeId}
              onSelect={(id) => fetchImpact(id, depth, { stay: true })}
              onClear={clearSelection}
              repositoryName={`${data.repository.owner}/${data.repository.name}`}
              architecture={data.intelligence?.architecture}
            />
          </div>
        </div>
      ) : null}

      {tab === "graph" && (
        <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,320px)]">
          <aside className="min-w-0 space-y-4 overflow-hidden">
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <h3 className="font-display text-base font-semibold">Repository</h3>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="Files" value={data.summary.files} />
                <Metric label="Functions" value={data.summary.functions} />
                <Metric label="Tests" value={data.summary.tests} />
                <Metric label="APIs" value={data.summary.apiRoutes} />
              </dl>
            </div>
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                  Search
                </label>
                {selectedNodeId ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 text-[11px] text-[var(--teal)] hover:underline"
                  >
                    Deselect
                  </button>
                ) : null}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="authenticate"
                className="mt-2 w-full min-w-0 rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[var(--teal)]"
              />
              <ul className="mt-3 max-h-[420px] space-y-1 overflow-x-hidden overflow-y-auto">
                {filteredNodes.slice(0, 80).map((node) => (
                  <li key={node.id} className="min-w-0 max-w-full">
                    <button
                      type="button"
                      onClick={() => fetchImpact(node.id)}
                      title={`${node.name}\n${node.file}`}
                      className={`block w-full max-w-full overflow-hidden rounded-lg px-2 py-2 text-left text-xs transition hover:bg-[var(--fog)] ${
                        selectedNodeId === node.id ? "bg-[var(--fog)]" : ""
                      }`}
                    >
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                        {node.name}
                      </span>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--ink-soft)]/70">
                        {node.file}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="min-h-[640px] min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold">
                  {selectedNodeId ? (
                    <HelpTip label="Blast radius" text={HELP.blastRadius} />
                  ) : showPrChrome ? (
                    "Pull request impact graph"
                  ) : (
                    "Dependency graph"
                  )}
                </h2>
                <p className="truncate text-xs text-[var(--ink-soft)]/70">
                  {selectedNodeId
                    ? "Components potentially affected by this change · click empty space to deselect"
                    : `Click a node to inspect relationships · depth ${depth}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {selectedNodeId ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:border-[var(--teal)]"
                  >
                    Deselect
                  </button>
                ) : null}
                <label className="font-mono text-[11px] text-[var(--ink-soft)]">Depth</label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={depth}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setDepth(value);
                    if (selectedNodeId) fetchImpact(selectedNodeId, value);
                  }}
                />
              </div>
            </div>
            <div className="h-[600px] overflow-hidden">
              <ImpactGraph
                nodes={data.graph.nodes}
                edges={data.graph.edges}
                impacted={impactedIds}
                selectedId={selectedNodeId}
                onSelect={(id) => fetchImpact(id)}
                onClear={clearSelection}
              />
            </div>
          </section>

          <NodeInspectorPanel
            selectedNode={selectedNode}
            impact={impact}
            whyPath={whyPath}
            whyTarget={whyTarget}
            pending={pending}
            analysisUrl={
              typeof window !== "undefined"
                ? `${window.location.origin}${data.id.startsWith("/") ? "" : "/"}${
                    showPrChrome
                      ? `/${data.repository.owner}/${data.repository.name}/pull/${data.pullRequest?.number}`
                      : `/${data.repository.owner}/${data.repository.name}`
                  }`
                : undefined
            }
            relations={
              inspector
                ? {
                    directDependencies: inspector.directDependencies,
                    directDependents: inspector.directDependents,
                  }
                : null
            }
            onSelect={fetchImpact}
            onShowWhy={showWhy}
            onClear={clearSelection}
            onCloseWhy={() => {
              setWhyPath(null);
              setWhyTarget(null);
            }}
          />
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--fog)]/70 px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]/70">
        {label}
      </dt>
      <dd className="font-display text-lg font-semibold">{value}</dd>
    </div>
  );
}
