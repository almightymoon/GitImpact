import type { ParsedFile, ResolvedCall } from "@gitimpact/shared";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export type MetricBucket = "callGraph" | "importGraph" | "routeDetection";

type Outcome = "tp" | "fp" | "fn";

interface BucketStats {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  assertions: number;
}

export interface BucketReport extends BucketStats {
  precision: number | null;
  recall: number | null;
  precisionPct: string | null;
  recallPct: string | null;
}

export interface CallCoverage {
  totalCalls: number;
  resolvedCalls: number;
  unresolvedCalls: number;
  resolutionCoverage: number | null;
  resolutionCoveragePct: string | null;
  unresolvedSamples: Array<{
    file: string;
    calleeName: string;
    container?: string;
  }>;
}

export interface CaseCoverage extends CallCoverage {
  name: string;
  unsupportedPatterns: string[];
  knownUnresolved: number;
  softMisses: number;
}

export interface RealWorldResults {
  generatedAt: string;
  fixtures: number;
  assertions: number;
  softMisses: number;
  unsupportedPatternCount: number;
  coverage: CallCoverage;
  metrics: Record<MetricBucket, BucketReport>;
  summary: {
    precision: string | null;
    recall: string | null;
    resolutionCoverage: string | null;
    unsupportedPatternCount: number;
  };
  headline: string;
  cases: CaseCoverage[];
}

function emptyBucket(): BucketStats {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0, assertions: 0 };
}

function ratio(n: number, d: number): number | null {
  if (d === 0) return null;
  return n / d;
}

function pct(v: number | null): string | null {
  if (v === null) return null;
  return `${(v * 100).toFixed(1)}%`;
}

function finalize(stats: BucketStats): BucketReport {
  const precision = ratio(stats.truePositives, stats.truePositives + stats.falsePositives);
  const recall = ratio(stats.truePositives, stats.truePositives + stats.falseNegatives);
  return {
    ...stats,
    precision,
    recall,
    precisionPct: pct(precision),
    recallPct: pct(recall),
  };
}

const NOISE_CALLEES = new Set([
  "startsWith",
  "endsWith",
  "includes",
  "indexOf",
  "slice",
  "splice",
  "trim",
  "map",
  "filter",
  "reduce",
  "forEach",
  "push",
  "pop",
  "shift",
  "join",
  "split",
  "then",
  "catch",
  "finally",
  "json",
  "status",
  "send",
  "next",
  "log",
  "error",
  "warn",
  "info",
  "stringify",
  "parse",
  "keys",
  "values",
  "entries",
  "assign",
  "create",
  "get",
  "set",
  "has",
  "add",
  "delete",
  "dispatch",
  "fn",
  "post",
  "put",
  "patch",
  "use",
  "listen",
]);

function isApplicationCall(call: ResolvedCall): boolean {
  if (call.resolvedKind !== "UNRESOLVED") return true;
  // Builtins / framework chain noise — excluded from resolution coverage denominator
  if (NOISE_CALLEES.has(call.calleeName)) return false;
  return true;
}

function allCalls(files: ParsedFile[]): Array<ResolvedCall & { file: string; container?: string }> {
  const out: Array<ResolvedCall & { file: string; container?: string }> = [];
  for (const file of files) {
    for (const fn of file.functions) {
      for (const call of fn.calls) {
        if (!isApplicationCall(call)) continue;
        out.push({ ...call, file: file.path, container: fn.name });
      }
    }
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        for (const call of method.calls) {
          if (!isApplicationCall(call)) continue;
          out.push({ ...call, file: file.path, container: `${cls.name}.${method.name}` });
        }
      }
    }
  }
  return out;
}

export function measureCallCoverage(files: ParsedFile[]): CallCoverage {
  const calls = allCalls(files);
  const resolved = calls.filter((c) => c.resolvedKind !== "UNRESOLVED");
  const unresolved = calls.filter((c) => c.resolvedKind === "UNRESOLVED");
  const coverage = ratio(resolved.length, calls.length);
  return {
    totalCalls: calls.length,
    resolvedCalls: resolved.length,
    unresolvedCalls: unresolved.length,
    resolutionCoverage: coverage,
    resolutionCoveragePct: pct(coverage),
    unresolvedSamples: unresolved.slice(0, 12).map((c) => ({
      file: c.file,
      calleeName: c.calleeName,
      container: c.container,
    })),
  };
}

