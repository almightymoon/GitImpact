import { describe, expect, it } from "vitest";
import { buildArchitectureMap, detectWorkspacePackages } from "./architecture-map.js";
import { buildArchitectureExperience } from "./architecture/experience.js";

describe("detectWorkspacePackages", () => {
  it("finds apps and packages roots", () => {
    const pkgs = detectWorkspacePackages([
      "apps/web/src/page.tsx",
      "apps/api/src/main.ts",
      "packages/ui/button.tsx",
      "packages/auth/index.ts",
      "README.md",
    ]);
    expect(pkgs.map((p) => p.root).sort()).toEqual([
      "apps/api",
      "apps/web",
      "packages/auth",
      "packages/ui",
    ]);
    expect(pkgs.find((p) => p.root === "apps/web")?.kind).toBe("app");
    expect(pkgs.find((p) => p.root === "packages/ui")?.kind).toBe("package");
  });
});

describe("monorepo architecture systems", () => {
  it("creates one system per workspace package instead of a flat runtime", () => {
    const map = buildArchitectureMap({
      codeFiles: [
        { path: "apps/web/src/App.tsx", type: "FILE" },
        { path: "apps/api/src/server.ts", type: "CONTROLLER" },
        { path: "packages/ui/Button.tsx", type: "FILE" },
        { path: "packages/database/client.ts", type: "FILE" },
      ],
    });
    const titles = map.components.map((c) => c.title);
    expect(titles).toContain("Web");
    expect(titles).toContain("Api");
    expect(titles).toContain("Ui");
    expect(titles).toContain("Database");
    expect(titles).not.toContain("Server runtime");
    expect(map.narrative.some((n) => /Monorepo/i.test(n))).toBe(true);
  });

  it("wires cross-package edges from import/call graph", () => {
    const experience = buildArchitectureExperience({
      codeFiles: [
        { path: "apps/web/src/App.tsx" },
        { path: "packages/ui/Button.tsx" },
        { path: "apps/api/src/server.ts" },
      ],
      graphNodes: [
        {
          id: "FILE:apps/web/src/App.tsx",
          type: "FILE",
          name: "App.tsx",
          file: "apps/web/src/App.tsx",
        },
        {
          id: "FILE:packages/ui/Button.tsx",
          type: "FILE",
          name: "Button.tsx",
          file: "packages/ui/Button.tsx",
        },
        {
          id: "FILE:apps/api/src/server.ts",
          type: "FILE",
          name: "server.ts",
          file: "apps/api/src/server.ts",
        },
      ],
      graphEdges: [
        {
          id: "e1",
          from: "FILE:apps/web/src/App.tsx",
          to: "FILE:packages/ui/Button.tsx",
          type: "IMPORTS",
          confidence: "HIGH",
        },
        {
          id: "e2",
          from: "FILE:apps/web/src/App.tsx",
          to: "FILE:apps/api/src/server.ts",
          type: "CALLS",
          confidence: "MEDIUM",
        },
      ],
    });
    const systems = experience.components.filter((c) => c.level === "SYSTEM");
    const web = systems.find((c) => c.title === "Web");
    const ui = systems.find((c) => c.title === "Ui");
    const api = systems.find((c) => c.title === "Api");
    expect(web && ui && api).toBeTruthy();
    expect(
      experience.edges.some((e) => e.from === web!.id && e.to === ui!.id && e.label === "uses"),
    ).toBe(true);
    expect(
      experience.edges.some((e) => e.from === web!.id && e.to === api!.id && e.label === "calls"),
    ).toBe(true);
  });
});
