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

/** Spring: @GetMapping("/users") */
export function extractSpringRoutes(
  filePath: string,
  content: string,
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const mapping =
    /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?/g;
  let match: RegExpExecArray | null;
  while ((match = mapping.exec(content)) !== null) {
    const verb = match[1] === "Request" ? "ALL" : match[1]!.toUpperCase();
    const pathName = normalizePath(match[2] ?? "/");
    const method = (verb === "ALL" ? "ALL" : verb) as HttpMethod;
    routes.push({
      id: routeId("spring", method, pathName, filePath),
      framework: "spring",
      method,
      path: pathName,
      file: filePath,
      confidence: "MEDIUM",
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
      confidence: "MEDIUM",
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
    routes.push({
      id: routeId("aspnet", method, pathName, filePath),
      framework: "aspnet",
      method,
      path: pathName,
      file: filePath,
      confidence: "MEDIUM",
    });
  }
  const mapRe =
    /\bMap(Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)["']/g;
  while ((match = mapRe.exec(content)) !== null) {
    const method = match[1]!.toUpperCase() as HttpMethod;
    const pathName = normalizePath(match[2]!);
    routes.push({
      id: routeId("aspnet-minimal", method, pathName, filePath),
      framework: "aspnet",
      method,
      path: pathName,
      file: filePath,
      confidence: "MEDIUM",
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

export function extractJvmishRoutes(
  files: ParsedFile[],
  contents: Map<string, string>,
  frameworkNames: string[],
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const wantSpring = frameworkNames.includes("Spring");
  const wantAxum = frameworkNames.includes("Axum");
  const wantAsp = frameworkNames.includes("ASP.NET");

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
      routes.push(...extractAspNetRoutes(file.path, content));
    }
  }
  return routes;
}
