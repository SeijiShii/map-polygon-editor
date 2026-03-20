import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { Operations } from "./operations";
import { DrawingMode } from "./drawing-mode";

describe("DrawingMode", () => {
  let network: Network;
  let polygonManager: PolygonManager;
  let ops: Operations;
  let drawing: DrawingMode;

  beforeEach(() => {
    network = new Network();
    polygonManager = new PolygonManager();
    ops = new Operations(network, polygonManager);
    drawing = new DrawingMode(ops, network);
  });

  describe("lifecycle", () => {
    it("should start inactive", () => {
      expect(drawing.isActive()).toBe(false);
    });

    it("should become active after start", () => {
      drawing.start();
      expect(drawing.isActive()).toBe(true);
    });

    it("should become inactive after end", () => {
      drawing.start();
      drawing.end();
      expect(drawing.isActive()).toBe(false);
    });

    it("should throw if placing vertex while inactive", () => {
      expect(() => drawing.placeVertex(0, 0)).toThrow();
    });
  });

  describe("placeVertex", () => {
    it("should add first vertex as isolated", () => {
      drawing.start();
      const cs = drawing.placeVertex(0, 0);
      expect(cs.vertices.added).toHaveLength(1);
      expect(network.getAllVertices()).toHaveLength(1);
      expect(network.getAllEdges()).toHaveLength(0);
    });

    it("should connect second vertex to first with an edge", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      const cs = drawing.placeVertex(1, 0);
      expect(cs.vertices.added).toHaveLength(1);
      expect(cs.edges.added.length).toBeGreaterThanOrEqual(1);
      expect(network.getAllVertices()).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(1);
    });

    it("should chain multiple vertices", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      drawing.placeVertex(1, 0);
      drawing.placeVertex(1, 1);
      expect(network.getAllVertices()).toHaveLength(3);
      expect(network.getAllEdges()).toHaveLength(2);
    });
  });

  describe("snapToExistingVertex", () => {
    it("should connect to existing vertex and end drawing", () => {
      // Pre-create a vertex
      const pre = ops.addVertex(0, 0);
      const existingId = pre.vertices.added[0]!.id;

      drawing.start();
      drawing.placeVertex(1, 0);
      drawing.placeVertex(0.5, 1);
      const cs = drawing.snapToExistingVertex(existingId);

      // Should have created an edge to the existing vertex
      expect(cs.edges.added.length).toBeGreaterThanOrEqual(1);
      // Drawing should end
      expect(drawing.isActive()).toBe(false);
    });

    it("should create polygon when snapping closes a triangle", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      drawing.placeVertex(1, 0);
      drawing.placeVertex(0.5, 1);

      // Get the first vertex ID
      const firstVertexId = drawing.getSessionVertices()[0]!;
      const cs = drawing.snapToExistingVertex(firstVertexId);

      expect(drawing.isActive()).toBe(false);
      expect(cs.polygons.created).toHaveLength(1);
    });
  });

  describe("snapToExistingEdge", () => {
    it("should split edge and connect, then end drawing", () => {
      // Pre-create an edge
      const v1 = ops.addVertex(0, 0);
      const v2 = ops.addConnectedVertex(v1.vertices.added[0]!.id, 0, 2);
      const edgeId = v2.edges.added[0]!.id;

      drawing.start();
      drawing.placeVertex(1, 1);
      const cs = drawing.snapToExistingEdge(edgeId, 0, 1);

      expect(cs.edges.removed).toContain(edgeId); // original edge split
      expect(drawing.isActive()).toBe(false);
    });
  });

  describe("undoLastVertex", () => {
    it("should remove last placed vertex and edge", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      drawing.placeVertex(1, 0);
      expect(network.getAllVertices()).toHaveLength(2);

      const cs = drawing.undoLastVertex();
      expect(cs.vertices.removed).toHaveLength(1);
      expect(network.getAllVertices()).toHaveLength(1);
      expect(network.getAllEdges()).toHaveLength(0);
    });

    it("should remove isolated first vertex", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      const cs = drawing.undoLastVertex();
      expect(cs.vertices.removed).toHaveLength(1);
      expect(network.getAllVertices()).toHaveLength(0);
    });

    it("should do nothing if no vertices placed", () => {
      drawing.start();
      const cs = drawing.undoLastVertex();
      expect(cs.vertices.removed).toHaveLength(0);
    });
  });

  describe("end drawing", () => {
    it("should leave vertices/edges in network", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      drawing.placeVertex(1, 0);
      drawing.end();

      expect(network.getAllVertices()).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(1);
    });

    it("should reset session state", () => {
      drawing.start();
      drawing.placeVertex(0, 0);
      drawing.end();

      expect(drawing.getSessionVertices()).toHaveLength(0);
    });
  });
});
