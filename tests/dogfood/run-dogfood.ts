/**
 * Offline dogfood runner — clones/analyzes matrix repos and writes summaries.
 *
 *   pnpm dogfood
 *   pnpm dogfood -- --priority 2
 *   pnpm dogfood -- --all
 *   pnpm dogfood -- --id express
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepositoryUrl } from "@gitimpact/analysis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const resultsDir = path.join(root, "results");
const matrixPath = path.join(root, "matrix.json");

interface MatrixRepo {
  id: string;
  url: string;
  shape: string;
  priority: number;
  status: "active" | "planned" | "skipped";
  why?: string;
  maxFiles?: number;
}

interface MatrixFile {
  version: number;
  repos: MatrixRepo[];
}

function argValue(flag: string): string | undefined {
  const args = process.argv.filter((a) => a !== "--");
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.filter((a) => a !== "--").includes(flag);
}

async function main(): Promise<void> {
  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as MatrixFile;
  const all = hasFlag("--all");
  const idFilter = argValue("--id");
  const priorityCap = Number(argValue("--priority") ?? (all ? 99 : 1));

  let selected = matrix.repos.filter((r) => r.status === "active");
  if (idFilter) {
    selected = matrix.repos.filter((r) => r.id === idFilter);
  } else {
    selected = selected.filter((r) => r.priority <= priorityCap);
  }

  if (selected.length === 0) {
    console.error("No repos matched filters.");
    process.exit(1);
  }

  await mkdir(resultsDir, { recursive: true });
  const cacheDir = path.resolve(root, "../../.repos/dogfood");
  await mkdir(cacheDir, { recursive: true });

  const rollup: unknown[] = [];
  console.log(`Dogfood: ${selected.length} repo(s) → ${resultsDir}`);

  for (const repo of selected) {
    const started = Date.now();
    const maxFiles = repo.maxFiles ?? Number(process.env.GITIMPACT_MAX_FILES ?? 2000);
    process.stdout.write(`\n→ ${repo.id} (${repo.shape}) ${repo.url}\n`);

    try {
      const analysis = await analyzeRepositoryUrl(repo.url, {
        maxFiles,
        depth: 2,
        cacheDir,
        skipCache: true,
      });
      const health = analysis.intelligence?.analysisHealth;
      const row = {
        id: repo.id,
        url: repo.url,
        shape: repo.shape,
        priority: repo.priority,
        ok: true,
        durationMs: Date.now() - started,
        commitSha: analysis.commitSha ?? null,
        fromCache: Boolean(analysis.fromCache),
        summary: analysis.summary,
        health: health ?? null,
        graph: {
          nodes: analysis.graph.nodes.length,
          edges: analysis.graph.edges.length,
        },
        routes: analysis.routes?.length ?? 0,
        frameworks: analysis.summary.frameworks,
        repositoryType: analysis.intelligence?.repositoryType ?? null,
        truncationNotice: analysis.truncationNotice ?? null,
        error: null as string | null,
      };
      await writeFile(path.join(resultsDir, `${repo.id}.json`), JSON.stringify(row, null, 2));
      rollup.push(row);
      console.log(
        `  ok ${row.durationMs}ms files=${row.summary.files} nodes=${row.graph.nodes} edges=${row.graph.edges} fw=${row.frameworks.join(",") || "-"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : undefined;
      const row = {
        id: repo.id,
        url: repo.url,
        shape: repo.shape,
        priority: repo.priority,
        ok: false,
        durationMs: Date.now() - started,
        error: message.slice(0, 2000),
        code: code ?? null,
      };
      await writeFile(path.join(resultsDir, `${repo.id}.json`), JSON.stringify(row, null, 2));
      rollup.push(row);
      console.error(`  FAIL ${code ?? "ERROR"}: ${message.slice(0, 200)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    count: rollup.length,
    ok: rollup.filter((r) => (r as { ok?: boolean }).ok).length,
    failed: rollup.filter((r) => !(r as { ok?: boolean }).ok).length,
    repos: rollup,
  };
  await writeFile(path.join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nDone. ${summary.ok} ok / ${summary.failed} failed → results/summary.json`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
