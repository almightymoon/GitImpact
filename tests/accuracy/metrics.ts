import { writeFile } from "node:fs/promises";
import path from "node:path";

export type MetricBucket =
  | "symbolResolution"
  | "callGraph"
  | "importGraph"
  | "impact"
  | "diffToAst"
  | "semanticDiff";

export type AssertionOutcome = "tp" | "fp" | "fn";

interface BucketStats {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  assertions: number;
}

export interface BucketReport extends BucketStats {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  precisionPct: string | null;
  recallPct: string | null;
}

export interface FixtureReport {
  name: string;
  assertions: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface BenchmarkResults {
  generatedAt: string;
  fixtures: number;
  assertions: number;
  softMisses: number;
  metrics: Record<MetricBucket, BucketReport>;
  summary: {
    symbolMappingPrecision: string | null;
    symbolMappingRecall: string | null;
    callGraphPrecision: string | null;
    callGraphRecall: string | null;
    importGraphPrecision: string | null;
    importGraphRecall: string | null;
    impactPrecision: string | null;
    impactRecall: string | null;
    diffToAstMapping: string | null;
    semanticDiffAccuracy: string | null;
  };
  headline: string;
  fixturesDetail: FixtureReport[];
}

function emptyBucket(): BucketStats {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0, assertions: 0 };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function pct(value: number | null): string | null {
  if (value === null) return null;
  return `${(value * 100).toFixed(1)}%`;
}

function finalizeBucket(stats: BucketStats): BucketReport {
  const precision = ratio(stats.truePositives, stats.truePositives + stats.falsePositives);
  const recall = ratio(stats.truePositives, stats.truePositives + stats.falseNegatives);
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  return {
    ...stats,
    precision,
    recall,
    f1,
    precisionPct: pct(precision),
    recallPct: pct(recall),
  };
}

/** Accuracy = (TP + correct absences) approximated as TP / (TP+FP+FN) when labels are sparse. */
function accuracy(stats: BucketStats): number | null {
  const total = stats.truePositives + stats.falsePositives + stats.falseNegatives;
  if (total === 0) return null;
  return stats.truePositives / total;
}

export class BenchmarkReporter {
  private readonly buckets: Record<MetricBucket, BucketStats> = {
    symbolResolution: emptyBucket(),
    callGraph: emptyBucket(),
    importGraph: emptyBucket(),
    impact: emptyBucket(),
    diffToAst: emptyBucket(),
    semanticDiff: emptyBucket(),
  };

  private readonly fixtures = new Map<string, FixtureReport>();
  private fixtureCount = 0;
  private softMisses = 0;

  startFixture(name: string): void {
    if (!this.fixtures.has(name)) {
      this.fixtureCount += 1;
      this.fixtures.set(name, {
        name,
        assertions: 0,
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
      });
    }
  }

  record(fixture: string, bucket: MetricBucket, outcome: AssertionOutcome): void {
    this.startFixture(fixture);
    const stats = this.buckets[bucket];
    stats.assertions += 1;
    if (outcome === "tp") stats.truePositives += 1;
    if (outcome === "fp") stats.falsePositives += 1;
    if (outcome === "fn") stats.falseNegatives += 1;

    const detail = this.fixtures.get(fixture)!;
    detail.assertions += 1;
    if (outcome === "tp") detail.truePositives += 1;
    if (outcome === "fp") detail.falsePositives += 1;
    if (outcome === "fn") detail.falseNegatives += 1;
  }

  /** Expectation that must be present in actual. */
  expectHit(
    fixture: string,
    bucket: MetricBucket,
    hit: boolean,
  ): void {
    this.record(fixture, bucket, hit ? "tp" : "fn");
  }

  /** Forbidden expectation that must NOT be present. */
  expectMiss(
    fixture: string,
    bucket: MetricBucket,
    present: boolean,
  ): void {
    this.record(fixture, bucket, present ? "fp" : "tp");
  }

  /** Soft expectations — tracked for honesty, excluded from hard precision/recall. */
  recordSoftMiss(fixture: string): void {
    this.startFixture(fixture);
    this.softMisses += 1;
  }

  build(): BenchmarkResults {
    const metrics = {
      symbolResolution: finalizeBucket(this.buckets.symbolResolution),
      callGraph: finalizeBucket(this.buckets.callGraph),
      importGraph: finalizeBucket(this.buckets.importGraph),
      impact: finalizeBucket(this.buckets.impact),
      diffToAst: finalizeBucket(this.buckets.diffToAst),
      semanticDiff: finalizeBucket(this.buckets.semanticDiff),
    };

    const assertions = Object.values(this.buckets).reduce((sum, b) => sum + b.assertions, 0);
    const callRecall = metrics.callGraph.recallPct ?? "n/a";

    return {
      generatedAt: new Date().toISOString(),
      fixtures: this.fixtureCount || this.fixtures.size,
      assertions,
      softMisses: this.softMisses,
      metrics,
      summary: {
        symbolMappingPrecision: metrics.symbolResolution.precisionPct,
        symbolMappingRecall: metrics.symbolResolution.recallPct,
        callGraphPrecision: metrics.callGraph.precisionPct,
        callGraphRecall: metrics.callGraph.recallPct,
        importGraphPrecision: metrics.importGraph.precisionPct,
        importGraphRecall: metrics.importGraph.recallPct,
        impactPrecision: metrics.impact.precisionPct,
        impactRecall: metrics.impact.recallPct,
        diffToAstMapping: metrics.diffToAst.recallPct ?? metrics.diffToAst.precisionPct,
        semanticDiffAccuracy: pct(accuracy(this.buckets.semanticDiff)),
      },
      headline: `GitImpact resolves ${callRecall} of benchmark call relationships correctly across the TypeScript accuracy suite.`,
      fixturesDetail: [...this.fixtures.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async write(outputPath: string): Promise<BenchmarkResults> {
    const results = this.build();
    await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    return results;
  }
}

export const reporter = new BenchmarkReporter();

export function edgeKey(edge: { from?: string; to?: string; type?: string }): string {
  return `${edge.type ?? "CALLS"}|${edge.from ?? ""}|${edge.to ?? ""}`;
}

export function resultsPath(rootDir: string): string {
  return path.join(rootDir, "results.json");
}
