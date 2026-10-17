/**
 * Java / Rust / C# HTTP route heuristics (Spring, axum, ASP.NET).
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

function normalizePath(raw: string): string {
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

/** Spring: @GetMapping("/users") public String listUsers() */
export function extractSpringRoutes(
  filePath: string,
  content: string,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const mapping =
    /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'][^)]*\))?/g;
  let match: RegExpExecArray | null;
  while ((match = mapping.exec(content)) !== null) {
    const verb = match[1] === "Request" ? "ALL" : match[1]!.toUpperCase();
    const pathName = normalizePath(match[2] ?? "/");
    const method = (verb === "ALL" ? "ALL" : verb) as HttpMethod;
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const methodMatch =
      /\b(?:public|protected|private)\s+(?:static\s+)?(?:[\w.<>[\]]+)\s+(\w+)\s*\(/.exec(
        after,
      );
    const classMatch = /\bclass\s+(\w+)/.exec(content.slice(0, match.index));
    routes.push({
      id: routeId("spring", method, pathName, filePath),
      framework: "spring",
      method,
      path: pathName,
      file: filePath,
      handlerName: methodMatch?.[1],
      handlerClass: classMatch?.[1],
      handlerFile: filePath,
      confidence: "MEDIUM",
      startLine: lineOf(content, match.index),
    });
  }
  return routes;
}

/** axum: .route("/users", get(list_users)) */
export function extractAxumRoutes(
  filePath: string,
  content: string,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const re =
    /\.route\s*\(\s*["']([^"']+)["']\s*,\s*(get|post|put|patch|delete)\s*\(\s*([A-Za-z_][\w]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const method = match[2]!.toUpperCase() as HttpMethod;
    const pathName = normalizePath(match[1]!);
    routes.push({
      id: routeId("axum", method, pathName, filePath),
      framework: "axum",
      method,
      path: pathName,
      file: filePath,
      handlerName: match[3],
      handlerFile: filePath,
      confidence: "MEDIUM",
      startLine: lineOf(content, match.index),
    });
  }
  return routes;
}

/** ASP.NET: [HttpGet("users")] or MapGet("/users", ...) */
export function extractAspNetRoutes(
  filePath: string,
  content: string,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const attr =
    /\[Http(Get|Post|Put|Patch|Delete)\s*(?:\(\s*["']([^"']+)["']\s*\))?\]/g;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(content)) !== null) {
    const method = match[1]!.toUpperCase() as HttpMethod;
    const pathName = normalizePath(match[2] ?? "/");
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 300);
    const methodMatch =
      /\b(?:public|private|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:[\w.<>[\]]+)\s+(\w+)\s*\(/.exec(
        after,
      );
    const classMatch = /\b(?:class|record)\s+(\w+)/.exec(content.slice(0, match.index));
    routes.push({
      id: routeId("aspnet", method, pathName, filePath),
      framework: "aspnet",
      method,
      path: pathName,
      file: filePath,
      handlerName: methodMatch?.[1],
      handlerClass: classMatch?.[1],
      handlerFile: filePath,
      confidence: "MEDIUM",
      startLine: lineOf(content, match.index),
    });
  }
  const mapRe =
    /\bMap(Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)["']\s*,\s*(?:\(\)\s*=>\s*)?([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?/g;
  while ((match = mapRe.exec(content)) !== null) {
    const method = match[1]!.toUpperCase() as HttpMethod;
    const pathName = normalizePath(match[2]!);
    const typeOrFn = match[3]!;
    const member = match[4];
    routes.push({
      id: routeId("aspnet-minimal", method, pathName, filePath),
      framework: "aspnet",
      method,
      path: pathName,
      file: filePath,
      handlerName: member ?? typeOrFn,
      handlerClass: member ? typeOrFn : undefined,
      handlerFile: filePath,
      confidence: "MEDIUM",
      startLine: lineOf(content, match.index),
    });
  }
  return routes;
}

export function detectJvmishFrameworkNames(files: ParsedFile[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    const imports = file.imports.map((i) => i.moduleSpecifier).join("\n");
    if (file.language === "java" && /springframework|spring\.web/i.test(imports)) {
      names.add("Spring");
    }
    if (file.language === "rust") {
      if (imports.includes("axum")) names.add("Axum");
      if (imports.includes("actix_web") || imports.includes("actix-web")) {
        names.add("Actix");
      }
    }
  }
  const csharpHint = files.some(
    (f) =>
      f.language === "csharp" &&
      (f.path.endsWith("Program.cs") ||
        f.imports.some((i) => /AspNetCore/i.test(i.moduleSpecifier))),
  );
  if (csharpHint) names.add("ASP.NET");
  return [...names];
}

function classFileIndex(files: ParsedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    for (const cls of file.classes) {
      map.set(cls.name, file.path);
    }
  }
  return map;
}

export function extractJvmishRoutes(
  files: ParsedFile[],
  contents: Map<string, string>,
  frameworkNames: string[],
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const wantSpring = frameworkNames.includes("Spring");
  const wantAxum = frameworkNames.includes("Axum");
  const wantAsp = frameworkNames.includes("ASP.NET");
  const classFiles = classFileIndex(files);

  for (const file of files) {
    const content = contents.get(file.path);
    if (!content) continue;
    if (
      file.language === "java" &&
      (wantSpring || /@(Get|Post|Put|Patch|Delete|Request)Mapping/.test(content))
    ) {
      routes.push(...extractSpringRoutes(file.path, content));
    }
    if (file.language === "rust" && (wantAxum || /\.route\s*\(/.test(content))) {
      routes.push(...extractAxumRoutes(file.path, content));
    }
    if (
      file.language === "csharp" &&
      (wantAsp || /\[Http(Get|Post)|Map(Get|Post)/.test(content))
    ) {
      for (const route of extractAspNetRoutes(file.path, content)) {
        if (route.handlerClass && classFiles.has(route.handlerClass)) {
          route.handlerFile = classFiles.get(route.handlerClass);
        }
        routes.push(route);
      }
    }
  }
  return routes;
}
