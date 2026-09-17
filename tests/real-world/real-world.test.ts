import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseRepository } from "@gitimpact/parser";
import { buildGraph } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";
import { reporter, resultsPath } from "./coverage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const casesRoot = path.resolve(__dirname, "cases");

type EdgeExpectation = {
  from?: string;
  to?: string;
  type?: string;
  fromContains?: string;
  note?: string;
};

type FixtureExpected = {
  description?: string;
  pathAliases?: Record<string, string[]>;
  mustCall?: EdgeExpectation[];
  mustNotCall?: EdgeExpectation[];
  mustImport?: EdgeExpectation[];
  mustEdge?: EdgeExpectation[];
  softMustCall?: EdgeExpectation[];
  mustDetectRoutes?: Array<{ method: string; path: string }>;
  unsupportedPatterns?: string[];
  knownUnresolved?: Array<{ pattern: string; note?: string }>;
};

async function listCases(): Promise<string[]> {
  const entries = await readdir(casesRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function hasEdge(
  edges: Array<{ from: string; to: string; type: string }>,
  expectation: EdgeExpectation,
  defaultType: string,
): boolean {
  return edges.some((edge) => {
    if (edge.type !== (expectation.type ?? defaultType)) return false;
    if (expectation.to && edge.to !== expectation.to) return false;
    if (expectation.from && edge.from !== expectation.from) return false;
    if (expectation.fromContains && !edge.from.includes(expectation.fromContains)) {
      return false;
    }
    return Boolean(expectation.from || expectation.fromContains);
  });
}

describe("GitImpact real-world benchmark", async () => {
  const cases = await listCases();

  for (const name of cases) {
    it(name, async () => {
      reporter.startCase(name);
      const caseDir = path.join(casesRoot, name);
      const expected = JSON.parse(
        await readFile(path.join(caseDir, "expected.json"), "utf8"),
      ) as FixtureExpected;

      const unsupported = expected.unsupportedPatterns ?? [];
      reporter.addUnsupported(unsupported);

      const parsed = await parseRepository(caseDir, {
        pathAliases: expected.pathAliases,
      });
      const routes = extractAllRoutes(
        parsed.files,
        parsed.contentsByPath,
        parsed.packageDeps,
      );
      const graph = buildGraph(parsed.files, routes);

      let softMisses = 0;

      for (const edge of expected.mustCall ?? []) {
        const hit = hasEdge(graph.edges, edge, "CALLS");
        reporter.expectHit("callGraph", hit);
        expect(
          hit,
          `missing CALLS ${edge.from ?? edge.fromContains} -> ${edge.to}`,
        ).toBe(true);
      }

      for (const edge of expected.mustNotCall ?? []) {
        const present = hasEdge(graph.edges, edge, "CALLS");
        reporter.expectMiss("callGraph", present);
        expect(present, `forbidden CALLS ${edge.from} -> ${edge.to}`).toBe(false);
      }

      for (const edge of expected.mustImport ?? []) {
        const hit = hasEdge(graph.edges, { ...edge, type: "IMPORTS" }, "IMPORTS");
        reporter.expectHit("importGraph", hit);
        expect(hit, `missing IMPORTS ${edge.from} -> ${edge.to}`).toBe(true);
      }

      for (const edge of expected.mustEdge ?? []) {
        const type = edge.type ?? "CALLS";
        const bucket =
          type === "IMPORTS"
            ? "importGraph"
            : type === "CALLS"
              ? "callGraph"
              : "callGraph";
        const hit = hasEdge(graph.edges, edge, type);
        // Framework edges (DEPENDS_ON / HANDLED_BY / QUERIES) count toward callGraph score
        reporter.expectHit(bucket, hit);
        expect(hit, `missing ${type} ${edge.from} -> ${edge.to}`).toBe(true);
      }

      for (const route of expected.mustDetectRoutes ?? []) {
        const hit = routes.some((r) => r.method === route.method && r.path === route.path);
        reporter.expectHit("routeDetection", hit);
        expect(
          hit,
          `missing route ${route.method} ${route.path}, got ${routes.map((r) => `${r.method} ${r.path}`).join(", ")}`,
        ).toBe(true);
      }

      for (const edge of expected.softMustCall ?? []) {
        if (!hasEdge(graph.edges, edge, "CALLS")) {
          softMisses += 1;
          reporter.recordSoftMiss();
          console.warn(
            `[soft] ${name}: missing ${edge.from ?? edge.fromContains} -> ${edge.to} (${edge.note ?? ""})`,
          );
        }
      }

      reporter.addCaseCoverage(
        name,
        parsed.files,
        unsupported,
        expected.knownUnresolved?.length ?? 0,
        softMisses,
      );
    }, 90_000);
  }

  afterAll(async () => {
    const results = await reporter.write(resultsPath(__dirname));
    console.log("\n=== GitImpact Real-World Benchmark ===");
    console.log(`Fixtures: ${results.fixtures}`);
    console.log(`Assertions: ${results.assertions}`);
    console.log(
      `Resolved calls: ${results.coverage.resolvedCalls} / ${results.coverage.totalCalls}`,
    );
    console.log(`Unresolved calls: ${results.coverage.unresolvedCalls}`);
    console.log(`Resolution coverage: ${results.summary.resolutionCoverage ?? "n/a"}`);
    console.log(`Precision: ${results.summary.precision ?? "n/a"}`);
    console.log(`Recall: ${results.summary.recall ?? "n/a"}`);
    console.log(`Unsupported patterns: ${results.summary.unsupportedPatternCount}`);
    console.log(`Soft misses: ${results.softMisses}`);
    console.log(results.headline);
    console.log(`Wrote ${resultsPath(__dirname)}\n`);
  });
});
