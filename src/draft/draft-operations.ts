import type { DraftShape, GeoJSONPolygon, Point } from "../types/index.js";

// ============================================================
// Pure factory
// ============================================================

/** Creates a new empty, open DraftShape. */
export function createDraft(): DraftShape {
  return { points: [], isClosed: false };
}

// ============================================================
// Immutable point operations
// ============================================================

/** Appends a point to the end of the draft's point list. */
export function addPoint(draft: DraftShape, point: Point): DraftShape {
  return { ...draft, points: [...draft.points, point] };
}

/**
 * Inserts a point at the given index.
 * Index 0 prepends; index === points.length appends.
 */
export function insertPoint(
  draft: DraftShape,
  index: number,
  point: Point,
): DraftShape {
  const next = [...draft.points];
  next.splice(index, 0, point);
  return { ...draft, points: next };
}

/** Replaces the point at the given index with a new coordinate. */
export function movePoint(
  draft: DraftShape,
  index: number,
  point: Point,
): DraftShape {
  const next = [...draft.points];
  next[index] = point;
  return { ...draft, points: next };
}

/** Removes the point at the given index. */
export function removePoint(draft: DraftShape, index: number): DraftShape {
  const next = [...draft.points];
  next.splice(index, 1);
  return { ...draft, points: next };
}

// ============================================================
// Open / Close
// ============================================================

/** Returns a new draft with isClosed = true. */
export function closeDraft(draft: DraftShape): DraftShape {
  return { ...draft, isClosed: true };
}

/** Returns a new draft with isClosed = false. */
export function openDraft(draft: DraftShape): DraftShape {
  return { ...draft, isClosed: false };
}

// ============================================================
// GeoJSON conversion
// ============================================================

/**
 * Converts a closed DraftShape to a GeoJSON Polygon.
 *
 * Rules:
 * - Throws if draft is not closed.
 * - Throws if draft has fewer than 3 points.
 * - GeoJSON coordinates are [lng, lat] order (RFC 7946).
 * - The exterior ring is normalized to CCW winding order.
 * - The ring is explicitly closed: last coordinate equals first.
 */
export function draftToGeoJSON(draft: DraftShape): GeoJSONPolygon {
  if (!draft.isClosed) {
    throw new Error("draftToGeoJSON: draft must be closed (isClosed = true)");
  }
  if (draft.points.length < 3) {
    throw new Error(
      `draftToGeoJSON: draft must have at least 3 points, got ${draft.points.length}`,
    );
  }

  // Convert Point { lat, lng } → GeoJSON [lng, lat]
  const coords: number[][] = draft.points.map((p) => [p.lng, p.lat]);

  // Ensure the ring is CCW (RFC 7946 exterior ring standard).
  // We use the shoelace signed-area formula in [lng, lat] space.
  // CCW → negative signed area (because the lat-axis is positive upward,
  // and in a standard math coordinate system CCW gives positive area;
  // however in [lng, lat] the y-axis is lat (pointing up) so the
  // standard shoelace gives positive for CCW).
  // We use: area > 0 → CCW in GeoJSON screen space? Let's be explicit:
  //
  // RFC 7946 §3.1.6: exterior rings MUST follow CCW order when projected
  // onto a 2D Cartesian plane with x=lng, y=lat.
  //
  // Shoelace formula: positive area = CCW in Cartesian (x right, y up).
  // So: if signedArea(ring) < 0, the ring is CW → reverse it.
  if (signedArea(coords) < 0) {
    coords.reverse();
  }

  // Close the ring: last coord = first coord
  // coords is guaranteed non-empty (length >= 3 checked above)
  const closedRing = [...coords, coords[0]!];

  return {
    type: "Polygon",
    coordinates: [closedRing],
  };
}

// ============================================================
// Geometry helpers (module-internal)
// ============================================================

/**
 * Computes the signed area of a ring using the shoelace formula.
 * Positive result → CCW in Cartesian (x=lng, y=lat).
 * Negative result → CW.
 *
 * The ring need NOT be explicitly closed (first ≠ last).
 */
function signedArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i]!;
    const b = ring[j]!;
    area += a[0]! * b[1]!;
    area -= b[0]! * a[1]!;
  }
  return area / 2;
}
