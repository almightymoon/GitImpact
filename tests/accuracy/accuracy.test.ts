import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRepository, mapPatchToEnclosingSymbols } from "@gitimpact/parser";
import { buildGraph } from "@gitimpact/graph";
import { extractAllRoutes } from "@gitimpact/framework-detector";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "../../fixtures/accuracy");

type EdgeExpectation = {
  from?: string;
  to?: string;
  type?: string;
  fromContains?: string;
};

type FixtureExpected = {
  description?: string;
  pathAliases?: Record<string, string[]>;
  mustCall?: EdgeExpectation[];
  mustNotCall?: EdgeExpectation[];
  mustEdge?: EdgeExpectation[];
  softMustCall?: Array<EdgeExpectation & { note?: string }>;
  mustDetectRoutes?: Array<{ method: string; path: string }>;
  diffCases?: Array<{
    file: string;
    patch: string;
    mustEnclose: Array<{ kind: string; name: string; className?: string }>;
  }>;
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

describe("GitImpact accuracy fixtures", async () => {
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
          for (const want of diffCase.mustEnclose) {
            expect(
              enclosing.some(
                (symbol) =>
                  symbol.kind === want.kind &&
                  symbol.name === want.name &&
                  (want.className ? symbol.className === want.className : true),
              ),
              `expected enclosing ${want.kind} ${want.className ?? ""}.${want.name}, got ${JSON.stringify(enclosing)}`,
            ).toBe(true);
          }
        }
      }

      const hasGraphAssertions =
        (expected.mustCall?.length ?? 0) > 0 ||
        (expected.mustNotCall?.length ?? 0) > 0 ||
        (expected.mustEdge?.length ?? 0) > 0 ||
        (expected.mustDetectRoutes?.length ?? 0) > 0 ||
        (expected.softMustCall?.length ?? 0) > 0;

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

      // softMustCall: log-only style — do not fail the suite yet
      for (const edge of expected.softMustCall ?? []) {
        if (!hasCall(graph.edges, edge)) {
          console.warn(`[soft] ${name}: missing ${edge.from} -> ${edge.to} (${edge.note ?? ""})`);
        }
      }
    }, 60_000);
  }
});
