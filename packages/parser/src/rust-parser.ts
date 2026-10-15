/**
 * Deterministic Rust surface parser (no cargo/rustc).
 */
import type {
  ParsedClass,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  ParsedMethod,
  ResolvedCall,
} from "@gitimpact/shared";

function lineOf(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function stripCommentsAndStrings(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/.*?$/gm, (m) => " ".repeat(m.length))
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (m) => " ".repeat(m.length));
}

function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === "{") depth += 1;
    else if (content[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return content.length;
}

function resolveRustUse(
  moduleSpecifier: string,
  knownFiles: Set<string>,
  crateName?: string,
): string | undefined {
  let rest = moduleSpecifier;
  if (rest.startsWith("crate::")) rest = rest.slice("crate::".length);
  if (crateName && rest.startsWith(`${crateName}::`)) {
    rest = rest.slice(crateName.length + 2);
  }
  const parts = rest.split("::").filter(Boolean);
  if (parts.length === 0) return undefined;
  const candidates = [
    `src/${parts.join("/")}.rs`,
    `${parts.join("/")}.rs`,
    `src/${parts.join("/")}/mod.rs`,
    `${parts.join("/")}/mod.rs`,
  ];
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  const leaf = `${parts[parts.length - 1]}.rs`;
  return [...knownFiles].find((f) => f.endsWith(`/${leaf}`) || f === leaf);
}

function extractUses(
  content: string,
  knownFiles: Set<string>,
  crateName?: string,
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const re = /^\s*use\s+([\w:]+)(?:::\{([^}]+)\})?\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const base = match[1]!;
    const group = match[2];
    if (group) {
      for (const part of group.split(",").map((s) => s.trim()).filter(Boolean)) {
        const name = part.split(" as ").pop()!.trim();
        const moduleSpecifier = `${base}::${name}`;
        imports.push({
          moduleSpecifier,
          namedImports: [name],
          isTypeOnly: false,
          resolvedPath: resolveRustUse(moduleSpecifier, knownFiles, crateName),
        });
      }
    } else {
      const name = base.split("::").pop()!;
      imports.push({
        moduleSpecifier: base,
        namedImports: [name],
        isTypeOnly: false,
        resolvedPath: resolveRustUse(base, knownFiles, crateName),
      });
    }
  }
  return imports;
}

function extractCalls(slice: string, baseOffset: number, full: string): ResolvedCall[] {
  const calls: ResolvedCall[] = [];
  const seen = new Set<string>();
  const re = /\b(?:([A-Za-z_][\w]*)(?:::|\.))?([A-Za-z_][\w]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    const calleeName = match[2]!;
    if (["if", "for", "while", "match", "return", "fn", "mod", "use", "let"].includes(calleeName)) {
      continue;
    }
    const key = `${calleeName}@${match.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      calleeName,
      resolvedKind: "UNRESOLVED",
      confidence: "MEDIUM",
      startLine: lineOf(full, baseOffset + match.index),
    });
  }
  return calls.slice(0, 80);
}

export function parseCargoPackageName(cargoToml: string): string | undefined {
  const match = /\[package\][\s\S]*?name\s*=\s*"([^"]+)"/m.exec(cargoToml);
  return match?.[1];
}

export function parseRustFile(
  filePath: string,
  content: string,
  knownFiles: Set<string>,
  crateName?: string,
): ParsedFile {
  const cleaned = stripCommentsAndStrings(content);
  const imports = extractUses(content, knownFiles, crateName);
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];

  const fnRe = /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRe.exec(cleaned)) !== null) {
    const name = fnMatch[1]!;
    const start = fnMatch.index;
    const brace = cleaned.indexOf("{", start);
    const end = brace === -1 ? cleaned.length : findMatchingBrace(cleaned, brace);
    const exported = /pub\b/.test(cleaned.slice(Math.max(0, start - 24), start + 8));
    functions.push({
      name,
      startLine: lineOf(content, start),
      endLine: lineOf(content, end),
      parameters: [],
      calls: extractCalls(cleaned.slice(start, end), start, content),
      exported,
    });
  }

  const structRe = /\b(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/g;
  let structMatch: RegExpExecArray | null;
  while ((structMatch = structRe.exec(cleaned)) !== null) {
    const name = structMatch[1]!;
    const start = structMatch.index;
    const brace = cleaned.indexOf("{", start);
    const end = brace === -1 ? start + name.length : findMatchingBrace(cleaned, brace);
    classes.push({
      name,
      startLine: lineOf(content, start),
      endLine: lineOf(content, end),
      exported: true,
      implements: [],
      methods: [],
    });
  }

  const implRe = /\bimpl(?:\s*<[^>]*>)?\s+(?:\w+\s+for\s+)?(\w+)/g;
  let implMatch: RegExpExecArray | null;
  while ((implMatch = implRe.exec(cleaned)) !== null) {
    const typeName = implMatch[1]!;
    const start = implMatch.index;
    const brace = cleaned.indexOf("{", start);
    if (brace === -1) continue;
    const end = findMatchingBrace(cleaned, brace);
    const body = cleaned.slice(brace, end);
    const methods: ParsedMethod[] = [];
    const methodRe = /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRe.exec(body)) !== null) {
      const name = methodMatch[1]!;
      const mStart = methodMatch.index;
      const mBrace = body.indexOf("{", mStart);
      const mEnd = mBrace === -1 ? body.length : findMatchingBrace(body, mBrace);
      methods.push({
        name,
        className: typeName,
        startLine: lineOf(content, start + mStart),
        endLine: lineOf(content, start + mEnd),
        parameters: [],
        calls: extractCalls(body.slice(mStart, mEnd), start + mStart, content),
      });
    }
    const existing = classes.find((c) => c.name === typeName);
    if (existing) existing.methods.push(...methods);
    else {
      classes.push({
        name: typeName,
        startLine: lineOf(content, start),
        endLine: lineOf(content, end),
        exported: true,
        implements: [],
        methods,
      });
    }
  }

  const isTest =
    filePath.includes("/tests/") ||
    /#\[cfg\(test\)\]/.test(content) ||
    /#\[test\]/.test(content);

  return {
    path: filePath.replace(/\\/g, "/"),
    language: "rust",
    imports,
    exports: [
      ...functions.filter((f) => f.exported).map((f) => f.name),
      ...classes.map((c) => c.name),
    ],
    functions,
    classes,
    envVariables: [],
    isTest,
  };
}

export function linkRustCalls(files: ParsedFile[]): void {
  const byName = new Map<string, { file: string; kind: "METHOD" | "FUNCTION" }>();
  for (const file of files.filter((f) => f.language === "rust")) {
    for (const fn of file.functions) byName.set(fn.name, { file: file.path, kind: "FUNCTION" });
    for (const cls of file.classes) {
      for (const m of cls.methods) byName.set(m.name, { file: file.path, kind: "METHOD" });
    }
  }
  const apply = (calls: ResolvedCall[]) => {
    for (const call of calls) {
      const hit = byName.get(call.calleeName);
      if (hit) {
        call.resolvedFile = hit.file;
        call.resolvedKind = hit.kind;
        call.confidence = "HIGH";
      }
    }
  };
  for (const file of files.filter((f) => f.language === "rust")) {
    for (const fn of file.functions) apply(fn.calls);
    for (const cls of file.classes) for (const m of cls.methods) apply(m.calls);
  }
}
