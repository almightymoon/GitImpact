import {
  Project,
  SyntaxKind,
  type SourceFile,
  type ClassDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type VariableDeclaration,
} from "ts-morph";
import {
  parseChangedLineRangesFromPatch,
  reconstructOldContent,
  findEnclosingSymbols,
  enclosingSymbolToNodeId,
  type EnclosingSymbol,
} from "./diff-to-ast.js";

export type SemanticChangeKind =
  | "METHOD_REMOVED"
  | "METHOD_ADDED"
  | "FUNCTION_REMOVED"
  | "FUNCTION_ADDED"
  | "CLASS_REMOVED"
  | "CLASS_ADDED"
  | "SIGNATURE_CHANGED"
  | "PARAMETER_ADDED"
  | "PARAMETER_REMOVED"
  | "RETURN_TYPE_CHANGED"
  | "CALL_ADDED"
  | "CALL_REMOVED"
  | "BODY_CHANGED";

export interface SemanticChangeEvent {
  kind: SemanticChangeKind;
  /** Graph-compatible id, e.g. METHOD:src/auth.ts:AuthService.login */
  symbolId: string;
  file: string;
  name: string;
  className?: string;
  details?: Record<string, unknown>;
}

export interface SemanticDiffResult {
  oldContent: string | null;
  events: SemanticChangeEvent[];
  /** Symbols touched by the change (added, removed, or modified) */
  changedSymbols: EnclosingSymbol[];
  changedSymbolIds: string[];
}

interface SymbolSnapshot {
  key: string;
  kind: "FUNCTION" | "METHOD" | "CLASS";
  name: string;
  className?: string;
  parameters: string[];
  returnType: string;
  calls: string[];
  bodyText: string;
  startLine: number;
  endLine: number;
}

