/**
 * v1.1.2 relationship accuracy runner
 *
 *   pnpm relationships
 *   pnpm relationships -- --id nestjs-small
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "@gitimpact/parser";
import { buildGraph } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";
import {
  classifyExpectation,
  flattenExpectations,
  scoreClassifications,
  type ExpectedEdge,
} from "./score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(__dirname, "results");
const matrixPath = path.join(__dirname, "matrix.json");
const casesDir = path.join(__dirname, "cases");

interface MatrixCase {
  id: string;
  source: "local" | "dogfood";
  fixture?: string;
  clonePath?: string;
  dogfoodId?: string;
  shape: string;
  why?: string;
}

interface MatrixFile {
  version: number;
  targets: Record<string, { precision: number; recall: number }>;
  cases: MatrixCase[];
}

interface CaseExpected {
  description?: string;
  pathAliases?: Record<string, string[]>;
  maxFiles?: number;
  mustCall?: ExpectedEdge[];
  mustImport?: ExpectedEdge[];
  mustEdge?: ExpectedEdge[];
  mustNotCall?: ExpectedEdge[];
  mustNotImport?: ExpectedEdge[];
  softMustCall?: ExpectedEdge[];
}

function argValue(flag: string): string | undefined {
  const args = process.argv.filter((a) => a !== "--");
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadExpected(caseId: string): Promise<CaseExpected> {
  const p = path.join(casesDir, caseId, "expected.json");
  return JSON.parse(await readFile(p, "utf8")) as CaseExpected;
}

async function main(): Promise<void> {
  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as MatrixFile;
  const idFilter = argValue("--id");
  const selected = idFilter
    ? matrix.cases.filter((c) => c.id === idFilter)
    : matrix.cases;

  if (selected.length === 0) {
    console.error("No cases matched.");
    process.exit(1);
  }

  await mkdir(resultsDir, { recursive: true });
  const caseRows: unknown[] = [];
  const allClassifications: ReturnType<typeof classifyExpectation>[] = [];

  console.log(`Relationships: ${selected.length} case(s)\n`);

  for (const entry of selected) {
    const started = Date.now();
    process.stdout.write(`→ ${entry.id} (${entry.shape})\n`);

    let rootDir: string | undefined;
    if (entry.source === "local" && entry.fixture) {
      rootDir = path.resolve(__dirname, entry.fixture);
    } else if (entry.source === "dogfood" && entry.clonePath) {
      rootDir = path.resolve(__dirname, entry.clonePath);
    }

    if (!rootDir || !(await exists(rootDir))) {
      console.log(`  skip — fixture/clone missing at ${rootDir ?? "(none)"}`);
      caseRows.push({
        id: entry.id,
        ok: false,
        skipped: true,
        reason: "fixture_or_clone_missing",
        path: rootDir ?? null,
      });
      continue;
    }

    if (!(await exists(path.join(casesDir, entry.id, "expected.json")))) {
      console.log(`  skip — no expected.json`);
      caseRows.push({
        id: entry.id,
        ok: false,
        skipped: true,
        reason: "missing_expected",
      });
      continue;
    }

    const expected = await loadExpected(entry.id);
    const expectations = flattenExpectations(expected);
    const parsed = await parseRepository(rootDir, {
      pathAliases: expected.pathAliases,
      maxFiles: expected.maxFiles ?? 2500,
    });
    const routes = extractAllRoutes(
      parsed.files,
      parsed.contentsByPath,
      parsed.packageDeps,
      parsed.packageName,
    );
    const graph = buildGraph(parsed.files, routes);

    const classifications = expectations.map((exp, i) =>
      classifyExpectation(graph.edges, exp, i, exp.type ?? "CALLS"),
    );
    allClassifications.push(...classifications);
    const scored = scoreClassifications(classifications);

    const hardFails = classifications.filter(
      (c) =>
        !c.soft &&
        (c.class === "MISSING_EDGE" ||
          c.class === "WRONG_TARGET" ||
          c.class === "WRONG_TYPE" ||
          c.class === "FALSE_POSITIVE"),
    );

    console.log(
      `  ok ${Date.now() - started}ms edges=${graph.edges.length} checked=${classifications.length}` +
        ` TP=${scored.counts.TRUE_POSITIVE} miss=${scored.counts.MISSING_EDGE}` +
        ` FP=${scored.counts.FALSE_POSITIVE} P=${scored.overall.precision} R=${scored.overall.recall}`,
    );
    for (const fail of hardFails.slice(0, 5)) {
      console.log(`    ! ${fail.class} ${fail.type} ${fail.from ?? "?"} → ${fail.to ?? "?"}`);
    }

    caseRows.push({
      id: entry.id,
      ok: hardFails.length === 0,
      skipped: false,
      durationMs: Date.now() - started,
      shape: entry.shape,
      edgeCount: graph.edges.length,
      checked: classifications.length,
      counts: scored.counts,
      overall: scored.overall,
      byType: scored.byType,
      failures: hardFails,
      classifications,
    });

    await writeFile(
      path.join(resultsDir, `${entry.id}.json`),
      `${JSON.stringify(
        {
          id: entry.id,
          classifications,
          overall: scored.overall,
          byType: scored.byType,
          counts: scored.counts,
        },
        null,
        2,
      )}\n`,
    );
  }

  const overall = scoreClassifications(allClassifications);
  const targetHits: Record<string, { precisionOk: boolean | null; recallOk: boolean | null }> =
    {};
  for (const [key, target] of Object.entries(matrix.targets)) {
    const score =
      key === "overall"
        ? overall.overall
        : overall.byType.find((t) => t.type === key) ?? null;
    if (!score) {
      targetHits[key] = { precisionOk: null, recallOk: null };
      continue;
    }
    targetHits[key] = {
      precisionOk:
        score.precision === null ? null : score.precision >= target.precision,
      recallOk: score.recall === null ? null : score.recall >= target.recall,
    };
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    caseCount: selected.length,
    scoredCases: caseRows.filter((r) => !(r as { skipped?: boolean }).skipped).length,
    counts: overall.counts,
    overall: overall.overall,
    byType: overall.byType,
    targets: matrix.targets,
    targetHits,
    cases: caseRows,
  };

  await writeFile(
    path.join(resultsDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log("\n=== Relationship accuracy ===");
  console.log(
    `Overall precision=${overall.overall.precision} recall=${overall.overall.recall}` +
      ` (TP=${overall.counts.TRUE_POSITIVE} FN=${overall.counts.MISSING_EDGE + overall.counts.WRONG_TARGET + overall.counts.WRONG_TYPE} FP=${overall.counts.FALSE_POSITIVE})`,
  );
  for (const row of overall.byType) {
    console.log(
      `  ${row.type.padEnd(12)} P=${row.precision ?? "n/a"} R=${row.recall ?? "n/a"}` +
        ` TP=${row.truePositives} FN=${row.falseNegatives} FP=${row.falsePositives}`,
    );
  }
  console.log(`Wrote ${path.join(resultsDir, "summary.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
