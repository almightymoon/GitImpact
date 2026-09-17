import type { DetectedRoute, HttpMethod, ParsedFile } from "@gitimpact/shared";

export interface FrameworkAnalyzer {
  name: string;
  detect(files: ParsedFile[], packageDeps?: Record<string, string>): boolean;
  extractRoutes(files: ParsedFile[], contents?: Map<string, string>): DetectedRoute[];
}

const NEXT_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

function routeId(framework: string, method: string, path: string, file: string): string {
  return `API_ROUTE:${framework}:${method}:${path}:${file}`;
}

/** app/api/users/[id]/route.ts → /api/users/:id */
export function nextAppRoutePathFromFile(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)app\/(api\/.+)\/route\.(ts|tsx|js|jsx)$/);
  if (!match) return null;
  const segments = match[1].split("/").map((segment) => {
    const optionalCatch = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optionalCatch) return `:${optionalCatch[1]}*`;
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) return `:${catchAll[1]}*`;
    const dynamic = segment.match(/^\[(.+)\]$/);
    if (dynamic) return `:${dynamic[1]}`;
    return segment;
  });
  return `/${segments.join("/")}`;
}

/** pages/api/users/[id].ts → /api/users/:id */
export function nextPagesApiPathFromFile(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)pages\/(api\/.+)\.(ts|tsx|js|jsx)$/);
  if (!match) return null;
  const withoutIndex = match[1].replace(/\/index$/, "");
  const segments = withoutIndex.split("/").map((segment) => {
    const optionalCatch = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optionalCatch) return `:${optionalCatch[1]}*`;
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) return `:${catchAll[1]}*`;
    const dynamic = segment.match(/^\[(.+)\]$/);
    if (dynamic) return `:${dynamic[1]}`;
    return segment;
  });
  return `/${segments.join("/")}`;
}

function methodsFromExports(file: ParsedFile): HttpMethod[] {
  const methods = file.exports
    .map((name) => name.toUpperCase())
    .filter((name): name is HttpMethod => NEXT_METHODS.has(name));
  if (methods.length > 0) return methods;

  // Common pages/api default export — treat as ALL
  if (file.exports.includes("default") || /pages\/api\//.test(file.path)) {
    return ["ALL"];
  }
  return ["ALL"];
}

export class NextJSAnalyzer implements FrameworkAnalyzer {
  name = "Next.js";

  detect(files: ParsedFile[], packageDeps: Record<string, string> = {}): boolean {
    if (packageDeps.next) return true;
    return files.some(
      (file) =>
        Boolean(nextAppRoutePathFromFile(file.path)) ||
        Boolean(nextPagesApiPathFromFile(file.path)),
    );
  }

  extractRoutes(files: ParsedFile[]): DetectedRoute[] {
    const routes: DetectedRoute[] = [];

    for (const file of files) {
      const appPath = nextAppRoutePathFromFile(file.path);
      if (appPath) {
        for (const method of methodsFromExports(file)) {
          routes.push({
            id: routeId("nextjs", method, appPath, file.path),
            framework: "nextjs",
            method,
            path: appPath,
            file: file.path,
            handlerName: method === "ALL" ? "default" : method,
            confidence: "HIGH",
          });
        }
        continue;
      }

      const pagesPath = nextPagesApiPathFromFile(file.path);
      if (pagesPath) {
        routes.push({
          id: routeId("nextjs", "ALL", pagesPath, file.path),
          framework: "nextjs",
          method: "ALL",
          path: pagesPath,
          file: file.path,
          handlerName: "default",
          confidence: "HIGH",
        });
      }
    }

    return routes;
  }
}

const EXPRESS_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all",
  "use",
] as const;

