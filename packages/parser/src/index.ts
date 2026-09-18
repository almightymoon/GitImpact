import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  Project,
  SyntaxKind,
  TypeFormatFlags,
  type CallExpression,
  type Node,
  type SourceFile,
  type TypeChecker,
} from "ts-morph";
import {
  CODE_EXTENSIONS,
  IGNORE_PATTERNS,
  SECRET_PATTERNS,
  type AnalysisHealth,
  type ConfidenceLevel,
  type LanguageStats,
  type ParsedClass,
  type ParsedFile,
  type ParsedFunction,
  type ParsedImport,
  type ParsedMethod,
  type PythonProjectInfo,
  type ResolvedCall,
} from "@gitimpact/shared";
import {
  collectCommonJsRequires,
  collectDynamicImports,
  extractConstructorDependencies,
  extractDecoratorMeta,
  tryResolveDynamicBindingCall,
  tryResolveDynamicImportCall,
  tryResolveFetchCall,
  tryResolvePrismaCall,
} from "./framework-intel.js";
import { linkPythonCalls, parsePythonFile } from "./python-parser.js";
import { detectPythonProject } from "./python-project.js";

export interface LanguageParser {
  parseFile(filePath: string, content: string): ParsedFile;
}

function shouldIgnore(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => (IGNORE_PATTERNS as readonly string[]).includes(segment))) {
    return true;
  }
  const basename = path.basename(relativePath);
  return SECRET_PATTERNS.some((pattern) => pattern.test(basename) || pattern.test(relativePath));
}

function isCodeFile(filePath: string): boolean {
  return (CODE_EXTENSIONS as readonly string[]).some((ext) => filePath.endsWith(ext));
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized) ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/test/")
  );
}

function languageFromPath(filePath: string): ParsedFile["language"] {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".ts")) return "typescript";
  return "javascript";
}

function getLine(node: Node): number {
  return node.getStartLineNumber();
}

function getEndLine(node: Node): number {
  return node.getEndLineNumber();
}

function extractEnvVariables(content: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[["']([A-Z0-9_]+)["']\]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      found.add(match[1]);
    }
  }
  return [...found];
}

function toRepoRelative(rootDir: string, filePath: string): string {
  const normalizedRoot = rootDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith(normalizedRoot + "/")) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

function resolveCallExpression(
  call: CallExpression,
  checker: TypeChecker,
  rootDir: string,
  knownFiles: Set<string>,
): ResolvedCall {
  const expression = call.getExpression();
  const calleeName = expression.getKind() === SyntaxKind.PropertyAccessExpression
    ? expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
    : expression.getText().split(".").pop() ?? expression.getText();

  const unresolved: ResolvedCall = {
    calleeName,
    resolvedKind: "UNRESOLVED",
    confidence: "LOW",
    startLine: getLine(call),
  };

  try {
    let symbol = expression.getSymbol() ?? checker.getSymbolAtLocation(expression);
    if (!symbol) {
      // For property access like authService.generateToken, resolve the name node
      if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
        const nameNode = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode();
        symbol = nameNode.getSymbol() ?? checker.getSymbolAtLocation(nameNode);
      }
    }
    if (!symbol) return unresolved;

    const target = symbol.getAliasedSymbol?.() ?? symbol;
    const declarations = target.getDeclarations();
    if (!declarations.length) return unresolved;

    for (const declaration of declarations) {
      const sourceFile = declaration.getSourceFile();
      const absolute = sourceFile.getFilePath().replace(/\\/g, "/");
      // Skip lib / node_modules declarations
      if (absolute.includes("/node_modules/") || absolute.includes("/typescript/lib/")) {
        continue;
      }

      let relative = toRepoRelative(rootDir, absolute);
      // Match against known repo files
      if (!knownFiles.has(relative)) {
        const basename = path.posix.basename(absolute);
        const match = [...knownFiles].find((f) => f.endsWith("/" + basename) || f === basename);
        if (match) relative = match;
        else if (!knownFiles.has(relative)) {
          // Still record if it looks like our file
          relative = relative.replace(/^\/+/, "");
        }
      }

      const kind = declaration.getKind();

      if (
        kind === SyntaxKind.MethodDeclaration ||
        kind === SyntaxKind.Constructor ||
        kind === SyntaxKind.GetAccessor ||
        kind === SyntaxKind.SetAccessor
      ) {
        const method = declaration.asKindOrThrow(
          kind === SyntaxKind.MethodDeclaration
            ? SyntaxKind.MethodDeclaration
            : kind === SyntaxKind.Constructor
              ? SyntaxKind.Constructor
              : kind === SyntaxKind.GetAccessor
                ? SyntaxKind.GetAccessor
                : SyntaxKind.SetAccessor,
        );
        const parent = method.getParent();
        const className =
          parent && "getName" in parent && typeof parent.getName === "function"
            ? (parent.getName() as string | undefined) ?? "AnonymousClass"
            : "AnonymousClass";
        const methodName =
          kind === SyntaxKind.Constructor
            ? "constructor"
            : "getName" in method && typeof method.getName === "function"
              ? method.getName()
              : calleeName;

        return {
          calleeName,
          resolvedFile: knownFiles.has(relative) ? relative : relative,
          resolvedSymbol: methodName,
          resolvedClassName: className,
          resolvedKind: "METHOD",
          confidence: knownFiles.has(relative) ? "HIGH" : "MEDIUM",
          startLine: getLine(call),
        };
      }

      if (
        kind === SyntaxKind.FunctionDeclaration ||
        kind === SyntaxKind.FunctionExpression ||
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.VariableDeclaration
      ) {
        let name = calleeName;
        if (kind === SyntaxKind.FunctionDeclaration) {
          name = declaration.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName() ?? calleeName;
        } else if (kind === SyntaxKind.VariableDeclaration) {
          name = declaration.asKindOrThrow(SyntaxKind.VariableDeclaration).getName() ?? calleeName;
        }

        return {
          calleeName,
          resolvedFile: relative,
          resolvedSymbol: name,
          resolvedKind: "FUNCTION",
          confidence: knownFiles.has(relative) ? "HIGH" : "MEDIUM",
          startLine: getLine(call),
        };
      }

      if (kind === SyntaxKind.ClassDeclaration) {
        const className =
          declaration.asKindOrThrow(SyntaxKind.ClassDeclaration).getName() ?? calleeName;
        return {
          calleeName,
          resolvedFile: relative,
          resolvedSymbol: className,
          resolvedKind: "CLASS",
          confidence: knownFiles.has(relative) ? "HIGH" : "MEDIUM",
          startLine: getLine(call),
        };
      }
    }
  } catch {
    return unresolved;
  }

  return unresolved;
}

