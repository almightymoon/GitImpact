import { describe, expect, it } from "vitest";
import {
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
} from "../../packages/analysis/src/pr-comment.ts";
import type {
  ImpactReport,
  PullRequestImpactOverview,
  PullRequestMeta,
} from "@gitimpact/shared";

const pullRequest: PullRequestMeta = {
  owner: "acme",
  repo: "app",
  number: 42,
  title: "Rotate auth signing secret",
  baseBranch: "main",
  headBranch: "fix/auth-secret",
  url: "https://github.com/acme/app/pull/42",
};

const overview: PullRequestImpactOverview = {
  filesChanged: 2,
  functionsModified: 2,
  directDependencies: 8,
  indirectDependencies: 17,
  apiRoutesAffected: 3,
  databaseModelsAffected: 0,
  frontendComponentsAffected: 1,
  relevantTests: 6,
  potentialMissingTests: 2,
  complexityScore: 47,
  impactLevel: "Elevated",
  summary: "Auth signing change fans out to admin login.",
  changedFiles: ["src/auth.service.ts"],
  changeBreakdown: {
    STRUCTURAL: 0,
    INTERFACE: 0,
    BEHAVIORAL: 2,
    CONFIGURATION: 0,
  },
};

const impact: ImpactReport = {
  changedNodes: [
    {
      id: "METHOD:src/auth.service.ts:AuthService.generateToken",
      type: "METHOD",
      name: "AuthService.generateToken",
      file: "src/auth.service.ts",
    },
    {
      id: "METHOD:src/session.service.ts:SessionService.createSession",
      type: "METHOD",
      name: "SessionService.createSession",
      file: "src/session.service.ts",
    },
  ],
  directImpact: [],
  indirectImpact: [
    {
      node: {
        id: "COMPONENT:src/AdminLogin.tsx:AdminLogin",
        type: "COMPONENT",
        name: "AdminLogin",
        file: "src/AdminLogin.tsx",
      },
      depth: 3,
      severity: "HIGH",
      relationshipPath: [
        "METHOD:src/auth.service.ts:AuthService.generateToken",
        "METHOD:src/admin-auth.controller.ts:AdminAuthController.login",
        "API_ROUTE:nestjs:POST:/api/admin/login:src/admin-auth.controller.ts",
        "FUNCTION:src/adminApi.ts:adminApi",
        "COMPONENT:src/AdminLogin.tsx:AdminLogin",
      ],
      confidence: "HIGH",
    },
  ],
  affectedFiles: [],
  affectedApis: [],
  relatedTests: [],
  missingTests: [],
  maxDepth: 3,
  complexityScore: 47,
  complexityBreakdown: [],
  summary: "Auth signing change fans out to admin login.",
};

describe("formatPullRequestComment", () => {
  it("renders the product-facing PR report", () => {
    const body = formatPullRequestComment({
      pullRequest,
      impact,
      overview,
      whyPath: {
        targetName: "AdminLogin",
        steps: [
          {
            nodeId: "METHOD:src/auth.service.ts:AuthService.generateToken",
            name: "AuthService.generateToken",
            file: "src/auth.service.ts",
            type: "METHOD",
          },
          {
            nodeId: "METHOD:src/admin-auth.controller.ts:AdminAuthController.login",
            name: "AdminAuthController.login",
            file: "src/admin-auth.controller.ts",
            type: "METHOD",
          },
          {
            nodeId: "API_ROUTE:nestjs:POST:/api/admin/login:src/admin-auth.controller.ts",
            name: "POST /api/admin/login",
            file: "src/admin-auth.controller.ts",
            type: "API_ROUTE",
          },
          {
            nodeId: "FUNCTION:src/adminApi.ts:adminApi",
            name: "adminApi",
            file: "src/adminApi.ts",
            type: "FUNCTION",
          },
          {
            nodeId: "COMPONENT:src/AdminLogin.tsx:AdminLogin",
            name: "AdminLogin",
            file: "src/AdminLogin.tsx",
            type: "COMPONENT",
          },
        ],
      },
      analysisUrl: "http://localhost:3000/acme/app/pull/42",
    });

    expect(body.startsWith(GITIMPACT_COMMENT_MARKER)).toBe(true);
    expect(body).toContain("## GitImpact Analysis");
    expect(body).toContain("**Change Complexity:** 47/100 (Elevated)");
    expect(body).toContain("`AuthService.generateToken`");
    expect(body).toContain("`SessionService.createSession`");
    expect(body).toContain("| Direct dependents | 8 |");
    expect(body).toContain("| Indirect dependents | 17 |");
    expect(body).toContain("| Affected APIs | 3 |");
    expect(body).toContain("| Relevant tests | 6 |");
    expect(body).toContain("| Potential test gaps | 2 |");
    expect(body).toContain("### Why is `AdminLogin` affected?");
    expect(body).toContain("AdminLogin");
    expect(body).toContain("→ adminApi");
    expect(body).toContain("→ POST /api/admin/login");
    expect(body).toContain("→ AdminAuthController.login");
    expect(body).toContain("→ AuthService.generateToken");
    expect(body).toContain("Workbench: http://localhost:3000/acme/app/pull/42");
  });
});
