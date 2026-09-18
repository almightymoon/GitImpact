import { describe, expect, it } from "vitest";
import {
  buildHistorySnapshot,
  compareAnalyses,
  buildReviewReportMarkdown,
  formatArchitectureDiffMarkdown,
} from "./compare.js";
import type { SnapshotSource } from "./compare.js";

function baseSource(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    id: "acme/app",
    createdAt: "2026-09-18T12:00:00.000Z",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    summary: {
      files: 10,
      functions: 20,
      classes: 2,
      dependencies: 5,
      tests: 3,
      apiRoutes: 2,
      languages: [{ language: "TypeScript", fileCount: 10, percentage: 100 }],
      frameworks: ["Express"],
    },
    graph: {
      nodes: [
        { id: "FILE:a.ts", type: "FILE", name: "a.ts", file: "a.ts" },
        { id: "FILE:b.ts", type: "FILE", name: "b.ts", file: "b.ts" },
      ],
      edges: [
        {
          id: "e1",
          from: "FILE:a.ts",
          to: "FILE:b.ts",
          type: "IMPORTS",
          confidence: "HIGH",
        },
      ],
    },
    intelligence: {
      repositoryType: "API_SERVICE",
      typeLabel: "Express Service",
      architectureSummary: "API service",
      importantModules: [],
      infraSignals: [],
      analysisHealth: {
        filesDiscovered: 10,
        filesParsed: 10,
        filesIgnored: 0,
        filesUnsupported: 0,
        parseFailures: 0,
        truncated: false,
      },
      openPullRequests: [],
      openPrCount: 0,
      architecture: {
        components: [
          {
            id: "sys-api",
            band: "server",
            title: "API",
            role: "HTTP entry",
            pathHint: "src",
            files: ["a.ts"],
            shape: "box",
            level: "SYSTEM",
          },
        ],
        edges: [],
        narrative: [],
      },
      coverage: {
        confidence: "HIGH",
        confidenceLabel: "High confidence",
        codeParseCoveragePercent: 100,
        highConfidenceEdgePercent: 100,
        infraPrimary: false,
        reasons: [],
        blindSpots: ["example blind spot"],
        frameworks: [],
        edgeConfidence: { highPercent: 100, mediumPercent: 0, lowPercent: 0 },
        unsupportedGroups: [],
        inventory: {
          filesDiscovered: 10,
          filesParsed: 10,
          filesIgnored: 0,
          filesUnsupported: 0,
          parseFailures: 0,
          truncated: false,
        },
        graph: {
          nodes: 2,
          edges: 1,
          highConfidenceEdges: 1,
          mediumConfidenceEdges: 0,
          lowConfidenceEdges: 0,
        },
      },
    },
    impact: {
      changedNodes: [],
      directImpact: [
        {
          node: { id: "FILE:b.ts", type: "FILE", name: "b.ts", file: "b.ts" },
          depth: 1,
          severity: "MEDIUM",
          relationshipPath: [],
          confidence: "HIGH",
        },
      ],
      indirectImpact: [],
      affectedFiles: ["b.ts"],
      affectedApis: [],
      relatedTests: [],
      missingTests: [],
      maxDepth: 3,
      complexityScore: 20,
      complexityBreakdown: [],
      summary: "small",
    },
    ...overrides,
  };
}

describe("compare / history snapshots", () => {
  it("builds a compact snapshot", () => {
    const snap = buildHistorySnapshot(baseSource());
    expect(snap.frameworks).toEqual(["Express"]);
    expect(snap.summary.apiRoutes).toBe(2);
    expect(snap.systems[0]?.title).toBe("API");
    expect(snap.impact?.directCount).toBe(1);
  });

  it("detects architecture and blast-radius deltas", () => {
    const from = baseSource();
    const to = baseSource({
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      createdAt: "2026-09-19T12:00:00.000Z",
      summary: {
        ...from.summary,
        apiRoutes: 4,
        frameworks: ["Express", "Zod"],
      },
      intelligence: {
        ...from.intelligence!,
        architecture: {
          components: [
            ...(from.intelligence!.architecture!.components ?? []),
            {
              id: "sys-jobs",
              band: "server",
              title: "Jobs",
              role: "workers",
              pathHint: "jobs",
              files: [],
              shape: "box",
              level: "SYSTEM",
            },
          ],
          edges: [
            {
              from: "sys-api",
              to: "sys-jobs",
              label: "enqueues",
            },
          ],
          narrative: [],
        },
      },
      impact: {
        ...from.impact!,
        directImpact: [
          ...from.impact!.directImpact,
          {
            node: { id: "FILE:c.ts", type: "FILE", name: "c.ts", file: "c.ts" },
            depth: 1,
            severity: "MEDIUM" as const,
            relationshipPath: [],
            confidence: "HIGH" as const,
          },
        ],
        complexityScore: 40,
      },
    });

    const diff = compareAnalyses(from, to);
    expect(diff.frameworksAdded).toContain("Zod");
    expect(diff.systemsAdded.some((s) => s.title === "Jobs")).toBe(true);
    expect(diff.summaryDeltas.apiRoutes).toBe(2);
    expect(diff.blastRadius?.verdict).toBe("increased");
    expect(diff.narrative.some((n) => /Blast radius increased/i.test(n))).toBe(true);

    const md = formatArchitectureDiffMarkdown(diff);
    expect(md).toContain("Architecture comparison");
    expect(md).toContain("Zod");
  });

  it("builds a deterministic review report", () => {
    const md = buildReviewReportMarkdown(baseSource());
    expect(md).toContain("GitImpact review report");
    expect(md).toContain("Express");
    expect(md).toContain("example blind spot");
    expect(md).toContain("no AI");
  });
});
