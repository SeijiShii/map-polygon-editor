import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { Operations } from "./operations";
import { UndoRedoManager } from "./undo-redo";

describe("UndoRedoManager", () => {
  let network: Network;
  let polygonManager: PolygonManager;
  let ops: Operations;
  let undoRedo: UndoRedoManager;

  beforeEach(() => {
    network = new Network();
    polygonManager = new PolygonManager();
    ops = new Operations(network, polygonManager);
    undoRedo = new UndoRedoManager(network, polygonManager);
  });

  describe("basic undo", () => {
    it("should undo vertex addition", () => {
      const cs = ops.addVertex(35, 139);
      undoRedo.push(cs);

      expect(network.getAllVertices()).toHaveLength(1);

      const undoCs = undoRedo.undo();
      expect(undoCs).not.toBeNull();
      expect(network.getAllVertices()).toHaveLength(0);
    });

    it("should undo edge addition", () => {
      const cs1 = ops.addVertex(0, 0);
      undoRedo.push(cs1);
      const v0 = cs1.vertices.added[0]!.id;

      const cs2 = ops.addConnectedVertex(v0, 1, 0);
      undoRedo.push(cs2);

      expect(network.getAllEdges()).toHaveLength(1);

      const undoCs = undoRedo.undo();
      expect(undoCs).not.toBeNull();
      expect(network.getAllEdges()).toHaveLength(0);
      expect(network.getAllVertices()).toHaveLength(1); // only v0 remains
    });

    it("should undo polygon creation (by undoing closing edge)", () => {
      // Build triangle
      const cs0 = ops.addVertex(0, 0);
      undoRedo.push(cs0);
      const v0 = cs0.vertices.added[0]!.id;

      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      undoRedo.push(cs1);
      const v1 = cs1.vertices.added[0]!.id;

      const cs2 = ops.addConnectedVertex(v1, 0.5, 1);
      undoRedo.push(cs2);
      const v2 = cs2.vertices.added[0]!.id;

      const cs3 = ops.snapToVertex(v2, v0);
      undoRedo.push(cs3);

      expect(polygonManager.getAllPolygons()).toHaveLength(1);

      undoRedo.undo(); // undo closing edge
      expect(polygonManager.getAllPolygons()).toHaveLength(0);
      expect(network.getAllEdges()).toHaveLength(2); // two edges remain
    });

    it("should return null when nothing to undo", () => {
      expect(undoRedo.undo()).toBeNull();
    });
  });

  describe("basic redo", () => {
    it("should redo after undo", () => {
      const cs = ops.addVertex(35, 139);
      undoRedo.push(cs);
      undoRedo.undo();

      expect(network.getAllVertices()).toHaveLength(0);

      const redoCs = undoRedo.redo();
      expect(redoCs).not.toBeNull();
      expect(network.getAllVertices()).toHaveLength(1);
    });

    it("should return null when nothing to redo", () => {
      expect(undoRedo.redo()).toBeNull();
    });

    it("should clear redo stack on new operation", () => {
      const cs1 = ops.addVertex(0, 0);
      undoRedo.push(cs1);
      undoRedo.undo();

      // New operation should clear redo
      const cs2 = ops.addVertex(1, 1);
      undoRedo.push(cs2);

      expect(undoRedo.redo()).toBeNull();
    });
  });

  describe("multiple undo/redo cycles", () => {
    it("should handle multiple undos then redos", () => {
      const cs0 = ops.addVertex(0, 0);
      undoRedo.push(cs0);
      const v0 = cs0.vertices.added[0]!.id;

      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      undoRedo.push(cs1);

      const cs2 = ops.addConnectedVertex(
        cs1.vertices.added[0]!.id,
        1,
        1,
      );
      undoRedo.push(cs2);

      expect(network.getAllVertices()).toHaveLength(3);

      undoRedo.undo(); // remove v2
      expect(network.getAllVertices()).toHaveLength(2);

      undoRedo.undo(); // remove v1
      expect(network.getAllVertices()).toHaveLength(1);

      undoRedo.redo(); // restore v1
      expect(network.getAllVertices()).toHaveLength(2);

      undoRedo.redo(); // restore v2
      expect(network.getAllVertices()).toHaveLength(3);
    });
  });

  describe("undo vertex move", () => {
    it("should restore vertex to original position", () => {
      const cs0 = ops.addVertex(0, 0);
      undoRedo.push(cs0);
      const vId = cs0.vertices.added[0]!.id;

      const cs1 = ops.moveVertex(vId, 5, 5);
      undoRedo.push(cs1);

      expect(network.getVertex(vId)!.lat).toBe(5);

      undoRedo.undo();
      expect(network.getVertex(vId)!.lat).toBe(0);
      expect(network.getVertex(vId)!.lng).toBe(0);
    });
  });

  describe("undo vertex removal", () => {
    it("should restore vertex and its edges", () => {
      const cs0 = ops.addVertex(0, 0);
      undoRedo.push(cs0);
      const v0 = cs0.vertices.added[0]!.id;

      const cs1 = ops.addConnectedVertex(v0, 1, 0);
      undoRedo.push(cs1);
      const v1 = cs1.vertices.added[0]!.id;

      const cs2 = ops.removeVertex(v0);
      undoRedo.push(cs2);

      expect(network.getAllVertices()).toHaveLength(1);

      undoRedo.undo();
      expect(network.getAllVertices()).toHaveLength(2);
      expect(network.getAllEdges()).toHaveLength(1);
    });
  });
});
