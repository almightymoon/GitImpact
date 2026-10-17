/**
 * Deterministic Java surface parser (no javac).
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

function resolveJavaImport(
  moduleSpecifier: string,
  knownFiles: Set<string>,
): string | undefined {
  const rel = moduleSpecifier.replace(/\./g, "/");
  const direct = `${rel}.java`;
  if (knownFiles.has(direct)) return direct;
  const leaf = `${rel.split("/").pop()}.java`;
  return [...knownFiles].find((f) => f.endsWith(`/${leaf}`) || f === leaf);
}

function extractImports(content: string, knownFiles: Set<string>): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const moduleSpecifier = match[1]!;
    const localName = moduleSpecifier.split(".").pop()!;
    imports.push({
      moduleSpecifier,
      namedImports: [localName],
      isTypeOnly: false,
      resolvedPath: resolveJavaImport(moduleSpecifier, knownFiles),
    });
  }
  return imports;
}

function extractCalls(slice: string, baseOffset: number, full: string): ResolvedCall[] {
  const calls: ResolvedCall[] = [];
  const seen = new Set<string>();
  const re = /\b(?:([A-Z][\w]*)\.)?([a-zA-Z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    const calleeName = match[2]!;
    if (
      ["if", "for", "while", "switch", "catch", "return", "new", "class", "package", "import"].includes(
        calleeName,
      )
    ) {
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

export function parseJavaFile(
  filePath: string,
  content: string,
  knownFiles: Set<string>,
): ParsedFile {
  const cleaned = stripCommentsAndStrings(content);
  const imports = extractImports(content, knownFiles);
  const classes: ParsedClass[] = [];
  const functions: ParsedFunction[] = [];

  const classRe =
    /\b(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(class|interface|enum|record)\s+(\w+)/g;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRe.exec(cleaned)) !== null) {
    const className = classMatch[2]!;
    const classStart = classMatch.index;
    const brace = cleaned.indexOf("{", classStart);
    const classEnd = brace === -1 ? cleaned.length : findMatchingBrace(cleaned, brace);
    const body = cleaned.slice(brace === -1 ? classStart : brace, classEnd);
    const methods: ParsedMethod[] = [];
    const methodRe =
      /\b(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?([\w.<>[\]]+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{/g;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRe.exec(body)) !== null) {
      const name = methodMatch[2]!;
      const mStart = methodMatch.index;
      const mBrace = body.indexOf("{", mStart);
      const mEnd = mBrace === -1 ? body.length : findMatchingBrace(body, mBrace);
      const bodyBase = brace === -1 ? classStart : brace;
      const absStart = bodyBase + (mBrace === -1 ? mStart : mBrace);
      methods.push({
        name,
        className,
        startLine: lineOf(content, bodyBase + mStart),
        endLine: lineOf(content, bodyBase + mEnd),
        parameters: [],
        calls: extractCalls(
          body.slice(mBrace === -1 ? mStart : mBrace, mEnd),
          absStart,
          content,
        ),
      });
    }
    classes.push({
      name: className,
      startLine: lineOf(content, classStart),
      endLine: lineOf(content, classEnd),
      exported: true,
      implements: [],
      methods,
    });
  }

  const isTest =
    /Test\.java$/i.test(filePath) ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/");

  return {
    path: filePath.replace(/\\/g, "/"),
    language: "java",
    imports,
    exports: classes.map((c) => c.name),
    functions,
    classes,
    envVariables: [],
    isTest,
  };
}

export function linkJavaCalls(files: ParsedFile[]): void {
  const byName = new Map<
    string,
    { file: string; kind: "METHOD" | "FUNCTION"; className?: string; symbol: string }
  >();
  for (const file of files.filter((f) => f.language === "java")) {
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        const hit = {
          file: file.path,
          kind: "METHOD" as const,
          className: cls.name,
          symbol: method.name,
        };
        byName.set(method.name, hit);
        byName.set(`${cls.name}.${method.name}`, hit);
      }
    }
  }
  for (const file of files.filter((f) => f.language === "java")) {
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        for (const call of method.calls) {
          // Skip self-name false positives from signature matching
          if (call.calleeName === method.name && !call.resolvedFile) continue;
          const hit = byName.get(call.calleeName);
          if (hit && !(hit.className === cls.name && hit.symbol === method.name)) {
            call.resolvedFile = hit.file;
            call.resolvedKind = hit.kind;
            call.resolvedClassName = hit.className;
            call.resolvedSymbol = hit.symbol;
            call.confidence = "HIGH";
          }
        }
      }
    }
  }
}
