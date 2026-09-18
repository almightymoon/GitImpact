/**
 * Score graph edges against hand-verified expectations (v1.1.2).
 */
import type { ConfidenceLevel, GraphEdge, RelationType } from "@gitimpact/shared";

export type EdgeClass =
  | "TRUE_POSITIVE"
  | "FALSE_POSITIVE"
  | "MISSING_EDGE"
  | "WRONG_TARGET"
  | "WRONG_TYPE"
  | "LOW_CONFIDENCE";

export interface ExpectedEdge {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  fromContains?: string;
  toContains?: string;
  /** Edge that must NOT appear (false positive probe). */
  forbidden?: boolean;
  note?: string;
  /** Soft miss — counted separately, does not fail recall hard target. */
  soft?: boolean;
}

export interface Classification {
  expectationId: string;
  class: EdgeClass;
  type: string;
  from?: string;
  to?: string;
  soft?: boolean;
  note?: string;
  matchedEdgeId?: string;
  confidence?: ConfidenceLevel;
}

export interface TypeScore {
  type: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  lowConfidence: number;
  softMisses: number;
  precision: number | null;
  recall: number | null;
}

function edgeMatches(
  edge: GraphEdge,
  expectation: ExpectedEdge,
  defaultType: string,
): boolean {
  const type = expectation.type ?? defaultType;
  if (edge.type !== type) return false;
  if (expectation.to && edge.to !== expectation.to) return false;
  if (expectation.from && edge.from !== expectation.from) return false;
  if (expectation.fromContains && !edge.from.includes(expectation.fromContains)) {
    return false;
  }
  if (expectation.toContains && !edge.to.includes(expectation.toContains)) {
    return false;
  }
  return Boolean(
    expectation.from ||
      expectation.fromContains ||
      expectation.to ||
      expectation.toContains,
  );
}

function label(expectation: ExpectedEdge, index: number): string {
  return (
    expectation.id ??
    `${expectation.type ?? "CALLS"}:${expectation.from ?? expectation.fromContains ?? "?"}→${expectation.to ?? expectation.toContains ?? "?"}:${index}`
  );
}

export function classifyExpectation(
  edges: GraphEdge[],
  expectation: ExpectedEdge,
  index: number,
  defaultType = "CALLS",
): Classification {
  const type = expectation.type ?? defaultType;
  const expectationId = label(expectation, index);

  if (expectation.forbidden) {
    const hit = edges.find((e) => edgeMatches(e, expectation, defaultType));
    if (hit) {
      return {
        expectationId,
        class: "FALSE_POSITIVE",
        type,
        from: expectation.from,
        to: expectation.to,
        note: expectation.note,
        matchedEdgeId: hit.id,
        confidence: hit.confidence,
      };
    }
    return {
      expectationId,
      class: "TRUE_POSITIVE",
      type,
      from: expectation.from,
      to: expectation.to,
      note: expectation.note ?? "forbidden edge correctly absent",
    };
  }

  const exact = edges.find((e) => edgeMatches(e, expectation, defaultType));
  if (exact) {
    if (exact.confidence === "LOW") {
      return {
        expectationId,
        class: "LOW_CONFIDENCE",
        type,
        from: exact.from,
        to: exact.to,
        soft: expectation.soft,
        note: expectation.note,
        matchedEdgeId: exact.id,
        confidence: exact.confidence,
      };
    }
    return {
      expectationId,
      class: "TRUE_POSITIVE",
      type,
      from: exact.from,
      to: exact.to,
      soft: expectation.soft,
      note: expectation.note,
      matchedEdgeId: exact.id,
      confidence: exact.confidence,
    };
  }

  // Wrong type: same endpoints, different relation
  if (expectation.from && expectation.to) {
    const wrongType = edges.find(
      (e) => e.from === expectation.from && e.to === expectation.to && e.type !== type,
    );
    if (wrongType) {
      return {
        expectationId,
        class: "WRONG_TYPE",
        type,
        from: wrongType.from,
        to: wrongType.to,
        soft: expectation.soft,
        note: expectation.note ?? `found as ${wrongType.type}`,
        matchedEdgeId: wrongType.id,
        confidence: wrongType.confidence,
      };
    }
  }

  // Wrong target: same from + type, different to
  if (expectation.from || expectation.fromContains) {
    const wrongTarget = edges.find((e) => {
      if (e.type !== type) return false;
      if (expectation.from && e.from !== expectation.from) return false;
      if (expectation.fromContains && !e.from.includes(expectation.fromContains)) {
        return false;
      }
      if (expectation.to && e.to === expectation.to) return false;
      return true;
    });
    // Only call WRONG_TARGET when we have a specific expected `to` and another edge leaves the same from
    if (wrongTarget && expectation.to) {
      const anyFrom = edges.some((e) => {
        if (e.type !== type) return false;
        if (expectation.from && e.from !== expectation.from) return false;
        if (expectation.fromContains && !e.from.includes(expectation.fromContains)) {
          return false;
        }
        return true;
      });
      if (anyFrom && !edges.some((e) => edgeMatches(e, expectation, defaultType))) {
        // Prefer MISSING over WRONG_TARGET when many outbound edges exist — only mark WRONG_TARGET
        // if exactly one outbound of that type exists and it differs.
        const outbound = edges.filter((e) => {
          if (e.type !== type) return false;
          if (expectation.from && e.from !== expectation.from) return false;
          if (
            expectation.fromContains &&
            !e.from.includes(expectation.fromContains)
          ) {
            return false;
          }
          return true;
        });
        if (outbound.length === 1 && outbound[0]!.to !== expectation.to) {
          return {
            expectationId,
            class: "WRONG_TARGET",
            type,
            from: outbound[0]!.from,
            to: outbound[0]!.to,
            soft: expectation.soft,
            note: expectation.note ?? `expected ${expectation.to}`,
            matchedEdgeId: outbound[0]!.id,
            confidence: outbound[0]!.confidence,
          };
        }
      }
    }
  }

  return {
    expectationId,
    class: "MISSING_EDGE",
    type,
    from: expectation.from,
    to: expectation.to,
    soft: expectation.soft,
    note: expectation.note,
  };
}

