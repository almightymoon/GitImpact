import {
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type Node,
  type SourceFile,
} from "ts-morph";
import type { ParsedImport, ResolvedCall } from "@gitimpact/shared";

const PRISMA_METHODS = new Set([
  "findMany",
  "findUnique",
  "findFirst",
  "findUniqueOrThrow",
  "findFirstOrThrow",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

export function capitalizeModel(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function extractDecoratorMeta(
  node: { getDecorators(): { getName(): string; getArguments(): Node[] }[] },
): Array<{ name: string; args: string[] }> {
  return node.getDecorators().map((decorator) => ({
    name: decorator.getName(),
    args: decorator.getArguments().map((arg) => {
      const text = arg.getText().trim();
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")) ||
        (text.startsWith("`") && text.endsWith("`"))
      ) {
        return text.slice(1, -1);
      }
      return text;
    }),
  }));
}

export function extractConstructorDependencies(
  cls: ClassDeclaration,
): Array<{ paramName: string; typeName: string }> {
  const ctor = cls.getConstructors()[0];
  if (!ctor) return [];
  const deps: Array<{ paramName: string; typeName: string }> = [];
  for (const param of ctor.getParameters()) {
    const typeNode = param.getTypeNode();
    const typeName = typeNode?.getText() ?? param.getType().getText().split(".").pop();
    if (!typeName || /^(string|number|boolean|any|unknown|object|void)$/.test(typeName)) {
      continue;
    }
    deps.push({
      paramName: param.getName(),
      typeName: typeName.replace(/<.*>$/, "").trim(),
    });
  }
  return deps;
}

/**
 * Collect `import("...")` / `await import("...")` as ParsedImport records.
 * Also returns a map of local binding name → { module, exportName } for follow-on call resolution.
 */
export function collectDynamicImports(
  sourceFile: SourceFile,
  resolveSpecifier: (specifier: string) => string | undefined,
): {
  imports: ParsedImport[];
  bindingMap: Map<string, { modulePath: string; exportName: string }>;
} {
  const imports: ParsedImport[] = [];
  const bindingMap = new Map<string, { modulePath: string; exportName: string }>();
  const seenSpec = new Set<string>();

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;

    const arg = call.getArguments()[0];
    if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) return;
    const moduleSpecifier = arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
    const resolvedPath = resolveSpecifier(moduleSpecifier);

    if (!seenSpec.has(moduleSpecifier)) {
      seenSpec.add(moduleSpecifier);
      imports.push({
        moduleSpecifier,
        namedImports: [],
        isTypeOnly: false,
        resolvedPath,
        isDynamic: true,
      });
    }

    // const mod = await import("...")
    // const { foo: bar } = await import("...")
    const awaitExpr = call.getParent();
    const init =
      awaitExpr?.getKind() === SyntaxKind.AwaitExpression ? awaitExpr.getParent() : call.getParent();
    if (!init || init.getKind() !== SyntaxKind.VariableDeclaration) return;
    const decl = init.asKindOrThrow(SyntaxKind.VariableDeclaration);
    const nameNode = decl.getNameNode();

    if (nameNode.getKind() === SyntaxKind.Identifier && resolvedPath) {
      // namespace-style: const mod = await import(...); mod.foo()
      bindingMap.set(nameNode.getText(), {
        modulePath: resolvedPath,
        exportName: "*",
      });
    }

    if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern && resolvedPath) {
      const pattern = nameNode.asKindOrThrow(SyntaxKind.ObjectBindingPattern);
      for (const element of pattern.getElements()) {
        const exportName = element.getPropertyNameNode()?.getText() ?? element.getName();
        const localName = element.getName();
        bindingMap.set(localName, { modulePath: resolvedPath, exportName });
        const dyn = imports.find((i) => i.moduleSpecifier === moduleSpecifier);
        if (dyn && !dyn.namedImports.includes(exportName)) {
          dyn.namedImports.push(exportName);
        }
      }
    }
  });

  return { imports, bindingMap };
}

export function tryResolveDynamicImportCall(
  call: CallExpression,
  resolveSpecifier: (specifier: string) => string | undefined,
): ResolvedCall | null {
  if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return null;
  const arg = call.getArguments()[0];
  const specifier =
    arg?.getKind() === SyntaxKind.StringLiteral
      ? arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText()
      : undefined;
  const resolvedPath = specifier ? resolveSpecifier(specifier) : undefined;
  return {
    calleeName: "import",
    resolvedFile: resolvedPath,
    resolvedSymbol: specifier ?? "import",
    resolvedKind: resolvedPath ? "MODULE" : "UNRESOLVED",
    confidence: resolvedPath ? "HIGH" : "LOW",
    startLine: call.getStartLineNumber(),
  };
}

export function tryResolveDynamicBindingCall(
  call: CallExpression,
  bindingMap: Map<string, { modulePath: string; exportName: string }>,
): ResolvedCall | null {
  const expr = call.getExpression();
  // q()
  if (expr.getKind() === SyntaxKind.Identifier) {
    const name = expr.getText();
    const binding = bindingMap.get(name);
    if (!binding || binding.exportName === "*") return null;
    return {
      calleeName: name,
      resolvedFile: binding.modulePath,
      resolvedSymbol: binding.exportName,
      resolvedKind: "FUNCTION",
      confidence: "MEDIUM",
      startLine: call.getStartLineNumber(),
    };
  }
  // mod.queryUsers() / client.user.findMany already handled elsewhere
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (pa.getExpression().getKind() !== SyntaxKind.Identifier) return null;
    const root = pa.getExpression().getText();
    const binding = bindingMap.get(root);
    if (!binding) return null;
    return {
      calleeName: pa.getName(),
      resolvedFile: binding.modulePath,
      resolvedSymbol: pa.getName(),
      resolvedKind: "FUNCTION",
      confidence: "MEDIUM",
      startLine: call.getStartLineNumber(),
    };
  }
  return null;
}

export function tryResolvePrismaCall(call: CallExpression): {
  call: ResolvedCall;
  query: { model: string; method: string };
} | null {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const methodPa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const methodName = methodPa.getName();
  if (!PRISMA_METHODS.has(methodName)) return null;

  const modelExpr = methodPa.getExpression();
  if (modelExpr.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const modelPa = modelExpr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const modelName = modelPa.getName();
  const clientExpr = modelPa.getExpression();

  // prisma.user.findMany / this.prisma.user.findMany / client.user.findMany
  const clientText = clientExpr.getText();
  const looksPrisma =
    /\bprisma\b/i.test(clientText) ||
    /\bclient\b/i.test(clientText) ||
    clientExpr.getType().getText().includes("PrismaClient");
  if (!looksPrisma) return null;

  const model = capitalizeModel(modelName);
  return {
    query: { model, method: methodName },
    call: {
      calleeName: methodName,
      resolvedSymbol: methodName,
      resolvedClassName: `Prisma.${model}`,
      resolvedKind: "QUERY",
      confidence: "MEDIUM",
      startLine: call.getStartLineNumber(),
    },
  };
}
