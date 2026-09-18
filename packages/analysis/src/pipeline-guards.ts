import {
  assertFileCount,
  assertGraphLimits,
  getResourceQuotas,
  observeMetric,
  withTimeout,
  QuotaExceededError,
  type ResourceQuotas,
} from "@gitimpact/ops";
import type { AnalysisPhase, DependencyGraph } from "@gitimpact/shared";
import { ANALYSIS_SCHEMA_VERSION } from "@gitimpact/shared";

export type PhaseReporter = (phase: AnalysisPhase) => void | Promise<void>;

export function analysisExpiresAt(kind: "repository" | "pull_request", quotas = getResourceQuotas()): Date {
  const hours =
    kind === "pull_request" ? quotas.prAnalysisTtlHours : quotas.repoAnalysisTtlHours;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function schemaVersion(): string {
  return ANALYSIS_SCHEMA_VERSION;
}

export async function runPhase<T>(
  phase: AnalysisPhase,
  work: () => Promise<T>,
  opts?: {
    onPhase?: PhaseReporter;
    timeoutMs?: number;
    quotas?: ResourceQuotas;
  },
): Promise<T> {
  const quotas = opts?.quotas ?? getResourceQuotas();
  const timeoutMs = opts?.timeoutMs ?? Math.min(quotas.maxAnalysisDurationMs, 120_000);
  await opts?.onPhase?.(phase);
  const started = Date.now();
  try {
    const result = await withTimeout(phase, timeoutMs, work);
    observeMetric("analysis.phase.duration", Date.now() - started, { phase });
    return result;
  } catch (error) {
    if (error instanceof QuotaExceededError) throw error;
    throw error;
  }
}

export function enforceDiscoveryQuotas(
  fileCount: number,
  quotas = getResourceQuotas(),
): void {
  assertFileCount(fileCount, quotas.maxRepositoryFiles);
}

export function enforceGraphQuotas(graph: DependencyGraph, quotas = getResourceQuotas()): void {
  assertGraphLimits(graph.nodes.length, graph.edges.length, quotas);
}

export function enforcePrChangedFileQuota(
  count: number,
  quotas = getResourceQuotas(),
): void {
  if (count > quotas.maxPrChangedFiles) {
    throw new QuotaExceededError(
      "REPOSITORY_TOO_LARGE",
      `Pull request changes ${count.toLocaleString()} files. The current public-beta limit is ${quotas.maxPrChangedFiles.toLocaleString()}.`,
      `changedFiles=${count} limit=${quotas.maxPrChangedFiles}`,
      "DISCOVERY",
    );
  }
}

/** Soft parse truncation is allowed within hard repo limits — surface clearly. */
export function truncationNotice(discovered: number, parsed: number, truncated: boolean): string | undefined {
  if (!truncated) return undefined;
  return `Parsed ${parsed.toLocaleString()} of ${discovered.toLocaleString()} source files (soft parse cap). Hard repository limits still apply.`;
}
