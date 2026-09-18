import { AnalyzeForm } from "@/components/AnalyzeForm";
import { DemoButton } from "@/components/DemoButton";
import { RecentAnalyses } from "@/components/RecentAnalyses";
import { ConnectGitHubButton } from "@/components/ConnectGitHubButton";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="atmosphere-grid pointer-events-none absolute inset-0" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="font-display text-lg font-bold tracking-tight text-[var(--ink)]">
          GitImpact
        </div>
        <nav className="flex items-center gap-6 text-sm text-[var(--ink-soft)]">
          <a href="#how" className="hover:text-[var(--teal)] transition-colors">
            How it works
          </a>
            <a
              href="https://github.com/almightymoon/GitImpact/tree/main/docs"
              className="rounded-full border border-[var(--line)] px-3 py-1.5 hover:border-[var(--teal)] transition-colors"
            >
              Docs
            </a>
        </nav>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-5.5rem)] w-full max-w-6xl flex-col justify-center px-6 pb-24 pt-8">
        <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="animate-rise font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-[var(--ink)] sm:text-6xl md:text-7xl">
              GitImpact
            </p>
            <h1 className="animate-rise-delay mt-5 max-w-xl font-display text-2xl font-semibold leading-tight text-[var(--ink-soft)] sm:text-3xl">
              Know What Breaks Before You Merge.
            </h1>
            <p className="animate-rise-delay-2 mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-soft)]/80 sm:text-lg">
              Paste a public repo or connect GitHub. GitImpact maps structure and
              change impact — explore PRs, Checks, APIs, Tests, and Structure.
            </p>

            <div className="animate-rise-delay-2 mt-10 space-y-3">
              <AnalyzeForm />
              <div className="flex flex-wrap items-center gap-3">
                <DemoButton />
                <ConnectGitHubButton />
              </div>
              <RecentAnalyses />
            </div>
          </div>

          <div className="relative animate-rise-delay-2 hidden lg:block">
            <div className="blast-ring relative mx-auto aspect-square w-full max-w-md">
              <svg
                viewBox="0 0 420 420"
                className="h-full w-full"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#14a090" />
                    <stop offset="100%" stopColor="#c45c26" />
                  </linearGradient>
                </defs>
                <circle cx="210" cy="210" r="150" fill="rgba(255,255,255,0.55)" stroke="#c9d5e1" />
                <circle cx="210" cy="210" r="78" fill="#0b1220" />
                <text
                  x="210"
                  y="206"
                  textAnchor="middle"
                  fill="#f7fafc"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="13"
                >
                  auth.service
                </text>
                <text
                  x="210"
                  y="226"
                  textAnchor="middle"
                  fill="#14a090"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="11"
                >
                  changed
                </text>
                <line x1="210" y1="132" x2="210" y2="78" stroke="url(#edge)" strokeWidth="2" className="impact-edge" />
                <line x1="145" y1="170" x2="88" y2="120" stroke="url(#edge)" strokeWidth="2" />
                <line x1="275" y1="170" x2="332" y2="120" stroke="url(#edge)" strokeWidth="2" />
                <line x1="150" y1="260" x2="96" y2="310" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="270" y1="260" x2="324" y2="310" stroke="#94a3b8" strokeWidth="1.5" />
                <rect x="160" y="42" width="100" height="32" rx="8" fill="#fff" stroke="#0f7a6c" />
                <text x="210" y="62" textAnchor="middle" fontSize="11" fill="#0b1220" fontFamily="IBM Plex Sans">
                  Login API
                </text>
                <rect x="28" y="92" width="110" height="32" rx="8" fill="#fff" stroke="#c2410c" />
                <text x="83" y="112" textAnchor="middle" fontSize="11" fill="#0b1220" fontFamily="IBM Plex Sans">
                  session.ts
                </text>
                <rect x="282" y="92" width="110" height="32" rx="8" fill="#fff" stroke="#c2410c" />
                <text x="337" y="112" textAnchor="middle" fontSize="11" fill="#0b1220" fontFamily="IBM Plex Sans">
                  admin-auth
                </text>
                <rect x="36" y="318" width="120" height="32" rx="8" fill="#fff" stroke="#64748b" />
                <text x="96" y="338" textAnchor="middle" fontSize="11" fill="#0b1220" fontFamily="IBM Plex Sans">
                  LoginForm
                </text>
                <rect x="264" y="318" width="120" height="32" rx="8" fill="#fff" stroke="#64748b" />
                <text x="324" y="338" textAnchor="middle" fontSize="11" fill="#0b1220" fontFamily="IBM Plex Sans">
                  auth.test
                </text>
              </svg>
            </div>
            <p className="mt-4 text-center font-mono text-xs text-[var(--ink-soft)]/70">
              change → dependents → blast radius
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="relative z-10 border-t border-[var(--line)]/70 bg-white/40 backdrop-blur-sm">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
          {[
            {
              title: "1. Paste or connect",
              body: "Analyze a public GitHub URL immediately, or install the GitImpact App for private repositories.",
            },
            {
              title: "2. Structure & impact",
              body: "Deterministic parsing builds a dependency graph, architecture map, APIs, tests, and Checks — no AI required.",
            },
            {
              title: "3. Explore before merge",
              body: "Open PRs to see blast radius, missing tests, and check findings before you land the change.",
            },
          ].map((item) => (
            <div key={item.title}>
              <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{item.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]/80">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
