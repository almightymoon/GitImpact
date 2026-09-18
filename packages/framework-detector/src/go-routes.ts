/**
 * Go HTTP framework route extraction (Echo / Gin / Chi).
 * Deterministic regex heuristics — no execution of repo code.
 */
import type { DetectedRoute, HttpMethod, ParsedFile } from "@gitimpact/shared";

function routeId(
  framework: string,
  method: string,
  pathName: string,
  file: string,
): string {
  return `API_ROUTE:${framework}:${method}:${pathName}:${file}`;
}

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "ANY",
  "ALL",
]);

function normalizePath(raw: string): string {
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function isPrimaryGo(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    !/(^|\/)(_?examples?|tests?|spec|docs?(?:_src)?|documentation|demos?|samples?|benchmarks?|fixtures?|_test)\//i.test(
      normalized,
    ) && !/_test\.go$/i.test(normalized)
  );
}

function resolveHandlerFile(
  file: ParsedFile,
  packageAlias: string | undefined,
): string | undefined {
  if (!packageAlias) return file.path;
  for (const imp of file.imports) {
    if (imp.namedImports.includes(packageAlias) && imp.resolvedPath) {
      return imp.resolvedPath;
    }
  }
  return undefined;
}

/**
 * Echo: e.GET("/users", getUsers) or e.GET("/users", handlers.ListUsers)
 * Gin:  r.POST("/orders", createOrder)
 * Chi:  r.Get("/…", handler)  (method title-case)
 */
export function extractGoHttpRoutes(
  filePath: string,
  content: string,
  framework: "echo" | "gin" | "chi",
  parsedFile?: ParsedFile,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const re =
    /\b\w+\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ANY|CONNECT|TRACE|Get|Post|Put|Patch|Delete|Options|Head|Connect|Trace|Method)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:([A-Za-z_][\w]*)\.)?([A-Za-z_][\w]*)/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    let verb = match[1]!;
    if (verb === "Method") continue;
    if (verb === "ANY" || verb === "Any") verb = "ALL";
    const upper = verb.toUpperCase();
    if (!HTTP_METHODS.has(upper) && upper !== "CONNECT" && upper !== "TRACE") {
      continue;
    }
    const method = (upper === "CONNECT" || upper === "TRACE" ? "ALL" : upper) as HttpMethod;
    const routePath = normalizePath(match[2]!);
    const pkgAlias = match[3];
    const handlerName = match[4]!;
    const startLine = content.slice(0, match.index).split(/\r?\n/).length;
    const handlerFile = parsedFile
      ? resolveHandlerFile(parsedFile, pkgAlias) ?? filePath
      : filePath;

    routes.push({
      id: routeId(framework, method, routePath, filePath),
      framework,
      method,
      path: routePath,
      file: filePath,
      handlerName,
      handlerFile,
      confidence: "HIGH",
      startLine,
    });
  }

  if (framework === "chi") {
    const methodRe =
      /\b\w+\.Method\s*\(\s*["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]\s*,\s*["'`]([^"'`]+)["'`]\s*,\s*(?:([A-Za-z_][\w]*)\.)?([A-Za-z_][\w]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = methodRe.exec(content)) !== null) {
      const method = m[1]!.toUpperCase() as HttpMethod;
      const routePath = normalizePath(m[2]!);
      const pkgAlias = m[3];
      const handlerName = m[4]!;
      const startLine = content.slice(0, m.index).split(/\r?\n/).length;
      const handlerFile = parsedFile
        ? resolveHandlerFile(parsedFile, pkgAlias) ?? filePath
        : filePath;
      routes.push({
        id: routeId(framework, method, routePath, filePath),
        framework,
        method,
        path: routePath,
        file: filePath,
        handlerName,
        handlerFile,
        confidence: "HIGH",
        startLine,
      });
    }
  }

  return routes;
}

function detectGoFrameworksFromImports(files: ParsedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    if (file.language !== "go" || !isPrimaryGo(file.path)) continue;
    for (const imp of file.imports) {
      const m = imp.moduleSpecifier.toLowerCase();
      if (m.includes("labstack/echo")) names.add("Echo");
      if (m.includes("gin-gonic/gin")) names.add("Gin");
      if (m.includes("go-chi/chi") || m.endsWith("/chi") || m.includes("/chi/v5")) {
        names.add("Chi");
      }
      if (m.includes("spf13/cobra")) names.add("Cobra");
      if (m.includes("gorm.io/gorm") || m.includes("jinzhu/gorm")) names.add("GORM");
    }
  }
  return names;
}

export function extractGoRoutes(
  files: ParsedFile[],
  contents: Map<string, string>,
  frameworkNames: string[] = [],
): DetectedRoute[] {
  const detected = detectGoFrameworksFromImports(files);
  for (const n of frameworkNames) {
    if (/echo/i.test(n)) detected.add("Echo");
    if (/^gin$/i.test(n) || /gin-gonic/i.test(n)) detected.add("Gin");
    if (/chi/i.test(n)) detected.add("Chi");
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  const routes: DetectedRoute[] = [];
  for (const file of files) {
    if (file.language !== "go" || !isPrimaryGo(file.path)) continue;
    const content = contents.get(file.path);
    if (!content) continue;
    const parsed = byPath.get(file.path);

    const hasEcho =
      detected.has("Echo") ||
      file.imports.some((i) => i.moduleSpecifier.includes("labstack/echo"));
    const hasGin =
      detected.has("Gin") ||
      file.imports.some((i) => i.moduleSpecifier.includes("gin-gonic/gin"));
    const hasChi =
      detected.has("Chi") ||
      file.imports.some(
        (i) =>
          i.moduleSpecifier.includes("go-chi/chi") ||
          /\/chi(\/|$)/.test(i.moduleSpecifier),
      );

    if (hasEcho && file.imports.some((i) => i.moduleSpecifier.includes("labstack/echo"))) {
      routes.push(...extractGoHttpRoutes(file.path, content, "echo", parsed));
    } else if (
      hasGin &&
      file.imports.some((i) => i.moduleSpecifier.includes("gin-gonic/gin"))
    ) {
      routes.push(...extractGoHttpRoutes(file.path, content, "gin", parsed));
    } else if (hasChi) {
      routes.push(...extractGoHttpRoutes(file.path, content, "chi", parsed));
    } else if (hasEcho) {
      routes.push(...extractGoHttpRoutes(file.path, content, "echo", parsed));
    } else if (hasGin) {
      routes.push(...extractGoHttpRoutes(file.path, content, "gin", parsed));
    }
  }

  return routes;
}

export function detectGoFrameworkNames(files: ParsedFile[]): string[] {
  return [...detectGoFrameworksFromImports(files)];
}
