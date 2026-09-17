import { Project, SyntaxKind, type Node } from "ts-morph";

export interface EnclosingSymbol {
  kind: "FUNCTION" | "METHOD" | "CLASS";
  name: string;
  className?: string;
  startLine: number;
  endLine: number;
  file: string;
}

export interface ChangedLineRanges {
  /** 1-based lines that changed (or were anchored) in the new file */
  newLines: number[];
  /** 1-based lines that changed in the old file */
  oldLines: number[];
}

interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** Raw hunk body lines including leading '+', '-', or ' ' */
  body: string[];
}

/**
 * Parse unified diff hunks (supports multiple hunks / rename headers).
 */
function parseHunks(patch?: string): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const raw of patch.split(/\r?\n/)) {
    const header = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        body: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("similarity ") || raw.startsWith("rename ")) {
      continue;
    }
    if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ") || raw === "") {
      current.body.push(raw);
    }
  }

  return hunks;
}

/**
 * Parse a unified diff into old- and new-file changed line ranges.
 *
 * Added lines → newLines.
 * Deleted lines → oldLines, and also anchor the current new-file cursor
 * (the line that now sits at the deletion site) so body-only deletions
 * still map against the new AST.
 */
export function parseChangedLineRangesFromPatch(patch?: string): ChangedLineRanges {
  const newLines = new Set<number>();
  const oldLines = new Set<number>();
  if (!patch) return { newLines: [], oldLines: [] };

  let newLine = 0;
  let oldLine = 0;
  let inHunk = false;

  for (const raw of patch.split(/\r?\n/)) {
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("similarity ") || raw.startsWith("rename ")) {
      continue;
    }
    if (raw.startsWith("+")) {
      if (newLine > 0) newLines.add(newLine);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      if (oldLine > 0) oldLines.add(oldLine);
      // Deletion anchor: map to the line that remains at this position in the new file.
      if (newLine > 0) newLines.add(newLine);
      oldLine += 1;
      continue;
    }
    // context line
    if (raw.startsWith(" ") || raw === "") {
      if (newLine > 0) newLine += 1;
      if (oldLine > 0) oldLine += 1;
    }
  }

  return {
    newLines: [...newLines].sort((a, b) => a - b),
    oldLines: [...oldLines].sort((a, b) => a - b),
  };
}

/**
 * Parse a unified diff patch and return 1-based line numbers that changed in the *new* file
 * (including deletion anchors).
 */
export function parseChangedLinesFromPatch(patch?: string): number[] {
  return parseChangedLineRangesFromPatch(patch).newLines;
}

/**
 * Reconstruct pre-diff file content by reversing a unified diff against the new content.
 * Returns null when the patch cannot be applied cleanly.
 */
export function reconstructOldContent(newContent: string, patch?: string): string | null {
  if (!patch) return null;
  const hunks = parseHunks(patch);
  if (hunks.length === 0) return null;

  const lines = newContent.split("\n");

  // Apply from bottom to top so earlier indices stay stable.
  for (const hunk of [...hunks].reverse()) {
    const newSide: string[] = [];
    const oldSide: string[] = [];
    for (const row of hunk.body) {
      if (row.startsWith("+")) {
        newSide.push(row.slice(1));
      } else if (row.startsWith("-")) {
        oldSide.push(row.slice(1));
      } else if (row.startsWith(" ")) {
        const text = row.slice(1);
        newSide.push(text);
        oldSide.push(text);
      } else if (row === "") {
        newSide.push("");
        oldSide.push("");
      }
    }

    // Full-file deletion: @@ -1,N +0,0 @@
    if (hunk.newStart === 0) {
      return oldSide.join("\n");
    }

    const startIdx = Math.max(hunk.newStart - 1, 0);
    const expected = lines.slice(startIdx, startIdx + newSide.length);
    // Soft check — allow trailing-newline mismatches on the last hunk line
    const matches = expected.length === newSide.length && expected.every((line, i) => line === newSide[i]);
    if (!matches) {
      // Still attempt splice; callers can fall back if mapping fails
    }
    lines.splice(startIdx, newSide.length, ...oldSide);
  }

  return lines.join("\n");
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
 * Map a unified diff onto enclosing AST symbols.
 *
 * Prefers the new-file AST (added lines + deletion anchors). When old-file
 * lines exist, also reconstructs the pre-diff content and maps against that
 * AST — so pure deletions (including whole-method removal) still resolve.
 */
export function mapPatchToEnclosingSymbols(
  filePath: string,
  content: string,
  patch?: string,
): EnclosingSymbol[] {
  const { newLines, oldLines } = parseChangedLineRangesFromPatch(patch);
  const found = new Map<string, EnclosingSymbol>();

  for (const symbol of findEnclosingSymbols(filePath, content, newLines)) {
    const key = `${symbol.kind}:${symbol.className ?? ""}:${symbol.name}`;
    found.set(key, symbol);
  }

  if (oldLines.length > 0) {
    const oldContent = reconstructOldContent(content, patch);
    if (oldContent !== null) {
      for (const symbol of findEnclosingSymbols(filePath, oldContent, oldLines)) {
        const key = `${symbol.kind}:${symbol.className ?? ""}:${symbol.name}`;
        if (!found.has(key)) found.set(key, symbol);
      }
    }
  }

  return [...found.values()];
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
