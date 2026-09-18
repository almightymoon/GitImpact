import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseRepository,
  mapPatchToEnclosingSymbols,
  analyzeSemanticDiff,
  enclosingSymbolToNodeId,
} from "@gitimpact/parser";
import { buildGraph, GraphStore } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";
import { buildImpactReport } from "@gitimpact/impact-engine";
import { reporter, resultsPath } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "cases");

type EdgeExpectation = {
  from?: string;
  to?: string;
  type?: string;
  fromContains?: string;
};

type SymbolExpectation = {
  kind: string;
  name: string;
  className?: string;
  id?: string;
};

type DiffCase = {
  file: string;
  patch: string;
  mustEnclose?: SymbolExpectation[];
  mustChangedSymbols?: SymbolExpectation[];
  mustSemanticEvents?: string[];
  mustNotSemanticEvents?: string[];
};

type BlastRadiusExpectation = {
  seed: string;
  mustInclude?: string[];
  mustNotInclude?: string[];
  depth?: number;
};

type FixtureExpected = {
  description?: string;
  pathAliases?: Record<string, string[]>;
  mustCall?: EdgeExpectation[];
  mustNotCall?: EdgeExpectation[];
  mustImport?: EdgeExpectation[];
  mustNotImport?: EdgeExpectation[];
  mustEdge?: EdgeExpectation[];
  softMustCall?: Array<EdgeExpectation & { note?: string }>;
  mustDetectRoutes?: Array<{ method: string; path: string }>;
  mustSymbols?: string[];
  mustBlastRadius?: BlastRadiusExpectation[];
  diffCases?: DiffCase[];
};

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
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

function matchesSymbol(
  symbol: { kind: string; name: string; className?: string },
  want: SymbolExpectation,
): boolean {
  return (
    symbol.kind === want.kind &&
    symbol.name === want.name &&
    (want.className ? symbol.className === want.className : true)
  );
}

function symbolIdFromExpectation(file: string, want: SymbolExpectation): string {
  if (want.id) return want.id;
  return enclosingSymbolToNodeId({
    kind: want.kind as "FUNCTION" | "METHOD" | "CLASS",
    name: want.name,
    className: want.className,
    startLine: 0,
    endLine: 0,
    file,
  });
}

