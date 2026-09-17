"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  AnalysisSummary,
  ChangeRecord,
  GraphEdge,
  GraphNode,
  ImpactReport,
  PullRequestImpactOverview,
} from "@gitimpact/shared";
import { ImpactGraph } from "@/components/ImpactGraph";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import {
  PullRequestChangesPanel,
  PullRequestNodeListPanel,
  PullRequestOverviewPanel,
} from "@/components/PullRequestPanels";

type TabId = "overview" | "graph" | "changes" | "tests" | "apis";

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
    (nodeId: string, nextDepth = depth) => {
      startTransition(async () => {
        const response = await fetch(
          `/api/repositories/${analysisId}?nodeId=${encodeURIComponent(nodeId)}&depth=${nextDepth}`,
        );
        const payload = (await response.json()) as { impact?: ImpactReport; error?: string };
        if (response.ok && payload.impact) {
          setImpact(payload.impact);
          setSelectedNodeId(nodeId);
          setTab("graph");
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
          <div className="flex items-center gap-4">
            <Link href="/" className="font-display text-lg font-bold">
              GitImpact
            </Link>
            <div>
              <p className="font-mono text-sm text-[var(--ink)]">{title}</p>
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
        {showPrChrome && (
          <div className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-6 pb-3">
            {TABS.map((item) => (
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
        )}
      </header>

      {showPrChrome && tab === "overview" && data.prOverview ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestOverviewPanel
            overview={data.prOverview}
            impact={impact}
            onSelectNode={fetchImpact}
          />
        </div>
      ) : null}

      {showPrChrome && tab === "changes" && data.changes ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestChangesPanel changes={data.changes} onSelectFile={selectFile} />
        </div>
      ) : null}

      {showPrChrome && tab === "tests" ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestNodeListPanel
            title="Relevant tests"
            empty="No directly associated tests were found for this change set."
            nodes={impact?.relatedTests ?? []}
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

      {showPrChrome && tab === "apis" ? (
        <div className="mx-auto max-w-[1400px]">
          <PullRequestNodeListPanel
            title="API-related impact"
            empty="No API routes or controllers were linked to this change."
            nodes={impact?.affectedApis ?? []}
            onSelect={fetchImpact}
          />
        </div>
      ) : null}

      {(!showPrChrome || tab === "graph") && (
        <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
          <aside className="space-y-4">
            <Stats summary={data.summary} />
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
                Search files
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="authenticate"
                className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[var(--teal)]"
              />
              <ul className="mt-3 max-h-[420px] space-y-1 overflow-auto">
                {filteredNodes.slice(0, 80).map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => fetchImpact(node.id)}
                      className={`w-full rounded-lg px-2 py-2 text-left text-xs transition hover:bg-[var(--fog)] ${
                        selectedNodeId === node.id ? "bg-[var(--fog)]" : ""
                      }`}
                    >
                      <span className="block truncate font-medium">{node.name}</span>
                      <span className="block truncate font-mono text-[10px] text-[var(--ink-soft)]/70">
                        {node.file}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="min-h-[640px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div>
                <h2 className="font-display text-lg font-semibold">
                  {showPrChrome ? "Pull Request Impact Graph" : "Dependency Graph"}
                </h2>
                <p className="text-xs text-[var(--ink-soft)]/70">
                  Click a node to compute blast radius · depth {depth}
                </p>
              </div>
              <div className="flex items-center gap-2">
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
            <div className="h-[600px]">
              <ImpactGraph
                nodes={data.graph.nodes}
                edges={data.graph.edges}
                impacted={impactedIds}
                selectedId={selectedNodeId}
                onSelect={(id) => fetchImpact(id)}
              />
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
              <h3 className="font-display text-base font-semibold">Change Impact</h3>
              {pending ? (
                <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]">Computing…</p>
              ) : impact ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm leading-relaxed text-[var(--ink-soft)]">{impact.summary}</p>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <Metric label="Affected files" value={impact.affectedFiles.length} />
                    <Metric label="Direct" value={impact.directImpact.length} />
                    <Metric label="Indirect" value={impact.indirectImpact.length} />
                    <Metric label="APIs" value={impact.affectedApis.length} />
                    <Metric label="Tests" value={impact.relatedTests.length} />
                    <Metric label="Gaps" value={impact.missingTests.length} />
                  </dl>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  Select a file to see its blast radius.
                </p>
              )}
            </div>

            {impact && (
              <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                <h3 className="font-display text-base font-semibold">Dependents</h3>
                <ul className="mt-3 max-h-[360px] space-y-2 overflow-auto">
                  {[...impact.directImpact, ...impact.indirectImpact].slice(0, 40).map((item) => (
                    <li key={item.node.id} className="flex items-start gap-2 text-xs">
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: severityColor[item.severity] }}
                      />
                      <button
                        type="button"
                        className="text-left hover:text-[var(--teal)]"
                        onClick={() => fetchImpact(item.node.id)}
                      >
                        <span className="block font-medium">{item.node.name}</span>
                        <span className="font-mono text-[10px] text-[var(--ink-soft)]/70">
                          d{item.depth} · {item.node.file}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
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