export class RealWorldReporter {
  private readonly buckets: Record<MetricBucket, BucketStats> = {
    callGraph: emptyBucket(),
    importGraph: emptyBucket(),
    routeDetection: emptyBucket(),
  };
  private softMisses = 0;
  private unsupported = new Set<string>();
  private readonly cases: CaseCoverage[] = [];
  private fixtureCount = 0;

  startCase(name: string): void {
    this.fixtureCount += 1;
  }

  record(bucket: MetricBucket, outcome: Outcome): void {
    const stats = this.buckets[bucket];
    stats.assertions += 1;
    if (outcome === "tp") stats.truePositives += 1;
    if (outcome === "fp") stats.falsePositives += 1;
    if (outcome === "fn") stats.falseNegatives += 1;
  }

  expectHit(bucket: MetricBucket, hit: boolean): void {
    this.record(bucket, hit ? "tp" : "fn");
  }

  expectMiss(bucket: MetricBucket, present: boolean): void {
    this.record(bucket, present ? "fp" : "tp");
  }

  recordSoftMiss(): void {
    this.softMisses += 1;
  }

  addUnsupported(patterns: string[]): void {
    for (const pattern of patterns) this.unsupported.add(pattern);
  }

  addCaseCoverage(
    name: string,
    files: ParsedFile[],
    unsupportedPatterns: string[],
    knownUnresolved: number,
    softMisses: number,
  ): void {
    const coverage = measureCallCoverage(files);
    this.cases.push({
      name,
      ...coverage,
      unsupportedPatterns,
      knownUnresolved,
      softMisses,
    });
  }

  build(): RealWorldResults {
    const metrics = {
      callGraph: finalize(this.buckets.callGraph),
      importGraph: finalize(this.buckets.importGraph),
      routeDetection: finalize(this.buckets.routeDetection),
    };

    const totalCalls = this.cases.reduce((sum, c) => sum + c.totalCalls, 0);
    const resolvedCalls = this.cases.reduce((sum, c) => sum + c.resolvedCalls, 0);
    const unresolvedCalls = this.cases.reduce((sum, c) => sum + c.unresolvedCalls, 0);
    const resolutionCoverage = ratio(resolvedCalls, totalCalls);

    // Aggregate precision/recall across labelled edge assertions
    const labelled = {
      truePositives:
        metrics.callGraph.truePositives +
        metrics.importGraph.truePositives +
        metrics.routeDetection.truePositives,
      falsePositives:
        metrics.callGraph.falsePositives +
        metrics.importGraph.falsePositives +
        metrics.routeDetection.falsePositives,
      falseNegatives:
        metrics.callGraph.falseNegatives +
        metrics.importGraph.falseNegatives +
        metrics.routeDetection.falseNegatives,
    };
    const precision = ratio(
      labelled.truePositives,
      labelled.truePositives + labelled.falsePositives,
    );
    const recall = ratio(
      labelled.truePositives,
      labelled.truePositives + labelled.falseNegatives,
    );

    const assertions = Object.values(this.buckets).reduce((sum, b) => sum + b.assertions, 0);
    const coveragePct = pct(resolutionCoverage) ?? "n/a";

    return {
      generatedAt: new Date().toISOString(),
      fixtures: this.fixtureCount,
      assertions,
      softMisses: this.softMisses,
      unsupportedPatternCount: this.unsupported.size,
      coverage: {
        totalCalls,
        resolvedCalls,
        unresolvedCalls,
        resolutionCoverage,
        resolutionCoveragePct: pct(resolutionCoverage),
        unresolvedSamples: this.cases.flatMap((c) =>
          c.unresolvedSamples.map((s) => ({ ...s, file: `${c.name}:${s.file}` })),
        ).slice(0, 25),
      },
      metrics,
      summary: {
        precision: pct(precision),
        recall: pct(recall),
        resolutionCoverage: pct(resolutionCoverage),
        unsupportedPatternCount: this.unsupported.size,
      },
      headline: `Resolved calls: ${resolvedCalls} / ${totalCalls} (${coveragePct}). Labelled precision ${pct(precision) ?? "n/a"}, recall ${pct(recall) ?? "n/a"}, unsupported patterns ${this.unsupported.size}.`,
      cases: this.cases.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async write(outputPath: string): Promise<RealWorldResults> {
    const results = this.build();
    await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    return results;
  }
}

export const reporter = new RealWorldReporter();

export function resultsPath(rootDir: string): string {
  return path.join(rootDir, "results.json");
}
