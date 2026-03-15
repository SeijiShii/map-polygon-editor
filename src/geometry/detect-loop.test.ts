import { describe, it, expect } from "vitest";
import {
  buildConnectivityGraph,
  findLoop,
  extractLoopRing,
} from "./detect-loop.js";
import type { DraftEndpoint } from "./detect-loop.js";
import type { PolygonID, DraftID } from "../types/index.js";
import { makePolygonID, makeDraftID } from "../types/index.js";

// ============================================================
// Helpers
// ============================================================

const EPS = 1e-8;

function gridKey(lng: number, lat: number): string {
  const gx = Math.floor(lng / EPS);
  const gy = Math.floor(lat / EPS);
  return `${gx},${gy}`;
}

/**
 * 3 polygons arranged in a triangle, no shared edges:
 *
 *   A: [0,0]-[1,0]-[0.5,1]    (bottom-left triangle)
 *   B: [3,0]-[4,0]-[3.5,1]    (bottom-right triangle)
 *   C: [1.5,3]-[2.5,3]-[2,4]  (top triangle)
 *
 * None share vertices — they are far apart.
 */
const polyA_ring = [
  [0, 0],
  [1, 0],
  [0.5, 1],
  [0, 0],
];
const polyB_ring = [
  [3, 0],
  [4, 0],
  [3.5, 1],
  [3, 0],
];
const polyC_ring = [
  [1.5, 3],
  [2.5, 3],
  [2, 4],
  [1.5, 3],
];

// Draft D1: A vertex [1,0] → B vertex [3,0]
const d1: DraftEndpoint = {
  id: makeDraftID("d1"),
  firstCoord: [1, 0],
  lastCoord: [3, 0],
};

// Draft D2: B vertex [3.5,1] → C vertex [1.5,3]
const d2: DraftEndpoint = {
  id: makeDraftID("d2"),
  firstCoord: [3.5, 1],
  lastCoord: [1.5, 3],
};

// New line: C vertex [2,4] → A vertex [0.5,1]
// This should complete the loop: newLine + A boundary + D1 + B boundary + D2 + C boundary
const newLineStart: [number, number] = [2, 4]; // on C
const newLineEnd: [number, number] = [0.5, 1]; // on A

function makeCoordToPolygonIds(): (key: string) => PolygonID[] {
  // Build a map from coordinate key to polygon IDs
  const index = new Map<string, Set<PolygonID>>();
  const addRing = (ring: number[][], id: PolygonID) => {
    for (const [lng, lat] of ring) {
      const key = gridKey(lng!, lat!);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(id);
    }
  };
  addRing(polyA_ring, makePolygonID("polyA"));
  addRing(polyB_ring, makePolygonID("polyB"));
  addRing(polyC_ring, makePolygonID("polyC"));

  return (key: string) => {
    const set = index.get(key);
    return set ? [...set] : [];
  };
}

// ============================================================
// buildConnectivityGraph
// ============================================================

describe("buildConnectivityGraph", () => {
  it("creates nodes for all draft endpoints", () => {
    const graph = buildConnectivityGraph(
      [d1, d2],
      makeCoordToPolygonIds(),
      gridKey,
    );

    // d1 endpoints + d2 endpoints = 4 unique coordinate keys
    expect(graph.size).toBeGreaterThanOrEqual(4);
  });

  it("creates draft edges between endpoints of each draft", () => {
    const graph = buildConnectivityGraph(
      [d1],
      makeCoordToPolygonIds(),
      gridKey,
    );

    const startKey = gridKey(1, 0);
    const endKey = gridKey(3, 0);

    const neighbors = graph.get(startKey);
    expect(neighbors).toBeDefined();
    const draftEdge = neighbors!.find(
      (n) => n.neighborKey === endKey && n.edge.type === "draft",
    );
    expect(draftEdge).toBeDefined();
  });

  it("creates polygon edges between endpoints on the same polygon", () => {
    // D1 first coord [1,0] and D2 first coord [3.5,1] — both on polyB
    const graph = buildConnectivityGraph(
      [d1, d2],
      makeCoordToPolygonIds(),
      gridKey,
    );

    const key_d1_end = gridKey(3, 0); // D1 lastCoord, on polyB
    const key_d2_start = gridKey(3.5, 1); // D2 firstCoord, on polyB

    const neighbors = graph.get(key_d1_end);
    expect(neighbors).toBeDefined();
    const polyEdge = neighbors!.find(
      (n) => n.neighborKey === key_d2_start && n.edge.type === "polygon",
    );
    expect(polyEdge).toBeDefined();
    expect(polyEdge!.edge.entityId).toBe("polyB");
  });

  it("returns empty graph for no drafts", () => {
    const graph = buildConnectivityGraph([], makeCoordToPolygonIds(), gridKey);
    expect(graph.size).toBe(0);
  });
});

