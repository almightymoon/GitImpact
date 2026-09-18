"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function RecentAnalyses() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gitimpact:recent");
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) setItems(parsed.slice(0, 6));
    } catch {
      /* ignore */
    }

    void fetch("/api/repositories/recent")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { repositories?: Array<{ owner: string; name: string }> } | null) => {
        if (!data?.repositories?.length) return;
        setItems((prev) => {
          const fromServer = data.repositories!.map((r) => `${r.owner}/${r.name}`);
          return [...fromServer, ...prev.filter((p) => !fromServer.includes(p))].slice(0, 6);
        });
      })
      .catch(() => undefined);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]/70">
        Recent
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const path = item
            .replace(/^https?:\/\//, "")
            .replace(/^github\.com\//, "")
            .replace(/\/$/, "");
          return (
            <li key={item}>
              <Link
                href={`/${path}`}
                className="font-mono text-xs text-[var(--teal)] underline-offset-2 hover:underline"
              >
                {path}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
