"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "gitimpact:ai-settings";

export type AiClientSettings = {
  enabled: boolean;
  provider: "openai" | "anthropic" | "openai-compatible";
  apiKey: string;
};

export function loadAiClientSettings(): AiClientSettings {
  if (typeof window === "undefined") {
    return { enabled: false, provider: "openai", apiKey: "" };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, provider: "openai", apiKey: "" };
    return JSON.parse(raw) as AiClientSettings;
  } catch {
    return { enabled: false, provider: "openai", apiKey: "" };
  }
}

export function saveAiClientSettings(settings: AiClientSettings): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function AiSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AiClientSettings>({
    enabled: false,
    provider: "openai",
    apiKey: "",
  });
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSettings(loadAiClientSettings());
  }, []);

  function persist(next: AiClientSettings) {
    setSettings(next);
    saveAiClientSettings(next);
  }

  async function testKey() {
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/ai/narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: settings.apiKey || undefined,
          digest: {
            repository: "demo/gitimpact",
            complexityScore: 25,
            impactLevel: "Low",
            changedSymbols: ["ping"],
            affectedApis: [],
            relevantTests: [],
            summary: "Smoke test digest for BYOK connectivity.",
            frameworks: ["Next.js"],
          },
        }),
      });
      const json = (await res.json()) as {
        enabled?: boolean;
        narrative?: string | null;
        message?: string;
        error?: string;
      };
      if (json.narrative) {
        setTestMsg("Key works — narrative returned.");
      } else {
        setTestMsg(json.message ?? json.error ?? "No narrative (check key / server env).");
      }
    } catch (error) {
      setTestMsg(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/80 p-3 text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Optional AI narrative (BYOK)</span>
        <span className="font-mono text-[10px] text-[var(--ink-soft)]">
          {settings.enabled ? "on" : "off"} · {open ? "hide" : "show"}
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-[var(--ink-soft)]">
            Keys stay in this browser session and are only sent to{" "}
            <code className="font-mono">/api/ai/narrative</code> — never on analysis
            job payloads. See <code className="font-mono">docs/ai.md</code>.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => persist({ ...settings, enabled: e.target.checked })}
            />
            Enable client BYOK for on-demand narratives
          </label>
          <select
            value={settings.provider}
            onChange={(e) =>
              persist({
                ...settings,
                provider: e.target.value as AiClientSettings["provider"],
              })
            }
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => persist({ ...settings, apiKey: e.target.value })}
            placeholder="API key (session only)"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void testKey()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 disabled:opacity-40"
          >
            Test key
          </button>
          {testMsg ? (
            <p className="font-mono text-[10px] text-[var(--ink-soft)]">{testMsg}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
