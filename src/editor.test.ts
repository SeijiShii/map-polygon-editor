import { describe, it, expect, beforeEach } from "vitest";
import { NetworkPolygonEditor } from "./editor";

describe("NetworkPolygonEditor", () => {
  let editor: NetworkPolygonEditor;

  beforeEach(() => {
    editor = new NetworkPolygonEditor();
  });

  describe("mode management", () => {
    it("should start in idle mode", () => {
      expect(editor.getMode()).toBe("idle");
    });

    it("should switch to drawing mode", () => {
      editor.startDrawing();
      expect(editor.getMode()).toBe("drawing");
    });

    it("should switch back to idle after ending drawing", () => {
      editor.startDrawing();
      editor.endDrawing();
      expect(editor.getMode()).toBe("idle");
    });
  });

  describe("drawing workflow", () => {
    it("should draw a triangle and create a polygon", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);

      // Get first vertex to snap back
      const vertices = editor.getVertices();
      const firstVertex = vertices.find((v) => v.lat === 0 && v.lng === 0)!;
      const cs = editor.snapToVertex(firstVertex.id);

      expect(editor.getMode()).toBe("idle");
      expect(cs.polygons.created).toHaveLength(1);
      expect(editor.getPolygons()).toHaveLength(1);
    });

    it("should draw and end without closing (open polyline)", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(1, 1);
      editor.endDrawing();

      expect(editor.getMode()).toBe("idle");
      expect(editor.getVertices()).toHaveLength(3);
      expect(editor.getEdges()).toHaveLength(2);
      expect(editor.getPolygons()).toHaveLength(0);
    });
  });

  describe("edit operations", () => {
    it("should move a vertex", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();
      const vId = editor.getVertices()[0]!.id;

      const cs = editor.moveVertex(vId, 5, 5);
      expect(cs.vertices.moved).toHaveLength(1);
      expect(editor.getVertices()[0]!.lat).toBe(5);
    });

    it("should remove a vertex", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const vId = editor.getVertices()[0]!.id;
      editor.removeVertex(vId);
      expect(editor.getVertices()).toHaveLength(1);
    });

    it("should remove an edge", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const eId = editor.getEdges()[0]!.id;
      editor.removeEdge(eId);
      expect(editor.getEdges()).toHaveLength(0);
      expect(editor.getVertices()).toHaveLength(2); // vertices remain
    });

    it("should split an edge", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(0, 2);
      editor.endDrawing();

      const eId = editor.getEdges()[0]!.id;
      editor.splitEdge(eId, 0, 1);
      expect(editor.getVertices()).toHaveLength(3);
      expect(editor.getEdges()).toHaveLength(2);
    });
  });

  describe("undo/redo", () => {
    it("should undo and redo vertex addition", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();
      expect(editor.getVertices()).toHaveLength(1);

      editor.undo();
      expect(editor.getVertices()).toHaveLength(0);

      editor.redo();
      expect(editor.getVertices()).toHaveLength(1);
    });

    it("canUndo/canRedo should reflect state", () => {
      expect(editor.canUndo()).toBe(false);
      expect(editor.canRedo()).toBe(false);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();
      expect(editor.canUndo()).toBe(true);
      expect(editor.canRedo()).toBe(false);

      editor.undo();
      expect(editor.canUndo()).toBe(false);
      expect(editor.canRedo()).toBe(true);

      editor.redo();
      expect(editor.canUndo()).toBe(true);
      expect(editor.canRedo()).toBe(false);
    });
  });

  describe("nearest queries", () => {
    it("findNearestVertex should find closest vertex", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const result = editor.findNearestVertex(0.1, 0.1, 0.5);
      expect(result).not.toBeNull();
      expect(result!.lat).toBe(0);
    });

    it("findNearestEdge should find closest edge", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(0, 2);
      editor.endDrawing();

      const result = editor.findNearestEdge(0.1, 1, 0.5);
      expect(result).not.toBeNull();
      expect(result!.point.lng).toBeCloseTo(1);
    });
  });

  describe("GeoJSON export", () => {
    it("should export polygon as GeoJSON", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);
      const vertices = editor.getVertices();
      const first = vertices.find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(first.id);

      const polygon = editor.getPolygons()[0]!;
      const geojson = editor.getPolygonGeoJSON(polygon.id);
      expect(geojson).not.toBeNull();
      expect(geojson!.type).toBe("Polygon");
    });

    it("should export FeatureCollection", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);
      const vertices = editor.getVertices();
      const first = vertices.find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(first.id);

      const fc = editor.getAllGeoJSON();
      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features).toHaveLength(1);
    });
  });

  describe("queries", () => {
    it("should get vertex by ID", () => {
      editor.startDrawing();
      editor.placeVertex(35, 139);
      editor.endDrawing();
      const vId = editor.getVertices()[0]!.id;

      const v = editor.getVertex(vId);
      expect(v).not.toBeNull();
      expect(v!.lat).toBe(35);
    });

    it("should get edge by ID", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();
      const eId = editor.getEdges()[0]!.id;

      const e = editor.getEdge(eId);
      expect(e).not.toBeNull();
    });
  });

  describe("persistence", () => {
    it("should save and load via StorageAdapter", async () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);
      const vertices = editor.getVertices();
      const first = vertices.find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(first.id);

      // Save
      let savedData: any = null;
      const adapter = {
        loadAll: async () => savedData,
        saveAll: async (data: any) => {
          savedData = data;
        },
      };

      const editorWithAdapter = new NetworkPolygonEditor(adapter);
      // Replicate state
      editorWithAdapter.startDrawing();
      editorWithAdapter.placeVertex(0, 0);
      editorWithAdapter.placeVertex(1, 0);
      editorWithAdapter.placeVertex(0.5, 1);
      const verts = editorWithAdapter.getVertices();
      const firstV = verts.find((v) => v.lat === 0 && v.lng === 0)!;
      editorWithAdapter.snapToVertex(firstV.id);
      await editorWithAdapter.save();

      expect(savedData).not.toBeNull();
      expect(savedData.vertices.length).toBe(3);

      // Load into new editor
      const editor2 = new NetworkPolygonEditor(adapter);
      await editor2.init();
      expect(editor2.getVertices()).toHaveLength(3);
      expect(editor2.getPolygons()).toHaveLength(1);
    });
  });

  describe("pruneOrphans", () => {
    it("should remove vertices and edges not belonging to any polygon", () => {
      // Draw a triangle (creates polygon)
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);
      const first = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(first.id);
      expect(editor.getPolygons()).toHaveLength(1);

      // Draw an orphan line (no polygon)
      editor.startDrawing();
      editor.placeVertex(5, 5);
      editor.placeVertex(6, 6);
      editor.endDrawing();

      expect(editor.getVertices()).toHaveLength(5);
      expect(editor.getEdges()).toHaveLength(4);

      const cs = editor.pruneOrphans();

      expect(editor.getVertices()).toHaveLength(3);
      expect(editor.getEdges()).toHaveLength(3);
      expect(cs.vertices.removed).toHaveLength(2);
      expect(cs.edges.removed).toHaveLength(1);
      expect(editor.getPolygons()).toHaveLength(1);
    });

    it("should do nothing if all vertices belong to polygons", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.placeVertex(0.5, 1);
      const first = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(first.id);

      const cs = editor.pruneOrphans();
      expect(cs.vertices.removed).toHaveLength(0);
      expect(cs.edges.removed).toHaveLength(0);
    });

    it("should remove isolated vertices", () => {
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();

      expect(editor.getVertices()).toHaveLength(1);
      const cs = editor.pruneOrphans();
      expect(editor.getVertices()).toHaveLength(0);
      expect(cs.vertices.removed).toHaveLength(1);
    });
  });
});
