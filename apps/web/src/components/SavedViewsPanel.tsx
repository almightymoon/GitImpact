"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArchitectureComponent, SavedView } from "@gitimpact/shared";

const LOCAL_KEY = (owner: string, repo: string) =>
  `gitimpact:views:${owner}/${repo}`;

function loadLocalViews(owner: string, repo: string): SavedView[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(owner, repo));
    if (!raw) return [];
    return JSON.parse(raw) as SavedView[];
  } catch {
    return [];
  }
}

function saveLocalViews(owner: string, repo: string, views: SavedView[]) {
  localStorage.setItem(LOCAL_KEY(owner, repo), JSON.stringify(views.slice(0, 20)));
}

export function SavedViewsPanel({
  owner,
  repo,
  systems,
  activePinnedIds,
  onApply,
}: {
  owner: string;
  repo: string;
  systems: ArchitectureComponent[];
  activePinnedIds: string[];
  onApply: (pinnedIds: string[], hiddenBands: string[]) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const local = loadLocalViews(owner, repo);
    try {
      const res = await fetch(
        `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/views`,
      );
      if (res.ok) {
        const json = (await res.json()) as { views?: SavedView[] };
        const team = json.views ?? [];
        const teamIds = new Set(team.map((v) => v.id));
        setViews([...team, ...local.filter((v) => !teamIds.has(v.id))]);
        return;
      }
    } catch {
      // fall through to local
    }
    setViews(local);
  }, [owner, repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveCurrent() {
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      name: name.trim(),
      pinnedSystemIds: activePinnedIds,
      hiddenBands: [] as string[],
    };
    try {
      const res = await fetch(
        `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/views`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (res.ok) {
        setName("");
        await refresh();
        setBusy(false);
        return;
      }
    } catch {
      // local fallback
    }
    const now = new Date().toISOString();
    const localView: SavedView = {
      id: `local-${Date.now()}`,
      repositoryId: `${owner}/${repo}`,
      name: payload.name,
      pinnedSystemIds: payload.pinnedSystemIds,
      hiddenBands: [],
      scope: "local",
      createdAt: now,
      updatedAt: now,
    };
    const next = [localView, ...loadLocalViews(owner, repo)];
    saveLocalViews(owner, repo, next);
    setName("");
    await refresh();
    setBusy(false);
  }

  async function removeView(view: SavedView) {
    if (view.scope === "local" || view.id.startsWith("local-")) {
      saveLocalViews(
        owner,
        repo,
        loadLocalViews(owner, repo).filter((v) => v.id !== view.id),
      );
      await refresh();
      return;
    }
    await fetch(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/views/${encodeURIComponent(view.id)}`,
      { method: "DELETE" },
    );
    await refresh();
  }

  const systemOptions = systems.filter((s) => (s.level ?? "SYSTEM") === "SYSTEM");

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
      <h3 className="font-display text-base font-semibold">Saved views</h3>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        Pin systems for team walkthroughs. Views sync to the server when a database is configured;
        otherwise they stay in this browser.
      </p>

      {systemOptions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {systemOptions.slice(0, 16).map((sys) => {
            const pinned = activePinnedIds.includes(sys.id);
            return (
              <button
                key={sys.id}
                type="button"
                onClick={() => {
                  const next = pinned
                    ? activePinnedIds.filter((id) => id !== sys.id)
                    : [...activePinnedIds, sys.id];
                  onApply(next, []);
                }}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] ${
                  pinned
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : "bg-[var(--fog)] text-[var(--ink-soft)]"
                }`}
              >
                {pinned ? "★ " : ""}
                {sys.title}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="View name (e.g. Checkout path)"
          className="min-w-[12rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void saveCurrent()}
          className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--paper)] disabled:opacity-40"
        >
          Save view
        </button>
        {activePinnedIds.length > 0 ? (
          <button
            type="button"
            onClick={() => onApply([], [])}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs"
          >
            Clear pins
          </button>
        ) : null}
      </div>

      {views.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {views.map((view) => (
            <li
              key={view.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--fog)]/60 px-3 py-2 text-xs"
            >
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => onApply(view.pinnedSystemIds, view.hiddenBands)}
              >
                {view.name}
                <span className="ml-2 font-mono text-[10px] text-[var(--ink-soft)]">
                  {view.pinnedSystemIds.length} pinned · {view.scope}
                </span>
              </button>
              <button
                type="button"
                className="font-mono text-[10px] text-[var(--ink-soft)] hover:text-[var(--critical)]"
                onClick={() => void removeView(view)}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">No saved views yet.</p>
      )}
    </section>
  );
}
