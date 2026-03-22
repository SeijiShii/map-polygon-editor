import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { Operations } from "./operations";
import type { VertexID, PolygonID } from "./types";
import { createPolygonID } from "./types";

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

    it("should report polygon as modified when vertex moves even if edge set unchanged", () => {
      // Build a triangle: v0-v1-v2
      const cs0 = ops.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      const v1 = cs1.vertices.added[0]!.id;
      const cs2 = ops.addConnectedVertex(v1, 0.5, 1);
      const v2 = cs2.vertices.added[0]!.id;
      ops.snapToVertex(v2, v0); // close triangle

      expect(polygonManager.getAllPolygons()).toHaveLength(1);

      // Move v0 slightly — polygon should be modified even though edge IDs are unchanged
      const csMove = ops.moveVertexLight(v0, 0.1, 0.1);
      expect(csMove.polygons.modified).toHaveLength(1);
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

  describe("removePolygon", () => {
    /** Helper: build a triangle and return vertex IDs + polygon ID */
    function makeTriangle(o: Operations, n: Network, pm: PolygonManager) {
      const cs0 = o.addVertex(0, 0);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = o.addConnectedVertex(v0, 1, 0);
      const v1 = cs1.vertices.added[0]!.id;
      const cs2 = o.addConnectedVertex(v1, 0.5, 1);
      const v2 = cs2.vertices.added[0]!.id;
      o.snapToVertex(v2, v0);
      const polyId = pm.getAllPolygons()[0]!.id;
      return { v0, v1, v2, polyId };
    }

    it("should remove an isolated triangle completely (edges + vertices)", () => {
      const { polyId } = makeTriangle(ops, network, polygonManager);
      expect(polygonManager.getAllPolygons()).toHaveLength(1);

      const cs = ops.removePolygon(polyId);

      // All 3 edges removed
      expect(cs.edges.removed).toHaveLength(3);
      // All 3 vertices removed
      expect(cs.vertices.removed).toHaveLength(3);
      // Polygon removed
      expect(cs.polygons.removed).toContain(polyId);
      // Network is empty
      expect(network.getAllEdges()).toHaveLength(0);
      expect(network.getAllVertices()).toHaveLength(0);
      expect(polygonManager.getAllPolygons()).toHaveLength(0);
    });

    it("should preserve shared edges and vertices when adjacent polygon exists", () => {
      // Build two adjacent triangles sharing one edge:
      //   v0 --- v1
      //    \  A  / \
      //     \  /  B \
      //      v2 --- v3
      const cs0 = ops.addVertex(0, 1);
      const v0 = cs0.vertices.added[0]!.id;
      const cs1 = ops.addConnectedVertex(v0, 1, 1);
      const v1 = cs1.vertices.added[0]!.id;
      const cs2 = ops.addConnectedVertex(v1, 0.5, 0);
      const v2 = cs2.vertices.added[0]!.id;
      // Close triangle A: v2 -> v0
      ops.snapToVertex(v2, v0);
      expect(polygonManager.getAllPolygons()).toHaveLength(1);
      const polyA = polygonManager.getAllPolygons()[0]!.id;

      // Build triangle B: v1 -> v3 -> v2
      const cs3 = ops.addConnectedVertex(v1, 1.5, 0);
      const v3 = cs3.vertices.added[0]!.id;
      ops.snapToVertex(v3, v2);
      expect(polygonManager.getAllPolygons()).toHaveLength(2);
      const polyB = polygonManager
        .getAllPolygons()
        .find((p) => p.id !== polyA)!.id;

      // Remove triangle B
      const cs = ops.removePolygon(polyB);

      // Shared edge (v1-v2) should be preserved
      // Only non-shared edges of B removed (v1-v3, v3-v2)
      expect(cs.edges.removed).toHaveLength(2);
      // Only v3 should be removed (v1, v2 are shared)
      expect(cs.vertices.removed).toHaveLength(1);
      expect(cs.vertices.removed).toContain(v3);
      // Triangle A still exists
      expect(polygonManager.getAllPolygons()).toHaveLength(1);
      expect(polygonManager.getAllPolygons()[0]!.id).toBe(polyA);
      // v0, v1, v2 still in network
      expect(network.getVertex(v0)).not.toBeNull();
      expect(network.getVertex(v1)).not.toBeNull();
      expect(network.getVertex(v2)).not.toBeNull();
    });

    it("should return empty ChangeSet for non-existent polygon ID", () => {
      const fakeId = createPolygonID("nonexistent");
      const cs = ops.removePolygon(fakeId);

      expect(cs.edges.removed).toHaveLength(0);
      expect(cs.vertices.removed).toHaveLength(0);
      expect(cs.polygons.removed).toHaveLength(0);
    });

    it("should handle dangling edges attached to polygon vertex", () => {
      // Triangle + one dangling edge from v0
      const { v0, polyId } = makeTriangle(ops, network, polygonManager);

      // Add a dangling edge from v0
      const csDangle = ops.addConnectedVertex(v0, -1, -1);
      const vDangle = csDangle.vertices.added[0]!.id;

      // Remove the triangle
      const cs = ops.removePolygon(polyId);

      // Polygon removed
      expect(cs.polygons.removed).toContain(polyId);
      // v0 still has a dangling edge, so it should NOT be removed
      expect(network.getVertex(v0)).not.toBeNull();
      expect(network.getVertex(vDangle)).not.toBeNull();
      // The dangling edge still exists
      expect(network.getEdgesOfVertex(v0)).toHaveLength(1);
    });
  });
});