function collectCallsInNode(
  body: Node | undefined,
  checker: TypeChecker,
  rootDir: string,
  knownFiles: Set<string>,
  bindingMap: Map<string, { modulePath: string; exportName: string }> = new Map(),
  resolveSpecifier: (specifier: string) => string | undefined = () => undefined,
): { calls: ResolvedCall[]; queries: Array<{ model: string; method: string }> } {
  if (!body) return { calls: [], queries: [] };
  const calls: ResolvedCall[] = [];
  const queries: Array<{ model: string; method: string }> = [];
  const seen = new Set<string>();

  const visitCall = (call: CallExpression) => {
    const dynamicImport = tryResolveDynamicImportCall(call, resolveSpecifier);
    if (dynamicImport) {
      const key = `MODULE|${dynamicImport.resolvedFile ?? ""}|import|${dynamicImport.startLine ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push(dynamicImport);
      }
      return;
    }

    const fetchCall = tryResolveFetchCall(call);
    if (fetchCall) {
      const key = `EXTERNAL|${fetchCall.resolvedSymbol ?? "http"}|fetch|${fetchCall.startLine ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push(fetchCall);
      }
      return;
    }

    const prisma = tryResolvePrismaCall(call);
    if (prisma) {
      const key = `QUERY|${prisma.query.model}|${prisma.query.method}|${prisma.call.startLine ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push(prisma.call);
        queries.push(prisma.query);
      }
      return;
    }

    let resolved = resolveCallExpression(call, checker, rootDir, knownFiles);
    if (resolved.resolvedKind === "UNRESOLVED") {
      const fromBinding = tryResolveDynamicBindingCall(call, bindingMap);
      if (fromBinding) resolved = fromBinding;
    }

    const key = [
      resolved.resolvedKind,
      resolved.resolvedFile ?? "",
      resolved.resolvedClassName ?? "",
      resolved.resolvedSymbol ?? resolved.calleeName,
      resolved.startLine ?? 0,
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(resolved);
  };

  // Include the root node when it is itself a CallExpression
  // (e.g. `const loginHandler = compose(...)` — forEachDescendant skips self).
  if (body.getKind() === SyntaxKind.CallExpression) {
    visitCall(body.asKindOrThrow(SyntaxKind.CallExpression));
  }
  body.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    visitCall(node.asKindOrThrow(SyntaxKind.CallExpression));
  });

  return { calls, queries };
}

function parseSourceFileDetailed(
  sourceFile: SourceFile,
  content: string,
  relativePath: string,
  rootDir: string,
  knownFiles: Set<string>,
  checker: TypeChecker,
  resolveSpecifier: (specifier: string) => string | undefined,
): ParsedFile {
  const imports: ParsedImport[] = sourceFile.getImportDeclarations().map((imp) => {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    const resolvedSource = imp.getModuleSpecifierSourceFile();
    let resolvedPath: string | undefined;
    if (resolvedSource) {
      const abs = resolvedSource.getFilePath().replace(/\\/g, "/");
      if (!abs.includes("/node_modules/")) {
        const rel = toRepoRelative(rootDir, abs);
        resolvedPath = knownFiles.has(rel) ? rel : resolveImportPath(relativePath, moduleSpecifier, knownFiles);
      }
    } else {
      resolvedPath = resolveImportPath(relativePath, moduleSpecifier, knownFiles);
    }

    return {
      moduleSpecifier,
      namedImports: imp.getNamedImports().map((named) => named.getName()),
      defaultImport: imp.getDefaultImport()?.getText(),
      isTypeOnly: imp.isTypeOnly(),
      resolvedPath,
    };
  });

  const dynamic = collectDynamicImports(sourceFile, resolveSpecifier);
  imports.push(...dynamic.imports);
  const cjsImports = collectCommonJsRequires(sourceFile, resolveSpecifier);
  imports.push(...cjsImports);

  // Merge CJS destructured require bindings into the dynamic binding map
  // so `const { issueToken } = require("./tokens"); issueToken()` resolves.
  const bindingMap = new Map(dynamic.bindingMap);
  for (const imp of cjsImports) {
    if (!imp.resolvedPath) continue;
    for (const name of imp.namedImports) {
      if (!bindingMap.has(name)) {
        bindingMap.set(name, { modulePath: imp.resolvedPath, exportName: name });
      }
    }
    if (imp.defaultImport && !bindingMap.has(imp.defaultImport)) {
      bindingMap.set(imp.defaultImport, {
        modulePath: imp.resolvedPath,
        exportName: "*",
      });
    }
  }

  const exports: string[] = [];
  for (const decl of sourceFile.getExportedDeclarations()) {
    exports.push(decl[0]);
  }

  const functions: ParsedFunction[] = [];
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const collected = collectCallsInNode(
      fn.getBody(),
      checker,
      rootDir,
      knownFiles,
      bindingMap,
      resolveSpecifier,
    );
    functions.push({
      name,
      startLine: getLine(fn),
      endLine: getEndLine(fn),
      exported: fn.isExported(),
      calls: collected.calls,
      parameters: fn.getParameters().map((p) => p.getName()),
      queries: collected.queries.length ? collected.queries : undefined,
    });
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const kind = initializer.getKind();
      // Direct function binding: const login = () => { ... }
      // HOF binding: const loginHandler = compose(a, async () => { issueToken() })
      // — attribute nested callback calls to the outer const for impact analysis.
      if (
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.FunctionExpression ||
        kind === SyntaxKind.CallExpression
      ) {
        const collected = collectCallsInNode(
          initializer,
          checker,
          rootDir,
          knownFiles,
          bindingMap,
          resolveSpecifier,
        );
        if (
          kind === SyntaxKind.CallExpression &&
          collected.calls.length === 0 &&
          collected.queries.length === 0
        ) {
          continue;
        }
        functions.push({
          name: declaration.getName(),
          startLine: getLine(declaration),
          endLine: getEndLine(declaration),
          exported: statement.isExported(),
          calls: collected.calls,
          parameters: [],
          queries: collected.queries.length ? collected.queries : undefined,
        });
      }
    }
  }

  const classes: ParsedClass[] = sourceFile.getClasses().map((cls) => {
    const className = cls.getName() ?? "AnonymousClass";
    const methods: ParsedMethod[] = cls.getMethods().map((method) => {
      const collected = collectCallsInNode(
        method.getBody(),
        checker,
        rootDir,
        knownFiles,
        bindingMap,
        resolveSpecifier,
      );
      return {
        name: method.getName(),
        className,
        startLine: getLine(method),
        endLine: getEndLine(method),
        calls: collected.calls,
        parameters: method.getParameters().map((p) => p.getName()),
        decorators: extractDecoratorMeta(method),
        queries: collected.queries.length ? collected.queries : undefined,
      };
    });

    return {
      name: className,
      startLine: getLine(cls),
      endLine: getEndLine(cls),
      exported: cls.isExported(),
      extends: cls.getExtends()?.getText(),
      implements: cls.getImplements().map((i) => i.getText()),
      methods,
      dependencies: extractConstructorDependencies(cls),
      decorators: extractDecoratorMeta(cls),
    };
  });

  return {
    path: relativePath,
    language: languageFromPath(relativePath),
    imports,
    exports,
    functions,
    classes,
    envVariables: extractEnvVariables(content),
    isTest: isTestFile(relativePath),
  };
}

/**
 * Legacy single-file parser — kept for simple tooling.
 * Prefer {@link parseRepository} for accurate cross-file symbol resolution.
 */
export class TypeScriptParser implements LanguageParser {
  parseFile(filePath: string, content: string): ParsedFile {
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
    const known = new Set([filePath]);
    const resolveSpecifier = (specifier: string) =>
      resolveImportPath(filePath, specifier, known);
    return parseSourceFileDetailed(
      sourceFile,
      content,
      filePath,
      "",
      known,
      project.getTypeChecker(),
      resolveSpecifier,
    );
  }
}

export async function inventoryRepositoryFiles(rootDir: string): Promise<{
  codeFiles: string[];
  filesIgnored: number;
  filesUnsupported: number;
  allRelativeFiles: string[];
}> {
  const codeFiles: string[] = [];
  const allRelativeFiles: string[] = [];
  let filesIgnored = 0;
  let filesUnsupported = 0;

  async function walk(current: string, relative = ""): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      const normalized = rel.replace(/\\/g, "/");
      if (shouldIgnore(rel)) {
        filesIgnored += 1;
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, rel);
      } else if (entry.isFile()) {
        allRelativeFiles.push(normalized);
        if (isCodeFile(rel)) {
          try {
            const info = await stat(absolute);
            if (info.size <= 1_500_000) {
              codeFiles.push(normalized);
            } else {
              filesUnsupported += 1;
            }
          } catch {
            filesUnsupported += 1;
          }
        } else if (
          !/\.(md|json|ya?ml|toml|lock|svg|png|jpg|gif|webp|ico|woff2?|ttf|css|scss|html|txt|env|example)$/i.test(
            normalized,
          )
        ) {
          filesUnsupported += 1;
        }
      }
    }
  }

  await walk(rootDir);
  codeFiles.sort();
  return { codeFiles, filesIgnored, filesUnsupported, allRelativeFiles };
}

export async function listCodeFiles(rootDir: string): Promise<string[]> {
  const { codeFiles } = await inventoryRepositoryFiles(rootDir);
  return codeFiles;
}

/**
 * Repository-level TypeScript project with shared TypeChecker.
 * Enables deterministic CallExpression → Symbol → Declaration resolution.
 */
export async function parseRepository(
  rootDir: string,
  options?: {
    maxFiles?: number;
    pathAliases?: Record<string, string[]>;
  },
): Promise<{
  files: ParsedFile[];
  languages: LanguageStats[];
  frameworks: string[];
  contentsByPath: Map<string, string>;
  packageDeps: Record<string, string>;
  packageName?: string;
  packageNames?: string[];
  analysisHealth: AnalysisHealth;
  allRelativeFiles: string[];
  pythonProject: PythonProjectInfo | null;
}> {
  const inventory = await inventoryRepositoryFiles(rootDir);
  const relativePaths = inventory.codeFiles;
  const maxFiles = options?.maxFiles ?? 2_500;
  const limited = relativePaths.slice(0, maxFiles);
  const truncated = relativePaths.length > limited.length;
  const contentsByPath = new Map<string, string>();
  const knownFiles = new Set(limited);
  const pathAliases =
    options?.pathAliases ?? (await readPathAliases(rootDir));
  let parseFailures = 0;

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: 4,
      target: 99,
      module: 99,
      moduleResolution: 100,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      noEmit: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      baseUrl: ".",
      paths: pathAliases,
    },
  });

  const jsTsFiles = limited.filter((p) => !p.replace(/\\/g, "/").endsWith(".py"));
  const pythonFiles = limited.filter((p) => p.replace(/\\/g, "/").endsWith(".py"));

  for (const relativePath of jsTsFiles) {
    const absolute = path.join(rootDir, relativePath);
    try {
      const content = await readFile(absolute, "utf8");
      contentsByPath.set(relativePath, content);
      project.createSourceFile(relativePath, content, { overwrite: true });
    } catch {
      parseFailures += 1;
      continue;
    }
  }

  for (const relativePath of pythonFiles) {
    const absolute = path.join(rootDir, relativePath);
    try {
      const content = await readFile(absolute, "utf8");
      contentsByPath.set(relativePath, content);
    } catch {
      parseFailures += 1;
    }
  }

  const checker = project.getTypeChecker();
  const files: ParsedFile[] = [];

  for (const relativePath of jsTsFiles) {
    const content = contentsByPath.get(relativePath);
    if (!content) continue;
    const sourceFile = project.getSourceFile(relativePath);
    if (!sourceFile) continue;
    try {
      const resolveSpecifier = (specifier: string) =>
        resolveImportPath(relativePath, specifier, knownFiles) ??
        resolveAliasImport(specifier, pathAliases, knownFiles);
      const parsed = parseSourceFileDetailed(
        sourceFile,
        content,
        relativePath,
        rootDir,
        knownFiles,
        checker,
        resolveSpecifier,
      );
      for (const imp of parsed.imports) {
        if (imp.resolvedPath) continue;
        imp.resolvedPath =
          resolveImportPath(relativePath, imp.moduleSpecifier, knownFiles) ??
          resolveAliasImport(imp.moduleSpecifier, pathAliases, knownFiles);
      }
      files.push(parsed);
    } catch {
      parseFailures += 1;
      continue;
    }
  }

  const pythonKnown = new Set(
    [...knownFiles].map((p) => p.replace(/\\/g, "/")).filter((p) => p.endsWith(".py")),
  );
  for (const relativePath of pythonFiles) {
    const content = contentsByPath.get(relativePath);
    if (!content) continue;
    try {
      files.push(parsePythonFile(relativePath, content, pythonKnown));
    } catch {
      parseFailures += 1;
    }
  }
  linkPythonCalls(files);

  const packageManifest = await readPackageManifest(rootDir);
  const packageDeps = packageManifest.deps;
  const frameworks = await detectFrameworks(
    rootDir,
    files,
    packageDeps,
    packageManifest.name,
    packageManifest.packageNames,
  );
  const pythonProject = await detectPythonProject(rootDir, inventory.allRelativeFiles);

  return {
    files,
    languages: detectLanguages(files),
    frameworks,
    contentsByPath,
    packageDeps,
    packageName: packageManifest.name,
    packageNames: packageManifest.packageNames,
    allRelativeFiles: inventory.allRelativeFiles,
    pythonProject,
    analysisHealth: {
      filesDiscovered: relativePaths.length,
      filesParsed: files.length,
      filesIgnored: inventory.filesIgnored,
      filesUnsupported: inventory.filesUnsupported,
      parseFailures,
      maxFilesCap: maxFiles,
      truncated,
      pythonProject: pythonProject ?? undefined,
    },
  };
}

async function readPathAliases(rootDir: string): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(path.join(rootDir, "tsconfig.json"), "utf8");
    // Strip simple trailing commas / comments for fixture tsconfigs
    const cleaned = raw.replace(/,\s*([}\]])/g, "$1").replace(/\/\/.*$/gm, "");
    const json = JSON.parse(cleaned) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    return json.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

function resolveAliasImport(
  moduleSpecifier: string,
  aliases: Record<string, string[]>,
  knownFiles: Set<string>,
): string | undefined {
  for (const [pattern, targets] of Object.entries(aliases)) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // keep trailing behavior: "@/*" -> "@/"
      const aliasRoot = pattern.slice(0, -2); // "@"
      if (!moduleSpecifier.startsWith(aliasRoot + "/")) continue;
      const rest = moduleSpecifier.slice(aliasRoot.length + 1);
      for (const target of targets) {
        const base = target.endsWith("/*") ? target.slice(0, -1) + rest : target;
        const hit = resolveImportPath(".", "./" + base.replace(/^\.\//, ""), knownFiles)
          ?? tryKnown(base.replace(/^\.\//, ""), knownFiles);
        if (hit) return hit;
      }
      void prefix;
    } else if (moduleSpecifier === pattern) {
      for (const target of targets) {
        const normalized = target.replace(/^\.\//, "");
        const hit = tryKnown(normalized, knownFiles);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

function tryKnown(candidate: string, knownFiles: Set<string>): string | undefined {
  const variants = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
  ];
  for (const v of variants) {
    if (knownFiles.has(v)) return v;
  }
  return undefined;
}

async function readJsonPackage(
  filePath: string,
): Promise<{
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
} | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as {
      name?: string;
      private?: boolean;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      workspaces?: string[] | { packages?: string[] };
    };
  } catch {
    return null;
  }
}

function prodAndPeerDeps(pkg: {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}): Record<string, string> {
  const peers = { ...pkg.peerDependencies };
  for (const [name, meta] of Object.entries(pkg.peerDependenciesMeta ?? {})) {
    if (meta?.optional) delete peers[name];
  }
  return {
    ...pkg.dependencies,
    ...peers,
  };
}

async function listWorkspacePackageDirs(rootDir: string): Promise<string[]> {
  const dirs = new Set<string>();
  const addChildren = async (baseRel: string) => {
    const abs = path.join(rootDir, baseRel);
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules") {
          dirs.add(path.join(abs, entry.name));
        }
      }
    } catch {
      // missing dir
    }
  };

  const rootPkg = await readJsonPackage(path.join(rootDir, "package.json"));
  const workspaceGlobs = Array.isArray(rootPkg?.workspaces)
    ? rootPkg.workspaces
    : rootPkg?.workspaces?.packages ?? [];
  for (const glob of workspaceGlobs) {
    if (typeof glob !== "string") continue;
    if (glob.endsWith("/*")) {
      await addChildren(glob.slice(0, -2));
    }
  }

  // Common monorepo layouts even when workspaces field is missing / pnpm-only
  await addChildren("packages");
  await addChildren("apps");

  try {
    const pnpmWs = await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8");
    for (const match of pnpmWs.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) {
      const glob = match[1]?.trim();
      if (!glob || glob.startsWith("!")) continue;
      if (glob.endsWith("/*")) await addChildren(glob.slice(0, -2));
    }
  } catch {
    // no pnpm workspace file
  }

  // Also probe top-level package dirs used by flat monorepos (drizzle-*, etc.)
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (["packages", "apps", "node_modules", "docs", "examples"].includes(entry.name)) {
        continue;
      }
      const pkgPath = path.join(rootDir, entry.name, "package.json");
      try {
        await access(pkgPath);
        dirs.add(path.join(rootDir, entry.name));
      } catch {
        // no package.json
      }
    }
  } catch {
    // ignore
  }

  return [...dirs];
}

function shortPackageName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split("/");
    return parts[1] ?? trimmed;
  }
  return trimmed;
}

function isToolingOrDocsPackage(name: string): boolean {
  const short = shortPackageName(name);
  return /(?:^|-)(docs?|documentation|website|www|bench(?:mark)?s?|examples?|e2e|integration|treeshake|tsc|perf|native|playground)$/i.test(
    short,
  );
}

function pickPrimaryPackageName(
  rootName: string | undefined,
  workspaceNames: string[],
): string | undefined {
  const avoid = /(?:^|-)(project|monorepo|web|website|docs|examples?)$/i;
  const knownProduct = (n: string) => {
    const short = shortPackageName(n);
    return (
      /^(zod|solid-js|drizzle-orm|lit|bullmq|zustand|remix|express|fastify|hono|koa|msw|payload|vite|preact|formik)$/i.test(
        short,
      ) ||
      n === "@trpc/server" ||
      n === "@tanstack/query-core" ||
      n === "@tanstack/react-query" ||
      n.startsWith("@remix-run/") ||
      n === "payload" ||
      n.startsWith("@payloadcms/payload") ||
      n === "@nestjs/core"
    );
  };
  const isIntegrationPackage = (n: string) => {
    const short = shortPackageName(n);
    return /^(next|react-query|tanstack-react-query|express|fastify|nestjs|openapi|upgrade|devtools)$/i.test(
      short,
    );
  };
  const candidates = workspaceNames.filter(
    (n) => n && !avoid.test(shortPackageName(n)) && !isToolingOrDocsPackage(n),
  );
  // Prefer known product packages, then unscoped, then remaining workspace names.
  const known = candidates.filter(knownProduct);
  const unscoped = candidates.filter((n) => !n.startsWith("@"));
  const pool =
    known.length > 0 ? known : unscoped.length > 0 ? unscoped : candidates;
  const scored = pool
    .map((n) => ({
      name: n,
      short: shortPackageName(n),
      score:
        (n.startsWith("@") ? 10 : 0) +
        shortPackageName(n).length +
        (knownProduct(n) ? -40 : 0) +
        (isIntegrationPackage(n) ? 40 : 0) +
        (/^(server|core|orm|runtime)$/i.test(shortPackageName(n)) ? -25 : 0) +
        (/adapter|plugin|create-|eslint|config|devtools/i.test(n) ? 20 : 0),
    }))
    .sort((a, b) => a.score - b.score);
  if (scored[0]?.name) {
    return scored[0].name;
  }
  if (rootName && !avoid.test(shortPackageName(rootName)) && !isToolingOrDocsPackage(rootName)) {
    return rootName;
  }
  return rootName;
}

async function readPackageManifest(rootDir: string): Promise<{
  name?: string;
  deps: Record<string, string>;
  packageNames: string[];
}> {
  const rootPkg = await readJsonPackage(path.join(rootDir, "package.json"));
  if (!rootPkg) {
    return { deps: {}, packageNames: [] };
  }

  const packageNames = new Set<string>();
  if (rootPkg.name) packageNames.add(rootPkg.name);

  const workspaceDirs = await listWorkspacePackageDirs(rootDir);
  const workspacePkgs: Array<{ dir: string; name?: string; deps: Record<string, string> }> =
    [];

  for (const dir of workspaceDirs.slice(0, 60)) {
    const base = path.basename(dir);
    if (isToolingOrDocsPackage(base)) continue;
    const pkg = await readJsonPackage(path.join(dir, "package.json"));
    if (!pkg) continue;
    if (pkg.name && isToolingOrDocsPackage(pkg.name)) continue;
    if (pkg.name) packageNames.add(pkg.name);
    workspacePkgs.push({ dir, name: pkg.name, deps: prodAndPeerDeps(pkg) });
  }

  const names = [...packageNames];
  const primaryName =
    pickPrimaryPackageName(rootPkg.name, names) ?? rootPkg.name;

  // Framework signals use the primary package only — never merge every adapter/docs peer.
  let deps = prodAndPeerDeps(rootPkg);
  if (primaryName) {
    const primaryShort = shortPackageName(primaryName);
    const match = workspacePkgs.find(
      (p) =>
        p.name === primaryName ||
        (p.name && shortPackageName(p.name) === primaryShort) ||
        path.basename(p.dir) === primaryShort ||
        path.basename(p.dir) === primaryName,
    );
    if (match) {
      deps = match.deps;
    }
  }

  return {
    name: primaryName,
    deps,
    packageNames: names,
  };
}

export function detectLanguages(files: ParsedFile[]): LanguageStats[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const label =
      file.language === "python"
        ? "Python"
        : file.language === "tsx" || file.language === "typescript"
          ? "TypeScript"
          : "JavaScript";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = files.length || 1;
  return [...counts.entries()]
    .map(([language, fileCount]) => ({
      language,
      fileCount,
      percentage: Math.round((fileCount / total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

export async function detectFrameworks(
  rootDir: string,
  files: ParsedFile[],
  packageDeps?: Record<string, string>,
  packageName?: string,
  packageNames: string[] = [],
): Promise<string[]> {
  const manifest =
    packageDeps && packageName !== undefined
      ? { deps: packageDeps, name: packageName, packageNames }
      : await readPackageManifest(rootDir);
  const deps = packageDeps ?? manifest.deps;
  const name = packageName ?? manifest.name;
  const workspaceNames =
    packageNames.length > 0 ? packageNames : manifest.packageNames;
  const workspace = new Set(
    [name, ...workspaceNames].filter(Boolean) as string[],
  );
  const hasWorkspace = (...candidates: string[]) =>
    candidates.some((c) => workspace.has(c));
  const hasWorkspacePrefix = (...prefixes: string[]) =>
    [...workspace].some((n) => prefixes.some((p) => n.startsWith(p)));
  // Short-name match only for unambiguous unscoped packages (avoid @trpc/react-query → "react-query").
  const hasWorkspaceShort = (...shorts: string[]) =>
    shorts.some(
      (s) =>
        workspace.has(s) ||
        [...workspace].some((n) => !n.startsWith("@") && shortPackageName(n) === s),
    );
  const frameworks = new Set<string>();

  const isPrimary = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    return (
      !/(^|\/)(__(tests|mocks)__|tests?|spec|fixtures?|examples?|demos?|samples?|playgrounds?|docs(?:-v\d+)?|documentation|www|website|bench(?:mark)?s?|e2e)\//i.test(
        normalized,
      ) && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(normalized)
    );
  };

  if (deps.next) frameworks.add("Next.js");
  if (deps.react) frameworks.add("React");
  if (deps["@nestjs/core"] || hasWorkspace("@nestjs/core")) frameworks.add("NestJS");
  if (hasWorkspace("express") || hasWorkspaceShort("express")) {
    frameworks.add("Express");
  } else if (
    files.some(
      (file) =>
        isPrimary(file.path) &&
        file.imports.some(
          (imp) =>
            !imp.isTypeOnly &&
            (imp.moduleSpecifier === "express" ||
              imp.moduleSpecifier.startsWith("express/")),
        ),
    )
  ) {
    frameworks.add("Express");
  }
  if (deps.fastify || hasWorkspace("fastify") || hasWorkspaceShort("fastify")) {
    frameworks.add("Fastify");
  }
  if (deps.hono || hasWorkspace("hono") || hasWorkspaceShort("hono")) frameworks.add("Hono");
  if (deps.koa || hasWorkspace("koa") || hasWorkspaceShort("koa")) frameworks.add("Koa");
  if (deps.vue) frameworks.add("Vue");
  if (deps["@angular/core"]) frameworks.add("Angular");
  if (deps.prisma || deps["@prisma/client"]) frameworks.add("Prisma");
  if (hasWorkspace("socket.io") || hasWorkspaceShort("socket.io") || deps["socket.io"]) {
    frameworks.add("Socket.IO");
  }
  if (hasWorkspace("msw") || hasWorkspaceShort("msw") || deps.msw) frameworks.add("MSW");
  if (hasWorkspace("preact") || hasWorkspaceShort("preact") || deps.preact) {
    frameworks.add("Preact");
  }
  if (hasWorkspace("formik") || hasWorkspaceShort("formik") || deps.formik) {
    frameworks.add("Formik");
  }
  if (hasWorkspace("vite") || hasWorkspaceShort("vite") || deps.vite) frameworks.add("Vite");
  if (hasWorkspace("zod") || hasWorkspaceShort("zod") || deps.zod) frameworks.add("Zod");
  if (
    hasWorkspace("solid-js") ||
    hasWorkspaceShort("solid-js", "solid") ||
    deps["solid-js"]
  ) {
    frameworks.add("Solid");
  }
  if (hasWorkspace("drizzle-orm") || hasWorkspaceShort("drizzle-orm") || deps["drizzle-orm"]) {
    frameworks.add("Drizzle");
  }
  if (
    hasWorkspace("remix") ||
    hasWorkspaceShort("remix") ||
    hasWorkspacePrefix("@remix-run/") ||
    deps["@remix-run/react"] ||
    deps["@remix-run/node"]
  ) {
    frameworks.add("Remix");
  }
  if (
    hasWorkspace("lit") ||
    hasWorkspaceShort("lit") ||
    deps.lit ||
    deps["@lit/reactive-element"]
  ) {
    frameworks.add("Lit");
  }
  if (hasWorkspace("bullmq") || hasWorkspaceShort("bullmq") || deps.bullmq) {
    frameworks.add("BullMQ");
  }
  if (hasWorkspace("zustand") || hasWorkspaceShort("zustand") || deps.zustand) {
    frameworks.add("Zustand");
  }
  if (
    hasWorkspace("trpc") ||
    hasWorkspacePrefix("@trpc/") ||
    deps["@trpc/server"] ||
    deps["@trpc/client"]
  ) {
    frameworks.add("tRPC");
  }
  if (
    hasWorkspace("@tanstack/query-core") ||
    hasWorkspace("@tanstack/react-query") ||
    hasWorkspacePrefix("@tanstack/query-") ||
    deps["@tanstack/query-core"] ||
    deps["@tanstack/react-query"]
  ) {
    frameworks.add("TanStack Query");
  }
  if (
    hasWorkspace("payload") ||
    hasWorkspaceShort("payload") ||
    hasWorkspacePrefix("@payloadcms/") ||
    deps.payload ||
    deps["@payloadcms/db-mongodb"]
  ) {
    frameworks.add("Payload");
  }

  const primaryPaths = files.filter((f) => isPrimary(f.path)).map((f) => f.path);
  const joined = primaryPaths.join("\n");
  if (joined.includes("app/api/") || joined.includes("pages/api/")) {
    frameworks.add("Next.js");
  }

  const pythonFrameworks = await detectPythonFrameworks(rootDir, files);
  for (const fw of pythonFrameworks) frameworks.add(fw);

  return [...frameworks];
}

async function detectPythonFrameworks(
  rootDir: string,
  files: ParsedFile[],
): Promise<string[]> {
  const names = new Set<string>();
  const hasPy = files.some((f) => f.language === "python");
  if (!hasPy) return [];

  const depTextParts: string[] = [];
  for (const candidate of [
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "setup.cfg",
    "setup.py",
    "Pipfile",
    "uv.lock",
    "poetry.lock",
  ]) {
    try {
      depTextParts.push(await readFile(path.join(rootDir, candidate), "utf8"));
    } catch {
      // missing
    }
  }
  const blob = depTextParts.join("\n").toLowerCase();
  if (/^\s*flask[\s=\[]/m.test(blob) || /\bflask\b/.test(blob)) names.add("Flask");
  if (/fastapi/.test(blob)) names.add("FastAPI");
  if (/django/.test(blob)) names.add("Django");
  if (/celery/.test(blob)) names.add("Celery");
  if (/sqlalchemy/.test(blob)) names.add("SQLAlchemy");

  // Import-based fallback when manifests are sparse
  const importBlob = files
    .filter((f) => f.language === "python")
    .flatMap((f) => f.imports.map((i) => i.moduleSpecifier))
    .join("\n")
    .toLowerCase();
  if (/(^|\n)flask(\.|$)/m.test(importBlob) || importBlob.includes("flask")) {
    names.add("Flask");
  }
  if (importBlob.includes("fastapi")) names.add("FastAPI");
  if (importBlob.includes("django")) names.add("Django");

  return [...names];
}

export function resolveImportPath(
  fromFile: string,
  moduleSpecifier: string,
  knownFiles: Set<string>,
): string | undefined {
  if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("/")) {
    return undefined;
  }

  const fromDir = path.posix.dirname(fromFile);
  const unresolved = path.posix.normalize(path.posix.join(fromDir, moduleSpecifier));
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.js`,
    `${unresolved}.jsx`,
    `${unresolved}.mjs`,
    `${unresolved}.cjs`,
    `${unresolved}/index.ts`,
    `${unresolved}/index.tsx`,
    `${unresolved}/index.js`,
    `${unresolved}/index.jsx`,
  ];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\.\//, "");
    if (knownFiles.has(normalized)) return normalized;
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}

export type { ConfidenceLevel, TypeFormatFlags };
export {
  parseChangedLinesFromPatch,
  parseChangedLineRangesFromPatch,
  reconstructOldContent,
  findEnclosingSymbols,
  mapPatchToEnclosingSymbols,
  enclosingSymbolToNodeId,
  type EnclosingSymbol,
  type ChangedLineRanges,
} from "./diff-to-ast.js";
export {
  analyzeSemanticDiff,
  extractSymbolSnapshots,
  semanticEventsToChangeCategory,
  type SemanticChangeKind,
  type SemanticChangeEvent,
  type SemanticDiffResult,
} from "./semantic-diff.js";
