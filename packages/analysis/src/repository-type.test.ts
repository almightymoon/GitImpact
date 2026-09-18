import { describe, expect, it } from "vitest";
import {
  buildArchitectureSummary,
  detectImportantModules,
  detectInfraSignals,
  detectInventoryLanguages,
  detectRepositoryType,
} from "./repository-type.js";

const GITOPS_PATHS = [
  "README.md",
  "guestbook/guestbook-ui-deployment.yaml",
  "guestbook/guestbook-ui-svc.yaml",
  "helm-guestbook/Chart.yaml",
  "helm-guestbook/templates/deployment.yaml",
  "helm-guestbook/templates/service.yaml",
  "kustomize-guestbook/kustomization.yaml",
  "kustomize-guestbook/guestbook-ui-deployment.yaml",
  "applicationset/list.yaml",
  "applicationset/git.yaml",
  "apps/templates/applications.yaml",
  "apps/Chart.yaml",
  "sock-shop/base/front-end-dep.yaml",
  "sock-shop/base/front-end-svc.yaml",
  "sync-waves/manifests.yaml",
];

describe("detectInfraSignals", () => {
  it("classifies helm, kubernetes, and argocd from path heuristics", () => {
    const signals = detectInfraSignals(GITOPS_PATHS);
    const kinds = new Set(signals.map((s) => s.kind));
    expect(kinds.has("helm")).toBe(true);
    expect(kinds.has("kubernetes")).toBe(true);
    expect(kinds.has("argocd")).toBe(true);
  });

  it("does not treat Expression-like paths as kubernetes", () => {
    const signals = detectInfraSignals(["src/expression-helpers.ts", "docs/readme.md"]);
    expect(signals).toHaveLength(0);
  });
});

describe("detectRepositoryType", () => {
  it("labels yaml-heavy Argo example repos as GITOPS", () => {
    const infra = detectInfraSignals(GITOPS_PATHS);
    const result = detectRepositoryType({
      frameworks: [],
      routes: [],
      files: [],
      filePaths: GITOPS_PATHS,
      infraSignals: infra,
    });
    expect(result.type).toBe("GITOPS");
    expect(result.label).toMatch(/GitOps/i);
  });

  it("labels Python src-layout packages as LIBRARY", () => {
    const result = detectRepositoryType({
      frameworks: [],
      routes: [],
      files: [
        {
          path: "src/requests/__init__.py",
          language: "python",
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          isTest: false,
          envVariables: [],
        },
        {
          path: "src/requests/api.py",
          language: "python",
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          isTest: false,
          envVariables: [],
        },
      ],
      filePaths: ["src/requests/__init__.py", "src/requests/api.py", "pyproject.toml"],
      pythonProject: {
        packageManagers: ["pip"],
        layout: "src",
        manifests: ["pyproject.toml"],
        srcLayout: true,
      },
    });
    expect(result.type).toBe("LIBRARY");
    expect(result.label).toMatch(/Python Library/i);
  });

  it("labels Go modules without HTTP surface as LIBRARY", () => {
    const result = detectRepositoryType({
      frameworks: ["GORM"],
      routes: [],
      files: [
        {
          path: "gorm.go",
          language: "go",
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          isTest: false,
          envVariables: [],
        },
      ],
      filePaths: ["gorm.go", "go.mod"],
    });
    expect(result.type).toBe("LIBRARY");
    expect(result.label).toMatch(/GORM Library|Go Library/i);
  });
});

describe("detectImportantModules", () => {
  it("uses inventory paths when no code files were parsed", () => {
    const modules = detectImportantModules([], [], GITOPS_PATHS);
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.some((m) => m.path === "guestbook" || m.path === "sock-shop")).toBe(
      true,
    );
  });
});

describe("buildArchitectureSummary", () => {
  it("surfaces infra-first story for empty parse surface", () => {
    const infra = detectInfraSignals(GITOPS_PATHS);
    const modules = detectImportantModules([], [], GITOPS_PATHS);
    const languages = detectInventoryLanguages(GITOPS_PATHS);
    const summary = buildArchitectureSummary({
      typeLabel: "GitOps / Infrastructure",
      frameworks: [],
      modules,
      routeCount: 0,
      testCount: 0,
      languages,
      infraSignals: infra,
      codeFileCount: 0,
    });
    expect(summary).toMatch(/GitOps/i);
    expect(summary).toMatch(/Infrastructure focus/i);
    expect(summary).toMatch(/manifests and deploy/i);
    expect(summary).toMatch(/YAML/);
  });
});
