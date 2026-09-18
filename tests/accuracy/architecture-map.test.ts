import { describe, expect, it } from "vitest";
import {
  buildArchitectureMap,
  collectArchitectureArtifacts,
} from "../../packages/analysis/src/architecture-map.js";
import { buildArchitectureExperience } from "../../packages/analysis/src/architecture/experience.js";

describe("architecture map (GitDiagram-style)", () => {
  it("maps MyShelf-like layout into semantic bands with labeled edges", () => {
    const files = [
      "src/main.js",
      "src/models.js",
      "src/lib/api.js",
      "src/lib/db.js",
      "server/src/index.js",
      "server/src/auth.js",
      "server/src/db.js",
      "server/src/storage.js",
      "vite.config.js",
      "index.html",
      "docker-compose.yml",
      "vercel.json",
      "Caddyfile",
      "server/sql/schema.sql",
      "supabase/schema.sql",
      "src/styles.css",
      ".github/workflows/deploy.yml",
    ];
    const artifacts = collectArchitectureArtifacts(files);
    expect(artifacts).toContain("docker-compose.yml");
    expect(artifacts).toContain("index.html");
    expect(artifacts).toContain("vercel.json");
    expect(artifacts).not.toContain("package.json");

    const map = buildArchitectureMap({
      codeFiles: files.filter((f) => /\.(js|ts)$/.test(f)).map((path) => ({ path })),
      artifacts,
    });

    const titles = map.components.map((c) => c.title);
    expect(titles).toContain("Server runtime");
    expect(titles).toContain("Browser application");
    expect(titles).toContain("HTML host");
    expect(titles).toContain("Compose configuration");
    expect(titles).toContain("Hosting configuration");
    expect(titles).toContain("Database service");
    expect(titles).toContain("HTTP consumer");
    expect(titles).toContain("Browser");

    expect(map.components.some((c) => c.band === "deployment")).toBe(true);
    expect(map.components.some((c) => c.band === "client")).toBe(true);
    expect(map.components.some((c) => c.band === "server")).toBe(true);
    expect(map.components.some((c) => c.band === "persistence")).toBe(true);

    const labels = map.edges.map((e) => e.label);
    expect(labels).toContain("addresses");
    expect(labels).toContain("loads");
    expect(labels).toContain("hosts");
    expect(labels).toContain("configures");
    expect(labels).toContain("defines schema for");
  });
});

describe("architecture experience (v0.9.5)", () => {
  const files = [
    "src/main.js",
    "src/models.js",
    "src/lib/api.js",
    "server/src/index.js",
    "server/src/auth.js",
    "server/src/db.js",
    "server/src/storage.js",
    "index.html",
    "docker-compose.yml",
    "vercel.json",
    "Caddyfile",
    "server/sql/schema.sql",
    ".github/workflows/deploy.yml",
  ];

  it("defaults to a small SYSTEM-level set with primary flow and walkthrough", () => {
    const artifacts = collectArchitectureArtifacts(files);
    const experience = buildArchitectureExperience({
      codeFiles: files.filter((f) => /\.(js|ts)$/.test(f)).map((path) => ({ path })),
      artifacts,
      repositoryType: "FULLSTACK",
      routes: [
        {
          id: "r1",
          framework: "express",
          method: "POST",
          path: "/api/login",
          file: "server/src/auth.js",
          confidence: "HIGH",
        },
      ],
      graphNodes: [
        {
          id: "FILE:server/src/auth.js",
          type: "FILE",
          name: "auth.js",
          file: "server/src/auth.js",
        },
        {
          id: "FUNCTION:server/src/auth.js:authenticate",
          type: "FUNCTION",
          name: "authenticate",
          file: "server/src/auth.js",
        },
      ],
    });

    const systems = experience.components.filter((c) => (c.level ?? "SYSTEM") === "SYSTEM");
    expect(systems.length).toBeGreaterThanOrEqual(4);
    // Full SYSTEM cards are kept (no silent "Other modules" collapse) for Structure UX.
    expect(systems.length).toBeLessThanOrEqual(40);

    // Deployment systems stay as separate cards (GitDiagram-style), not one collapsed parent.
    expect(systems.filter((c) => c.band === "deployment").length).toBeGreaterThanOrEqual(1);
    expect(systems.filter((c) => c.band === "deployment").length).toBeLessThanOrEqual(12);

    expect(experience.primaryFlow?.length).toBeGreaterThanOrEqual(2);
    expect(experience.walkthrough?.length).toBeGreaterThanOrEqual(2);
    expect(experience.summary?.primaryFlowLabel).toBeTruthy();
    expect(experience.defaultMode).toBe("architecture");

    const primaryEdges = experience.edges.filter((e) => e.importance === "PRIMARY");
    expect(primaryEdges.length).toBeGreaterThan(0);
    expect(experience.edges.every((e) => e.importance)).toBe(true);
  });

  it("creates COMPONENT/CODE children for drill-down", () => {
    const artifacts = collectArchitectureArtifacts(files);
    const experience = buildArchitectureExperience({
      codeFiles: files.filter((f) => /\.(js|ts)$/.test(f)).map((path) => ({ path })),
      artifacts,
      graphNodes: [
        {
          id: "FILE:server/src/auth.js",
          type: "FILE",
          name: "auth.js",
          file: "server/src/auth.js",
        },
        {
          id: "FUNCTION:server/src/auth.js:authenticate",
          type: "FUNCTION",
          name: "authenticate",
          file: "server/src/auth.js",
        },
        {
          id: "CLASS:server/src/auth.js:AuthService",
          type: "CLASS",
          name: "AuthService",
          file: "server/src/auth.js",
        },
      ],
    });

    const auth = experience.components.find((c) => /auth/i.test(c.title) && c.level === "SYSTEM");
    expect(auth).toBeTruthy();
    if (auth?.childIds?.length) {
      const children = experience.components.filter((c) => auth.childIds!.includes(c.id));
      expect(children.some((c) => c.level === "COMPONENT")).toBe(true);
      const code = experience.components.filter((c) => c.level === "CODE");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("prefers deployment mode for gitops repositories", () => {
    const experience = buildArchitectureExperience({
      codeFiles: [{ path: "server/src/index.js" }],
      artifacts: [".github/workflows/deploy.yml", "Dockerfile", "helm/Chart.yaml"],
      repositoryType: "GITOPS",
    });
    expect(experience.defaultMode).toBe("deployment");
  });
});
