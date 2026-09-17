import { Project, SyntaxKind, type Node } from "ts-morph";

export interface EnclosingSymbol {
  kind: "FUNCTION" | "METHOD" | "CLASS";
  name: string;
  className?: string;
  startLine: number;
  endLine: number;
  file: string;
}

/**
 * Parse a unified diff patch and return 1-based line numbers that changed in the *new* file.
 */
export function parseChangedLinesFromPatch(patch?: string): number[] {
  if (!patch) return [];
  const lines = new Set<number>();
  let newLine = 0;

  for (const raw of patch.split(/\r?\n/)) {
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[2]);
      continue;
    }
    if (!newLine) continue;

    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ")) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.add(newLine);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      // deleted line — does not advance new-file cursor
      continue;
    }
    // context line
    if (raw.startsWith(" ") || raw === "") {
      newLine += 1;
    }
  }

  return [...lines].sort((a, b) => a - b);
}

function enclosingSymbolAtLine(sourceFilePath: string, node: Node, line: number): EnclosingSymbol | null {
  // Walk up from the deepest node containing this line
  let current: Node | undefined = node;
  let best: EnclosingSymbol | null = null;

  while (current) {
    const kind = current.getKind();
    const start = current.getStartLineNumber();
    const end = current.getEndLineNumber();
    if (line < start || line > end) {
      current = current.getParent();
      continue;
    }

    if (kind === SyntaxKind.MethodDeclaration) {
      const method = current.asKindOrThrow(SyntaxKind.MethodDeclaration);
      const parent = method.getParent();
      const className =
        parent && "getName" in parent && typeof parent.getName === "function"
          ? (parent.getName() as string | undefined) ?? "AnonymousClass"
          : "AnonymousClass";
      best = {
        kind: "METHOD",
        name: method.getName(),
        className,
        startLine: start,
        endLine: end,
        file: sourceFilePath,
      };
      // Prefer method over class — stop once we have a method
      return best;
    }

    if (kind === SyntaxKind.FunctionDeclaration) {
      const fn = current.asKindOrThrow(SyntaxKind.FunctionDeclaration);
      const name = fn.getName();
      if (name) {
        return {
          kind: "FUNCTION",
          name,
          startLine: start,
          endLine: end,
          file: sourceFilePath,
        };
      }
    }

    if (kind === SyntaxKind.VariableDeclaration) {
      const decl = current.asKindOrThrow(SyntaxKind.VariableDeclaration);
      const init = decl.getInitializer();
      if (
        init &&
        (init.getKind() === SyntaxKind.ArrowFunction ||
          init.getKind() === SyntaxKind.FunctionExpression)
      ) {
        return {
          kind: "FUNCTION",
          name: decl.getName(),
          startLine: start,
          endLine: end,
          file: sourceFilePath,
        };
      }
    }

    if (kind === SyntaxKind.ClassDeclaration && !best) {
      const cls = current.asKindOrThrow(SyntaxKind.ClassDeclaration);
      best = {
        kind: "CLASS",
        name: cls.getName() ?? "AnonymousClass",
        startLine: start,
        endLine: end,
        file: sourceFilePath,
      };
    }

    current = current.getParent();
  }

  return best;
}

/**
 * Given file content and changed line numbers, find the smallest enclosing
 * FUNCTION / METHOD / CLASS for each line (deduped).
 */
export function findEnclosingSymbols(
  filePath: string,
  content: string,
  changedLines: number[],
): EnclosingSymbol[] {
  if (changedLines.length === 0) return [];

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      target: 99,
      module: 99,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });

  const sourceFile = project.createSourceFile(filePath, content);
  const found = new Map<string, EnclosingSymbol>();

  for (const line of changedLines) {
    let nodeAtLine: Node | undefined;
    try {
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
      nodeAtLine = sourceFile.getDescendantAtPos(pos) ?? sourceFile;
    } catch {
      const last = sourceFile.getEndLineNumber();
      const clamped = Math.min(Math.max(line, 1), last);
      try {
        const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(clamped - 1, 0);
        nodeAtLine = sourceFile.getDescendantAtPos(pos) ?? sourceFile;
      } catch {
        nodeAtLine = sourceFile;
      }
    }

    if (!nodeAtLine) continue;
    const symbol = enclosingSymbolAtLine(filePath, nodeAtLine, line);
    if (!symbol) continue;
    const key = `${symbol.kind}:${symbol.className ?? ""}:${symbol.name}:${symbol.startLine}`;
    found.set(key, symbol);
  }

  return [...found.values()];
}

/**
 * Map a unified diff onto enclosing AST symbols in the *new* file content.
 * This catches internal logic edits that never touch a function signature line.
 */
export function mapPatchToEnclosingSymbols(
  filePath: string,
  content: string,
  patch?: string,
): EnclosingSymbol[] {
  const lines = parseChangedLinesFromPatch(patch);
  return findEnclosingSymbols(filePath, content, lines);
}

export function enclosingSymbolToNodeId(symbol: EnclosingSymbol): string {
  if (symbol.kind === "METHOD" && symbol.className) {
    return `METHOD:${symbol.file}:${symbol.className}.${symbol.name}`;
  }
  if (symbol.kind === "CLASS") {
    return `CLASS:${symbol.file}:${symbol.name}`;
  }
  return `FUNCTION:${symbol.file}:${symbol.name}`;
}