// ============================================================
// findLoop
// ============================================================

describe("findLoop", () => {
  it("finds loop through 3 polygons and 2 drafts", () => {
    // Graph has: d1(A→B) + d2(B→C) + polygon edges on A, B, C
    // We search from newLineStart (on C) to newLineEnd (on A)
    const graph = buildConnectivityGraph(
      [d1, d2],
      makeCoordToPolygonIds(),
      gridKey,
      [newLineStart, newLineEnd],
    );

    const startKey = gridKey(...newLineStart);
    const targetKey = gridKey(...newLineEnd);

    const loop = findLoop(graph, startKey, targetKey);

    expect(loop).not.toBeNull();
    expect(loop!.edges.length).toBeGreaterThanOrEqual(4);
    // Path should alternate draft and polygon edges
    expect(loop!.nodeKeys[0]).toBe(startKey);
    expect(loop!.nodeKeys[loop!.nodeKeys.length - 1]).toBe(targetKey);
  });

  it("returns null when no path exists", () => {
    // Only one draft — graph is disconnected (no D2, so C is unreachable from B)
    const graph = buildConnectivityGraph(
      [d1], // only A↔B, no connection to C
      makeCoordToPolygonIds(),
      gridKey,
      [newLineStart, newLineEnd],
    );

    const startKey = gridKey(...newLineStart); // on C
    const targetKey = gridKey(...newLineEnd); // on A

    const loop = findLoop(graph, startKey, targetKey);
    expect(loop).toBeNull();
  });

  it("returns null when start equals target", () => {
    const graph = buildConnectivityGraph(
      [d1, d2],
      makeCoordToPolygonIds(),
      gridKey,
    );
    const key = gridKey(1, 0);
    const loop = findLoop(graph, key, key);
    expect(loop).toBeNull();
  });
});

// ============================================================
// extractLoopRing
// ============================================================

describe("extractLoopRing", () => {
  it("assembles closed CCW ring from loop path", () => {
    const graph = buildConnectivityGraph(
      [d1, d2],
      makeCoordToPolygonIds(),
      gridKey,
      [newLineStart, newLineEnd],
    );

    const startKey = gridKey(...newLineStart);
    const targetKey = gridKey(...newLineEnd);
    const loop = findLoop(graph, startKey, targetKey);
    expect(loop).not.toBeNull();

    const newLinePoints = [
      [2, 4], // C vertex
      [0.5, 1], // A vertex
    ];

    const polygonRings = new Map<PolygonID, number[][]>();
    polygonRings.set(makePolygonID("polyA"), polyA_ring);
    polygonRings.set(makePolygonID("polyB"), polyB_ring);
    polygonRings.set(makePolygonID("polyC"), polyC_ring);

    const draftPoints = new Map<DraftID, number[][]>();
    draftPoints.set(makeDraftID("d1"), [
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    draftPoints.set(makeDraftID("d2"), [
      [3.5, 1],
      [2.5, 2],
      [1.5, 3],
    ]);

    const ring = extractLoopRing(
      loop!,
      newLinePoints,
      polygonRings,
      draftPoints,
      gridKey,
    );

    // Ring should be closed
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring[ring.length - 1]).toEqual(ring[0]);

    // Ring should be CCW (positive signed area)
    const coords = ring.slice(0, -1);
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      area += coords[i]![0]! * coords[j]![1]!;
      area -= coords[j]![0]! * coords[i]![1]!;
    }
    expect(area).toBeGreaterThan(0);
  });
});
