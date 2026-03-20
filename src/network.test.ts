import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { createVertexID, createEdgeID } from "./types";
import type { VertexID, EdgeID } from "./types";

describe("Network", () => {
  let network: Network;

  beforeEach(() => {
    network = new Network();
  });

  describe("addVertex", () => {
    it("should add a vertex and return it", () => {
      const v = network.addVertex(35.0, 139.0);
      expect(v.lat).toBe(35.0);
      expect(v.lng).toBe(139.0);
      expect(v.id).toBeDefined();
    });

    it("should store the vertex retrievable by ID", () => {
      const v = network.addVertex(35.0, 139.0);
      const retrieved = network.getVertex(v.id);
      expect(retrieved).toEqual(v);
    });

    it("should accept an optional ID", () => {
      const id = createVertexID("v1");
      const v = network.addVertex(35.0, 139.0, id);
      expect(v.id).toBe(id);
    });
  });

  describe("removeVertex", () => {
    it("should remove a vertex", () => {
      const v = network.addVertex(35.0, 139.0);
      network.removeVertex(v.id);
      expect(network.getVertex(v.id)).toBeNull();
    });

    it("should also remove connected edges", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      network.removeVertex(v1.id);
      expect(network.getEdge(e.id)).toBeNull();
    });

    it("should return removed edge IDs", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const v3 = network.addVertex(35.2, 139.2);
      const e1 = network.addEdge(v1.id, v2.id);
      const e2 = network.addEdge(v1.id, v3.id);
      const removedEdgeIds = network.removeVertex(v1.id);
      expect(removedEdgeIds).toContain(e1.id);
      expect(removedEdgeIds).toContain(e2.id);
    });

    it("should throw if vertex does not exist", () => {
      expect(() =>
        network.removeVertex(createVertexID("nonexistent")),
      ).toThrow();
    });
  });

  describe("moveVertex", () => {
    it("should update vertex coordinates", () => {
      const v = network.addVertex(35.0, 139.0);
      network.moveVertex(v.id, 36.0, 140.0);
      const updated = network.getVertex(v.id);
      expect(updated?.lat).toBe(36.0);
      expect(updated?.lng).toBe(140.0);
    });

    it("should return the old position", () => {
      const v = network.addVertex(35.0, 139.0);
      const old = network.moveVertex(v.id, 36.0, 140.0);
      expect(old).toEqual({ lat: 35.0, lng: 139.0 });
    });

    it("should throw if vertex does not exist", () => {
      expect(() =>
        network.moveVertex(createVertexID("nonexistent"), 0, 0),
      ).toThrow();
    });
  });

  describe("addEdge", () => {
    it("should add an edge between two vertices", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      expect(e.v1).toBe(v1.id);
      expect(e.v2).toBe(v2.id);
      expect(e.id).toBeDefined();
    });

    it("should reject duplicate edges (same pair)", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      network.addEdge(v1.id, v2.id);
      expect(() => network.addEdge(v1.id, v2.id)).toThrow();
    });

    it("should reject duplicate edges (reversed pair)", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      network.addEdge(v1.id, v2.id);
      expect(() => network.addEdge(v2.id, v1.id)).toThrow();
    });

    it("should reject self-loop", () => {
      const v1 = network.addVertex(35.0, 139.0);
      expect(() => network.addEdge(v1.id, v1.id)).toThrow();
    });

    it("should throw if vertex does not exist", () => {
      const v1 = network.addVertex(35.0, 139.0);
      expect(() =>
        network.addEdge(v1.id, createVertexID("nonexistent")),
      ).toThrow();
    });

    it("should accept an optional ID", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const id = createEdgeID("e1");
      const e = network.addEdge(v1.id, v2.id, id);
      expect(e.id).toBe(id);
    });
  });

  describe("removeEdge", () => {
    it("should remove an edge", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      network.removeEdge(e.id);
      expect(network.getEdge(e.id)).toBeNull();
    });

    it("should not remove the vertices", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      network.removeEdge(e.id);
      expect(network.getVertex(v1.id)).not.toBeNull();
      expect(network.getVertex(v2.id)).not.toBeNull();
    });

    it("should update adjacency index", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      network.removeEdge(e.id);
      expect(network.getEdgesOfVertex(v1.id)).toHaveLength(0);
      expect(network.getEdgesOfVertex(v2.id)).toHaveLength(0);
    });

    it("should throw if edge does not exist", () => {
      expect(() => network.removeEdge(createEdgeID("nonexistent"))).toThrow();
    });
  });

  describe("adjacency queries", () => {
    it("getEdgesOfVertex should return connected edges", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const v3 = network.addVertex(35.2, 139.2);
      const e1 = network.addEdge(v1.id, v2.id);
      const e2 = network.addEdge(v1.id, v3.id);
      const edges = network.getEdgesOfVertex(v1.id);
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.id)).toContain(e1.id);
      expect(edges.map((e) => e.id)).toContain(e2.id);
    });

    it("getNeighborVertices should return adjacent vertices", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const v3 = network.addVertex(35.2, 139.2);
      network.addEdge(v1.id, v2.id);
      network.addEdge(v1.id, v3.id);
      const neighbors = network.getNeighborVertices(v1.id);
      expect(neighbors).toHaveLength(2);
      expect(neighbors.map((v) => v.id)).toContain(v2.id);
      expect(neighbors.map((v) => v.id)).toContain(v3.id);
    });

    it("getVertexPairEdge should find edge between two vertices", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const e = network.addEdge(v1.id, v2.id);
      expect(network.getVertexPairEdge(v1.id, v2.id)).toBe(e.id);
      expect(network.getVertexPairEdge(v2.id, v1.id)).toBe(e.id);
    });

    it("getVertexPairEdge should return undefined if no edge", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      expect(network.getVertexPairEdge(v1.id, v2.id)).toBeUndefined();
    });
  });

  describe("findNearestVertex", () => {
    it("should find the nearest vertex within radius", () => {
      network.addVertex(0, 0);
      const v2 = network.addVertex(1, 0);
      network.addVertex(5, 5);
      const result = network.findNearestVertex(0.9, 0.1, 0.5);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(v2.id);
    });

    it("should return null if no vertex within radius", () => {
      network.addVertex(0, 0);
      const result = network.findNearestVertex(10, 10, 1);
      expect(result).toBeNull();
    });

    it("should return null for empty network", () => {
      const result = network.findNearestVertex(0, 0, 10);
      expect(result).toBeNull();
    });
  });

  describe("findNearestEdge", () => {
    it("should find the nearest edge within radius", () => {
      const v1 = network.addVertex(0, 0);
      const v2 = network.addVertex(0, 2);
      const e = network.addEdge(v1.id, v2.id);
      // Point (0.1, 1) is close to the edge (0,0)-(0,2)
      const result = network.findNearestEdge(0.1, 1, 0.5);
      expect(result).not.toBeNull();
      expect(result!.edge.id).toBe(e.id);
      expect(result!.point.lat).toBeCloseTo(0);
      expect(result!.point.lng).toBeCloseTo(1);
    });

    it("should return null if no edge within radius", () => {
      const v1 = network.addVertex(0, 0);
      const v2 = network.addVertex(0, 2);
      network.addEdge(v1.id, v2.id);
      const result = network.findNearestEdge(10, 10, 1);
      expect(result).toBeNull();
    });

    it("should return null for empty network", () => {
      const result = network.findNearestEdge(0, 0, 10);
      expect(result).toBeNull();
    });

    it("should clamp projection to edge endpoints", () => {
      const v1 = network.addVertex(0, 0);
      const v2 = network.addVertex(0, 2);
      network.addEdge(v1.id, v2.id);
      // Point (0, -0.5) projects before edge start
      const result = network.findNearestEdge(0, -0.5, 1);
      expect(result).not.toBeNull();
      expect(result!.point.lat).toBeCloseTo(0);
      expect(result!.point.lng).toBeCloseTo(0);
    });
  });

  describe("bulk queries", () => {
    it("getAllVertices should return all vertices", () => {
      network.addVertex(35.0, 139.0);
      network.addVertex(35.1, 139.1);
      expect(network.getAllVertices()).toHaveLength(2);
    });

    it("getAllEdges should return all edges", () => {
      const v1 = network.addVertex(35.0, 139.0);
      const v2 = network.addVertex(35.1, 139.1);
      const v3 = network.addVertex(35.2, 139.2);
      network.addEdge(v1.id, v2.id);
      network.addEdge(v2.id, v3.id);
      expect(network.getAllEdges()).toHaveLength(2);
    });
  });
});
