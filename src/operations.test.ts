import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { Operations } from "./operations";
import type { VertexID } from "./types";

describe("Operations", () => {
  let network: Network;
  let polygonManager: PolygonManager;
  let ops: Operations;

  beforeEach(() => {
    network = new Network();
    polygonManager = new PolygonManager();
    ops = new Operations(network, polygonManager);
  });

  describe("addVertex", () => {
    it("should add an isolated vertex", () => {
      const cs = ops.addVertex(35.0, 139.0);
      expect(cs.vertices.added).toHaveLength(1);
      expect(cs.vertices.added[0]!.lat).toBe(35.0);
      expect(cs.vertices.added[0]!.lng).toBe(139.0);
      expect(network.getAllVertices()).toHaveLength(1);
    });
  });

  describe("addConnectedVertex", () => {
    it("should add a vertex connected to existing vertex", () => {
      const cs1 = ops.addVertex(0, 0);
      const fromId = cs1.vertices.added[0]!.id;
      const cs2 = ops.addConnectedVertex(fromId, 1, 0);

      expect(cs2.vertices.added).toHaveLength(1);
      expect(cs2.edges.added).toHaveLength(1);
      expect(network.getAllVertices()).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(1);
    });

    it("should detect intersections when new edge crosses existing edge", () => {
      // Create edge from (0,2) to (2,0)
      const a = ops.addVertex(0, 2);
      const aId = a.vertices.added[0]!.id;
      const b = ops.addConnectedVertex(aId, 2, 0);
      const bId = b.vertices.added[0]!.id;

      // Create vertex at (0,0) and connect to (2,2) — crosses the diagonal
      const c = ops.addVertex(0, 0);
      const cId = c.vertices.added[0]!.id;
      const cs = ops.addConnectedVertex(cId, 2, 2);

      // Should have added an intersection vertex
      expect(cs.vertices.added.length).toBeGreaterThanOrEqual(2); // new vertex + intersection
      // Original diagonal should be split
      expect(cs.edges.removed.length).toBeGreaterThan(0);
    });
  });

  describe("snapToVertex", () => {
    it("should create edge between two existing vertices", () => {
      const cs1 = ops.addVertex(0, 0);
      const cs2 = ops.addVertex(1, 0);
      const v1 = cs1.vertices.added[0]!.id;
      const v2 = cs2.vertices.added[0]!.id;

      const cs = ops.snapToVertex(v1, v2);
      expect(cs.edges.added).toHaveLength(1);
      expect(network.getAllEdges()).toHaveLength(1);
    });

    it("should create polygon when closing a triangle", () => {
      // Build open triangle: v0-v1-v2, then close v2-v0
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      const v1 = cs1.vertices.added[0]!.id;
      const cs2 = ops.addConnectedVertex(v1, 0.5, 1);
      const v2 = cs2.vertices.added[0]!.id;

      const cs = ops.snapToVertex(v2, v0);

      // Should detect a polygon
      expect(cs.polygons.created).toHaveLength(1);
      expect(polygonManager.getAllPolygons()).toHaveLength(1);
    });
  });

  describe("snapToEdge", () => {
    it("should split edge and connect to it", () => {
      // Create edge from (0,0) to (2,0)
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 0, 2);
      const v1 = cs1.vertices.added[0]!.id;
      const edgeId = cs1.edges.added[0]!.id;

      // Create isolated vertex at (1,1)
      const cs2 = ops.addVertex(1, 1);
      const v2 = cs2.vertices.added[0]!.id;

      // Snap to edge at midpoint (0, 1)
      const cs = ops.snapToEdge(v2, edgeId, 0, 1);

      // Original edge should be removed, 2 new edges from split + 1 connecting edge
      expect(cs.edges.removed).toContain(edgeId);
      expect(cs.vertices.added).toHaveLength(1); // split point vertex
    });
  });

  describe("moveVertex", () => {
    it("should move vertex and return old position in changeset", () => {
      const cs0 = ops.addVertex(0, 0);
      const vId = cs0.vertices.added[0]!.id;
      const cs = ops.moveVertex(vId, 1, 1);

      expect(cs.vertices.moved).toHaveLength(1);
      expect(cs.vertices.moved[0]!.from).toEqual({ lat: 0, lng: 0 });
      expect(cs.vertices.moved[0]!.to).toEqual({ lat: 1, lng: 1 });
      expect(network.getVertex(vId)!.lat).toBe(1);
    });
  });

  describe("removeVertex", () => {
    it("should remove vertex and connected edges", () => {
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      const v1 = cs1.vertices.added[0]!.id;

      const cs = ops.removeVertex(v0);
      expect(cs.vertices.removed).toContain(v0);
      expect(cs.edges.removed).toHaveLength(1);
      expect(network.getAllVertices()).toHaveLength(1);
    });

    it("should remove polygon when breaking a cycle", () => {
      // Build triangle
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      const v1 = cs1.vertices.added[0]!.id;
      const cs2 = ops.addConnectedVertex(v1, 0.5, 1);
      const v2 = cs2.vertices.added[0]!.id;
      ops.snapToVertex(v2, v0);
      expect(polygonManager.getAllPolygons()).toHaveLength(1);
      const polyId = polygonManager.getAllPolygons()[0]!.id;

      // Remove one vertex → polygon should disappear
      const cs = ops.removeVertex(v0);
      expect(cs.polygons.removed).toContain(polyId);
      expect(polygonManager.getAllPolygons()).toHaveLength(0);
    });
  });

  describe("removeEdge", () => {
    it("should remove only the edge, not vertices", () => {
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      const edgeId = cs1.edges.added[0]!.id;

      const cs = ops.removeEdge(edgeId);
      expect(cs.edges.removed).toContain(edgeId);
      expect(network.getAllVertices()).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(0);
    });
  });

  describe("splitEdgeAtPoint", () => {
    it("should insert vertex on edge", () => {
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 0, 2);
      const edgeId = cs1.edges.added[0]!.id;

      const cs = ops.splitEdgeAtPoint(edgeId, 0, 1);
      expect(cs.vertices.added).toHaveLength(1);
      expect(cs.vertices.added[0]!.lat).toBe(0);
      expect(cs.vertices.added[0]!.lng).toBe(1);
      expect(cs.edges.removed).toContain(edgeId);
      expect(cs.edges.added).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(2);
    });
  });
});