describe("GitImpact accuracy benchmark (v0.4)", async () => {
  const fixtures = await listFixtures();

  for (const name of fixtures) {
    it(name, async () => {
      reporter.startFixture(name);
      const fixtureDir = path.join(fixturesRoot, name);
      const expected = JSON.parse(
        await readFile(path.join(fixtureDir, "expected.json"), "utf8"),
      ) as FixtureExpected;

      if (expected.diffCases?.length) {
        for (const diffCase of expected.diffCases) {
          const content = await readFile(path.join(fixtureDir, diffCase.file), "utf8");
          const enclosing = mapPatchToEnclosingSymbols(
            diffCase.file,
            content,
            diffCase.patch,
          );
          const semantic = analyzeSemanticDiff(diffCase.file, content, diffCase.patch);

          for (const want of diffCase.mustEnclose ?? []) {
            const hit = enclosing.some((symbol) => matchesSymbol(symbol, want));
            reporter.expectHit(name, "diffToAst", hit);
            expect(
              hit,
              `expected enclosing ${want.kind} ${want.className ?? ""}.${want.name}, got ${JSON.stringify(enclosing)}`,
            ).toBe(true);
          }

          for (const want of diffCase.mustChangedSymbols ?? []) {
            const hit =
              semantic.changedSymbols.some((symbol) => matchesSymbol(symbol, want)) ||
              semantic.changedSymbolIds.includes(symbolIdFromExpectation(diffCase.file, want));
            reporter.expectHit(name, "symbolResolution", hit);
            expect(
              hit,
              `expected changed symbol ${want.kind} ${want.className ?? ""}.${want.name}, got ${JSON.stringify(semantic.changedSymbolIds)}`,
            ).toBe(true);
          }

          for (const kind of diffCase.mustSemanticEvents ?? []) {
            const hit = semantic.events.some((event) => event.kind === kind);
            reporter.expectHit(name, "semanticDiff", hit);
            expect(
              hit,
              `expected semantic event ${kind}, got ${semantic.events.map((e) => e.kind).join(", ") || "(none)"}`,
            ).toBe(true);
          }

          for (const kind of diffCase.mustNotSemanticEvents ?? []) {
            const present = semantic.events.some((event) => event.kind === kind);
            reporter.expectMiss(name, "semanticDiff", present);
            expect(present, `forbidden semantic event ${kind}`).toBe(false);
          }
        }
      }

      const hasGraphAssertions =
        (expected.mustCall?.length ?? 0) > 0 ||
        (expected.mustNotCall?.length ?? 0) > 0 ||
        (expected.mustImport?.length ?? 0) > 0 ||
        (expected.mustNotImport?.length ?? 0) > 0 ||
        (expected.mustEdge?.length ?? 0) > 0 ||
        (expected.mustDetectRoutes?.length ?? 0) > 0 ||
        (expected.softMustCall?.length ?? 0) > 0 ||
        (expected.mustSymbols?.length ?? 0) > 0 ||
        (expected.mustBlastRadius?.length ?? 0) > 0;

      if (!hasGraphAssertions) return;

      const parsed = await parseRepository(fixtureDir, {
        pathAliases: expected.pathAliases,
      });
      const routes = extractAllRoutes(
        parsed.files,
        parsed.contentsByPath,
        parsed.packageDeps,
        parsed.packageName,
      );
      const graph = buildGraph(parsed.files, routes);
      const store = new GraphStore(graph);
      const nodeIds = new Set(graph.nodes.map((n) => n.id));

      for (const id of expected.mustSymbols ?? []) {
        const hit = nodeIds.has(id);
        reporter.expectHit(name, "symbolResolution", hit);
        expect(nodeIds.has(id), `missing symbol node ${id}`).toBe(true);
      }

      for (const edge of expected.mustCall ?? []) {
        const hit = hasEdge(graph.edges, edge, "CALLS");
        reporter.expectHit(name, "callGraph", hit);
        expect(
          hit,
          `missing CALLS ${edge.from ?? edge.fromContains} -> ${edge.to}`,
        ).toBe(true);
      }

      for (const edge of expected.mustNotCall ?? []) {
        const present = hasEdge(graph.edges, edge, "CALLS");
        reporter.expectMiss(name, "callGraph", present);
        expect(
          present,
          `forbidden CALLS ${edge.from ?? edge.fromContains} -> ${edge.to}`,
        ).toBe(false);
      }

      for (const edge of expected.mustImport ?? []) {
        const hit = hasEdge(graph.edges, { ...edge, type: edge.type ?? "IMPORTS" }, "IMPORTS");
        reporter.expectHit(name, "importGraph", hit);
        expect(
          hit,
          `missing IMPORTS ${edge.from} -> ${edge.to}`,
        ).toBe(true);
      }

      for (const edge of expected.mustNotImport ?? []) {
        const present = hasEdge(
          graph.edges,
          { ...edge, type: edge.type ?? "IMPORTS" },
          "IMPORTS",
        );
        reporter.expectMiss(name, "importGraph", present);
        expect(present, `forbidden IMPORTS ${edge.from} -> ${edge.to}`).toBe(false);
      }

      for (const edge of expected.mustEdge ?? []) {
        const type = edge.type ?? "CALLS";
        const bucket =
          type === "IMPORTS"
            ? "importGraph"
            : type === "TESTS"
              ? "impact"
              : "callGraph";
        const hit = hasEdge(graph.edges, edge, type);
        reporter.expectHit(name, bucket, hit);
        expect(hit, `missing ${type} ${edge.from} -> ${edge.to}`).toBe(true);
      }

      for (const route of expected.mustDetectRoutes ?? []) {
        expect(
          routes.some((r) => r.method === route.method && r.path === route.path),
          `missing route ${route.method} ${route.path}, got ${routes.map((r) => `${r.method} ${r.path}`).join(", ")}`,
        ).toBe(true);
      }

      for (const blast of expected.mustBlastRadius ?? []) {
        const seed = store.getNode(blast.seed);
        expect(seed, `blast-radius seed missing: ${blast.seed}`).toBeTruthy();
        if (!seed) continue;

        const impact = buildImpactReport(store, [seed], blast.depth ?? 3);
        const impactedIds = new Set([
          ...impact.changedNodes.map((n) => n.id),
          ...impact.directImpact.map((i) => i.node.id),
          ...impact.indirectImpact.map((i) => i.node.id),
        ]);

        for (const id of blast.mustInclude ?? []) {
          const hit = impactedIds.has(id);
          reporter.expectHit(name, "impact", hit);
          expect(hit, `blast radius missing ${id} from seed ${blast.seed}`).toBe(true);
        }
        for (const id of blast.mustNotInclude ?? []) {
          const present = impactedIds.has(id);
          reporter.expectMiss(name, "impact", present);
          expect(present, `blast radius should not include ${id}`).toBe(false);
        }
      }

      for (const edge of expected.softMustCall ?? []) {
        if (!hasEdge(graph.edges, edge, "CALLS")) {
          reporter.recordSoftMiss(name);
          console.warn(`[soft] ${name}: missing ${edge.from} -> ${edge.to} (${edge.note ?? ""})`);
        }
      }
    }, 60_000);
  }

  afterAll(async () => {
    const results = await reporter.write(resultsPath(__dirname));
    console.log("\n=== GitImpact Accuracy Benchmark ===");
    console.log(`Fixtures: ${results.fixtures}`);
    console.log(`Assertions: ${results.assertions}`);
    console.log(`Soft misses (excluded from hard scores): ${results.softMisses}`);
    console.log(`Symbol mapping precision: ${results.summary.symbolMappingPrecision ?? "n/a"}`);
    console.log(`Symbol mapping recall: ${results.summary.symbolMappingRecall ?? "n/a"}`);
    console.log(`Call graph precision: ${results.summary.callGraphPrecision ?? "n/a"}`);
    console.log(`Call graph recall: ${results.summary.callGraphRecall ?? "n/a"}`);
    console.log(`Import graph precision: ${results.summary.importGraphPrecision ?? "n/a"}`);
    console.log(`Import graph recall: ${results.summary.importGraphRecall ?? "n/a"}`);
    console.log(`Impact precision: ${results.summary.impactPrecision ?? "n/a"}`);
    console.log(`Impact recall: ${results.summary.impactRecall ?? "n/a"}`);
    console.log(`Diff-to-AST mapping: ${results.summary.diffToAstMapping ?? "n/a"}`);
    console.log(`Semantic diff accuracy: ${results.summary.semanticDiffAccuracy ?? "n/a"}`);
    console.log(results.headline);
    console.log(`Wrote ${resultsPath(__dirname)}\n`);
  });
});
