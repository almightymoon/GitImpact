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
  /** Why this relationship exists — file:line, snippet, resolution path. */
  evidence?: GraphEdgeEvidence;
}

export interface GraphEdgeEvidence {
  /** Source file where the relationship was observed */
  file: string;
  startLine?: number;
  /** Short source snippet (e.g. `authService.login(...)`) */
  snippet?: string;
  /** How the target was resolved (import path, symbol binding, etc.) */
  resolvedThrough?: string;
  /** Callee / import name as written in source */
  symbol?: string;
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
  resolvedKind: "FUNCTION" | "METHOD" | "CLASS" | "MODULE" | "QUERY" | "EXTERNAL" | "UNRESOLVED";
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
  language: "typescript" | "javascript" | "tsx" | "jsx" | "python";
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
  ".py",
] as const;

export const SECRET_PATTERNS = [
  /^\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /credentials\.json$/i,
  /id_rsa/,
  /secret/i,
] as const;

/** Broad repository classification for UX (deterministic heuristics). */
export type RepositoryType =
  | "APPLICATION"
  | "LIBRARY"
  | "MONOREPO"
  | "API_SERVICE"
  | "FRONTEND"
  | "BACKEND"
  | "FULLSTACK"
  | "INFRASTRUCTURE"
  | "DEVOPS"
  | "GITOPS"
  | "UNKNOWN";

export type AnalysisIssueCode =
  | "EMPTY_REPOSITORY"
  | "PRIVATE_REPOSITORY"
  | "ACCESS_DENIED"
  | "ANALYSIS_FAILED"
  | "NO_SUPPORTED_FILES"
  | "NOT_FOUND"
  | "INVALID_REPOSITORY_URL"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_TOO_LARGE"
  | "UNSUPPORTED_REPOSITORY"
  | "FILE_LIMIT_EXCEEDED"
  | "ANALYSIS_TIMEOUT"
  | "RATE_LIMITED"
  | "GITHUB_RATE_LIMITED"
  | "QUEUE_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "GRAPH_LIMIT_EXCEEDED"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export interface AnalysisHealth {
  filesDiscovered: number;
  filesParsed: number;
  filesIgnored: number;
  filesUnsupported: number;
  parseFailures: number;
  maxFilesCap?: number;
  truncated: boolean;
}

/** Overall trust signal for a repository analysis (product-facing). */
export type AnalysisTrustLevel = "HIGH" | "MEDIUM" | "LOW" | "INCOMPLETE";

export interface UnsupportedFileGroup {
  kind: string;
  fileCount: number;
  examples: string[];
}

/**
 * Measurable coverage + confidence for Overview trust.
 * Built from inventory health, graph edge confidence, and infra fallbacks.
 */
export interface FrameworkDetectionConfidence {
  name: string;
  confidence: ConfidenceLevel;
}

export interface AnalysisCoverageReport {
  confidence: AnalysisTrustLevel;
  confidenceLabel: string;
  /** 0–100; null when there is no JS/TS parse surface (e.g. YAML-only). */
  codeParseCoveragePercent: number | null;
  /** 0–100 share of graph edges marked HIGH confidence; null if no edges. */
  highConfidenceEdgePercent: number | null;
  /** Edge confidence mix (percentages); nulls when no edges. */
  edgeConfidence: {
    highPercent: number | null;
    mediumPercent: number | null;
    lowPercent: number | null;
  };
  /** Per-framework trust for what we claimed to detect. */
  frameworks: FrameworkDetectionConfidence[];
  /** Human-readable gaps: unsupported languages, unresolved dynamics, truncation. */
  blindSpots: string[];
  reasons: string[];
  inventory: AnalysisHealth;
  unsupportedGroups: UnsupportedFileGroup[];
  graph: {
    nodes: number;
    edges: number;
    highConfidenceEdges: number;
    mediumConfidenceEdges: number;
    lowConfidenceEdges: number;
  };
  /** True when manifests/infra are the primary story (little or no code parsed). */
  infraPrimary: boolean;
}

export interface ReadmeDigest {
  title?: string;
  description?: string;
  installation?: string;
  architecture?: string;
  technologies: string[];
  features: string[];
  rawAvailable: boolean;
  rawExcerpt?: string;
}

export interface InfraSignal {
  kind:
    | "docker"
    | "terraform"
    | "kubernetes"
    | "helm"
    | "argocd"
    | "github_actions"
    | "workflow"
    | "config";
  label: string;
  path: string;
}

export interface ImportantModule {
  path: string;
  label: string;
  fileCount: number;
  role?: string;
}

