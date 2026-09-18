import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisHealth,
  DetectedRoute,
  GraphNode,
  ParsedFile,
  RepositoryIntelligence,
} from "@gitimpact/shared";
import { listOpenPullRequests } from "@gitimpact/git";
import { extractReadmeDigest } from "./readme-digest.js";
import {
  buildArchitectureSummary,
  detectImportantModules,
  detectInfraSignals,
  detectInventoryLanguages,
  detectRepositoryType,
} from "./repository-type.js";
import {
  buildArchitectureExperience,
  collectArchitectureArtifacts,
} from "./architecture/index.js";
import { detectWorkspacePackages } from "./architecture-map.js";
import { buildAnalysisCoverage } from "./coverage.js";
import { buildInfrastructureNodes } from "./checks/index.js";

async function findReadmeRaw(clonePath: string): Promise<string | undefined> {
  for (const name of ["README.md", "Readme.md", "readme.md", "README.MD"]) {
    try {
      return await readFile(path.join(clonePath, name), "utf8");
    } catch {
      // try next
    }
  }
  return undefined;
}

export async function buildRepositoryIntelligence(input: {
  owner: string;
  repo: string;
  clonePath?: string;
  files: ParsedFile[];
  graphNodes: GraphNode[];
  graphEdges?: import("@gitimpact/shared").GraphEdge[];
  routes: DetectedRoute[];
  frameworks: string[];
  languages: Array<{ language: string; percentage: number }>;
  packageDeps?: Record<string, string>;
  packageName?: string;
  analysisHealth: AnalysisHealth;
  allRelativeFiles?: string[];
  token?: string;
  skipOpenPrs?: boolean;
}): Promise<RepositoryIntelligence> {
  const filePaths =
    input.allRelativeFiles ??
    input.files.map((f) => f.path);
  const infraSignals = detectInfraSignals(filePaths, input.packageDeps);
  const importantModules = detectImportantModules(
    input.files,
    input.graphNodes,
    filePaths,
  );
  const { type, label } = detectRepositoryType({
    frameworks: input.frameworks,
    routes: input.routes,
    files: input.files,
    packageDeps: input.packageDeps,
    packageName: input.packageName,
    filePaths,
    infraSignals,
    pythonProject: input.analysisHealth.pythonProject,
  });

  const languages =
    input.languages.length > 0
      ? input.languages
      : detectInventoryLanguages(filePaths);

  const readmeRaw = input.clonePath
    ? await findReadmeRaw(input.clonePath)
    : undefined;
  const readme = extractReadmeDigest(readmeRaw, input.frameworks);

  let openPullRequests: RepositoryIntelligence["openPullRequests"] = [];
  if (!input.skipOpenPrs) {
    try {
      openPullRequests = await listOpenPullRequests(input.owner, input.repo, {
        token: input.token,
        limit: 25,
      });
    } catch {
      openPullRequests = [];
    }
  }

  const testCount = input.files.filter((f) => f.isTest).length;
  const workspacePackages = detectWorkspacePackages(filePaths);
  const architectureSummary = buildArchitectureSummary({
    typeLabel: label,
    frameworks: input.frameworks,
    modules: importantModules,
    routeCount: input.routes.length,
    testCount,
    languages,
    infraSignals,
    codeFileCount: input.files.length,
    workspacePackages,
  });

  const architectureArtifacts = collectArchitectureArtifacts(filePaths);
  const architecture = buildArchitectureExperience({
    codeFiles: input.files.map((f) => ({ path: f.path })),
    artifacts: architectureArtifacts,
    infraSignals,
    graphNodes: input.graphNodes,
    graphEdges: input.graphEdges,
    routes: input.routes,
    repositoryType: type,
  });

  const infraGraph = buildInfrastructureNodes({
    infraSignals,
    findings: [],
  });
  const coverage = buildAnalysisCoverage({
    analysisHealth: input.analysisHealth,
    graphEdges: [...(input.graphEdges ?? []), ...infraGraph.edges],
    graphNodeCount: input.graphNodes.length + infraGraph.nodes.length,
    allRelativeFiles: filePaths,
    codeFilePaths: input.files.map((f) => f.path),
    infraSignals,
    frameworks: input.frameworks,
    files: input.files,
  });

  return {
    repositoryType: type,
    typeLabel: label,
    architectureSummary,
    readme,
    importantModules,
    infraSignals,
    analysisHealth: input.analysisHealth,
    coverage,
    openPullRequests,
    openPrCount: openPullRequests.length,
    architectureArtifacts,
    architecture,
  };
}
