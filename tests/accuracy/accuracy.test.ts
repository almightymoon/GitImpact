import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseRepository,
  mapPatchToEnclosingSymbols,
  analyzeSemanticDiff,
  enclosingSymbolToNodeId,
} from "@gitimpact/parser";
import { buildGraph } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** v0.4 accuracy benchmark cases live beside this harness */
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

type FixtureExpected = {
  description?: string;
  pathAliases?: Record<string, string[]>;
  mustCall?: EdgeExpectation[];
  mustNotCall?: EdgeExpectation[];
  mustEdge?: EdgeExpectation[];
  softMustCall?: Array<EdgeExpectation & { note?: string }>;
  mustDetectRoutes?: Array<{ method: string; path: string }>;
  /** Graph node ids that must exist after parse */
  mustSymbols?: string[];
  diffCases?: DiffCase[];
};

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function hasCall(
  edges: Array<{ from: string; to: string; type: string }>,
  expectation: EdgeExpectation,
): boolean {
  return edges.some((edge) => {
    if (edge.type !== (expectation.type ?? "CALLS")) return false;
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

describe("GitImpact accuracy benchmark (v0.4)", async () => {
  const fixtures = await listFixtures();

  for (const name of fixtures) {
    it(name, async () => {
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
            expect(
              enclosing.some((symbol) => matchesSymbol(symbol, want)),
              `expected enclosing ${want.kind} ${want.className ?? ""}.${want.name}, got ${JSON.stringify(enclosing)}`,
            ).toBe(true);
          }

          for (const want of diffCase.mustChangedSymbols ?? []) {
            const hit =
              semantic.changedSymbols.some((symbol) => matchesSymbol(symbol, want)) ||
              (want.id
                ? semantic.changedSymbolIds.includes(want.id)
                : semantic.changedSymbolIds.includes(
                    enclosingSymbolToNodeId({
                      kind: want.kind as "FUNCTION" | "METHOD" | "CLASS",
                      name: want.name,
                      className: want.className,
                      startLine: 0,
                      endLine: 0,
                      file: diffCase.file,
                    }),
                  ));
            expect(
              hit,
              `expected changed symbol ${want.kind} ${want.className ?? ""}.${want.name}, got ${JSON.stringify(semantic.changedSymbolIds)}`,
            ).toBe(true);
          }

          for (const kind of diffCase.mustSemanticEvents ?? []) {
            expect(
              semantic.events.some((event) => event.kind === kind),
              `expected semantic event ${kind}, got ${semantic.events.map((e) => e.kind).join(", ") || "(none)"}`,
            ).toBe(true);
          }

          for (const kind of diffCase.mustNotSemanticEvents ?? []) {
            expect(
              semantic.events.some((event) => event.kind === kind),
              `forbidden semantic event ${kind}`,
            ).toBe(false);
          }
        }
      }

      const hasGraphAssertions =
        (expected.mustCall?.length ?? 0) > 0 ||
        (expected.mustNotCall?.length ?? 0) > 0 ||
        (expected.mustEdge?.length ?? 0) > 0 ||
        (expected.mustDetectRoutes?.length ?? 0) > 0 ||
        (expected.softMustCall?.length ?? 0) > 0 ||
        (expected.mustSymbols?.length ?? 0) > 0;

      if (!hasGraphAssertions) return;

      const parsed = await parseRepository(fixtureDir, {
        pathAliases: expected.pathAliases,
      });
      const routes = extractAllRoutes(
        parsed.files,
        parsed.contentsByPath,
        parsed.packageDeps,
      );
      const graph = buildGraph(parsed.files, routes);
      const nodeIds = new Set(graph.nodes.map((n) => n.id));

      for (const id of expected.mustSymbols ?? []) {
        expect(nodeIds.has(id), `missing symbol node ${id}`).toBe(true);
      }

      for (const edge of expected.mustCall ?? []) {
        expect(
          hasCall(graph.edges, edge),
          `missing CALLS ${edge.from ?? edge.fromContains} -> ${edge.to}`,
        ).toBe(true);
      }

      for (const edge of expected.mustNotCall ?? []) {
        expect(
          hasCall(graph.edges, edge),
          `forbidden CALLS ${edge.from ?? edge.fromContains} -> ${edge.to}`,
        ).toBe(false);
      }

      for (const edge of expected.mustEdge ?? []) {
        expect(
          hasCall(graph.edges, { ...edge, type: edge.type }),
          `missing ${edge.type} ${edge.from} -> ${edge.to}`,
        ).toBe(true);
      }

      for (const route of expected.mustDetectRoutes ?? []) {
        expect(
          routes.some((r) => r.method === route.method && r.path === route.path),
          `missing route ${route.method} ${route.path}, got ${routes.map((r) => `${r.method} ${r.path}`).join(", ")}`,
        ).toBe(true);
      }

      for (const edge of expected.softMustCall ?? []) {
        if (!hasCall(graph.edges, edge)) {
          console.warn(`[soft] ${name}: missing ${edge.from} -> ${edge.to} (${edge.note ?? ""})`);
        }
      }
    }, 60_000);
  }
});
