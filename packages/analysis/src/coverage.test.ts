import { describe, expect, it } from "vitest";
import type { AnalysisHealth, GraphEdge } from "@gitimpact/shared";
import { buildAnalysisCoverage, groupUnsupportedFiles } from "./coverage.js";

const healthy: AnalysisHealth = {
  filesDiscovered: 100,
  filesParsed: 100,
  filesIgnored: 2,
  filesUnsupported: 5,
  parseFailures: 0,
  truncated: false,
  maxFilesCap: 2000,
};

describe("buildAnalysisCoverage", () => {
  it("reports HIGH when parse and edges look solid", () => {
    const edges: GraphEdge[] = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      from: "a",
      to: "b",
      type: "CALLS",
      confidence: "HIGH" as const,
    }));
    const report = buildAnalysisCoverage({
      analysisHealth: healthy,
      graphEdges: edges,
      graphNodeCount: 20,
      allRelativeFiles: ["src/a.ts", "README.md"],
      codeFilePaths: ["src/a.ts"],
    });
    expect(report.confidence).toBe("HIGH");
    expect(report.codeParseCoveragePercent).toBe(100);
    expect(report.highConfidenceEdgePercent).toBe(100);
  });

  it("marks truncated analyses INCOMPLETE", () => {
    const report = buildAnalysisCoverage({
      analysisHealth: { ...healthy, truncated: true, filesParsed: 80 },
      graphEdges: [],
      graphNodeCount: 10,
    });
    expect(report.confidence).toBe("INCOMPLETE");
    expect(report.reasons.some((r) => /cap/i.test(r))).toBe(true);
  });

  it("treats infra-primary repos as HIGH when signals exist", () => {
    const report = buildAnalysisCoverage({
      analysisHealth: {
        filesDiscovered: 0,
        filesParsed: 0,
        filesIgnored: 1,
        filesUnsupported: 40,
        parseFailures: 0,
        truncated: false,
      },
      graphEdges: [
        {
          id: "d1",
          from: "a",
          to: "b",
          type: "DEPLOYS",
          confidence: "LOW",
        },
      ],
      graphNodeCount: 3,
      allRelativeFiles: ["main.tf", "variables.tf", "README.md"],
      codeFilePaths: [],
      infraSignals: [
        { kind: "terraform", label: "Terraform", path: "main.tf" },
        { kind: "github_actions", label: "GitHub Actions", path: ".github/workflows/ci.yml" },
      ],
    });
    expect(report.infraPrimary).toBe(true);
    expect(report.confidence).toBe("HIGH");
    expect(report.codeParseCoveragePercent).toBeNull();
  });
});

describe("groupUnsupportedFiles", () => {
  it("groups by extension kind", () => {
    const groups = groupUnsupportedFiles(
      ["main.tf", "vpc.tf", "app.yaml", "src/index.ts"],
      new Set(["src/index.ts"]),
    );
    expect(groups.find((g) => g.kind.includes("Terraform"))?.fileCount).toBe(2);
    expect(groups.find((g) => g.kind === "YAML")?.fileCount).toBe(1);
  });
});
