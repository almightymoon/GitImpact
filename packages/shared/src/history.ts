/**
 * v1.2 — compact analysis history snapshots for compare / workflows.
 * Full graphs stay on `analyses`; history stores architecture + impact metrics.
 */
export interface AnalysisHistorySystem {
  id: string;
  title: string;
  role: string;
  pathHint?: string;
}

export interface AnalysisHistoryArchEdge {
  from: string;
  to: string;
  label: string;
}

export interface AnalysisHistoryImpactMetrics {
  directCount: number;
  indirectCount: number;
  affectedFiles: number;
  affectedApis: number;
  relatedTests: number;
  missingTests: number;
  complexityScore?: number;
  impactLevel?: string;
  maxDepth?: number;
}

export interface AnalysisHistorySnapshot {
  schemaVersion: string;
  repositoryType?: string;
  typeLabel?: string;
  frameworks: string[];
  languages: Array<{ language: string; fileCount: number; percentage: number }>;
  summary: {
    files: number;
    functions: number;
    classes: number;
    dependencies: number;
    tests: number;
    apiRoutes: number;
  };
  graph: {
    nodes: number;
    edges: number;
    edgeTypeCounts: Record<string, number>;
  };
  systems: AnalysisHistorySystem[];
  architectureEdges: AnalysisHistoryArchEdge[];
  coverageConfidence?: string;
  blindSpots: string[];
  impact?: AnalysisHistoryImpactMetrics;
  checks?: {
    total: number;
    bySeverity: Record<string, number>;
  };
}

export interface AnalysisHistoryEntry {
  id: string;
  repositoryId: string;
  analysisId: string;
  kind: "repository" | "pull_request";
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
  prNumber?: number;
  createdAt: string;
  snapshot: AnalysisHistorySnapshot;
}

export interface ArchitectureDiff {
  from: { id: string; commitSha?: string; createdAt: string; label: string };
  to: { id: string; commitSha?: string; createdAt: string; label: string };
  frameworksAdded: string[];
  frameworksRemoved: string[];
  systemsAdded: AnalysisHistorySystem[];
  systemsRemoved: AnalysisHistorySystem[];
  architectureEdgesAdded: AnalysisHistoryArchEdge[];
  architectureEdgesRemoved: AnalysisHistoryArchEdge[];
  summaryDeltas: {
    files: number;
    functions: number;
    classes: number;
    dependencies: number;
    tests: number;
    apiRoutes: number;
    graphNodes: number;
    graphEdges: number;
  };
  repositoryTypeChanged?: { from?: string; to?: string };
  blastRadius?: {
    directDelta: number;
    indirectDelta: number;
    complexityDelta?: number;
    impactLevelFrom?: string;
    impactLevelTo?: string;
    verdict: "increased" | "decreased" | "unchanged" | "unknown";
  };
  narrative: string[];
}
