/**
 * Deterministic Python surface parser (no ML).
 * Extracts imports, defs/classes, and simple call sites for the impact graph.
 */
import path from "node:path";
import type {
  ParsedClass,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  ParsedMethod,
  ResolvedCall,
} from "@gitimpact/shared";

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function stripCommentsAndStrings(content: string): string {
  // Best-effort: remove # comments and simple string literals so defs aren't matched inside them.
  return content
    .replace(/('''[\s\S]*?'''|"""[\s\S]*?""")/g, (m) => " ".repeat(m.length))
    .replace(/(#.*?$)/gm, (m) => " ".repeat(m.length))
    .replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/g, (m) => " ".repeat(m.length));
}

function resolvePythonImport(
  fromFile: string,
  moduleSpecifier: string,
  knownFiles: Set<string>,
  isFromImport: boolean,
  importedName?: string,
): string | undefined {
  const fromDir = path.posix.dirname(fromFile.replace(/\\/g, "/"));

  // Relative: from .foo import bar / from ..pkg import x / import .local
  if (moduleSpecifier.startsWith(".")) {
    let dots = 0;
    while (moduleSpecifier[dots] === ".") dots += 1;
    const rest = moduleSpecifier.slice(dots).replace(/\./g, "/");
    let base = fromDir;
    for (let i = 1; i < dots; i += 1) {
      base = path.posix.dirname(base);
    }
    const candidates = [
      rest ? path.posix.join(base, `${rest}.py`) : undefined,
      rest ? path.posix.join(base, rest, "__init__.py") : undefined,
      rest && importedName
        ? path.posix.join(base, rest, `${importedName}.py`)
        : undefined,
      !rest && importedName ? path.posix.join(base, `${importedName}.py`) : undefined,
      !rest ? path.posix.join(base, "__init__.py") : undefined,
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      const normalized = path.posix.normalize(c);
      if (knownFiles.has(normalized)) return normalized;
    }
    return undefined;
  }

  // Absolute-within-repo style: package.module → package/module.py
  const asPath = moduleSpecifier.replace(/\./g, "/");
  const candidates = [
    `${asPath}.py`,
    path.posix.join(asPath, "__init__.py"),
    importedName ? path.posix.join(asPath, `${importedName}.py`) : undefined,
    // same-directory fallback for flat layouts
    path.posix.join(fromDir, `${asPath}.py`),
    path.posix.join(fromDir, asPath, "__init__.py"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const normalized = path.posix.normalize(c);
    if (knownFiles.has(normalized)) return normalized;
  }
  // Ignore third-party (flask, fastapi, …)
  void isFromImport;
  return undefined;
}

function extractImports(
  content: string,
  filePath: string,
  knownFiles: Set<string>,
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const seen = new Set<string>();

  const importRe = /^\s*import\s+([a-zA-Z0-9_.,\s]+?)(?:\s+as\s+\w+)?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const parts = match[1].split(",").map((p) => p.trim().split(/\s+as\s+/)[0]!.trim());
    for (const moduleSpecifier of parts) {
      if (!moduleSpecifier || seen.has(`i:${moduleSpecifier}`)) continue;
      seen.add(`i:${moduleSpecifier}`);
      imports.push({
        moduleSpecifier,
        namedImports: [],
        isTypeOnly: false,
        resolvedPath: resolvePythonImport(filePath, moduleSpecifier, knownFiles, false),
      });
    }
  }

  const fromRe =
    /^\s*from\s+(\.*[a-zA-Z0-9_.]*)\s+import\s+\(?([\s\S]*?)\)?\s*$/gm;
  while ((match = fromRe.exec(content)) !== null) {
    const moduleSpecifier = match[1]!;
    const namesRaw = match[2]!;
    if (namesRaw.includes("\n") && !match[0].includes("(")) {
      // Avoid over-matching; only single-line or parenthesized
    }
    const namedImports: string[] = [];
    const aliases: Record<string, string> = {};
    for (const part of namesRaw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "*") continue;
      const asParts = trimmed.split(/\s+as\s+/);
      const exported = asParts[0]!.trim();
      const local = (asParts[1] ?? asParts[0]!).trim();
      if (!/^[a-zA-Z_][\w]*$/.test(local)) continue;
      namedImports.push(local);
      if (local !== exported && /^[a-zA-Z_][\w]*$/.test(exported)) {
        aliases[local] = exported;
      }
    }
    const key = `f:${moduleSpecifier}:${namedImports.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push({
      moduleSpecifier,
      namedImports,
      aliases: Object.keys(aliases).length ? aliases : undefined,
      isTypeOnly: false,
      resolvedPath: resolvePythonImport(
        filePath,
        moduleSpecifier,
        knownFiles,
        true,
        Object.values(aliases)[0] ?? namedImports[0],
      ),
    });
  }

  return imports;
}

function extractEnvVariables(content: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /os\.environ\[['\"]([A-Z0-9_]+)['\"]\]/g,
    /os\.environ\.get\(['\"]([A-Z0-9_]+)['\"]/g,
    /os\.getenv\(['\"]([A-Z0-9_]+)['\"]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      found.add(match[1]!);
    }
  }
  return [...found];
}

function collectCallsInRange(
  content: string,
  start: number,
  end: number,
  knownNames: Set<string>,
): ResolvedCall[] {
  const slice = content.slice(start, end);
  const calls: ResolvedCall[] = [];
  const seen = new Set<string>();
  // name(...) or obj.name(...) — skip def/class keywords
  const callRe = /(?<![\w.])([A-Za-z_][\w]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(slice)) !== null) {
    const name = match[1]!;
    if (
      /^(if|for|while|elif|return|print|len|str|int|list|dict|set|range|super|type|isinstance|enumerate|zip|map|filter|min|max|sum|open|Exception)$/.test(
        name,
      )
    ) {
      continue;
    }
    const absIndex = start + match.index;
    const key = `${name}@${absIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = knownNames.has(name);
    calls.push({
      calleeName: name,
      resolvedKind: resolved ? "FUNCTION" : "UNRESOLVED",
      resolvedSymbol: resolved ? name : undefined,
      confidence: resolved ? "MEDIUM" : "LOW",
      startLine: lineOf(content, absIndex),
    });
  }
  // self.method(...)
  const methodRe = /\bself\.([A-Za-z_][\w]*)\s*\(/g;
  while ((match = methodRe.exec(slice)) !== null) {
    const name = match[1]!;
    const absIndex = start + match.index;
    const key = `self.${name}@${absIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      calleeName: name,
      resolvedKind: "METHOD",
      resolvedSymbol: name,
      confidence: "MEDIUM",
      startLine: lineOf(content, absIndex),
    });
  }
  return calls;
}

function extractFunctionsAndClasses(
  content: string,
  scrubbed: string,
): { functions: ParsedFunction[]; classes: ParsedClass[]; exports: string[] } {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const exports: string[] = [];
  const lines = content.split(/\r?\n/);
  const scrubbedLines = scrubbed.split(/\r?\n/);

  // Map line index → char offset
  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length - 1; i += 1) {
    lineStarts.push(lineStarts[i]! + lines[i]!.length + 1);
  }

  const blockEnd = (startLine: number, indent: number): number => {
    for (let i = startLine + 1; i < scrubbedLines.length; i += 1) {
      const line = scrubbedLines[i]!;
      if (!line.trim()) continue;
      const curIndent = line.match(/^\s*/)?.[0].length ?? 0;
      if (curIndent <= indent && !line.trim().startsWith("#")) {
        return lineStarts[i] ?? content.length;
      }
    }
    return content.length;
  };

  const topLevelNames = new Set<string>();
  for (let i = 0; i < scrubbedLines.length; i += 1) {
    const line = scrubbedLines[i]!;
    const defMatch = /^(def|async def)\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/.exec(line);
    if (defMatch && (line.match(/^\s*/)?.[0].length ?? 0) === 0) {
      topLevelNames.add(defMatch[2]!);
    }
  }

  for (let i = 0; i < scrubbedLines.length; i += 1) {
    const line = scrubbedLines[i]!;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    const classMatch = /^class\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?\s*:/.exec(line);
    if (classMatch && indent === 0) {
      const className = classMatch[1]!;
      const start = lineStarts[i]!;
      const end = blockEnd(i, indent);
      exports.push(className);
      const methods: ParsedMethod[] = [];
      const body = scrubbed.slice(start, end);
      const methodRe = /^( +)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm;
      let mm: RegExpExecArray | null;
      while ((mm = methodRe.exec(body)) !== null) {
        const methodIndent = mm[1]!.length;
        if (methodIndent <= indent) continue;
        const methodName = mm[2]!;
        const methodAbs = start + mm.index;
        const methodLine = lineOf(content, methodAbs) - 1;
        const methodEnd = blockEnd(methodLine, methodIndent);
        const params = mm[3]!
          .split(",")
          .map((p) => p.trim().split(":")[0]!.split("=")[0]!.trim())
          .filter((p) => p && p !== "self" && p !== "cls");
        methods.push({
          name: methodName,
          className,
          startLine: methodLine + 1,
          endLine: lineOf(content, Math.max(methodAbs, methodEnd - 1)),
          calls: collectCallsInRange(content, methodAbs, methodEnd, topLevelNames),
          parameters: params,
        });
      }
      classes.push({
        name: className,
        startLine: i + 1,
        endLine: lineOf(content, Math.max(start, end - 1)),
        exported: true,
        extends: classMatch[2]?.split(",")[0]?.trim(),
        implements: [],
        methods,
      });
      continue;
    }

    const defMatch = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?:->[^:]*)?:/.exec(
      line,
    );
    if (defMatch && indent === 0) {
      const name = defMatch[1]!;
      const start = lineStarts[i]!;
      const end = blockEnd(i, indent);
      const params = defMatch[2]!
        .split(",")
        .map((p) => p.trim().split(":")[0]!.split("=")[0]!.trim())
        .filter(Boolean);
      exports.push(name);
      functions.push({
        name,
        startLine: i + 1,
        endLine: lineOf(content, Math.max(start, end - 1)),
        exported: true,
        calls: collectCallsInRange(content, start, end, topLevelNames),
        parameters: params,
      });
    }
  }

  return { functions, classes, exports };
}

export function parsePythonFile(
  filePath: string,
  content: string,
  knownFiles: Set<string> = new Set(),
): ParsedFile {
  const normalized = filePath.replace(/\\/g, "/");
  const scrubbed = stripCommentsAndStrings(content);
  const imports = extractImports(content, normalized, knownFiles);
  const { functions, classes, exports } = extractFunctionsAndClasses(content, scrubbed);

  // Second pass: resolve call symbols to same-file functions with HIGH when exact
  const localFns = new Set(functions.map((f) => f.name));
  for (const fn of functions) {
    for (const call of fn.calls) {
      if (localFns.has(call.calleeName) && call.resolvedKind === "FUNCTION") {
        call.confidence = "HIGH";
        call.resolvedFile = normalized;
      }
    }
  }
  for (const cls of classes) {
    for (const method of cls.methods) {
      for (const call of method.calls) {
        if (localFns.has(call.calleeName) && call.resolvedKind === "FUNCTION") {
          call.confidence = "HIGH";
          call.resolvedFile = normalized;
        }
      }
    }
  }

  return {
    path: normalized,
    language: "python",
    imports,
    exports,
    functions,
    classes,
    envVariables: extractEnvVariables(content),
    isTest: /(^|\/)tests?\/|_test\.py$|test_.*\.py$/i.test(normalized),
  };
}

/** Resolve cross-file Python call targets using import maps. */
export function linkPythonCalls(files: ParsedFile[]): void {
  const exportMap = new Map<string, { file: string; kind: "FUNCTION" | "CLASS" }>();
  for (const file of files) {
    if (file.language !== "python") continue;
    for (const fn of file.functions) {
      exportMap.set(`${file.path}::${fn.name}`, { file: file.path, kind: "FUNCTION" });
      exportMap.set(fn.name, { file: file.path, kind: "FUNCTION" });
    }
    for (const cls of file.classes) {
      exportMap.set(`${file.path}::${cls.name}`, { file: file.path, kind: "CLASS" });
      for (const method of cls.methods) {
        exportMap.set(`${file.path}::${cls.name}.${method.name}`, {
          file: file.path,
          kind: "FUNCTION",
        });
      }
    }
  }

  for (const file of files) {
    if (file.language !== "python") continue;
    const imported = new Map<string, { file: string; symbol: string }>();
    for (const imp of file.imports) {
      if (!imp.resolvedPath) continue;
      for (const name of imp.namedImports) {
        const symbol = imp.aliases?.[name] ?? name;
        imported.set(name, { file: imp.resolvedPath, symbol });
      }
    }

    const link = (calls: ResolvedCall[]) => {
      for (const call of calls) {
        const target = imported.get(call.calleeName);
        if (target) {
          call.resolvedFile = target.file;
          call.resolvedSymbol = target.symbol;
          call.resolvedKind = "FUNCTION";
          call.confidence = "HIGH";
        }
      }
    };
    for (const fn of file.functions) link(fn.calls);
    for (const cls of file.classes) {
      for (const method of cls.methods) link(method.calls);
    }
  }
}
