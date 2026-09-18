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

  it("ignores express imports that only appear in examples", () => {
    const files = [
      file("lib/server.js", { exports: ["Server"] }),
      file("examples/chat/index.js", { imports: ["express"] }),
    ];
    expect(new ExpressAnalyzer().detect(files, { express: "^4.0.0" }, "socket.io")).toBe(
      false,
    );
  });

  it("labels wave-4 libraries from package identity without peer soup", () => {
    expect(detectFrameworkNames([], {}, "zod")).toEqual(["Zod"]);
    expect(detectFrameworkNames([], {}, "solid-js")).toEqual(["Solid"]);
    expect(detectFrameworkNames([], {}, "drizzle-orm")).toEqual(["Drizzle"]);
    expect(detectFrameworkNames([], {}, "bullmq")).toEqual(["BullMQ"]);
    expect(detectFrameworkNames([], {}, "zustand")).toEqual(["Zustand"]);
    expect(detectFrameworkNames([], {}, "lit")).toEqual(["Lit"]);
    expect(
      detectFrameworkNames([], {}, "@remix-run/react", [
        "@remix-run/react",
        "@remix-run/node",
        "@remix-run/express",
      ]),
    ).toContain("Remix");
    expect(
      detectFrameworkNames([], {}, "@trpc/server", ["@trpc/server", "@trpc/client"]),
    ).toEqual(["tRPC"]);
    expect(
      detectFrameworkNames([], {}, "@tanstack/query-core", [
        "@tanstack/query-core",
        "@tanstack/react-query",
      ]),
    ).toEqual(["TanStack Query"]);
    expect(
      detectFrameworkNames([], {}, "payload", ["payload", "@payloadcms/ui"]),
    ).toEqual(["Payload"]);
  });

  it("does not treat @trpc/react-query short-name as TanStack Query", () => {
    expect(
      detectFrameworkNames([], {}, "@trpc/server", [
        "@trpc/server",
        "@trpc/client",
        "@trpc/react-query",
        "@trpc/next",
      ]),
    ).toEqual(["tRPC"]);
  });

  it("does not treat docs-only Next paths as the product stack when identity is zod", () => {
    expect(
      detectFrameworkNames(
        [file("docs/app/api/hello/route.ts", { exports: ["GET"] })],
        {},
        "zod",
        ["zod"],
      ),
    ).toEqual(["Zod"]);
  });

  it("does not treat type-only express imports as Express", () => {
    const files = [
      {
        path: "src/adapters/express.ts",
        language: "typescript" as const,
        imports: [
          {
            moduleSpecifier: "express",
            importedNames: ["Request"],
            namedImports: ["Request"],
            isTypeOnly: true,
          },
        ],
        exports: ["createExpressMiddleware"],
        functions: [],
        classes: [],
        isTest: false,
        envVariables: [],
      },
    ];
    expect(new ExpressAnalyzer().detect(files, {}, "@trpc/server")).toBe(false);
  });

  it("ignores express imports under docs/", () => {
    const files = [
      file("packages/core/index.ts", { exports: ["create"] }),
      file("docs/examples/server.ts", { imports: ["express"] }),
    ];
    expect(new ExpressAnalyzer().detect(files, {}, "zod")).toBe(false);
  });

  it("labels msw by package name without Fastify when Fastify is not a prod dep", () => {
    expect(detectFrameworkNames([], {}, "msw")).toEqual(["MSW"]);
  });

  it("isExpressModuleSpecifier is exact", () => {
    expect(isExpressModuleSpecifier("express")).toBe(true);
    expect(isExpressModuleSpecifier("express/lib/router")).toBe(true);
    expect(isExpressModuleSpecifier("@fastify/express")).toBe(false);
  });

  it("detects Flask from Python imports", () => {
    const files = [
      {
        path: "app.py",
        language: "python" as const,
        imports: [
          {
            moduleSpecifier: "flask",
            namedImports: ["Flask"],
            isTypeOnly: false,
          },
        ],
        exports: ["app"],
        functions: [],
        classes: [],
        isTest: false,
        envVariables: [],
      },
    ];
    expect(detectFrameworkNames(files)).toContain("Flask");
  });

  it("does not label Flask from docs_src when FastAPI dominates", () => {
    const files = [
      {
        path: "fastapi/applications.py",
        language: "python" as const,
        imports: [
          {
            moduleSpecifier: "fastapi",
            namedImports: ["FastAPI"],
            isTypeOnly: false,
          },
        ],
        exports: [],
        functions: [],
        classes: [],
        isTest: false,
        envVariables: [],
      },
      {
        path: "docs_src/wsgi/tutorial001.py",
        language: "python" as const,
        imports: [
          {
            moduleSpecifier: "flask",
            namedImports: ["Flask"],
            isTypeOnly: false,
          },
        ],
        exports: [],
        functions: [],
        classes: [],
        isTest: false,
        envVariables: [],
      },
    ];
    const names = detectFrameworkNames(files);
    expect(names).toContain("FastAPI");
    expect(names).not.toContain("Flask");
  });

  it("extracts Flask decorator routes with handlers", () => {
    const files = [
      {
        path: "app.py",
        language: "python" as const,
        imports: [
          {
            moduleSpecifier: "flask",
            namedImports: ["Flask"],
            isTypeOnly: false,
          },
        ],
        exports: ["login"],
        functions: [
          {
            name: "login",
            startLine: 5,
            endLine: 7,
            exported: true,
            calls: [],
            parameters: [],
          },
        ],
        classes: [],
        isTest: false,
        envVariables: [],
      },
    ];
    const contents = new Map([
      [
        "app.py",
        'from flask import Flask\napp = Flask(__name__)\n\n@app.post("/login")\ndef login():\n    return {}\n',
      ],
    ]);
    const routes = extractAllRoutes(files, contents);
    expect(routes.some((r) => r.method === "POST" && r.path === "/login")).toBe(
      true,
    );
    expect(routes.find((r) => r.path === "/login")?.handlerName).toBe("login");
  });
});
