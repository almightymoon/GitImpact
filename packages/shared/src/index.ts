export type NodeType =
  | "FILE"
  | "FUNCTION"
  | "METHOD"
  | "CLASS"
  | "MODULE"
  | "API_ROUTE"
  | "SERVICE"
  | "CONTROLLER"
  | "DATABASE_MODEL"
  | "DATABASE_TABLE"
  | "COMPONENT"
  | "HOOK"
  | "EVENT"
  | "QUEUE"
  | "CONFIG"
  | "ENV_VARIABLE"
  | "TEST"
  | "PACKAGE"
  | "EXTERNAL_SERVICE"
  | "INFRASTRUCTURE";

export type RelationType =
  | "IMPORTS"
  | "CALLS"
  | "USES"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "READS"
  | "WRITES"
  | "QUERIES"
  | "EMITS"
  | "LISTENS_TO"
  | "DEPENDS_ON"
  | "HANDLED_BY"
  | "TESTS"
  | "RENDERS"
  | "FETCHES"
  | "CONFIGURES"
  | "DEPLOYS"
  | "EXPORTS"
  | "CONTAINS";

export type ChangeCategory =
  | "STRUCTURAL"
  | "INTERFACE"
  | "BEHAVIORAL"
  | "CONFIGURATION";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type ImpactSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "NEUTRAL";

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  file: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  confidence: ConfidenceLevel;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ParsedImport {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
  resolvedPath?: string;
  /** True when sourced from `import("...")` rather than a static ImportDeclaration */
  isDynamic?: boolean;
}

export interface ResolvedCall {
  /** Display / callee name as written in source (e.g. save, generateToken) */
  calleeName: string;
  /** Exact repository-relative file of the resolved declaration, if known */
  resolvedFile?: string;
  /** Function or method name of the declaration */
  resolvedSymbol?: string;
  /** Owning class when the declaration is a method */
  resolvedClassName?: string;
  resolvedKind: "FUNCTION" | "METHOD" | "CLASS" | "MODULE" | "QUERY" | "UNRESOLVED";
  confidence: ConfidenceLevel;
  startLine?: number;
}

export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  calls: ResolvedCall[];
  parameters: string[];
  /** Prisma-style model queries discovered in this function */
  queries?: Array<{ model: string; method: string }>;
}

export interface ParsedMethod {
  name: string;
  className: string;
  startLine: number;
  endLine: number;
  calls: ResolvedCall[];
  parameters: string[];
  decorators?: Array<{ name: string; args: string[] }>;
  queries?: Array<{ model: string; method: string }>;
}

export interface ParsedClass {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  extends?: string;
  implements: string[];
  methods: ParsedMethod[];
  /** Constructor-injected type names (NestJS-style DI) */
  dependencies?: Array<{ paramName: string; typeName: string }>;
  /** Class-level Nest-style decorators (Controller, Injectable, …) */
  decorators?: Array<{ name: string; args: string[] }>;
}

export interface ParsedFile {
  path: string;
  language: "typescript" | "javascript" | "tsx" | "jsx";
  imports: ParsedImport[];
  exports: string[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
  envVariables: string[];
  isTest: boolean;
}

export interface LanguageStats {
  language: string;
  percentage: number;
  fileCount: number;
}

export interface RepositoryMeta {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  clonePath?: string;
}

export interface AnalysisSummary {
  files: number;
  functions: number;
  classes: number;
  dependencies: number;
  tests: number;
  apiRoutes: number;
  languages: LanguageStats[];
  frameworks: string[];
}

export interface ImpactedNode {
  node: GraphNode;
  depth: number;
  severity: ImpactSeverity;
  relationshipPath: string[];
  confidence: ConfidenceLevel;
}

export interface ImpactPathStep {
  nodeId: string;
  name: string;
  file: string;
  type: NodeType;
  edgeType?: RelationType;
}

export interface ComplexityFactor {
  label: string;
  points: number;
  detail: string;
}

export interface ImpactReport {
  changedNodes: GraphNode[];
  directImpact: ImpactedNode[];
  indirectImpact: ImpactedNode[];
  affectedFiles: string[];
  affectedApis: GraphNode[];
  relatedTests: GraphNode[];
  missingTests: GraphNode[];
  maxDepth: number;
  complexityScore: number;
  complexityBreakdown: ComplexityFactor[];
  summary: string;
}

export interface ChangeRecord {
  filePath: string;
  changeType: ChangeCategory;
  symbolName?: string;
  symbols?: string[];
  status?: string;
  patch?: string;
  oldValue?: string;
  newValue?: string;
  startLine?: number;
  endLine?: number;
  /** Precise AST semantic events (v0.4 Semantic Diff Engine) */
  semanticEvents?: Array<{
    kind: string;
    symbolId: string;
    file: string;
    name: string;
    className?: string;
    details?: Record<string, unknown>;
  }>;
}

export interface PullRequestMeta {
  owner: string;
  repo: string;
  number: number;
  title: string;
  baseBranch: string;
  headBranch: string;
  headSha?: string;
  url: string;
}

export interface PullRequestImpactOverview {
  filesChanged: number;
  functionsModified: number;
  directDependencies: number;
  indirectDependencies: number;
  apiRoutesAffected: number;
  databaseModelsAffected: number;
  frontendComponentsAffected: number;
  relevantTests: number;
  potentialMissingTests: number;
  complexityScore: number;
  impactLevel: "Low" | "Moderate" | "Elevated" | "Critical";
  summary: string;
  changedFiles: string[];
  changeBreakdown: Record<ChangeCategory, number>;
}

export interface AnalyzeRepositoryRequest {
  repository: string;
  depth?: number;
}

export interface AnalyzeImpactRequest {
  nodeId: string;
  depth?: number;
}

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"
  | "ALL"
  | "USE";

export interface DetectedRoute {
  id: string;
  framework: "nextjs" | "express" | "nestjs" | "unknown";
  method: HttpMethod;
  path: string;
  file: string;
  handlerName?: string;
  /** Owning class for NestJS controller methods */
  handlerClass?: string;
  confidence: ConfidenceLevel;
  startLine?: number;
}

export const IGNORE_PATTERNS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".git",
  "out",
  "tmp",
  "__pycache__",
  ".venv",
  "venv",
] as const;

export const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export const SECRET_PATTERNS = [
  /^\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /credentials\.json$/i,
  /id_rsa/,
  /secret/i,
] as const;
