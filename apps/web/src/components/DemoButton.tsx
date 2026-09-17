"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DemoButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prPending, startPrTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const response = await fetch("/api/demo", { method: "POST" });
              const data = (await response.json()) as { error?: string; routePath?: string };
              if (!response.ok) {
                setError(data.error ?? "Demo failed");
                return;
              }
              router.push(data.routePath ?? "/demo/tiny-fixture");
            });
          }}
          className="text-sm text-[var(--teal)] underline-offset-4 hover:underline disabled:opacity-60"
        >
          {pending ? "Loading demo…" : "Try local repo demo"}
        </button>
        <button
          type="button"
          disabled={prPending}
          onClick={() => {
            setError(null);
            startPrTransition(async () => {
              const response = await fetch("/api/demo/pr", { method: "POST" });
              const data = (await response.json()) as { error?: string; routePath?: string };
              if (!response.ok) {
                setError(data.error ?? "Demo PR failed");
                return;
              }
              router.push(data.routePath ?? "/demo/tiny-fixture/pull/1");
            });
          }}
          className="text-sm text-[var(--ember)] underline-offset-4 hover:underline disabled:opacity-60"
        >
          {prPending ? "Analyzing demo PR…" : "Try demo pull request"}
        </button>
      </div>
      {error ? <p className="text-sm text-[var(--critical)]">{error}</p> : null}
    </div>
  );
}
