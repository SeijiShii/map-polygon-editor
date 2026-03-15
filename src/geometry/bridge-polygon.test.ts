import { describe, it, expect } from "vitest";
import {
  computeBridgePolygon,
  findSharedVertices,
  buildSharedRuns,
  walkBoundary,
  selectBestRun,
} from "./bridge-polygon.js";

// ============================================================
// Helpers
// ============================================================

/** CCW unit square [0,0]-[1,0]-[1,1]-[0,1] (closed ring) */
const squareA = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0], // closing vertex
];

/** CCW square [1,0]-[2,0]-[2,1]-[1,1] sharing edge [1,0]-[1,1] with squareA */
const squareB = [
  [1, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 0], // closing vertex
];

const EPS = 1e-8;

// ============================================================
// findSharedVertices
// ============================================================

describe("findSharedVertices", () => {
  it("finds shared vertices between two adjacent squares", () => {
    // Strip closing vertex for internal function
    const rA = squareA.slice(0, -1);
    const rB = squareB.slice(0, -1);
    const shared = findSharedVertices(rA, rB, EPS);

    expect(shared).toHaveLength(2);

    // A[1]=[1,0] matches B[0]=[1,0]
    expect(shared).toContainEqual({ aIdx: 1, bIdx: 0 });
    // A[2]=[1,1] matches B[3]=[1,1]
    expect(shared).toContainEqual({ aIdx: 2, bIdx: 3 });
  });

  it("returns empty array when no shared vertices", () => {
    const rA = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const rB = [
      [5, 5],
      [6, 5],
      [6, 6],
      [5, 6],
    ];
    expect(findSharedVertices(rA, rB, EPS)).toHaveLength(0);
  });

  it("detects vertices within epsilon tolerance", () => {
    const rA = [[1, 1]];
    const rB = [[1 + 1e-9, 1 - 1e-9]];
    const shared = findSharedVertices(rA, rB, EPS);
    expect(shared).toHaveLength(1);
  });
});

// ============================================================
// buildSharedRuns
// ============================================================

describe("buildSharedRuns", () => {
  it("groups consecutive shared vertices into one run", () => {
    // A[1]↔B[0], A[2]↔B[3] — consecutive on A (1,2), on B (0,3=backward)
    const shared = [
      { aIdx: 1, bIdx: 0 },
      { aIdx: 2, bIdx: 3 },
    ];
    const runs = buildSharedRuns(shared, 4, 4);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.aIndices).toEqual([1, 2]);
    expect(runs[0]!.bIndices).toEqual([0, 3]);
  });

  it("creates separate runs for non-consecutive shared vertices", () => {
    // Shared at A[0]↔B[0] and A[2]↔B[2] — not consecutive on A
    const shared = [
      { aIdx: 0, bIdx: 0 },
      { aIdx: 2, bIdx: 2 },
    ];
    const runs = buildSharedRuns(shared, 4, 4);
    expect(runs).toHaveLength(2);
  });
});

// ============================================================
// walkBoundary
// ============================================================

describe("walkBoundary", () => {
  // Ring: [A, B, C, D] — indices 0,1,2,3
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  it("returns shorter path between two vertices (forward)", () => {
    // From 0 to 2: forward=[1], backward=[3]
    const path = walkBoundary(ring, 0, 2, 4);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual([1, 0]); // vertex at index 1
  });

  it("returns shorter path (backward when shorter)", () => {
    // From 3 to 1: forward=[0], backward=[2]
    const path = walkBoundary(ring, 3, 1, 4);
    expect(path).toHaveLength(1);
  });

  it("returns empty for adjacent vertices", () => {
    const path = walkBoundary(ring, 0, 1, 4);
    expect(path).toHaveLength(0);
  });

  it("returns empty for same vertex", () => {
    const path = walkBoundary(ring, 2, 2, 4);
    expect(path).toHaveLength(0);
  });
});

// ============================================================
// computeBridgePolygon
// ============================================================

describe("computeBridgePolygon", () => {
  it("returns null when rings share no vertices", () => {
    const farSquare = [
      [5, 5],
      [6, 5],
      [6, 6],
      [5, 6],
      [5, 5],
    ];
    const bridge = [
      [0, 1],
      [0, 3],
      [5, 6],
    ];
    const result = computeBridgePolygon(squareA, farSquare, 3, 2, bridge, EPS);
    expect(result).toBeNull();
  });

  it("creates closed polygon bridging two adjacent squares", () => {
    // squareA: [0,0]-[1,0]-[1,1]-[0,1]  (indices 0,1,2,3)
    // squareB: [1,0]-[2,0]-[2,1]-[1,1]  (indices 0,1,2,3)
    // Shared: A[1]=[1,0]↔B[0], A[2]=[1,1]↔B[3]
    //
    // Bridge from A vertex 3 [0,1] going up to [0,2],[2,2] landing on B vertex 2 [2,1]
    //
    // Expected polygon: [0,1]-[0,2]-[2,2]-[2,1]-[1,1]-[0,1]
    const bridgeLine = [
      [0, 1], // A[3] = [0,1]
      [0, 2],
      [2, 2],
      [2, 1], // B[2] = [2,1]
    ];

    const result = computeBridgePolygon(squareA, squareB, 3, 2, bridgeLine, EPS);

    expect(result).not.toBeNull();
    // Should be a closed ring (last = first)
    expect(result![result!.length - 1]).toEqual(result![0]);
    // Should contain the bridge points and the shared edge vertex [1,1]
    // The ring should have at least 5 unique vertices + closure
    expect(result!.length).toBeGreaterThanOrEqual(5);

    // Verify key vertices are present in the ring
    const coords = result!.slice(0, -1); // strip closing
    const hasVertex = (v: number[]) =>
      coords.some((c) => Math.abs(c[0]! - v[0]!) < EPS && Math.abs(c[1]! - v[1]!) < EPS);

    expect(hasVertex([0, 1])).toBe(true);  // A start
    expect(hasVertex([0, 2])).toBe(true);  // bridge point
    expect(hasVertex([2, 2])).toBe(true);  // bridge point
    expect(hasVertex([2, 1])).toBe(true);  // B end
    expect(hasVertex([1, 1])).toBe(true);  // shared vertex
  });

  it("produces CCW winding order", () => {
    const bridgeLine = [
      [0, 1],
      [0, 2],
      [2, 2],
      [2, 1],
    ];
    const result = computeBridgePolygon(squareA, squareB, 3, 2, bridgeLine, EPS);
    expect(result).not.toBeNull();

    // Compute signed area (positive = CCW in [lng,lat] Cartesian)
    const ring = result!.slice(0, -1);
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      area += ring[i]![0]! * ring[j]![1]!;
      area -= ring[j]![0]! * ring[i]![1]!;
    }
    expect(area).toBeGreaterThan(0); // CCW
  });

  it("bridge from B to A (reversed direction) also works", () => {
    // Bridge from B vertex 1 [2,0] going down to [2,-1],[0,-1] landing on A vertex 0 [0,0]
    const bridgeLine = [
      [2, 0], // B[1]
      [2, -1],
      [0, -1],
      [0, 0], // A[0]
    ];
    const result = computeBridgePolygon(squareB, squareA, 1, 0, bridgeLine, EPS);
    expect(result).not.toBeNull();
    // Closed ring
    expect(result![result!.length - 1]).toEqual(result![0]);
  });
});
