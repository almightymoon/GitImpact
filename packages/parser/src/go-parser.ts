/**
 * Deterministic Go surface parser (no ML, no `go/types`).
 * Extracts package, imports, funcs/methods/structs, and simple call sites.
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
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/.*?$/gm, (m) => " ".repeat(m.length))
    .replace(/(`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (m) =>
      " ".repeat(m.length),
    );
}

export function parseGoModModule(goModContent: string): string | undefined {
  const match = /^\s*module\s+(\S+)/m.exec(goModContent);
  return match?.[1];
}

function resolveGoImport(
  moduleSpecifier: string,
  modulePath: string | undefined,
  knownFiles: Set<string>,
): string | undefined {
  if (!modulePath || !moduleSpecifier.startsWith(modulePath)) {
    return undefined;
  }

  const rest = moduleSpecifier.slice(modulePath.length).replace(/^\//, "");
  if (!rest) {
    const rootFiles = [...knownFiles].filter(
      (f) => !f.includes("/") && f.endsWith(".go") && !f.endsWith("_test.go"),
    );
    return rootFiles.sort()[0];
  }

  const dir = rest.replace(/\\/g, "/");
  const candidates = [...knownFiles]
    .map((f) => f.replace(/\\/g, "/"))
    .filter(
      (f) =>
        !f.endsWith("_test.go") &&
        (path.posix.dirname(f) === dir || f === `${dir}.go`),
    )
    .sort();
  return candidates[0];
}

function extractImports(
  content: string,
  modulePath: string | undefined,
  knownFiles: Set<string>,
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const seen = new Set<string>();

  const push = (alias: string | undefined, moduleSpecifier: string) => {
    if (seen.has(moduleSpecifier)) return;
    seen.add(moduleSpecifier);
    const localName =
      alias && alias !== "_" && alias !== "."
        ? alias
        : moduleSpecifier.split("/").pop()!;
    imports.push({
      moduleSpecifier,
      namedImports: localName ? [localName] : [],
      isTypeOnly: false,
      resolvedPath: resolveGoImport(moduleSpecifier, modulePath, knownFiles),
    });
  };

  const single = /^\s*import\s+(?:(\w+)\s+)?["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = single.exec(content)) !== null) {
    push(match[1], match[2]!);
  }

  const block = /import\s*\(([\s\S]*?)\)/g;
  while ((match = block.exec(content)) !== null) {
    const body = match[1]!;
    const lineRe = /^\s*(?:(\w+)\s+)?["']([^"']+)["']/gm;
    let line: RegExpExecArray | null;
    while ((line = lineRe.exec(body)) !== null) {
      push(line[1], line[2]!);
    }
  }

  return imports;
}

function extractPackageName(content: string): string | undefined {
  const match = /^\s*package\s+(\w+)/m.exec(content);
  return match?.[1];
}

function extractGormQueries(
  content: string,
  start: number,
  end: number,
): Array<{ model: string; method: string }> {
  const slice = content.slice(start, end);
  const queries: Array<{ model: string; method: string }> = [];
  const seen = new Set<string>();

  // Local vars: `var user models.User` / `user := models.User{`
  const varTypes = new Map<string, string>();
  const varRe =
    /(?:var\s+([A-Za-z_][\w]*)\s+(?:[A-Za-z_][\w]*\.)?([A-Z][\w]*)|([A-Za-z_][\w]*)\s*:?=\s*(?:&)?(?:[A-Za-z_][\w]*\.)?([A-Z][\w]*)\s*\{)/g;
  let vm: RegExpExecArray | null;
  while ((vm = varRe.exec(slice)) !== null) {
    if (vm[1] && vm[2]) varTypes.set(vm[1], vm[2]);
    if (vm[3] && vm[4]) varTypes.set(vm[3], vm[4]);
  }

  const typedPtr =
    /\.(Where|Find|First|Create|Save|Delete|Updates|Take|Last)\s*\(\s*&(?:[A-Za-z_][\w]*\.)?([A-Z][\w]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = typedPtr.exec(slice)) !== null) {
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ method: match[1]!, model: match[2]! });
  }

  const varPtr =
    /\.(Where|Find|First|Create|Save|Delete|Updates|Take|Last)\s*\(\s*&([a-z][\w]*)\b/g;
  while ((match = varPtr.exec(slice)) !== null) {
    const model = varTypes.get(match[2]!);
    if (!model) continue;
    const key = `${match[1]}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ method: match[1]!, model });
  }

  return queries;
}

function collectCallsInRange(
  content: string,
  start: number,
  end: number,
  knownFuncs: Set<string>,
  opts?: {
    receiverType?: string;
    filePath?: string;
    methodNames?: Set<string>;
    packageAliases?: Set<string>;
  },
): ResolvedCall[] {
  const slice = content.slice(start, end);
  const calls: ResolvedCall[] = [];
  const seen = new Set<string>();

  // pkg.Func( or recv.Method(
  const dottedRe = /\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = dottedRe.exec(slice)) !== null) {
    const recv = match[1]!;
    const name = match[2]!;
    const absIndex = start + match.index;
    const key = `${recv}.${name}@${absIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isPackage = opts?.packageAliases?.has(recv) ?? false;
    const knownMethod = opts?.methodNames?.has(name) ?? false;
    calls.push({
      calleeName: name,
      resolvedKind: isPackage ? "FUNCTION" : "METHOD",
      resolvedSymbol: name,
      resolvedClassName: isPackage ? recv : opts?.receiverType,
      resolvedFile: knownMethod ? opts?.filePath : undefined,
      confidence: isPackage ? "MEDIUM" : knownMethod ? "HIGH" : "MEDIUM",
      startLine: lineOf(content, absIndex),
    });
  }

  const callRe = /(?<![\w.])([A-Za-z_][\w]*)\s*\(/g;
  while ((match = callRe.exec(slice)) !== null) {
    const name = match[1]!;
    if (
      /^(if|for|switch|return|func|defer|go|range|make|len|cap|append|copy|delete|new|panic|recover|close|string|int|bool|error|nil|var|const|type|map|chan|struct|interface|select|case|default|fallthrough|break|continue|goto)$/.test(
        name,
      )
    ) {
      continue;
    }
    const absIndex = start + match.index;
    const key = `${name}@${absIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const local = knownFuncs.has(name);
    calls.push({
      calleeName: name,
      resolvedKind: local ? "FUNCTION" : "UNRESOLVED",
      resolvedSymbol: local ? name : undefined,
      resolvedFile: local ? opts?.filePath : undefined,
      confidence: local ? "HIGH" : "LOW",
      startLine: lineOf(content, absIndex),
    });
  }

  return calls;
}

function extractDecls(
  content: string,
  scrubbed: string,
  filePath: string,
  packageAliases: Set<string>,
): { functions: ParsedFunction[]; classes: ParsedClass[]; exports: string[] } {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const exports: string[] = [];
  const lines = scrubbed.split(/\r?\n/);
  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length - 1; i += 1) {
    lineStarts.push(lineStarts[i]! + lines[i]!.length + 1);
  }

  const topLevelFuncs = new Set<string>();
  const structMethods = new Map<string, Set<string>>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const methodMatch =
      /^func\s+\(\s*\w+\s+\*?([A-Za-z_][\w]*)\s*\)\s+([A-Za-z_][\w]*)\s*\(/.exec(line);
    if (methodMatch) {
      const recv = methodMatch[1]!;
      const name = methodMatch[2]!;
      const set = structMethods.get(recv) ?? new Set();
      set.add(name);
      structMethods.set(recv, set);
      continue;
    }
    const funcMatch = /^func\s+([A-Za-z_][\w]*)\s*\(/.exec(line);
    if (funcMatch) topLevelFuncs.add(funcMatch[1]!);
  }

  const braceEnd = (startIndex: number): number => {
    let depth = 0;
    let started = false;
    for (let i = startIndex; i < scrubbed.length; i += 1) {
      const ch = scrubbed[i]!;
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
        if (started && depth === 0) return i + 1;
      }
    }
    return scrubbed.length;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const start = lineStarts[i]!;

    const structMatch = /^type\s+([A-Za-z_][\w]*)\s+struct\s*\{/.exec(line);
    if (structMatch) {
      const name = structMatch[1]!;
      exports.push(name);
      const end = braceEnd(start);
      classes.push({
        name,
        startLine: i + 1,
        endLine: lineOf(content, Math.max(start, end - 1)),
        exported: /^[A-Z]/.test(name),
        extends: undefined,
        implements: [],
        methods: [],
      });
      continue;
    }

    const ifaceMatch = /^type\s+([A-Za-z_][\w]*)\s+interface\s*\{/.exec(line);
    if (ifaceMatch) {
      const name = ifaceMatch[1]!;
      exports.push(name);
      classes.push({
        name,
        startLine: i + 1,
        endLine: i + 1,
        exported: /^[A-Z]/.test(name),
        extends: undefined,
        implements: [],
        methods: [],
        decorators: [{ name: "interface", args: [] }],
      });
      continue;
    }

    const methodMatch =
      /^func\s+\(\s*\w+\s+\*?([A-Za-z_][\w]*)\s*\)\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/.exec(
        line,
      );
    if (methodMatch) {
      const recv = methodMatch[1]!;
      const name = methodMatch[2]!;
      const params = methodMatch[3]!
        .split(",")
        .map((p) => p.trim().split(/\s+/).pop()!)
        .filter(Boolean);
      const end = braceEnd(start);
      const methodNames = structMethods.get(recv) ?? new Set();
      const parsedMethod: ParsedMethod = {
        name,
        className: recv,
        startLine: i + 1,
        endLine: lineOf(content, Math.max(start, end - 1)),
        calls: collectCallsInRange(content, start, end, topLevelFuncs, {
          receiverType: recv,
          filePath,
          methodNames,
          packageAliases,
        }),
        parameters: params,
        queries: extractGormQueries(content, start, end),
      };
      const cls = classes.find((c) => c.name === recv);
      if (cls) cls.methods.push(parsedMethod);
      else {
        classes.push({
          name: recv,
          startLine: i + 1,
          endLine: parsedMethod.endLine,
          exported: /^[A-Z]/.test(recv),
          extends: undefined,
          implements: [],
          methods: [parsedMethod],
        });
      }
      if (/^[A-Z]/.test(name)) exports.push(`${recv}.${name}`);
      continue;
    }

    const funcMatch = /^func\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/.exec(line);
    if (funcMatch) {
      const name = funcMatch[1]!;
      const params = funcMatch[2]!
        .split(",")
        .map((p) => p.trim().split(/\s+/).pop()!)
        .filter(Boolean);
      const end = braceEnd(start);
      if (/^[A-Z]/.test(name)) exports.push(name);
      functions.push({
        name,
        startLine: i + 1,
        endLine: lineOf(content, Math.max(start, end - 1)),
        exported: /^[A-Z]/.test(name),
        calls: collectCallsInRange(content, start, end, topLevelFuncs, {
          filePath,
          packageAliases,
        }),
        parameters: params,
        queries: extractGormQueries(content, start, end),
      });
    }
  }

  return { functions, classes, exports };
}

export function parseGoFile(
  filePath: string,
  content: string,
  knownFiles: Set<string> = new Set(),
  modulePath?: string,
): ParsedFile {
  const normalized = filePath.replace(/\\/g, "/");
  const scrubbed = stripCommentsAndStrings(content);
  const imports = extractImports(content, modulePath, knownFiles);
  const packageAliases = new Set(
    imports.flatMap((i) => i.namedImports).filter(Boolean),
  );
  const { functions, classes, exports } = extractDecls(
    content,
    scrubbed,
    normalized,
    packageAliases,
  );
  const pkg = extractPackageName(content);

  const localFns = new Set(functions.map((f) => f.name));
  for (const fn of functions) {
    for (const call of fn.calls) {
      if (localFns.has(call.calleeName) && call.resolvedKind === "FUNCTION") {
        call.confidence = "HIGH";
        call.resolvedFile = normalized;
        call.resolvedSymbol = call.calleeName;
      }
    }
  }

  return {
    path: normalized,
    language: "go",
    imports,
    exports: pkg ? [`package:${pkg}`, ...exports] : exports,
    functions,
    classes,
    envVariables: [],
    isTest: /_test\.go$/.test(normalized),
  };
}

/** Resolve cross-file Go calls using import package aliases → files. */
export function linkGoCalls(files: ParsedFile[], modulePath?: string): void {
  const funcsByFile = new Map<string, Set<string>>();
  const funcsByDir = new Map<string, Map<string, string>>(); // dir → name → file

  for (const file of files) {
    if (file.language !== "go") continue;
    const names = new Set(file.functions.map((f) => f.name));
    funcsByFile.set(file.path, names);
    const dir = path.posix.dirname(file.path);
    const dirMap = funcsByDir.get(dir) ?? new Map();
    for (const name of names) {
      if (!dirMap.has(name)) dirMap.set(name, file.path);
    }
    funcsByDir.set(dir, dirMap);
  }

  for (const file of files) {
    if (file.language !== "go") continue;
    // package alias → package directory
    const importedDirs = new Map<string, string>();
    for (const imp of file.imports) {
      if (!imp.resolvedPath) continue;
      const dir = path.posix.dirname(imp.resolvedPath);
      for (const alias of imp.namedImports) {
        importedDirs.set(alias, dir);
      }
    }

    const link = (calls: ResolvedCall[]) => {
      for (const call of calls) {
        // pkg.Func — package alias stored in resolvedClassName during collect
        const pkgAlias = call.resolvedClassName;
        if (pkgAlias && importedDirs.has(pkgAlias)) {
          const dir = importedDirs.get(pkgAlias)!;
          const hit = funcsByDir.get(dir)?.get(call.calleeName);
          if (hit) {
            call.resolvedFile = hit;
            call.resolvedSymbol = call.calleeName;
            call.resolvedKind = "FUNCTION";
            call.resolvedClassName = undefined;
            call.confidence = "HIGH";
            continue;
          }
        }

        // Ambiguous: unique name among imported packages
        if (call.resolvedKind === "UNRESOLVED" || call.confidence !== "HIGH") {
          const hits: string[] = [];
          for (const dir of importedDirs.values()) {
            const f = funcsByDir.get(dir)?.get(call.calleeName);
            if (f) hits.push(f);
          }
          const unique = [...new Set(hits)];
          if (unique.length === 1) {
            call.resolvedFile = unique[0];
            call.resolvedSymbol = call.calleeName;
            call.resolvedKind = "FUNCTION";
            call.confidence = "HIGH";
          }
        }
      }
    };

    for (const fn of file.functions) link(fn.calls);
    for (const cls of file.classes) {
      for (const method of cls.methods) link(method.calls);
    }
  }

  void modulePath;
}
