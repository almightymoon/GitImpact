import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  Project,
  SyntaxKind,
  type SourceFile,
  type Node,
} from "ts-morph";
import {
  CODE_EXTENSIONS,
  IGNORE_PATTERNS,
  SECRET_PATTERNS,
  type LanguageStats,
  type ParsedFile,
  type ParsedFunction,
  type ParsedClass,
  type ParsedImport,
} from "@gitimpact/shared";

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

function languageFromPath(
  filePath: string,
): ParsedFile["language"] {
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

function extractCalls(bodyText: string): string[] {
  const calls = new Set<string>();
  const regex = /\b([A-Za-z_][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  const keywords = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "return",
    "typeof",
    "new",
    "await",
    "super",
    "constructor",
  ]);
  while ((match = regex.exec(bodyText)) !== null) {
    const name = match[1];
    if (!keywords.has(name)) {
      calls.add(name);
    }
  }
  return [...calls];
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
    return this.parseSourceFile(sourceFile, content);
  }

  private parseSourceFile(sourceFile: SourceFile, content: string): ParsedFile {
    const filePath = sourceFile.getFilePath();

    const imports: ParsedImport[] = sourceFile.getImportDeclarations().map((imp) => ({
      moduleSpecifier: imp.getModuleSpecifierValue(),
      namedImports: imp.getNamedImports().map((named) => named.getName()),
      defaultImport: imp.getDefaultImport()?.getText(),
      isTypeOnly: imp.isTypeOnly(),
    }));

    const exports: string[] = [];
    for (const decl of sourceFile.getExportedDeclarations()) {
      exports.push(decl[0]);
    }

    const functions: ParsedFunction[] = [];
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      functions.push({
        name,
        startLine: getLine(fn),
        endLine: getEndLine(fn),
        exported: fn.isExported(),
        calls: extractCalls(fn.getBodyText() ?? ""),
        parameters: fn.getParameters().map((p) => p.getName()),
      });
    }

    for (const statement of sourceFile.getVariableStatements()) {
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer) continue;
        if (
          initializer.getKind() === SyntaxKind.ArrowFunction ||
          initializer.getKind() === SyntaxKind.FunctionExpression
        ) {
          const name = declaration.getName();
          functions.push({
            name,
            startLine: getLine(declaration),
            endLine: getEndLine(declaration),
            exported: statement.isExported(),
            calls: extractCalls(initializer.getText()),
            parameters: [],
          });
        }
      }
    }

    const classes: ParsedClass[] = sourceFile.getClasses().map((cls) => {
      const name = cls.getName() ?? "AnonymousClass";
      return {
        name,
        startLine: getLine(cls),
        endLine: getEndLine(cls),
        exported: cls.isExported(),
        extends: cls.getExtends()?.getText(),
        implements: cls.getImplements().map((i) => i.getText()),
        methods: cls.getMethods().map((m) => m.getName()),
      };
    });

    return {
      path: filePath,
      language: languageFromPath(filePath),
      imports,
      exports,
      functions,
      classes,
      envVariables: extractEnvVariables(content),
      isTest: isTestFile(filePath),
    };
  }
}

export async function listCodeFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, relative = ""): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      if (shouldIgnore(rel)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, rel);
      } else if (entry.isFile() && isCodeFile(rel)) {
        const info = await stat(absolute);
        // Skip unusually large files
        if (info.size <= 1_500_000) {
          results.push(rel.replace(/\\/g, "/"));
        }
      }
    }
  }

  await walk(rootDir);
  return results.sort();
}

export async function parseRepository(
  rootDir: string,
  options?: { maxFiles?: number },
): Promise<{
  files: ParsedFile[];
  languages: LanguageStats[];
  frameworks: string[];
  contentsByPath: Map<string, string>;
  packageDeps: Record<string, string>;
}> {
  const parser = new TypeScriptParser();
  const relativePaths = await listCodeFiles(rootDir);
  const limited = relativePaths.slice(0, options?.maxFiles ?? 2_500);
  const files: ParsedFile[] = [];
  const contentsByPath = new Map<string, string>();

  for (const relativePath of limited) {
    const absolute = path.join(rootDir, relativePath);
    try {
      const content = await readFile(absolute, "utf8");
      contentsByPath.set(relativePath, content);
      const parsed = parser.parseFile(relativePath, content);
      parsed.path = relativePath;
      files.push(parsed);
    } catch {
      // Skip files that fail to parse — never execute repo code
      continue;
    }
  }

  const packageDeps = await readPackageDeps(rootDir);
  const frameworks = await detectFrameworks(rootDir, files, packageDeps);

  return {
    files,
    languages: detectLanguages(files),
    frameworks,
    contentsByPath,
    packageDeps,
  };
}

async function readPackageDeps(rootDir: string): Promise<Record<string, string>> {
  try {
    const pkgRaw = await readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
  } catch {
    return {};
  }
}

export function detectLanguages(files: ParsedFile[]): LanguageStats[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const label =
      file.language === "tsx" || file.language === "typescript"
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
): Promise<string[]> {
  const deps = packageDeps ?? (await readPackageDeps(rootDir));
  const frameworks = new Set<string>();

  if (deps.next) frameworks.add("Next.js");
  if (deps.react) frameworks.add("React");
  if (deps["@nestjs/core"]) frameworks.add("NestJS");
  if (deps.express) frameworks.add("Express");
  if (deps.fastify) frameworks.add("Fastify");
  if (deps.vue) frameworks.add("Vue");
  if (deps["@angular/core"]) frameworks.add("Angular");
  if (deps.prisma || deps["@prisma/client"]) frameworks.add("Prisma");
  if (deps["drizzle-orm"]) frameworks.add("Drizzle");

  const joined = files.map((f) => f.path).join("\n");
  if (joined.includes("app/api/") || joined.includes("pages/api/")) {
    frameworks.add("Next.js");
  }

  return [...frameworks];
}

export function resolveImportPath(
  fromFile: string,
  moduleSpecifier: string,
  knownFiles: Set<string>,
): string | undefined {
  if (
    !moduleSpecifier.startsWith(".") &&
    !moduleSpecifier.startsWith("/")
  ) {
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
