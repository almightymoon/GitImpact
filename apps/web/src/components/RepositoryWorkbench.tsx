"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  AnalysisSummary,
  ChangeRecord,
  ComplexityFactor,
  GraphEdge,
  GraphNode,
  ImpactPathStep,
  ImpactReport,
  PullRequestImpactOverview,
} from "@gitimpact/shared";
import { ImpactGraph } from "@/components/ImpactGraph";
import { StructureDiagram } from "@/components/StructureDiagram";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import {
  PullRequestChangesPanel,
  PullRequestNodeListPanel,
  PullRequestOverviewPanel,
} from "@/components/PullRequestPanels";

type TabId = "overview" | "graph" | "structure" | "changes" | "tests" | "apis";

type AnalysisPayload = {
  id: string;
  repository: {
    owner: string;
    name: string;
    url: string;
    defaultBranch: string;
  };
  summary: AnalysisSummary;
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
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  error?: string;
};

const severityColor: Record<string, string> = {
  CRITICAL: "var(--critical)",
  HIGH: "var(--high)",
  MEDIUM: "var(--medium)",
  NEUTRAL: "var(--neutral)",
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Graph" },
  { id: "structure", label: "Structure" },
  { id: "changes", label: "Changes" },
  { id: "tests", label: "Tests" },
  { id: "apis", label: "APIs" },
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [whyPath, setWhyPath] = useState<ImpactPathStep[] | null>(null);
  const [whyTarget, setWhyTarget] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>(isPullRequest ? "overview" : "graph");
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${analysisId}`);
      const payload = (await response.json()) as AnalysisPayload;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load analysis");
        setData(null);
        return;
      }
      setData(payload);
      if (payload.impact) {
        setImpact(payload.impact);
        setSelectedNodeId(payload.impact.changedNodes[0]?.id ?? null);
      }
      if (payload.prOverview || payload.pullRequest) {
        setTab("overview");
      }
    } catch {
      setError("Failed to load analysis");
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
        const response = await fetch(
          `/api/repositories/${analysisId}?nodeId=${encodeURIComponent(nodeId)}&depth=${nextDepth}`,
        );
        const payload = (await response.json()) as { impact?: ImpactReport; error?: string };
        if (response.ok && payload.impact) {
          setImpact(payload.impact);
          setSelectedNodeId(nodeId);
          if (!options?.stay) setTab("graph");
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
    setImpact(null);
    setWhyPath(null);
    setWhyTarget(null);
  }, []);

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

  const visibleTabs = TABS;

  const testNodes = useMemo(() => {
    if (impact?.relatedTests?.length) return impact.relatedTests;
    return data?.graph.nodes.filter((n) => n.type === "TEST") ?? [];
  }, [impact?.relatedTests, data?.graph.nodes]);

  const apiNodes = useMemo(() => {
    if (impact?.affectedApis?.length) return impact.affectedApis;
    return (
      data?.graph.nodes.filter(
        (n) => n.type === "API_ROUTE" || n.type === "CONTROLLER" || n.type === "SERVICE",
      ) ?? []
    );
  }, [impact?.affectedApis, data?.graph.nodes]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-mono text-sm text-[var(--ink-soft)]">Loading analysis…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
        <Link href="/" className="font-display text-lg font-bold">
          GitImpact
        </Link>
        <h1 className="mt-8 font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          {error ?? "No cached analysis found for this URL."}
        </p>
        <div className="mt-8">
          <AnalyzeForm initialUrl={githubUrl.replace("https://", "").replace("local://", "")} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--line)]/80 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" className="shrink-0 font-display text-lg font-bold">
              GitImpact
            </Link>
            <div className="min-w-0 overflow-hidden">
              <p className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm text-[var(--ink)]" title={title}>
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
                  {data.repository.defaultBranch} ·{" "}
                  {data.summary.frameworks.join(", ") || "detected stack"}
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

      {tab === "overview" ? (
        <div className="mx-auto max-w-[1400px]">
          {data.prOverview ? (
            <PullRequestOverviewPanel
              overview={data.prOverview}
              impact={impact}
              onSelectNode={fetchImpact}
            />
          ) : (
            <RepoOverviewPanel
              summary={data.summary}
              repository={data.repository}
              onOpenGraph={() => setTab("graph")}
              onOpenDiagram={() => setTab("structure")}
            />
          )}
        </div>
      ) : null}

      {tab === "changes" ? (
        <div className="mx-auto max-w-[1400px]">
          {data.changes && data.changes.length > 0 ? (
            <PullRequestChangesPanel changes={data.changes} onSelectFile={selectFile} />
          ) : (
            <EmptyTab
              title="Changes"
              message="No pull-request diff is attached to this analysis. Open a PR URL to see change-level impact."
            />
          )}
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestNodeListPanel
            title={impact?.relatedTests?.length ? "Relevant tests" : "Tests in repository"}
            empty="No tests were found in this analysis."
            nodes={testNodes}
            onSelect={fetchImpact}
          />
          {(impact?.missingTests.length ?? 0) > 0 && (
            <div className="border-t border-[var(--line)]">
              <PullRequestNodeListPanel
                title="Potential coverage gaps"
                empty=""
                nodes={impact?.missingTests ?? []}
                onSelect={fetchImpact}
              />
            </div>
          )}
        </div>
      ) : null}

      {tab === "apis" ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestNodeListPanel
            title={impact?.affectedApis?.length ? "API-related impact" : "API surface"}
            empty="No API routes or controllers were detected."
            nodes={apiNodes}
            onSelect={fetchImpact}
          />
        </div>
      ) : null}

      {tab === "structure" ? (
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          <div className="h-[780px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
            <StructureDiagram
              nodes={data.graph.nodes}
              edges={data.graph.edges}
              impacted={impactedIds}
              selectedId={selectedNodeId}
              onSelect={(id) => fetchImpact(id, depth, { stay: true })}
              onClear={clearSelection}
              repositoryName={`${data.repository.owner}/${data.repository.name}`}
            />
          </div>
        </div>
      ) : null}

      {tab === "graph" && (
        <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,300px)]">
          <aside className="min-w-0 space-y-4 overflow-hidden">
            <Stats summary={data.summary} />
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                  Search files
                </label>
                {selectedNodeId ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 text-[11px] text-[var(--teal)] hover:underline"
                  >
                    Show all
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
                  {selectedNodeId
                    ? "Blast radius"
                    : showPrChrome
                      ? "Pull Request Impact Graph"
                      : "Dependency Graph"}
                </h2>
                <p className="truncate text-xs text-[var(--ink-soft)]/70">
                  {selectedNodeId
                    ? "Focused on selected file · return to full repository graph anytime"
                    : `Click a node to compute blast radius · depth ${depth}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {selectedNodeId ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--ink-soft)]"
                  >
                    ← Back to overview
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

          <aside className="min-w-0 space-y-4 overflow-hidden">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold">Change Impact</h3>
                {selectedNodeId ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)] hover:border-[var(--teal)] hover:text-[var(--ink)]"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              {pending ? (
                <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]">Computing…</p>
              ) : impact ? (
                <div className="mt-3 min-w-0 space-y-3 overflow-hidden">
                  <p className="break-words text-sm leading-relaxed text-[var(--ink-soft)]">
                    {impact.summary}
                  </p>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <Metric label="Affected files" value={impact.affectedFiles.length} />
                    <Metric label="Direct" value={impact.directImpact.length} />
                    <Metric label="Indirect" value={impact.indirectImpact.length} />
                    <Metric label="APIs" value={impact.affectedApis.length} />
                    <Metric label="Tests" value={impact.relatedTests.length} />
                    <Metric label="Gaps" value={impact.missingTests.length} />
                  </dl>
                  <ComplexityPanel
                    score={impact.complexityScore}
                    factors={impact.complexityBreakdown ?? []}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  Select a file to see its blast radius.
                </p>
              )}
            </div>

            {impact && (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                <h3 className="font-display text-base font-semibold">Dependents</h3>
                <ul className="mt-3 max-h-[280px] space-y-2 overflow-x-hidden overflow-y-auto">
                  {[...impact.directImpact, ...impact.indirectImpact].slice(0, 40).map((item) => (
                    <li key={item.node.id} className="flex min-w-0 items-start gap-2 text-xs">
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: severityColor[item.severity] }}
                      />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <button
                          type="button"
                          title={item.node.file}
                          className="w-full overflow-hidden text-left hover:text-[var(--teal)]"
                          onClick={() => fetchImpact(item.node.id)}
                        >
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                            {item.node.name}
                          </span>
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--ink-soft)]/70">
                            d{item.depth} · {item.node.type}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => showWhy(item.node.id)}
                          className="mt-1 text-[10px] text-[var(--teal)] hover:underline"
                        >
                          Why is this affected?
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {whyPath && whyPath.length > 0 && (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--teal)]/40 bg-white/80 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-semibold">Why affected</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setWhyPath(null);
                      setWhyTarget(null);
                    }}
                    className="text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  >
                    Close
                  </button>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--ink-soft)]/70">
                  Deterministic dependency path · not AI-inferred
                </p>
                <ol className="mt-3 space-y-2">
                  {whyPath.map((step, index) => (
                    <li key={`${step.nodeId}-${index}`} className="min-w-0 text-xs">
                      {index > 0 && step.edgeType ? (
                        <p className="mb-1 font-mono text-[10px] text-[var(--teal)]">
                          ↑ {step.edgeType}
                        </p>
                      ) : (
                        <p className="mb-1 font-mono text-[10px] text-[var(--critical)]">
                          changed
                        </p>
                      )}
                      <button
                        type="button"
                        className={`w-full overflow-hidden rounded-lg px-2 py-1.5 text-left hover:bg-[var(--fog)] ${
                          step.nodeId === whyTarget ? "bg-[var(--fog)]" : ""
                        }`}
                        onClick={() => fetchImpact(step.nodeId)}
                      >
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                          {step.name}
                        </span>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--ink-soft)]/70">
                          {step.type} · {step.file}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function ComplexityPanel({
  score,
  factors,
}: {
  score: number;
  factors: ComplexityFactor[];
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
        Change Complexity
      </p>
      <p className="mt-1 font-display text-lg font-semibold">{score}/100</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--fog)]">
        <div className="h-full rounded-full bg-[var(--teal)]" style={{ width: `${score}%` }} />
      </div>
      {factors.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {factors.map((factor) => (
            <li
              key={factor.label}
              className="flex items-start justify-between gap-2 font-mono text-[10px] text-[var(--ink-soft)]"
            >
              <span className="min-w-0">
                <span className="text-[var(--ink)]">+{factor.points}</span> {factor.label}
                <span className="mt-0.5 block text-[9px] opacity-70">{factor.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stats({ summary }: { summary: AnalysisSummary }) {
  const items = [
    ["Files", summary.files],
    ["Functions", summary.functions],
    ["Dependencies", summary.dependencies],
    ["Tests", summary.tests],
  ] as const;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
      <h3 className="font-display text-base font-semibold">Repository</h3>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <Metric key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
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

function EmptyTab({ title, message }: { title: string; message: string }) {
  return (
    <div className="p-6">
      <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-8">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="mt-2 max-w-xl text-sm text-[var(--ink-soft)]">{message}</p>
      </div>
    </div>
  );
}

function RepoOverviewPanel({
  summary,
  repository,
  onOpenGraph,
  onOpenDiagram,
}: {
  summary: AnalysisSummary;
  repository: AnalysisPayload["repository"];
  onOpenGraph: () => void;
  onOpenDiagram: () => void;
}) {
  const metrics: Array<[string, number]> = [
    ["Files", summary.files],
    ["Functions", summary.functions],
    ["Classes", summary.classes],
    ["Dependencies", summary.dependencies],
    ["Tests", summary.tests],
    ["API Routes", summary.apiRoutes],
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">
          {repository.owner}/{repository.name}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          {repository.defaultBranch}
          {summary.frameworks.length > 0 ? ` · ${summary.frameworks.join(", ")}` : ""}
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">
          Repository analysis is ready. Explore the dependency graph, structure map, tests, and
          API surface from the header.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map(([label, value]) => (
          <Metric key={label} label={label} value={value} />
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenGraph}
          className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ink-soft)]"
        >
          Open Graph
        </button>
        <button
          type="button"
          onClick={onOpenDiagram}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--teal)]"
        >
          Open Structure
        </button>
      </div>
    </div>
  );
}
