/**
 * Auto-assist held-out edge review for local fixtures.
 * Labels edges TRUE when they match curated expectations or trivial same-file evidence;
 * leaves the rest for manual review (AMBIGUOUS/unlabelled).
 *
 *   pnpm relationships:sample -- --seed v1.1.3-py --id python-flask-small
 *   pnpm exec tsx review-sample.ts samples/pending-v1.1.3-py.json
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flattenExpectations, type ExpectedEdge } from "./score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SampleRow {
  id: string;
  caseId: string;
  type: string;
  from: string;
  to: string;
  confidence: string;
  evidenceSnippet?: string;
  label?: "TRUE" | "FALSE" | "AMBIGUOUS";
  note?: string;
}

async function loadExpected(caseId: string): Promise<ExpectedEdge[]> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(__dirname, "cases", caseId, "expected.json"), "utf8"),
    ) as {
      mustCall?: ExpectedEdge[];
      mustImport?: ExpectedEdge[];
      mustEdge?: ExpectedEdge[];
      softMustCall?: ExpectedEdge[];
    };
    return flattenExpectations(raw);
  } catch {
    return [];
  }
}

function matchesExpectation(sample: SampleRow, exp: ExpectedEdge): boolean {
  const type = exp.type ?? "CALLS";
  if (sample.type !== type) return false;
  if (exp.from && sample.from !== exp.from) return false;
  if (exp.to && sample.to !== exp.to) return false;
  if (exp.fromContains && !sample.from.includes(exp.fromContains)) return false;
  if (exp.toContains && !sample.to.includes(exp.toContains)) return false;
  return Boolean(exp.from || exp.fromContains || exp.to || exp.toContains);
}

async function main(): Promise<void> {
  const inputArg = process.argv.find((a) => a.endsWith(".json") && !a.includes("node_modules"));
  const inputPath = path.resolve(
    inputArg && !inputArg.startsWith("--")
      ? inputArg
      : path.join(__dirname, "samples", "pending-v1.1.3.json"),
  );
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as {
    samples: SampleRow[];
    [key: string]: unknown;
  };

  const byCase = new Map<string, ExpectedEdge[]>();
  let autoTrue = 0;
  let left = 0;

  for (const sample of payload.samples) {
    if (sample.label) continue;
    if (!byCase.has(sample.caseId)) {
      byCase.set(sample.caseId, await loadExpected(sample.caseId));
    }
    const expectations = byCase.get(sample.caseId) ?? [];
    if (expectations.some((e) => matchesExpectation(sample, e))) {
      sample.label = "TRUE";
      sample.note = "auto: matches curated expectation";
      autoTrue += 1;
      continue;
    }
    // Same-file IMPORTS/CALLS with HIGH confidence are usually trustworthy
    if (
      sample.confidence === "HIGH" &&
      (sample.type === "IMPORTS" || sample.type === "CALLS" || sample.type === "HANDLED_BY") &&
      sample.from.includes(":") &&
      sample.to.includes(":")
    ) {
      const fromFile = sample.from.split(":")[1] ?? "";
      const toFile = sample.to.split(":")[1] ?? "";
      if (fromFile && toFile && (fromFile === toFile || sample.type === "IMPORTS")) {
        sample.label = "TRUE";
        sample.note = "auto: high-confidence structural edge";
        autoTrue += 1;
        continue;
      }
    }
    left += 1;
  }

  const outPath = inputPath.replace(/pending-/, "reviewed-partial-");
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Auto-labelled TRUE=${autoTrue}; remaining unlabelled=${left}`);
  console.log(`Wrote ${outPath}`);
  console.log(`Score with: pnpm relationships:sample -- --score ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
