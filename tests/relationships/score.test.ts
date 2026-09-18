import { describe, expect, it } from "vitest";
import {
  classifyExpectation,
  flattenExpectations,
  scoreClassifications,
  type ExpectedEdge,
} from "./score.js";
import type { GraphEdge } from "@gitimpact/shared";

const edges: GraphEdge[] = [
  {
    id: "1",
    from: "FUNCTION:a.ts:caller",
    to: "FUNCTION:b.ts:callee",
    type: "CALLS",
    confidence: "HIGH",
  },
  {
    id: "2",
    from: "FILE:a.ts",
    to: "FILE:b.ts",
    type: "IMPORTS",
    confidence: "HIGH",
  },
  {
    id: "3",
    from: "FUNCTION:a.ts:caller",
    to: "FUNCTION:c.ts:wrong",
    type: "CALLS",
    confidence: "HIGH",
  },
];

describe("relationship score taxonomy", () => {
  it("marks exact matches TRUE_POSITIVE", () => {
    const row = classifyExpectation(
      edges,
      { from: "FUNCTION:a.ts:caller", to: "FUNCTION:b.ts:callee", type: "CALLS" },
      0,
    );
    expect(row.class).toBe("TRUE_POSITIVE");
  });

  it("marks absent edges MISSING_EDGE", () => {
    const row = classifyExpectation(
      edges,
      { from: "FUNCTION:a.ts:caller", to: "FUNCTION:z.ts:gone", type: "CALLS" },
      0,
    );
    expect(row.class).toBe("MISSING_EDGE");
  });

  it("marks forbidden hits FALSE_POSITIVE", () => {
    const row = classifyExpectation(
      edges,
      {
        from: "FUNCTION:a.ts:caller",
        to: "FUNCTION:b.ts:callee",
        type: "CALLS",
        forbidden: true,
      },
      0,
    );
    expect(row.class).toBe("FALSE_POSITIVE");
  });

  it("marks wrong type when endpoints match", () => {
    const row = classifyExpectation(
      edges,
      { from: "FILE:a.ts", to: "FILE:b.ts", type: "CALLS" },
      0,
    );
    expect(row.class).toBe("WRONG_TYPE");
  });

  it("computes precision and recall", () => {
    const expectations: ExpectedEdge[] = flattenExpectations({
      mustCall: [
        { from: "FUNCTION:a.ts:caller", to: "FUNCTION:b.ts:callee" },
        { from: "FUNCTION:a.ts:caller", to: "FUNCTION:missing.ts:x" },
      ],
      mustImport: [{ from: "FILE:a.ts", to: "FILE:b.ts" }],
      mustNotCall: [
        { from: "FUNCTION:a.ts:caller", to: "FUNCTION:c.ts:wrong" },
      ],
    });
    const rows = expectations.map((e, i) => classifyExpectation(edges, e, i));
    const scored = scoreClassifications(rows);
    expect(scored.counts.TRUE_POSITIVE).toBe(2);
    expect(scored.counts.MISSING_EDGE).toBe(1);
    expect(scored.counts.FALSE_POSITIVE).toBe(1);
    expect(scored.overall.precision).toBe(0.667);
    expect(scored.overall.recall).toBe(0.667);
  });
});
