import type { DraftShape, GeometryViolation } from "../types/index.js";

/**
 * Validates a DraftShape and returns an array of GeometryViolations.
 * An empty array means the draft is valid.
 *
 * Rules differ by isClosed:
 *
 * isClosed = false (polyline / cut-line):
 *   TOO_FEW_VERTICES  — fewer than 2 points
 *   (SELF_INTERSECTION and ZERO_AREA are never checked)
 *
 * isClosed = true (polygon):
 *   TOO_FEW_VERTICES  — fewer than 3 points
 *   SELF_INTERSECTION — any two non-adjacent edges intersect
 *   ZERO_AREA         — all points are collinear (area = 0)
 */
export function validateDraft(draft: DraftShape): GeometryViolation[] {
  const violations: GeometryViolation[] = [];

  if (draft.isClosed) {
    // --- closed polygon checks ---
    if (draft.points.length < 3) {
      violations.push({ code: "TOO_FEW_VERTICES" });
      // Cannot check geometry with fewer than 3 points — return early
      return violations;
    }

    if (hasZeroArea(draft.points)) {
      violations.push({ code: "ZERO_AREA" });
    }

    if (hasSelfIntersection(draft.points)) {
      violations.push({ code: "SELF_INTERSECTION" });
    }
  } else {
    // --- open polyline checks ---
    if (draft.points.length < 2) {
      violations.push({ code: "TOO_FEW_VERTICES" });
    }
  }

  return violations;
}

// ============================================================
// Geometry primitives
// ============================================================

/**
 * Returns true if all points are collinear (cross products ≈ 0).
 * Uses the 2D cross-product of consecutive edge vectors.
 */
function hasZeroArea(points: Array<{ lat: number; lng: number }>): boolean {
  // Compute shoelace area; if |area| is effectively 0, all collinear
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Use [lng, lat] as [x, y]
    area += points[i]!.lng * points[j]!.lat;
    area -= points[j]!.lng * points[i]!.lat;
  }

  return Math.abs(area) < 1e-14;
}

/**
 * Returns true if any two non-adjacent edges of the closed polygon intersect.
 *
 * The polygon is treated as having edges:
 *   e_0 = (p_0, p_1), e_1 = (p_1, p_2), ..., e_{n-1} = (p_{n-1}, p_0)
 *
 * Two edges are adjacent if they share a vertex.  Adjacent edges always
 * share exactly one endpoint and must NOT be flagged as intersecting.
 */
function hasSelfIntersection(
  points: Array<{ lat: number; lng: number }>,
): boolean {
  const n = points.length;
  // Build edge list: [startIndex, endIndex]
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edges.push([i, (i + 1) % n]);
  }

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 2; j < edges.length; j++) {
      // Skip the wrap-around pair (last edge adjacent to first edge)
      if (i === 0 && j === edges.length - 1) continue;

      const [a, b] = edges[i]!;
      const [c, d] = edges[j]!;

      if (segmentsIntersect(points[a]!, points[b]!, points[c]!, points[d]!)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Tests whether segment AB and segment CD properly intersect.
 *
 * "Properly" means they cross at an interior point — shared endpoints
 * (adjacency) are NOT counted as an intersection.
 *
 * Algorithm: orientation-based (cross-product sign test).
 */
function segmentsIntersect(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  c: { lat: number; lng: number },
  d: { lat: number; lng: number },
): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  if (differentSigns(d1, d2) && differentSigns(d3, d4)) {
    return true;
  }

  // Collinear cases — we deliberately do NOT count endpoint touches
  // as intersections (adjacent edges share vertices by definition).
  // Collinear overlap would be a degenerate polygon; for simplicity
  // we treat collinear cases as non-intersecting here.

  return false;
}

/**
 * Returns the 2D cross product of vectors (p→r) relative to (p→q):
 * cross(p, q, r) = (q - p) × (r - p)
 *
 * Positive: r is to the left of p→q
 * Negative: r is to the right
 * Zero:     collinear
 */
function cross(
  p: { lat: number; lng: number },
  q: { lat: number; lng: number },
  r: { lat: number; lng: number },
): number {
  return (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
}

/** Returns true if a and b have strictly different signs (both non-zero). */
function differentSigns(a: number, b: number): boolean {
  return a * b < 0;
}