function createProject(): Project {
  return new Project({
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
}

function paramSignature(
  node: FunctionDeclaration | MethodDeclaration | { getParameters(): { getName(): string; getType(): { getText(): string } }[] },
): string[] {
  return node.getParameters().map((param) => {
    const typeText = param.getType().getText().replace(/\s+/g, " ");
    return `${param.getName()}:${typeText}`;
  });
}

function returnTypeText(
  node: FunctionDeclaration | MethodDeclaration,
): string {
  const explicit = node.getReturnTypeNode()?.getText();
  if (explicit) return explicit.replace(/\s+/g, " ");
  try {
    return node.getReturnType().getText().replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function collectCalls(node: { forEachDescendant(cb: (child: import("ts-morph").Node) => void): void }): string[] {
  const calls = new Set<string>();
  node.forEachDescendant((child) => {
    if (child.getKind() !== SyntaxKind.CallExpression) return;
    const expr = child.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
    if (expr.getKind() === SyntaxKind.Identifier) {
      calls.add(expr.getText());
      return;
    }
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      calls.add(expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName());
    }
  });
  return [...calls].sort();
}

function functionBodyText(node: FunctionDeclaration | MethodDeclaration): string {
  return node.getBody()?.getText() ?? "";
}

function snapshotFunction(
  filePath: string,
  fn: FunctionDeclaration,
): SymbolSnapshot | null {
  const name = fn.getName();
  if (!name) return null;
  return {
    key: `FUNCTION:${filePath}:${name}`,
    kind: "FUNCTION",
    name,
    parameters: paramSignature(fn),
    returnType: returnTypeText(fn),
    calls: collectCalls(fn),
    bodyText: functionBodyText(fn),
    startLine: fn.getStartLineNumber(),
    endLine: fn.getEndLineNumber(),
  };
}

function snapshotArrow(
  filePath: string,
  decl: VariableDeclaration,
): SymbolSnapshot | null {
  const init = decl.getInitializer();
  if (!init) return null;
  if (
    init.getKind() !== SyntaxKind.ArrowFunction &&
    init.getKind() !== SyntaxKind.FunctionExpression
  ) {
    return null;
  }
  const name = decl.getName();
  const arrow = init.asKindOrThrow(
    init.getKind() === SyntaxKind.ArrowFunction
      ? SyntaxKind.ArrowFunction
      : SyntaxKind.FunctionExpression,
  );
  return {
    key: `FUNCTION:${filePath}:${name}`,
    kind: "FUNCTION",
    name,
    parameters: arrow.getParameters().map((param) => {
      const typeText = param.getType().getText().replace(/\s+/g, " ");
      return `${param.getName()}:${typeText}`;
    }),
    returnType: (() => {
      try {
        return arrow.getReturnType().getText().replace(/\s+/g, " ");
      } catch {
        return "";
      }
    })(),
    calls: collectCalls(arrow),
    bodyText: arrow.getBody()?.getText() ?? arrow.getText(),
    startLine: decl.getStartLineNumber(),
    endLine: decl.getEndLineNumber(),
  };
}

function snapshotMethod(
  filePath: string,
  cls: ClassDeclaration,
  method: MethodDeclaration,
): SymbolSnapshot {
  const className = cls.getName() ?? "AnonymousClass";
  const name = method.getName();
  return {
    key: `METHOD:${filePath}:${className}.${name}`,
    kind: "METHOD",
    name,
    className,
    parameters: paramSignature(method),
    returnType: returnTypeText(method),
    calls: collectCalls(method),
    bodyText: functionBodyText(method),
    startLine: method.getStartLineNumber(),
    endLine: method.getEndLineNumber(),
  };
}

function snapshotClass(filePath: string, cls: ClassDeclaration): SymbolSnapshot {
  const name = cls.getName() ?? "AnonymousClass";
  return {
    key: `CLASS:${filePath}:${name}`,
    kind: "CLASS",
    name,
    parameters: [],
    returnType: "",
    calls: [],
    bodyText: cls.getText(),
    startLine: cls.getStartLineNumber(),
    endLine: cls.getEndLineNumber(),
  };
}

export function extractSymbolSnapshots(
  filePath: string,
  content: string,
): Map<string, SymbolSnapshot> {
  const project = createProject();
  const sourceFile = project.createSourceFile(filePath, content);
  const snapshots = new Map<string, SymbolSnapshot>();

  for (const fn of sourceFile.getFunctions()) {
    const snap = snapshotFunction(filePath, fn);
    if (snap) snapshots.set(snap.key, snap);
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      const snap = snapshotArrow(filePath, decl);
      if (snap) snapshots.set(snap.key, snap);
    }
  }

  for (const cls of sourceFile.getClasses()) {
    const classSnap = snapshotClass(filePath, cls);
    snapshots.set(classSnap.key, classSnap);
    for (const method of cls.getMethods()) {
      const snap = snapshotMethod(filePath, cls, method);
      snapshots.set(snap.key, snap);
    }
  }

  // Avoid unused SourceFile lint in some tooling
  void (sourceFile as SourceFile);
  return snapshots;
}

function toEnclosing(snap: SymbolSnapshot, file: string): EnclosingSymbol {
  return {
    kind: snap.kind,
    name: snap.name,
    className: snap.className,
    startLine: snap.startLine,
    endLine: snap.endLine,
    file,
  };
}

function compareSnapshots(
  filePath: string,
  oldMap: Map<string, SymbolSnapshot>,
  newMap: Map<string, SymbolSnapshot>,
): { events: SemanticChangeEvent[]; changed: EnclosingSymbol[] } {
  const events: SemanticChangeEvent[] = [];
  const changed = new Map<string, EnclosingSymbol>();

  for (const [key, oldSnap] of oldMap) {
    const next = newMap.get(key);
    if (!next) {
      const kind =
        oldSnap.kind === "METHOD"
          ? "METHOD_REMOVED"
          : oldSnap.kind === "CLASS"
            ? "CLASS_REMOVED"
            : "FUNCTION_REMOVED";
      events.push({
        kind,
        symbolId: key,
        file: filePath,
        name: oldSnap.name,
        className: oldSnap.className,
      });
      changed.set(key, toEnclosing(oldSnap, filePath));
      continue;
    }

    if (oldSnap.kind === "CLASS" || next.kind === "CLASS") {
      // Classes are tracked for add/remove only; method-level diffs cover members.
      continue;
    }

    const oldParams = new Set(oldSnap.parameters);
    const newParams = new Set(next.parameters);
    let signatureTouched = false;

    for (const param of newParams) {
      if (!oldParams.has(param)) {
        events.push({
          kind: "PARAMETER_ADDED",
          symbolId: key,
          file: filePath,
          name: next.name,
          className: next.className,
          details: { parameter: param },
        });
        signatureTouched = true;
      }
    }
    for (const param of oldParams) {
      if (!newParams.has(param)) {
        events.push({
          kind: "PARAMETER_REMOVED",
          symbolId: key,
          file: filePath,
          name: next.name,
          className: next.className,
          details: { parameter: param },
        });
        signatureTouched = true;
      }
    }

    if (oldSnap.returnType !== next.returnType) {
      events.push({
        kind: "RETURN_TYPE_CHANGED",
        symbolId: key,
        file: filePath,
        name: next.name,
        className: next.className,
        details: { from: oldSnap.returnType, to: next.returnType },
      });
      signatureTouched = true;
    }

    if (signatureTouched && oldSnap.parameters.join("|") !== next.parameters.join("|")) {
      events.push({
        kind: "SIGNATURE_CHANGED",
        symbolId: key,
        file: filePath,
        name: next.name,
        className: next.className,
        details: {
          from: oldSnap.parameters,
          to: next.parameters,
        },
      });
    }

    const oldCalls = new Set(oldSnap.calls);
    const newCalls = new Set(next.calls);
    for (const call of newCalls) {
      if (!oldCalls.has(call)) {
        events.push({
          kind: "CALL_ADDED",
          symbolId: key,
          file: filePath,
          name: next.name,
          className: next.className,
          details: { callee: call },
        });
      }
    }
    for (const call of oldCalls) {
      if (!newCalls.has(call)) {
        events.push({
          kind: "CALL_REMOVED",
          symbolId: key,
          file: filePath,
          name: next.name,
          className: next.className,
          details: { callee: call },
        });
      }
    }

    if (oldSnap.bodyText !== next.bodyText) {
      // Body-only change when signature identity is unchanged enough to keep the symbol
      const onlyBody =
        oldSnap.parameters.join("|") === next.parameters.join("|") &&
        oldSnap.returnType === next.returnType;
      if (onlyBody || oldSnap.bodyText !== next.bodyText) {
        events.push({
          kind: "BODY_CHANGED",
          symbolId: key,
          file: filePath,
          name: next.name,
          className: next.className,
        });
      }
      changed.set(key, toEnclosing(next, filePath));
    } else if (signatureTouched) {
      changed.set(key, toEnclosing(next, filePath));
    } else if ([...newCalls].some((c) => !oldCalls.has(c)) || [...oldCalls].some((c) => !newCalls.has(c))) {
      changed.set(key, toEnclosing(next, filePath));
    }
  }

  for (const [key, next] of newMap) {
    if (oldMap.has(key)) continue;
    const kind =
      next.kind === "METHOD"
        ? "METHOD_ADDED"
        : next.kind === "CLASS"
          ? "CLASS_ADDED"
          : "FUNCTION_ADDED";
    events.push({
      kind,
      symbolId: key,
      file: filePath,
      name: next.name,
      className: next.className,
    });
    changed.set(key, toEnclosing(next, filePath));
  }

  return { events, changed: [...changed.values()] };
}

/**
 * Semantic Diff Engine (v0.4)
 *
 * Unified diff
 *   ├── OLD line ranges → old-file AST snapshots
 *   └── NEW line ranges → new-file AST snapshots
 *            ↓
 *      Symbol comparison → METHOD_REMOVED / CALL_ADDED / …
 */
export function analyzeSemanticDiff(
  filePath: string,
  newContent: string,
  patch?: string,
  oldContentOverride?: string,
): SemanticDiffResult {
  const oldContent =
    oldContentOverride ??
    (patch ? reconstructOldContent(newContent, patch) : null) ??
    null;

  if (!oldContent || oldContent === newContent) {
    // No reconstructable before-state: fall back to enclosing-symbol mapping on new AST
    const enclosing = findEnclosingSymbols(
      filePath,
      newContent,
      parseChangedLineRangesFromPatch(patch).newLines,
    );
    return {
      oldContent,
      events: enclosing.map((symbol) => ({
        kind: "BODY_CHANGED" as const,
        symbolId: enclosingSymbolToNodeId(symbol),
        file: filePath,
        name: symbol.name,
        className: symbol.className,
      })),
      changedSymbols: enclosing,
      changedSymbolIds: enclosing.map(enclosingSymbolToNodeId),
    };
  }

  const oldMap = extractSymbolSnapshots(filePath, oldContent);
  const newMap = extractSymbolSnapshots(filePath, newContent);
  const { events, changed } = compareSnapshots(filePath, oldMap, newMap);

  // Also include line-anchored enclosing symbols for body edits that didn't
  // change snapshot identity in an unexpected way (belt-and-suspenders).
  const ranges = parseChangedLineRangesFromPatch(patch);
  const lineAnchored = [
    ...findEnclosingSymbols(filePath, newContent, ranges.newLines),
    ...findEnclosingSymbols(filePath, oldContent, ranges.oldLines),
  ];
  const byId = new Map(changed.map((s) => [enclosingSymbolToNodeId(s), s]));
  for (const symbol of lineAnchored) {
    byId.set(enclosingSymbolToNodeId(symbol), symbol);
  }

  const changedSymbols = [...byId.values()];
  return {
    oldContent,
    events,
    changedSymbols,
    changedSymbolIds: changedSymbols.map(enclosingSymbolToNodeId),
  };
}

/**
 * Map broad ChangeCategory buckets from precise semantic events.
 */
export function semanticEventsToChangeCategory(
  events: SemanticChangeEvent[],
): "STRUCTURAL" | "INTERFACE" | "BEHAVIORAL" | "CONFIGURATION" {
  if (
    events.some((e) =>
      [
        "METHOD_REMOVED",
        "METHOD_ADDED",
        "FUNCTION_REMOVED",
        "FUNCTION_ADDED",
        "CLASS_REMOVED",
        "CLASS_ADDED",
      ].includes(e.kind),
    )
  ) {
    return "STRUCTURAL";
  }
  if (
    events.some((e) =>
      [
        "SIGNATURE_CHANGED",
        "PARAMETER_ADDED",
        "PARAMETER_REMOVED",
        "RETURN_TYPE_CHANGED",
      ].includes(e.kind),
    )
  ) {
    return "INTERFACE";
  }
  return "BEHAVIORAL";
}
