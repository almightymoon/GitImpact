import { describe, expect, it } from "vitest";
import {
  formatImpactSummaryMarkdown,
  formatRelationshipChain,
  formatSemanticEventDetail,
  humanizeSemanticEvent,
  explainTestGap,
  relationLabel,
} from "@gitimpact/shared";
import { classifyAnalysisError } from "../../packages/analysis/src/access-errors.ts";
import { extractReadmeDigest } from "../../packages/analysis/src/readme-digest.ts";
import {
  detectRepositoryType,
  detectInfraSignals,
} from "../../packages/analysis/src/repository-type.ts";
import type { ImpactReport, ImpactPathStep, GraphNode } from "@gitimpact/shared";

describe("access error classification", () => {
  it("detects private repository access failures", () => {
    const result = classifyAnalysisError(
      new Error("GitHub repository not found or private. For private repos, set GITHUB_TOKEN."),
    );
    expect(result.code).toBe("PRIVATE_REPOSITORY");
    expect(result.message).toContain("private repository");
    expect(result.action).toBe("connect_github");
  });

  it("detects empty / unsupported file cases", () => {
    const result = classifyAnalysisError(new Error("No supported source files found"));
    expect(result.code).toBe("NO_SUPPORTED_FILES");
  });
});

describe("readme digest", () => {
  it("extracts description without dumping raw markdown chrome", () => {
    const digest = extractReadmeDigest(`# Cool App

Cool App helps teams understand change impact.

## Installation

\`\`\`bash
npm install
\`\`\`

## Features

- Fast analysis
- Deterministic graphs
`);
    expect(digest?.title).toBe("Cool App");
    expect(digest?.description).toContain("change impact");
    expect(digest?.installation).toContain("npm install");
    expect(digest?.features.length).toBeGreaterThan(0);
    expect(digest?.rawAvailable).toBe(true);
  });
});

describe("repository type detection", () => {
  it("labels Next.js fullstack apps", () => {
    const result = detectRepositoryType({
      frameworks: ["Next.js", "React"],
      routes: [
        {
          id: "1",
          framework: "nextjs",
          method: "GET",
          path: "/api/users",
          file: "app/api/users/route.ts",
          confidence: "HIGH",
        },
      ],
      files: [],
      filePaths: ["app/api/users/route.ts", "app/page.tsx"],
    });
    expect(result.type).toBe("FULLSTACK");
    expect(result.label).toMatch(/Next\.js|Full-Stack/i);
  });

  it("labels gitops/infra repos", () => {
    const paths = ["argocd/application.yaml", "k8s/deployment.yaml", "terraform/main.tf"];
    const infra = detectInfraSignals(paths);
    const result = detectRepositoryType({
      frameworks: [],
      routes: [],
      files: [],
      filePaths: paths,
      infraSignals: infra,
    });
    expect(["GITOPS", "INFRASTRUCTURE"]).toContain(result.type);
  });
});

describe("impact summary formatter", () => {
  const impact: ImpactReport = {
    changedNodes: [],
    directImpact: [
      {
        node: {
          id: "FUNCTION:a:login",
          type: "FUNCTION",
          name: "adminApi.login",
          file: "a.ts",
        },
        depth: 1,
        severity: "HIGH",
        relationshipPath: ["METHOD:auth:generateToken", "FUNCTION:a:login"],
        confidence: "HIGH",
      },
    ],
    indirectImpact: [],
    affectedFiles: [],
    affectedApis: [{ id: "1", type: "API_ROUTE", name: "POST /api/admin/login", file: "r.ts" }],
    relatedTests: [
      { id: "2", type: "TEST", name: "auth.test.ts", file: "auth.test.ts" },
    ],
    missingTests: [{ id: "3", type: "SERVICE", name: "LegacyLogin", file: "legacy.ts" }],
    maxDepth: 3,
    complexityScore: 37,
    complexityBreakdown: [],
    summary: "ok",
  };

  it("formats a shareable markdown summary", () => {
    const text = formatImpactSummaryMarkdown({
      componentName: "AuthService.generateToken()",
      impact,
      analysisUrl: "https://gitimpact.example/acme/app",
    });
    expect(text).toContain("GitImpact — Change Impact");
    expect(text).toContain("AuthService.generateToken()");
    expect(text).toContain("Direct dependents: 1");
    expect(text).toContain("Complexity: 37/100");
    expect(text).toContain("GitImpact: https://gitimpact.example/acme/app");
    expect(text).not.toMatch(/METHOD:auth/);
  });

  it("formats relationship paths", () => {
    const steps: ImpactPathStep[] = [
      {
        nodeId: "a",
        name: "AdminLoginPage",
        file: "a.tsx",
        type: "COMPONENT",
      },
      {
        nodeId: "b",
        name: "POST /api/admin/login",
        file: "r.ts",
        type: "API_ROUTE",
        edgeType: "FETCHES",
      },
      {
        nodeId: "c",
        name: "AuthService.generateToken",
        file: "auth.ts",
        type: "METHOD",
        edgeType: "CALLS",
      },
    ];
    const chain = formatRelationshipChain(steps);
    expect(chain).toContain("AdminLoginPage");
    expect(chain).toContain("FETCHES");
    expect(chain).toContain("AuthService.generateToken");
  });
});

describe("semantic event labels", () => {
  it("humanizes enum names", () => {
    expect(humanizeSemanticEvent("PARAMETER_ADDED")).toBe("Parameter added");
    const detail = formatSemanticEventDetail({
      kind: "PARAMETER_ADDED",
      name: "login",
      className: "AuthService",
      details: { addedParameter: "organizationId", type: "string" },
    });
    expect(detail.subject).toBe("AuthService.login");
    expect(detail.detail).toContain("organizationId");
  });
});

describe("test gap explanation", () => {
  it("explains why a gap was flagged", () => {
    const gap: GraphNode = {
      id: "SERVICE:x",
      type: "SERVICE",
      name: "AdminSubscriptionService",
      file: "sub.ts",
    };
    const changed: GraphNode = {
      id: "FUNCTION:y",
      type: "FUNCTION",
      name: "createSubscription()",
      file: "sub.ts",
    };
    const explained = explainTestGap({ gapNode: gap, changedNodes: [changed] });
    expect(explained.title).toBe("Potential test gap");
    expect(explained.why).toContain("createSubscription()");
    expect(explained.why).toContain("AdminSubscriptionService");
  });
});

describe("relation labels", () => {
  it("maps CALLS to readable text", () => {
    expect(relationLabel("CALLS")).toBe("calls");
    expect(relationLabel("HANDLED_BY")).toBe("handled by");
  });
});
