import { describe, it, expect } from "vitest";
import { validateDraft } from "./validate-draft.js";
import type { DraftShape, GeometryViolation, Point } from "../types/index.js";

// ---- helpers ----

function makeDraft(points: Point[], isClosed = false): DraftShape {
  return { points, isClosed };
}

function pt(lat: number, lng: number): Point {
  return { lat, lng };
}

function codes(violations: GeometryViolation[]): string[] {
  return violations.map((v) => v.code);
}

// ============================================================
// isClosed = false  (polyline / cut-line)
// ============================================================

describe("validateDraft — open draft (isClosed = false)", () => {
  it("returns empty array (valid) for 2 or more points", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1)]);
    expect(validateDraft(draft)).toEqual([]);
  });

  it("returns empty array for 3 points", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(2, 0)]);
    expect(validateDraft(draft)).toEqual([]);
  });

  it("returns TOO_FEW_VERTICES for 1 point", () => {
    const draft = makeDraft([pt(0, 0)]);
    expect(codes(validateDraft(draft))).toContain("TOO_FEW_VERTICES");
  });

  it("returns TOO_FEW_VERTICES for 0 points", () => {
    const draft = makeDraft([]);
    expect(codes(validateDraft(draft))).toContain("TOO_FEW_VERTICES");
  });

  it("does NOT return SELF_INTERSECTION for open draft (never checked)", () => {
    // A self-intersecting open polyline should NOT get SELF_INTERSECTION
    // because that check only applies to closed drafts
    const draft = makeDraft([
      pt(0, 0),
      pt(2, 2),
      pt(0, 2),
      pt(2, 0), // crossing the first segment
    ]);
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });

  it("does NOT return ZERO_AREA for open draft (never checked)", () => {
    // Collinear points in an open draft should NOT produce ZERO_AREA
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    expect(codes(validateDraft(draft))).not.toContain("ZERO_AREA");
  });

  it("returns only TOO_FEW_VERTICES when the single violation is too few points", () => {
    const draft = makeDraft([pt(0, 0)]);
    const v = validateDraft(draft);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("TOO_FEW_VERTICES");
  });
});

// ============================================================
// isClosed = true  (polygon)
// ============================================================

describe("validateDraft — closed draft (isClosed = true)", () => {
  // ---- TOO_FEW_VERTICES ----

  it("returns empty array (valid) for a proper triangle (3 points)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(0, 1)], true);
    expect(validateDraft(draft)).toEqual([]);
  });

  it("returns TOO_FEW_VERTICES for 2 points (closed)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0)], true);
    expect(codes(validateDraft(draft))).toContain("TOO_FEW_VERTICES");
  });

  it("returns TOO_FEW_VERTICES for 1 point (closed)", () => {
    const draft = makeDraft([pt(0, 0)], true);
    expect(codes(validateDraft(draft))).toContain("TOO_FEW_VERTICES");
  });

  it("returns TOO_FEW_VERTICES for 0 points (closed)", () => {
    const draft = makeDraft([], true);
    expect(codes(validateDraft(draft))).toContain("TOO_FEW_VERTICES");
  });

  // ---- ZERO_AREA ----

  it("returns ZERO_AREA when all points are collinear (horizontal)", () => {
    const draft = makeDraft([pt(0, 0), pt(0, 1), pt(0, 2)], true);
    expect(codes(validateDraft(draft))).toContain("ZERO_AREA");
  });

  it("returns ZERO_AREA when all points are collinear (vertical)", () => {
    const draft = makeDraft([pt(0, 5), pt(1, 5), pt(2, 5)], true);
    expect(codes(validateDraft(draft))).toContain("ZERO_AREA");
  });

  it("returns ZERO_AREA when all points are collinear (diagonal)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)], true);
    expect(codes(validateDraft(draft))).toContain("ZERO_AREA");
  });

  it("does NOT return ZERO_AREA for a valid triangle", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(0, 1)], true);
    expect(codes(validateDraft(draft))).not.toContain("ZERO_AREA");
  });

  it("does NOT return ZERO_AREA for a valid square", () => {
    const draft = makeDraft(
      [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0)],
      true
    );
    expect(codes(validateDraft(draft))).not.toContain("ZERO_AREA");
  });

  // ---- SELF_INTERSECTION ----

  it("returns SELF_INTERSECTION for a figure-8 (bowtie) polygon", () => {
    // Bowtie: (0,0)->(1,1)->(0,1)->(1,0) forms two triangles crossing each other
    const draft = makeDraft(
      [pt(0, 0), pt(1, 1), pt(0, 1), pt(1, 0)],
      true
    );
    expect(codes(validateDraft(draft))).toContain("SELF_INTERSECTION");
  });

  it("does NOT return SELF_INTERSECTION for a convex polygon", () => {
    const draft = makeDraft(
      [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)],
      true
    );
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });

  it("does NOT return SELF_INTERSECTION for a simple triangle", () => {
    const draft = makeDraft([pt(0, 0), pt(2, 0), pt(1, 2)], true);
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });

  it("returns SELF_INTERSECTION for a complex self-crossing polygon", () => {
    // Star-shaped polygon that crosses itself
    // (0,2) -> (2,0) -> (4,2) -> (1,4) -> (3,4) forming a star-like shape
    const draft = makeDraft(
      [pt(0, 2), pt(2, 0), pt(4, 2), pt(1, 4), pt(3, 4)],
      true
    );
    expect(codes(validateDraft(draft))).toContain("SELF_INTERSECTION");
  });

  it("does NOT return SELF_INTERSECTION for a non-convex (concave) polygon", () => {
    // L-shaped polygon (concave but not self-intersecting)
    const draft = makeDraft(
      [pt(0, 0), pt(0, 3), pt(1, 3), pt(1, 1), pt(2, 1), pt(2, 0)],
      true
    );
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });

  // ---- Multiple violations ----

  it("can return both TOO_FEW_VERTICES and no SELF_INTERSECTION (2 points closed)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1)], true);
    const violations = validateDraft(draft);
    // Must have TOO_FEW_VERTICES; SELF_INTERSECTION not applicable with 2 pts
    expect(codes(violations)).toContain("TOO_FEW_VERTICES");
  });

  it("returns empty array for a valid 5-point polygon", () => {
    const draft = makeDraft(
      [pt(0, 0), pt(2, 0), pt(2, 2), pt(1, 3), pt(0, 2)],
      true
    );
    expect(validateDraft(draft)).toEqual([]);
  });

  // ---- Edge cases ----

  it("returns an array, never null or undefined", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(0, 1)], true);
    const result = validateDraft(draft);
    expect(Array.isArray(result)).toBe(true);
  });

  it("does not mutate the draft", () => {
    const points = [pt(0, 0), pt(1, 0), pt(1, 1)];
    const draft = makeDraft(points, true);
    validateDraft(draft);
    expect(draft.points).toHaveLength(3);
    expect(draft.isClosed).toBe(true);
  });

  // ---- Adjacent vs non-adjacent edge intersection ----

  it("does NOT flag shared endpoints of adjacent edges as SELF_INTERSECTION", () => {
    // A triangle has 3 edges; each pair of adjacent edges shares a vertex.
    // This is normal and must NOT be flagged as self-intersection.
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(0.5, 1)], true);
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });

  it("does NOT flag shared endpoints on a square as SELF_INTERSECTION", () => {
    const draft = makeDraft(
      [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0)],
      true
    );
    expect(codes(validateDraft(draft))).not.toContain("SELF_INTERSECTION");
  });
});
