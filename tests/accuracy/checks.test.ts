import { describe, expect, it } from "vitest";
import { buildGraph } from "@gitimpact/graph";
import type { ParsedFile } from "@gitimpact/shared";
import { runSecurityChecks } from "../../packages/analysis/src/checks/security.ts";
import { runQualityChecks } from "../../packages/analysis/src/checks/quality.ts";
import { runCicdChecks } from "../../packages/analysis/src/checks/cicd.ts";
import { buildChecksReport } from "../../packages/analysis/src/checks/index.ts";
import {
  applyChecksConfig,
  matchPathGlob,
} from "../../packages/analysis/src/checks/config.ts";

function file(partial: Partial<ParsedFile> & { path: string }): ParsedFile {
  return {
    language: "typescript",
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    envVariables: [],
    isTest: false,
    ...partial,
  };
}

describe("security checks", () => {
  it("flags hard-coded github token patterns", async () => {
    const path = "src/config.ts";
    const contents = new Map([
      [path, `const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";\n`],
    ]);
    const findings = await runSecurityChecks({
      files: [file({ path })],
      contentsByPath: contents,
    });
    expect(findings.some((f) => f.ruleId === "secret_exposure")).toBe(true);
  });

  it("flags dangerous dependencies", async () => {
    const findings = await runSecurityChecks({
      files: [],
      contentsByPath: new Map(),
      packageDeps: { request: "^2.88.0" },
    });
    expect(findings.some((f) => f.ruleId === "dangerous_dependency")).toBe(true);
  });
});

describe("quality checks", () => {
  it("flags high complexity and empty catch", () => {
    const path = "src/big.ts";
    const body = [
      "export function messy(x: number) {",
      ...Array.from({ length: 20 }, (_, i) => `  if (x === ${i}) return ${i};`),
      "  try { return x; } catch (e) {}",
      "}",
    ].join("\n");
    const parsed = file({
      path,
      exports: ["messy"],
      functions: [
        {
          name: "messy",
          startLine: 1,
          endLine: 24,
          exported: true,
          calls: [],
          parameters: ["x"],
        },
      ],
    });
    const graph = buildGraph([parsed], []);
    const findings = runQualityChecks({
      files: [parsed],
      contentsByPath: new Map([[path, body]]),
      graph,
    });
    expect(findings.some((f) => f.ruleId === "high_complexity_function")).toBe(true);
    expect(findings.some((f) => f.ruleId === "weak_error_handling")).toBe(true);
  });
});

describe("cicd checks", () => {
  it("detects workflows and dockerfile presence", () => {
    const findings = runCicdChecks({
      allRelativeFiles: [
        ".github/workflows/ci.yml",
        "Dockerfile",
        "k8s/deployment.yaml",
      ],
      infraSignals: [],
    });
    expect(findings.some((f) => f.ruleId === "github_actions_present")).toBe(true);
    expect(findings.some((f) => f.ruleId === "docker_present")).toBe(true);
  });

  it("flags changed infra files on PR", () => {
    const findings = runCicdChecks({
      allRelativeFiles: ["Dockerfile"],
      infraSignals: [],
      changes: [
        {
          filePath: "Dockerfile",
          changeType: "CONFIGURATION",
        },
      ],
    });
    expect(findings.some((f) => f.ruleId === "dockerfile_changed")).toBe(true);
  });
});

describe("checks report", () => {
  it("builds PR highlight bullets", async () => {
    const path = "src/auth.ts";
    const parsed = file({
      path,
      functions: [
        {
          name: "login",
          startLine: 1,
          endLine: 3,
          exported: true,
          calls: [],
          parameters: [],
        },
      ],
    });
    const report = await buildChecksReport({
      files: [parsed],
      contentsByPath: new Map([[path, "export function login() { return 1; }\n"]]),
      graph: buildGraph([parsed], []),
      allRelativeFiles: [path, "Dockerfile"],
      infraSignals: [{ kind: "docker", label: "Docker", path: "Dockerfile" }],
      changes: [{ filePath: "Dockerfile", changeType: "CONFIGURATION" }],
      prOverview: {
        filesChanged: 1,
        functionsModified: 0,
        directDependencies: 2,
        indirectDependencies: 3,
        apiRoutesAffected: 1,
        databaseModelsAffected: 0,
        frontendComponentsAffected: 0,
        relevantTests: 1,
        potentialMissingTests: 0,
        complexityScore: 10,
        impactLevel: "Low",
        summary: "ok",
        changedFiles: ["Dockerfile"],
        changeBreakdown: {
          STRUCTURAL: 0,
          INTERFACE: 0,
          BEHAVIORAL: 0,
          CONFIGURATION: 1,
        },
      },
    });
    expect(report.prHighlights.changeImpact?.[0]).toContain("downstream");
    expect(report.prHighlights.cicd.some((b) => /Docker/i.test(b))).toBe(true);
    expect(report.summaries.length).toBe(5);
    expect(report.findings.every((f) => f.whyItMatters && f.remediation)).toBe(true);
  });
});

describe("checks config (.gitimpact.yml)", () => {
  it("matches legacy path globs", () => {
    expect(matchPathGlob("src/legacy/foo.ts", "src/legacy/**")).toBe(true);
    expect(matchPathGlob("src/app/foo.ts", "src/legacy/**")).toBe(false);
    expect(matchPathGlob("src/lib/util.ts", "src/*/util.ts")).toBe(true);
  });

  it("suppresses and remaps severity from config", () => {
    const findings = [
      {
        id: "1",
        ruleId: "high_complexity_function" as const,
        category: "quality" as const,
        severity: "medium" as const,
        title: "Complex",
        message: "too complex",
        file: "src/legacy/old.ts",
        confidence: "MEDIUM" as const,
      },
      {
        id: "2",
        ruleId: "dangerous_dependency" as const,
        category: "dependencies" as const,
        severity: "medium" as const,
        title: "Dep",
        message: "risky",
        evidence: "request",
        confidence: "MEDIUM" as const,
      },
    ];
    const applied = applyChecksConfig(findings, {
      checks: {
        ignore: [
          {
            rule: "high_complexity_function",
            path: "src/legacy/**",
            reason: "legacy module scheduled for replacement",
          },
        ],
        severity: {
          dangerous_dependency: "high",
        },
      },
    });
    expect(applied.suppressed).toBe(1);
    expect(applied.severityOverrides).toBe(1);
    expect(applied.findings).toHaveLength(1);
    expect(applied.findings[0]?.ruleId).toBe("dangerous_dependency");
    expect(applied.findings[0]?.severity).toBe("high");
  });
});
