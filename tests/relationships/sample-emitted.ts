/**
 * Held-out emitted-edge sampler (v1.1.3).
 *
 * Curated relationship benchmarks measure recall of known-true edges.
 * This samples edges the system *emitted* for manual TRUE/FALSE/AMBIGUOUS review
 * — a stronger precision signal.
 *
 *   pnpm relationships:sample
 *   pnpm relationships:sample -- --seed v1.1.4-go --prefix go-
 *   pnpm relationships:sample -- --score samples/reviewed.json
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "@gitimpact/parser";
import { buildGraph } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";
import type { GraphEdge, RelationType } from "@gitimpact/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const matrixPath = path.join(__dirname, "matrix.json");
const samplesDir = path.join(__dirname, "samples");

const DEFAULT_QUOTA: Partial<Record<RelationType, number>> = {
  CALLS: 30,
  IMPORTS: 25,
  USES: 15,
  FETCHES: 10,
  HANDLED_BY: 10,
  QUERIES: 10,
};

interface MatrixCase {
  id: string;
  source: "local" | "dogfood";
  fixture?: string;
  clonePath?: string;
}

interface SampleRow {
  id: string;
  caseId: string;
  type: string;
  from: string;
  to: string;
  confidence: string;
  evidenceSnippet?: string;
  /** Fill in during review: TRUE | FALSE | AMBIGUOUS */
  label?: "TRUE" | "FALSE" | "AMBIGUOUS";
  note?: string;
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

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function stableShuffle<T>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => {
    const ha = createHash("sha256").update(seed + JSON.stringify(a)).digest("hex");
    const hb = createHash("sha256").update(seed + JSON.stringify(b)).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

function sampleEdges(
  caseId: string,
  edges: GraphEdge[],
  quota: Partial<Record<RelationType, number>>,
  seed: string,
): SampleRow[] {
  const out: SampleRow[] = [];
  for (const [type, n] of Object.entries(quota) as Array<[RelationType, number]>) {
    const pool = edges.filter((e) => e.type === type);
    const picked = stableShuffle(pool, `${seed}:${caseId}:${type}`).slice(0, n);
    for (const edge of picked) {
      out.push({
        id: `${caseId}:${edge.id}`,
        caseId,
        type: edge.type,
        from: edge.from,
        to: edge.to,
        confidence: edge.confidence,
        evidenceSnippet: edge.evidence?.snippet,
      });
    }
  }
  return out;
}

async function scoreReviewed(filePath: string): Promise<void> {
  const rows = JSON.parse(await readFile(filePath, "utf8")) as {
    samples?: SampleRow[];
  } & SampleRow[];
  const samples = Array.isArray(rows) ? rows : rows.samples ?? [];
  const labelled = samples.filter((s) => s.label);
  const trueN = labelled.filter((s) => s.label === "TRUE").length;
  const falseN = labelled.filter((s) => s.label === "FALSE").length;
  const ambN = labelled.filter((s) => s.label === "AMBIGUOUS").length;
  const denom = trueN + falseN;
  const precision = denom > 0 ? trueN / denom : null;
  console.log(`Reviewed ${labelled.length}/${samples.length}`);
  console.log(`  TRUE=${trueN} FALSE=${falseN} AMBIGUOUS=${ambN}`);
  console.log(
    `  Held-out precision (TRUE/(TRUE+FALSE))=${
      precision === null ? "n/a" : `${(precision * 100).toFixed(1)}%`
    }`,
  );
}

async function main(): Promise<void> {
  const scorePath = argValue("--score");
  if (scorePath) {
    await scoreReviewed(path.resolve(scorePath));
    return;
  }

  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as {
    cases: MatrixCase[];
  };
  const idFilter = argValue("--id");
  const prefixFilter = argValue("--prefix");
  const seed = argValue("--seed") ?? "v1.1.3";
  const nScale = Number(argValue("--n") ?? 100);
  const scale = nScale / 100;
  const quota = Object.fromEntries(
    Object.entries(DEFAULT_QUOTA).map(([k, v]) => [k, Math.max(1, Math.round((v ?? 0) * scale))]),
  ) as Partial<Record<RelationType, number>>;

  const selected = idFilter
    ? matrix.cases.filter((c) => c.id === idFilter)
    : prefixFilter
      ? matrix.cases.filter(
          (c) => c.source === "local" && c.id.startsWith(prefixFilter),
        )
      : matrix.cases.filter((c) => c.source === "local");

  await mkdir(samplesDir, { recursive: true });
  const all: SampleRow[] = [];

  for (const entry of selected) {
    let rootDir: string | undefined;
    if (entry.source === "local" && entry.fixture) {
      rootDir = path.resolve(__dirname, entry.fixture);
    } else if (entry.source === "dogfood" && entry.clonePath) {
      rootDir = path.resolve(__dirname, entry.clonePath);
    }
    if (!rootDir || !(await exists(rootDir))) {
      console.log(`skip ${entry.id} — missing fixture`);
      continue;
    }
    const parsed = await parseRepository(rootDir);
    const routes = extractAllRoutes(
      parsed.files,
      parsed.contentsByPath,
      parsed.packageDeps,
      parsed.packageName,
    );
    const graph = buildGraph(parsed.files, routes);
    // Per-case proportional slice so total ≈ quota across cases
    const perCaseQuota = Object.fromEntries(
      Object.entries(quota).map(([k, v]) => [
        k,
        Math.max(1, Math.ceil((v ?? 0) / Math.max(1, selected.length))),
      ]),
    ) as Partial<Record<RelationType, number>>;
    const rows = sampleEdges(entry.id, graph.edges, perCaseQuota, seed);
    console.log(`→ ${entry.id}: sampled ${rows.length} / ${graph.edges.length} edges`);
    all.push(...rows);
  }

  const outPath = path.join(samplesDir, `pending-${seed}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        seed,
        instruction:
          "Set label to TRUE | FALSE | AMBIGUOUS for each sample, then run: pnpm relationships:sample -- --score <file>",
        quota,
        samples: all,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${all.length} samples → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
