"use client";

const SAMPLES: Array<{ id: string; label: string; url: string; blurb: string }> = [
  {
    id: "express",
    label: "express",
    url: "https://github.com/expressjs/express",
    blurb: "Classic Node HTTP framework",
  },
  {
    id: "platforms",
    label: "vercel/platforms",
    url: "https://github.com/vercel/platforms",
    blurb: "Next.js App Router sample",
  },
  {
    id: "nestjs",
    label: "nestjs starter",
    url: "https://github.com/nestjs/typescript-starter",
    blurb: "Decorator API service",
  },
  {
    id: "gitops",
    label: "argocd examples",
    url: "https://github.com/argoproj/argocd-example-apps",
    blurb: "YAML / GitOps-only repo",
  },
];

export function SampleRepositories({
  onSelect,
}: {
  onSelect: (url: string) => void;
}) {
  return (
    <div className="pt-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]/70">
        Try a public sample
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {SAMPLES.map((sample) => (
          <li key={sample.id}>
            <button
              type="button"
              title={sample.blurb}
              onClick={() => onSelect(sample.url)}
              className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-1.5 text-left text-sm hover:border-[var(--teal)]"
            >
              <span className="font-medium">{sample.label}</span>
              <span className="ml-2 hidden text-[var(--ink-soft)] sm:inline">
                {sample.blurb}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
