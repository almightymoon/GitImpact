import { describe, expect, it } from "vitest";
import type { ParsedFile } from "@gitimpact/shared";
import {
  ExpressAnalyzer,
  detectFrameworkNames,
  extractAllRoutes,
  isExpressModuleSpecifier,
} from "./index.js";

function file(
  path: string,
  opts: { imports?: string[]; exports?: string[] } = {},
): ParsedFile {
  return {
    path,
    language: "typescript",
    imports: (opts.imports ?? []).map((moduleSpecifier) => ({
      moduleSpecifier,
      importedNames: [],
      namedImports: [],
      isTypeOnly: false,
    })),
    exports: opts.exports ?? [],
    functions: [],
    classes: [],
    isTest: false,
    envVariables: [],
  };
}

describe("Express detection", () => {
  it("does not match Expression-like export names", () => {
    const files = [
      file("types/utils.d.ts", {
        exports: ["RawRequestDefaultExpression", "FastifyRouterOptions"],
      }),
    ];
    expect(new ExpressAnalyzer().detect(files, {}, "fastify")).toBe(false);
    expect(detectFrameworkNames(files, { fastify: "5.0.0" }, "fastify")).toEqual([
      "Fastify",
    ]);
  });

  it("ignores express imports that only appear in tests", () => {
    const files = [
      file("lib/client.ts", { exports: ["create"] }),
      file("tests/unit/adapters/http.test.js", { imports: ["express"] }),
    ];
    expect(new ExpressAnalyzer().detect(files, { express: "^5.0.0" }, "axios")).toBe(
      false,
    );
    expect(detectFrameworkNames(files, { express: "^5.0.0" }, "axios")).toEqual([]);
  });

  it("detects the express package itself by name", () => {
    const files = [file("lib/application.js", { exports: ["createApplication"] })];
    expect(new ExpressAnalyzer().detect(files, {}, "express")).toBe(true);
    expect(detectFrameworkNames(files, {}, "express")).toContain("Express");
  });

  it("detects production imports of express", () => {
    const files = [file("src/app.ts", { imports: ["express"] })];
    expect(new ExpressAnalyzer().detect(files, {}, "my-api")).toBe(true);
  });

  it("does not scrape Fastify .get('/x') as Express routes without Express", () => {
    const files = [file("server.ts", { imports: ["fastify"] })];
    const contents = new Map([
      ["server.ts", "const app = fastify();\napp.get('/health', () => 'ok');\n"],
    ]);
    const routes = extractAllRoutes(files, contents, { fastify: "5.0.0" }, "fastify");
    expect(routes.every((r) => r.framework !== "express")).toBe(true);
  });

  it("isExpressModuleSpecifier is exact", () => {
    expect(isExpressModuleSpecifier("express")).toBe(true);
    expect(isExpressModuleSpecifier("express/lib/router")).toBe(true);
    expect(isExpressModuleSpecifier("@fastify/express")).toBe(false);
  });
});
