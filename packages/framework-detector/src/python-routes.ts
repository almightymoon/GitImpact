/**
 * Python web framework route extraction (Flask / FastAPI / Django urls).
 * Deterministic regex heuristics — no execution of repo code.
 */
import path from "node:path";
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
  "ALL",
]);

function normalizePath(raw: string): string {
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function findHandlerAfterDecorators(
  lines: string[],
  decoratorLineIndex: number,
): { name: string; line: number } | undefined {
  for (let i = decoratorLineIndex + 1; i < Math.min(lines.length, decoratorLineIndex + 12); i += 1) {
    const line = lines[i]!;
    if (/^\s*@/.test(line)) continue;
    const def = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/.exec(line);
    if (def) return { name: def[1]!, line: i + 1 };
    if (/^\s*(?:class|def|async\s+def)\b/.test(line)) break;
  }
  return undefined;
}

function methodsFromRouteKwargs(callText: string): HttpMethod[] {
  const methods: HttpMethod[] = [];
  const listMatch = /methods\s*=\s*\[([^\]]*)\]/i.exec(callText);
  if (listMatch) {
    for (const m of listMatch[1]!.matchAll(/['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/gi)) {
      const upper = m[1]!.toUpperCase() as HttpMethod;
      if (HTTP_METHODS.has(upper)) methods.push(upper);
    }
  }
  return methods.length ? methods : ["ALL"];
}

export function extractPythonDecoratorRoutes(
  filePath: string,
  content: string,
  framework: "flask" | "fastapi",
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const lines = content.split(/\r?\n/);
  const decoratorRe =
    /^\s*@([A-Za-z_][\w]*)\s*\.\s*(get|post|put|patch|delete|options|head|route|api_route)\s*\((.*)\)\s*$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = decoratorRe.exec(line);
    if (!match) continue;

    const verb = match[2]!.toLowerCase();
    const args = match[3] ?? "";
    const pathMatch = /['"]([^'"]+)['"]/.exec(args);
    if (!pathMatch) continue;
    const routePath = normalizePath(pathMatch[1]!);
    const handler = findHandlerAfterDecorators(lines, index);

    let methods: HttpMethod[];
    if (verb === "route" || verb === "api_route") {
      methods = methodsFromRouteKwargs(args);
    } else {
      methods = [verb.toUpperCase() as HttpMethod];
    }

    for (const method of methods) {
      routes.push({
        id: routeId(framework, method, routePath, filePath),
        framework,
        method,
        path: routePath,
        file: filePath,
        handlerName: handler?.name,
        confidence: handler ? "HIGH" : "MEDIUM",
        startLine: index + 1,
      });
    }
  }

  return routes;
}

/** Map local import aliases in a urls.py to likely module files. */
function resolveDjangoViewModules(
  urlsFile: string,
  content: string,
  knownFiles: Set<string>,
): Map<string, string> {
  const map = new Map<string, string>();
  const dir = path.posix.dirname(urlsFile.replace(/\\/g, "/"));
  const fromImport =
    /^\s*from\s+(\.*[a-zA-Z0-9_.]*)\s+import\s+([A-Za-z_][\w]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = fromImport.exec(content)) !== null) {
    const mod = match[1]!;
    const alias = match[2]!;
    const candidates: string[] = [];
    if (mod === ".") {
      candidates.push(path.posix.join(dir, `${alias}.py`));
    } else if (mod.startsWith(".")) {
      let dots = 0;
      while (mod[dots] === ".") dots += 1;
      let base = dir;
      for (let i = 1; i < dots; i += 1) base = path.posix.dirname(base);
      const rest = mod.slice(dots).replace(/\./g, "/");
      if (rest) {
        candidates.push(path.posix.join(base, `${rest}.py`));
        candidates.push(path.posix.join(base, rest, `${alias}.py`));
      } else {
        candidates.push(path.posix.join(base, `${alias}.py`));
      }
    } else {
      const asPath = mod.replace(/\./g, "/");
      candidates.push(`${asPath}.py`, path.posix.join(asPath, `${alias}.py`));
    }
    for (const c of candidates) {
      const n = path.posix.normalize(c);
      if (knownFiles.has(n)) {
        map.set(alias, n);
        break;
      }
    }
  }
  return map;
}

export function extractDjangoUrlRoutes(
  filePath: string,
  content: string,
  knownFiles: Set<string> = new Set(),
): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const normalized = filePath.replace(/\\/g, "/");
  if (!/(^|\/)urls\.py$/.test(normalized) && !/urlpatterns\s*=/.test(content)) {
    return routes;
  }

  const modules = resolveDjangoViewModules(normalized, content, knownFiles);
  const pattern =
    /\b(?:path|re_path)\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([A-Za-z_][\w.]*)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const rawPath = match[1]!;
    const target = match[2]!;
    if (target === "include") continue;
    const routePath = normalizePath(rawPath.replace(/^\^/, "").replace(/\$$/, ""));
    const parts = target.split(".");
    const root = parts[0]!;
    const leaf = parts[parts.length - 1]!.replace(/\(.*$/, "");
    const handlerFile = modules.get(root);
    const handlerName = parts.length > 1 ? leaf : leaf;

    routes.push({
      id: routeId("django", "ALL", routePath, normalized),
      framework: "django",
      method: "ALL",
      path: routePath,
      file: normalized,
      handlerName,
      handlerFile,
      confidence: handlerFile ? "HIGH" : "MEDIUM",
      startLine: content.slice(0, match.index).split(/\r?\n/).length,
    });
  }

  return routes;
}

export function extractPythonRoutes(
  files: ParsedFile[],
  contents: Map<string, string>,
  frameworks: string[],
): DetectedRoute[] {
  const wantFlask = frameworks.includes("Flask");
  const wantFastapi = frameworks.includes("FastAPI");
  const wantDjango = frameworks.includes("Django");
  const knownFiles = new Set(files.map((f) => f.path.replace(/\\/g, "/")));

  const routes: DetectedRoute[] = [];
  for (const file of files) {
    if (file.language !== "python") continue;
    const content = contents.get(file.path);
    if (!content) continue;

    if (wantFlask || /from\s+flask\b|import\s+flask\b/.test(content)) {
      routes.push(...extractPythonDecoratorRoutes(file.path, content, "flask"));
    }
    if (wantFastapi || /from\s+fastapi\b|import\s+fastapi\b/.test(content)) {
      routes.push(...extractPythonDecoratorRoutes(file.path, content, "fastapi"));
    }
    if (wantDjango || /django|urlpatterns/.test(content)) {
      routes.push(...extractDjangoUrlRoutes(file.path, content, knownFiles));
    }
  }

  return routes;
}
