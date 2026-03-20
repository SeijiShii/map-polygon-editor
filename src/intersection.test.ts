import { describe, it, expect } from "vitest";
import { Network } from "./network";
import {
  findIntersections,
  resolveIntersections,
  segmentIntersection,
} from "./intersection";

describe("segmentIntersection", () => {
  it("should find intersection of two crossing segments", () => {
    const result = segmentIntersection(
      { lat: 0, lng: 0 },
      { lat: 2, lng: 2 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 0 },
    );
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(1);
    expect(result!.lng).toBeCloseTo(1);
  });

  it("should return null for parallel segments", () => {
    const result = segmentIntersection(
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
    );
    expect(result).toBeNull();
  });

  it("should return null for non-intersecting segments", () => {
    const result = segmentIntersection(
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 2, lng: 0 },
      { lat: 2, lng: 1 },
    );
    expect(result).toBeNull();
  });

  it("should return null for T-junction at shared endpoint", () => {
    // Segments share an endpoint — not a crossing
    const result = segmentIntersection(
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
    );
    expect(result).toBeNull();
  });
});

describe("findIntersections", () => {
  it("should find edges that intersect with a given line segment", () => {
    const network = new Network();
    const a = network.addVertex(0, 0);
    const b = network.addVertex(2, 2);
    const c = network.addVertex(0, 2);
    const d = network.addVertex(2, 0);
    const e = network.addEdge(c.id, d.id); // crosses A-B

    const results = findIntersections(
      { lat: 0, lng: 0 },
      { lat: 2, lng: 2 },
      network,
      new Set(), // no edges to exclude
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.edgeId).toBe(e.id);
    expect(results[0]!.point.lat).toBeCloseTo(1);
    expect(results[0]!.point.lng).toBeCloseTo(1);
  });

  it("should exclude specified edges from intersection search", () => {
    const network = new Network();
    const a = network.addVertex(0, 0);
    const b = network.addVertex(2, 2);
    const c = network.addVertex(0, 2);
    const d = network.addVertex(2, 0);
    const e = network.addEdge(c.id, d.id);

    const results = findIntersections(
      { lat: 0, lng: 0 },
      { lat: 2, lng: 2 },
      network,
      new Set([e.id]), // exclude this edge
    );
    expect(results).toHaveLength(0);
  });

  it("should find multiple intersections sorted by distance from start", () => {
    const network = new Network();
    // Line from (0,0) to (4,0)
    // Crossed by edge at (1,-1)-(1,1) and (3,-1)-(3,1)
    const c1 = network.addVertex(-1, 1);
    const d1 = network.addVertex(1, 1);
    const c2 = network.addVertex(-1, 3);
    const d2 = network.addVertex(1, 3);
    const e1 = network.addEdge(c1.id, d1.id);
    const e2 = network.addEdge(c2.id, d2.id);

    const results = findIntersections(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 4 },
      network,
      new Set(),
    );
    expect(results).toHaveLength(2);
    expect(results[0]!.point.lng).toBeCloseTo(1);
    expect(results[1]!.point.lng).toBeCloseTo(3);
  });
});

describe("resolveIntersections", () => {
  it("should split intersecting edges and insert vertices", () => {
    const network = new Network();
    // Existing edge: (0,2) to (2,0) — diagonal
    const c = network.addVertex(0, 2);
    const d = network.addVertex(2, 0);
    const existingEdge = network.addEdge(c.id, d.id);

    // New edge being added: (0,0) to (2,2) — crosses existing
    const a = network.addVertex(0, 0);
    const b = network.addVertex(2, 2);

    const result = resolveIntersections(a.id, b.id, network);

    // The intersection point (1,1) should be a new vertex
    expect(result.addedVertices.length).toBe(1);
    expect(result.addedVertices[0]!.lat).toBeCloseTo(1);
    expect(result.addedVertices[0]!.lng).toBeCloseTo(1);

    // Original edge c-d should be split into c-E and E-d
    expect(network.getEdge(existingEdge.id)).toBeNull(); // original removed
    expect(result.removedEdgeIds).toContain(existingEdge.id);

    // New edges: a-E, E-b, c-E, E-d
    expect(result.addedEdges.length).toBe(4);

    // Total edges in network: 4 (the 4 new ones, original removed)
    expect(network.getAllEdges()).toHaveLength(4);
  });

  it("should handle no intersections (simple edge add)", () => {
    const network = new Network();
    const a = network.addVertex(0, 0);
    const b = network.addVertex(1, 0);

    const result = resolveIntersections(a.id, b.id, network);

    expect(result.addedVertices).toHaveLength(0);
    expect(result.removedEdgeIds).toHaveLength(0);
    expect(result.addedEdges).toHaveLength(1);
    expect(network.getAllEdges()).toHaveLength(1);
  });
});