export function scoreClassifications(rows: Classification[]): {
  byType: TypeScore[];
  overall: TypeScore;
  counts: Record<EdgeClass, number>;
} {
  const counts: Record<EdgeClass, number> = {
    TRUE_POSITIVE: 0,
    FALSE_POSITIVE: 0,
    MISSING_EDGE: 0,
    WRONG_TARGET: 0,
    WRONG_TYPE: 0,
    LOW_CONFIDENCE: 0,
  };
  for (const row of rows) counts[row.class] += 1;

  const types = [...new Set(rows.map((r) => r.type))];
  const byType = types.map((type) => scoreBucket(rows.filter((r) => r.type === type), type));
  const overall = scoreBucket(rows, "overall");
  return { byType, overall, counts };
}

function scoreBucket(rows: Classification[], type: string): TypeScore {
  const hard = rows.filter((r) => !r.soft);
  const softMisses = rows.filter(
    (r) =>
      r.soft &&
      (r.class === "MISSING_EDGE" ||
        r.class === "WRONG_TARGET" ||
        r.class === "WRONG_TYPE" ||
        r.class === "LOW_CONFIDENCE"),
  ).length;

  // Forbidden absences count as TP; forbidden hits as FP.
  const truePositives = hard.filter((r) => r.class === "TRUE_POSITIVE").length;
  const falsePositives = hard.filter((r) => r.class === "FALSE_POSITIVE").length;
  const falseNegatives = hard.filter(
    (r) =>
      r.class === "MISSING_EDGE" ||
      r.class === "WRONG_TARGET" ||
      r.class === "WRONG_TYPE",
  ).length;
  const lowConfidence = hard.filter((r) => r.class === "LOW_CONFIDENCE").length;

  // LOW_CONFIDENCE: count toward recall as TP for presence, but track separately.
  const tpForRecall = truePositives + lowConfidence;
  const predictedPositive = truePositives + falsePositives + lowConfidence;
  const precision =
    predictedPositive > 0 ? truePositives / (truePositives + falsePositives) : null;
  // Treat LOW as found for recall (edge exists), FN only for missing/wrong
  const recallDenom = tpForRecall + falseNegatives;
  const recall = recallDenom > 0 ? tpForRecall / recallDenom : null;

  return {
    type,
    truePositives,
    falsePositives,
    falseNegatives,
    lowConfidence,
    softMisses,
    precision: precision === null ? null : Math.round(precision * 1000) / 1000,
    recall: recall === null ? null : Math.round(recall * 1000) / 1000,
  };
}

export function flattenExpectations(input: {
  mustCall?: ExpectedEdge[];
  mustImport?: ExpectedEdge[];
  mustEdge?: ExpectedEdge[];
  mustNotCall?: ExpectedEdge[];
  mustNotImport?: ExpectedEdge[];
  softMustCall?: ExpectedEdge[];
}): ExpectedEdge[] {
  const out: ExpectedEdge[] = [];
  for (const e of input.mustCall ?? []) out.push({ ...e, type: e.type ?? "CALLS" });
  for (const e of input.mustImport ?? []) out.push({ ...e, type: e.type ?? "IMPORTS" });
  for (const e of input.mustEdge ?? []) out.push({ ...e, type: e.type ?? "CALLS" });
  for (const e of input.mustNotCall ?? []) {
    out.push({ ...e, type: e.type ?? "CALLS", forbidden: true });
  }
  for (const e of input.mustNotImport ?? []) {
    out.push({ ...e, type: e.type ?? "IMPORTS", forbidden: true });
  }
  for (const e of input.softMustCall ?? []) {
    out.push({ ...e, type: e.type ?? "CALLS", soft: true });
  }
  return out;
}

export type { RelationType };