export interface OpenPullRequestSummary {
  number: number;
  title: string;
  author?: string;
  headBranch: string;
  baseBranch: string;
  createdAt?: string;
  updatedAt?: string;
  draft: boolean;
  url: string;
  filesChanged?: number;
  /** Populated when a prior PR analysis exists in cache */
  complexityScore?: number;
  changedSymbols?: number;
  affectedApis?: number;
  relevantTests?: number;
  potentialTestGaps?: number;
}

export interface RepositoryIntelligence {
  repositoryType: RepositoryType;
  typeLabel: string;
  architectureSummary: string;
  readme?: ReadmeDigest;
  importantModules: ImportantModule[];
  infraSignals: InfraSignal[];
  analysisHealth: AnalysisHealth;
  /** Product-visible coverage / confidence for trust. */
  coverage?: AnalysisCoverageReport;
  openPullRequests: OpenPullRequestSummary[];
  openPrCount: number;
  /** Paths used for GitDiagram-style Structure (docker, sql, html, …) */
  architectureArtifacts?: string[];
  /** Semantic architecture map for Structure view */
  architecture?: ArchitectureMap;
}

export type ArchitectureBandId =
  | "actors"
  | "client"
  | "server"
  | "persistence"
  | "deployment"
  | "shared";

export type ArchitectureLevel = "SYSTEM" | "COMPONENT" | "CODE";

export type ArchitectureCategory =
  | "external_actor"
  | "external_service"
  | "frontend"
  | "backend"
  | "api"
  | "authentication"
  | "data"
  | "database"
  | "storage"
  | "queue"
  | "deployment"
  | "ci_cd"
  | "shared"
  | "other";

export type EdgeImportance = "PRIMARY" | "SECONDARY" | "CONFIGURATION" | "DEPLOYMENT";

export type ArchitectureMode =
  | "architecture"
  | "runtime"
  | "data"
  | "deployment"
  | "all";

export interface ArchitectureEvidence {
  kind: string;
  detail: string;
}

export interface ArchitectureComponent {
  id: string;
  band: ArchitectureBandId;
  title: string;
  role: string;
  pathHint?: string;
  files: string[];
  shape: "box" | "actor" | "store";
  /** Architecture Experience fields (optional for older maps) */
  level?: ArchitectureLevel;
  category?: ArchitectureCategory;
  description?: string;
  childIds?: string[];
  parentId?: string;
  fileCount?: number;
  symbolCount?: number;
  routeCount?: number;
  testCount?: number;
  graphNodeIds?: string[];
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  label: string;
  importance?: EdgeImportance;
  confidence?: ConfidenceLevel;
  modes?: ArchitectureMode[];
  evidence?: ArchitectureEvidence[];
}

export interface ArchitectureWalkthroughStep {
  id: string;
  title: string;
  body: string;
  componentIds?: string[];
  edgeIds?: string[];
  highlightNodeIds?: string[];
  highlightEdgeIds?: string[];
}

export interface ArchitectureSummary {
  layerCount: number;
  componentCount: number;
  apiRouteCount: number;
  externalServiceCount: number;
  deploymentSystemCount: number;
  primaryFlowLabel: string;
}

export interface ArchitectureMap {
  components: ArchitectureComponent[];
  edges: ArchitectureEdge[];
  narrative: string[];
  primaryFlow?: string[];
  walkthrough?: ArchitectureWalkthroughStep[];
  summary?: ArchitectureSummary;
  defaultMode?: ArchitectureMode;
  repositoryType?: RepositoryType;
}

export interface AnalysisErrorPayload {
  code: AnalysisIssueCode;
  message: string;
  detail?: string;
  action?: "connect_github" | "retry" | "none";
}

export type {
  CheckSeverity,
  CheckCategory,
  CheckRuleId,
  CheckFinding,
  CheckCategorySummary,
  ChecksReport,
  GitImpactConfig,
  GitImpactChecksConfig,
} from "./checks.js";

export {
  ANALYSIS_SCHEMA_VERSION,
  isRetryableJobError,
  isDeterministicJobFailure,
} from "./jobs.js";

export type {
  JobType,
  JobStatus,
  AnalysisPhase,
  AnalyzeRepositoryJobPayload,
  AnalyzePullRequestJobPayload,
  UpdatePrCommentJobPayload,
  UpdateCheckRunJobPayload,
  JobPayload,
  AnalysisJobRecord,
  ApiErrorCode,
  ApiErrorBody,
} from "./jobs.js";

export {
  relationLabel,
  formatRelationshipChain,
  formatPlainImpactPath,
  formatImpactSummaryMarkdown,
  formatBlastRadiusExplanation,
  explainTestGap,
  explainMissingTestForSymbol,
  humanizeSemanticEvent,
  humanizeChangeCategory,
  humanizeImpactLevel,
  formatSemanticEventDetail,
} from "./presentation.js";
