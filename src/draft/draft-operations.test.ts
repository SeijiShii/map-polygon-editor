import { describe, it, expect } from "vitest";
import {
  createDraft,
  addPoint,
  insertPoint,
  movePoint,
  removePoint,
  closeDraft,
  openDraft,
  draftToGeoJSON,
} from "./draft-operations.js";
import type { DraftShape, Point } from "../types/index.js";

// ---- helpers ----

/** Constructs a DraftShape directly for test setup. */
function makeDraft(points: Point[], isClosed = false): DraftShape {
  return { points, isClosed };
}

function pt(lat: number, lng: number): Point {
  return { lat, lng };
}

// ============================================================
// createDraft
// ============================================================

describe("createDraft()", () => {
  it("returns a draft with an empty points array", () => {
    const draft = createDraft();
    expect(draft.points).toEqual([]);
  });

  it("returns a draft that is open (isClosed = false)", () => {
    const draft = createDraft();
    expect(draft.isClosed).toBe(false);
  });

  it("returns a new object on each call (not shared state)", () => {
    const a = createDraft();
    const b = createDraft();
    expect(a).not.toBe(b);
    expect(a.points).not.toBe(b.points);
  });
});

// ============================================================
// addPoint
// ============================================================

describe("addPoint(draft, point)", () => {
  it("appends a point to an empty draft", () => {
    const draft = createDraft();
    const result = addPoint(draft, pt(35.0, 139.0));
    expect(result.points).toEqual([pt(35.0, 139.0)]);
  });

  it("appends to an existing list", () => {
    const draft = makeDraft([pt(1, 2)]);
    const result = addPoint(draft, pt(3, 4));
    expect(result.points).toEqual([pt(1, 2), pt(3, 4)]);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(1, 2)]);
    const original = [...draft.points];
    addPoint(draft, pt(3, 4));
    expect(draft.points).toEqual(original);
  });

  it("preserves isClosed state", () => {
    const draft = makeDraft([pt(1, 2), pt(3, 4), pt(5, 6)], true);
    const result = addPoint(draft, pt(7, 8));
    expect(result.isClosed).toBe(true);
  });

  it("appends multiple points sequentially", () => {
    let draft = createDraft();
    draft = addPoint(draft, pt(0, 0));
    draft = addPoint(draft, pt(1, 0));
    draft = addPoint(draft, pt(1, 1));
    expect(draft.points).toEqual([pt(0, 0), pt(1, 0), pt(1, 1)]);
  });
});

// ============================================================
// insertPoint
// ============================================================

describe("insertPoint(draft, index, point)", () => {
  it("inserts at index 0 (front)", () => {
    const draft = makeDraft([pt(2, 2), pt(3, 3)]);
    const result = insertPoint(draft, 0, pt(1, 1));
    expect(result.points).toEqual([pt(1, 1), pt(2, 2), pt(3, 3)]);
  });

  it("inserts in the middle", () => {
    const draft = makeDraft([pt(1, 1), pt(3, 3)]);
    const result = insertPoint(draft, 1, pt(2, 2));
    expect(result.points).toEqual([pt(1, 1), pt(2, 2), pt(3, 3)]);
  });

  it("inserts at the end (index === length)", () => {
    const draft = makeDraft([pt(1, 1), pt(2, 2)]);
    const result = insertPoint(draft, 2, pt(3, 3));
    expect(result.points).toEqual([pt(1, 1), pt(2, 2), pt(3, 3)]);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(1, 1), pt(3, 3)]);
    const original = [...draft.points];
    insertPoint(draft, 1, pt(2, 2));
    expect(draft.points).toEqual(original);
  });

  it("preserves isClosed state", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 0)], true);
    const result = insertPoint(draft, 1, pt(0.5, 0.5));
    expect(result.isClosed).toBe(true);
  });

  it("handles inserting into an empty draft at index 0", () => {
    const draft = createDraft();
    const result = insertPoint(draft, 0, pt(5, 5));
    expect(result.points).toEqual([pt(5, 5)]);
  });
});

// ============================================================
// movePoint
// ============================================================

describe("movePoint(draft, index, point)", () => {
  it("replaces the point at the given index", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    const result = movePoint(draft, 1, pt(9, 9));
    expect(result.points).toEqual([pt(0, 0), pt(9, 9), pt(2, 2)]);
  });

  it("replaces the first point", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1)]);
    const result = movePoint(draft, 0, pt(5, 5));
    expect(result.points).toEqual([pt(5, 5), pt(1, 1)]);
  });

  it("replaces the last point", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    const result = movePoint(draft, 2, pt(9, 9));
    expect(result.points).toEqual([pt(0, 0), pt(1, 1), pt(9, 9)]);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1)]);
    movePoint(draft, 0, pt(9, 9));
    expect(draft.points[0]).toEqual(pt(0, 0));
  });

  it("preserves isClosed state", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], true);
    const result = movePoint(draft, 0, pt(0, 0.5));
    expect(result.isClosed).toBe(true);
  });
});

// ============================================================
// removePoint
// ============================================================