export function extractExpressRoutesFromContent(
  filePath: string,
  content: string,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const lines = content.split(/\r?\n/);

  // app.get('/path'), router.post("/path"), authRouter.get(`/health`), etc.
  const pattern =
    /\b[A-Za-z_$][\w$]*\s*\.\s*(get|post|put|patch|delete|options|head|all|use)\s*\(\s*(['"`])(\/[^'"`]*|\*[^'"`]*)\2/gi;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1].toUpperCase() as HttpMethod;
      const routePath = match[3];
      routes.push({
        id: routeId("express", method, routePath, filePath),
        framework: "express",
        method,
        path: routePath,
        file: filePath,
        handlerName: match[1],
        confidence: "HIGH",
        startLine: index + 1,
      });
    }
  }

  // .route('/x').get(...)
  const chained =
    /\.route\s*\(\s*(['"`])([^'"`]+)\1\s*\)\s*\.\s*(get|post|put|patch|delete|all)\s*\(/gi;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    chained.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = chained.exec(line)) !== null) {
      const routePath = match[2];
      const method = match[3].toUpperCase() as HttpMethod;
      routes.push({
        id: routeId("express", method, routePath, filePath),
        framework: "express",
        method,
        path: routePath,
        file: filePath,
        handlerName: match[3],
        confidence: "HIGH",
        startLine: index + 1,
      });
    }
  }

  return routes;
}

export class ExpressAnalyzer implements FrameworkAnalyzer {
  name = "Express";

  detect(files: ParsedFile[], packageDeps: Record<string, string> = {}): boolean {
    if (packageDeps.express) return true;
    return files.some((file) =>
      /express|Router\(|app\.(get|post|use)\(/i.test(
        [...file.imports.map((i) => i.moduleSpecifier), ...file.exports].join(" "),
      ),
    );
  }

  extractRoutes(
    files: ParsedFile[],
    contents: Map<string, string> = new Map(),
  ): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    for (const file of files) {
      const content = contents.get(file.path);
      if (!content) continue;
      if (
        !/express|Router\(|\.(get|post|put|patch|delete|use)\s*\(/i.test(content)
      ) {
        continue;
      }
      routes.push(...extractExpressRoutesFromContent(file.path, content));
    }
    return routes;
  }
}

export class NestJSAnalyzer implements FrameworkAnalyzer {
  name = "NestJS";

  detect(files: ParsedFile[], packageDeps: Record<string, string> = {}): boolean {
    if (packageDeps["@nestjs/core"] || packageDeps["@nestjs/common"]) return true;
    return files.some((file) =>
      file.classes.some(
        (cls) =>
          cls.decorators?.some((d) => d.name === "Controller" || d.name === "Injectable") ||
          cls.methods.some((m) =>
            m.decorators?.some((d) =>
              ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"].includes(d.name),
            ),
          ),
      ),
    );
  }

  extractRoutes(files: ParsedFile[]): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const http = new Set(["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]);

    for (const file of files) {
      for (const cls of file.classes) {
        const controller = cls.decorators?.find((d) => d.name === "Controller");
        if (!controller) continue;
        const prefix = (controller.args[0] ?? "").replace(/^\//, "");

        for (const method of cls.methods) {
          for (const decorator of method.decorators ?? []) {
            if (!http.has(decorator.name)) continue;
            const suffix = (decorator.args[0] ?? "").replace(/^\//, "");
            const segments = [prefix, suffix].filter(Boolean);
            const routePath = `/${segments.join("/")}`;
            const httpMethod = decorator.name.toUpperCase() as HttpMethod;
            routes.push({
              id: routeId("nestjs", httpMethod, routePath, file.path),
              framework: "nestjs",
              method: httpMethod,
              path: routePath,
              file: file.path,
              handlerName: method.name,
              handlerClass: cls.name,
              confidence: "HIGH",
              startLine: method.startLine,
            });
          }
        }
      }
    }

    return routes;
  }
}

export function detectFrameworkNames(
  files: ParsedFile[],
  packageDeps: Record<string, string> = {},
): string[] {
  const names: string[] = [];
  const next = new NextJSAnalyzer();
  const express = new ExpressAnalyzer();
  const nest = new NestJSAnalyzer();
  if (next.detect(files, packageDeps)) names.push("Next.js");
  if (express.detect(files, packageDeps)) names.push("Express");
  if (nest.detect(files, packageDeps)) names.push("NestJS");
  if (packageDeps.react && !names.includes("Next.js")) names.push("React");
  if (packageDeps.fastify) names.push("Fastify");
  if (packageDeps.prisma || packageDeps["@prisma/client"]) names.push("Prisma");
  if (packageDeps["drizzle-orm"]) names.push("Drizzle");
  return [...new Set(names)];
}

export function extractAllRoutes(
  files: ParsedFile[],
  contents: Map<string, string> = new Map(),
  packageDeps: Record<string, string> = {},
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const next = new NextJSAnalyzer();
  const express = new ExpressAnalyzer();
  const nest = new NestJSAnalyzer();

  if (next.detect(files, packageDeps)) {
    routes.push(...next.extractRoutes(files));
  }
  if (express.detect(files, packageDeps) || contents.size > 0) {
    const expressRoutes = express.extractRoutes(files, contents);
    if (expressRoutes.length > 0 || express.detect(files, packageDeps)) {
      routes.push(...expressRoutes);
    }
  }
  if (nest.detect(files, packageDeps)) {
    routes.push(...nest.extractRoutes(files));
  }

  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.id)) return false;
    seen.add(route.id);
    return true;
  });
}

export { EXPRESS_METHODS };
