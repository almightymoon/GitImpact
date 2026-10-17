/**
 * Deterministic C# surface parser (no dotnet).
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

function resolveCsharpUsing(
  moduleSpecifier: string,
  knownFiles: Set<string>,
): string | undefined {
  const leaf = moduleSpecifier.split(".").pop()!;
  return [...knownFiles].find((f) => f.endsWith(`/${leaf}.cs`) || f === `${leaf}.cs`);
}

function extractUsings(content: string, knownFiles: Set<string>): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const re = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const moduleSpecifier = match[1]!;
    const localName = moduleSpecifier.split(".").pop()!;
    imports.push({
      moduleSpecifier,
      namedImports: [localName],
      isTypeOnly: false,
      resolvedPath: resolveCsharpUsing(moduleSpecifier, knownFiles),
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
      ["if", "for", "while", "switch", "catch", "return", "new", "class", "using", "namespace"].includes(
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

export function parseCsharpFile(
  filePath: string,
  content: string,
  knownFiles: Set<string>,
): ParsedFile {
  const cleaned = stripCommentsAndStrings(content);
  const imports = extractUsings(content, knownFiles);
  const classes: ParsedClass[] = [];
  const functions: ParsedFunction[] = [];

  const classRe =
    /\b(?:public\s+|internal\s+|private\s+|protected\s+)?(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(class|interface|record|struct|enum)\s+(\w+)/g;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRe.exec(cleaned)) !== null) {
    const className = classMatch[2]!;
    const classStart = classMatch.index;
    const brace = cleaned.indexOf("{", classStart);
    const classEnd = brace === -1 ? cleaned.length : findMatchingBrace(cleaned, brace);
    const bodyStart = brace === -1 ? classStart : brace;
    const body = cleaned.slice(bodyStart, classEnd);
    const methods: ParsedMethod[] = [];
    const methodRe =
      /\b(?:public|private|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:[\w.<>[\]]+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRe.exec(body)) !== null) {
      const name = methodMatch[1]!;
      const mStart = methodMatch.index;
      const mBrace = body.indexOf("{", mStart);
      const mEnd = mBrace === -1 ? body.length : findMatchingBrace(body, mBrace);
      methods.push({
        name,
        className,
        startLine: lineOf(content, bodyStart + mStart),
        endLine: lineOf(content, bodyStart + mEnd),
        parameters: [],
        calls: extractCalls(body.slice(mStart, mEnd), bodyStart + mStart, content),
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

  if (classes.length === 0 || /Map(Get|Post|Put|Delete|Patch)\s*\(/.test(content)) {
    functions.push({
      name: "Program",
      startLine: 1,
      endLine: content.split(/\r?\n/).length,
      parameters: [],
      calls: extractCalls(cleaned, 0, content),
      exported: true,
    });
  }

  const isTest =
    /Tests?\.cs$/i.test(filePath) ||
    filePath.includes("/test/") ||
    filePath.includes("/Tests/");

  return {
    path: filePath.replace(/\\/g, "/"),
    language: "csharp",
    imports,
    exports: classes.map((c) => c.name),
    functions,
    classes,
    envVariables: [],
    isTest,
  };
}

export function linkCsharpCalls(files: ParsedFile[]): void {
  const byName = new Map<
    string,
    { file: string; kind: "METHOD" | "FUNCTION"; className?: string; symbol: string }
  >();
  for (const file of files.filter((f) => f.language === "csharp")) {
    for (const cls of file.classes) {
      for (const m of cls.methods) {
        const hit = {
          file: file.path,
          kind: "METHOD" as const,
          className: cls.name,
          symbol: m.name,
        };
        byName.set(m.name, hit);
        byName.set(`${cls.name}.${m.name}`, hit);
      }
    }
    for (const fn of file.functions) {
      byName.set(fn.name, { file: file.path, kind: "FUNCTION", symbol: fn.name });
    }
  }
  const apply = (calls: ResolvedCall[], selfName?: string) => {
    for (const call of calls) {
      if (call.calleeName === selfName) continue;
      const hit = byName.get(call.calleeName);
      if (hit) {
        call.resolvedFile = hit.file;
        call.resolvedKind = hit.kind;
        call.resolvedClassName = hit.className;
        call.resolvedSymbol = hit.symbol;
        call.confidence = "HIGH";
      }
    }
  };
  for (const file of files.filter((f) => f.language === "csharp")) {
    for (const cls of file.classes) {
      for (const m of cls.methods) apply(m.calls, m.name);
    }
    for (const fn of file.functions) apply(fn.calls, fn.name);
  }
}