describe("removePoint(draft, index)", () => {
  it("removes the point at the given index", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    const result = removePoint(draft, 1);
    expect(result.points).toEqual([pt(0, 0), pt(2, 2)]);
  });

  it("removes the first point", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    const result = removePoint(draft, 0);
    expect(result.points).toEqual([pt(1, 1), pt(2, 2)]);
  });

  it("removes the last point", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1), pt(2, 2)]);
    const result = removePoint(draft, 2);
    expect(result.points).toEqual([pt(0, 0), pt(1, 1)]);
  });

  it("removes the only point leaving an empty array", () => {
    const draft = makeDraft([pt(1, 2)]);
    const result = removePoint(draft, 0);
    expect(result.points).toEqual([]);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 1)]);
    removePoint(draft, 0);
    expect(draft.points).toHaveLength(2);
  });

  it("preserves isClosed state", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)], true);
    const result = removePoint(draft, 0);
    expect(result.isClosed).toBe(true);
  });
});

// ============================================================
// closeDraft
// ============================================================

describe("closeDraft(draft)", () => {
  it("sets isClosed to true", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)]);
    const result = closeDraft(draft);
    expect(result.isClosed).toBe(true);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)]);
    closeDraft(draft);
    expect(draft.isClosed).toBe(false);
  });

  it("preserves the points array (not mutated, same values)", () => {
    const points = [pt(0, 0), pt(1, 0), pt(1, 1)];
    const draft = makeDraft(points);
    const result = closeDraft(draft);
    expect(result.points).toEqual(points);
  });

  it("is idempotent (closing an already-closed draft is fine)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], true);
    const result = closeDraft(draft);
    expect(result.isClosed).toBe(true);
  });
});

// ============================================================
// openDraft
// ============================================================

describe("openDraft(draft)", () => {
  it("sets isClosed to false", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], true);
    const result = openDraft(draft);
    expect(result.isClosed).toBe(false);
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], true);
    openDraft(draft);
    expect(draft.isClosed).toBe(true);
  });

  it("preserves the points array", () => {
    const points = [pt(0, 0), pt(1, 0), pt(1, 1)];
    const draft = makeDraft(points, true);
    const result = openDraft(draft);
    expect(result.points).toEqual(points);
  });

  it("is idempotent (opening an already-open draft is fine)", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0)]);
    const result = openDraft(draft);
    expect(result.isClosed).toBe(false);
  });
});

// ============================================================
// draftToGeoJSON
// ============================================================

describe("draftToGeoJSON(draft)", () => {
  it("converts a closed CCW triangle to a GeoJSON Polygon", () => {
    // CCW triangle: (0,0) -> (1,0) -> (0,1)
    // lat/lng stored as [lng, lat] in GeoJSON
    const draft = makeDraft([pt(0, 0), pt(0, 1), pt(1, 1)], true);
    const geojson = draftToGeoJSON(draft);
    expect(geojson.type).toBe("Polygon");
    // Should have exactly one ring (exterior)
    expect(geojson.coordinates).toHaveLength(1);
    // Ring should be closed (first = last)
    const ring = geojson.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("throws if draft is not closed", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], false);
    expect(() => draftToGeoJSON(draft)).toThrow();
  });

  it("throws if draft has fewer than 3 points", () => {
    const draft = makeDraft([pt(0, 0), pt(1, 0)], true);
    expect(() => draftToGeoJSON(draft)).toThrow();
  });

  it("throws if draft has 0 points", () => {
    const draft = makeDraft([], true);
    expect(() => draftToGeoJSON(draft)).toThrow();
  });

  it("produces coordinates as [lng, lat] order per GeoJSON spec", () => {
    // lat=35, lng=139 → GeoJSON coord [139, 35]
    const draft = makeDraft(
      [pt(35, 139), pt(35, 140), pt(36, 139)],
      true
    );
    const geojson = draftToGeoJSON(draft);
    const ring = geojson.coordinates[0];
    // Check the first coordinate is [lng, lat]
    expect(ring[0][0]).toBeCloseTo(139);
    expect(ring[0][1]).toBeCloseTo(35);
  });

  it("normalizes CW winding order to CCW (exterior ring)", () => {
    // CW triangle in lat/lng: (0,0) -> (1,0) -> (1,1)
    // A CW ring must be reversed to CCW in the output
    const cw = makeDraft([pt(0, 0), pt(1, 0), pt(1, 1)], true);
    const ccw = makeDraft([pt(0, 0), pt(1, 1), pt(1, 0)], true);

    const cwGeo = draftToGeoJSON(cw);
    const ccwGeo = draftToGeoJSON(ccw);

    // Both should produce CCW rings (signed area > 0 in GeoJSON coords)
    const signedArea = (ring: number[][]): number => {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area +=
          (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
      }
      return area;
    };

    // CCW in GeoJSON means negative signed area with the shoelace formula
    // (lat axis goes up, but GeoJSON uses [lng, lat]; CCW = negative area)
    expect(signedArea(cwGeo.coordinates[0])).toBeLessThan(0);
    expect(signedArea(ccwGeo.coordinates[0])).toBeLessThan(0);
  });

  it("closes the ring: last coordinate equals first coordinate", () => {
    const draft = makeDraft([pt(0, 0), pt(0, 1), pt(1, 1)], true);
    const geojson = draftToGeoJSON(draft);
    const ring = geojson.coordinates[0];
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it("ring length equals points.length + 1 (closed ring)", () => {
    const draft = makeDraft([pt(0, 0), pt(0, 1), pt(1, 1)], true);
    const geojson = draftToGeoJSON(draft);
    expect(geojson.coordinates[0]).toHaveLength(draft.points.length + 1);
  });

  it("handles a square correctly", () => {
    const draft = makeDraft(
      [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0)],
      true
    );
    const geojson = draftToGeoJSON(draft);
    expect(geojson.type).toBe("Polygon");
    expect(geojson.coordinates[0]).toHaveLength(5); // 4 points + closing point
  });
});
