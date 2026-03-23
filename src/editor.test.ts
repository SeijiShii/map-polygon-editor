import { describe, it, expect, beforeEach } from "vitest";
import { NetworkPolygonEditor } from "./editor";
import { LockedPolygonError } from "./types";

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

  describe("drag operations", () => {
    function makeTriangle(ed: NetworkPolygonEditor) {
      ed.startDrawing();
      ed.placeVertex(0, 0);
      ed.placeVertex(1, 0);
      ed.placeVertex(0.5, 1);
      const first = ed.getVertices().find((v) => v.lat === 0 && v.lng === 0)!;
      ed.snapToVertex(first.id);
    }

    it("should update polygons during drag without recording undo", () => {
      makeTriangle(editor);
      const vId = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!.id;

      editor.beginDrag(vId);
      editor.dragTo(0.1, 0.1);

      // Vertex moved
      expect(editor.getVertex(vId)!.lat).toBe(0.1);
      // Polygons still exist (rebuilt)
      expect(editor.getPolygons()).toHaveLength(1);
      // No undo step yet for the drag
      // Undo should revert the last pre-drag operation, not the drag
      editor.cancelDrag();
      expect(editor.getVertex(vId)!.lat).toBe(0);
    });

    it("should record one undo step on endDrag", () => {
      makeTriangle(editor);
      const vId = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!.id;

      editor.beginDrag(vId);
      editor.dragTo(0.1, 0.1);
      editor.dragTo(0.2, 0.2);
      editor.dragTo(0.3, 0.3);
      editor.endDrag();

      expect(editor.getVertex(vId)!.lat).toBe(0.3);

      // One undo should revert the entire drag
      editor.undo();
      expect(editor.getVertex(vId)!.lat).toBe(0);
    });

    it("cancelDrag should restore original position", () => {
      makeTriangle(editor);
      const vId = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!.id;

      editor.beginDrag(vId);
      editor.dragTo(5, 5);
      editor.cancelDrag();

      expect(editor.getVertex(vId)!.lat).toBe(0);
      expect(editor.getVertex(vId)!.lng).toBe(0);
    });

    it("should preserve both polygon IDs when dragging a vertex of one polygon (two separate polygons)", () => {
      // Draw polygon 1 (left triangle)
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(2, 0);
      editor.placeVertex(1, 2);
      const firstV1 = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(firstV1.id);
      expect(editor.getPolygons()).toHaveLength(1);
      const polyId1 = editor.getPolygons()[0]!.id;

      // Draw polygon 2 (right triangle, separate)
      editor.startDrawing();
      editor.placeVertex(5, 0);
      editor.placeVertex(7, 0);
      editor.placeVertex(6, 2);
      const firstV2 = editor
        .getVertices()
        .find((v) => v.lat === 5 && v.lng === 0)!;
      editor.snapToVertex(firstV2.id);
      expect(editor.getPolygons()).toHaveLength(2);
      const polyId2 = editor.getPolygons().find((p) => p.id !== polyId1)!.id;

      // Drag a vertex of polygon 1
      const dragTarget = editor
        .getVertices()
        .find((v) => v.lat === 1 && v.lng === 2)!;
      editor.beginDrag(dragTarget.id);
      editor.dragTo(1.2, 2.1);
      editor.dragTo(1.5, 1.8);
      const cs = editor.endDrag();

      // Both polygon IDs must be preserved
      const currentIds = editor.getPolygons().map((p) => p.id);
      expect(currentIds).toContain(polyId1);
      expect(currentIds).toContain(polyId2);
      expect(cs.polygons.removed).toHaveLength(0);
      expect(cs.polygons.created).toHaveLength(0);
    });

    it("should preserve both polygon IDs when dragging a shared vertex (two adjacent polygons)", () => {
      // Draw polygon 1 (left triangle): v0(0,0) - v1(2,0) - v2(1,2)
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(2, 0);
      editor.placeVertex(1, 2);
      const firstV1 = editor
        .getVertices()
        .find((v) => v.lat === 0 && v.lng === 0)!;
      editor.snapToVertex(firstV1.id);
      expect(editor.getPolygons()).toHaveLength(1);
      const polyId1 = editor.getPolygons()[0]!.id;

      // Draw polygon 2 adjacent to polygon 1, sharing edge v1(2,0)-v2(1,2)
      // New vertex v3(3,1), connect v1 → v3 → v2
      const v1 = editor.getVertices().find((v) => v.lat === 2 && v.lng === 0)!;
      const v2 = editor.getVertices().find((v) => v.lat === 1 && v.lng === 2)!;
      editor.startDrawing();
      editor.snapToVertex(v1.id);
      editor.placeVertex(3, 1);
      editor.snapToVertex(v2.id);
      expect(editor.getPolygons()).toHaveLength(2);
      const polyId2 = editor.getPolygons().find((p) => p.id !== polyId1)!.id;

      // Drag the shared vertex v2(1,2) slightly
      editor.beginDrag(v2.id);
      editor.dragTo(1.1, 2.1);
      editor.dragTo(1.2, 1.9);
      const cs = editor.endDrag();

      // Both polygon IDs must be preserved
      const currentIds = editor.getPolygons().map((p) => p.id);
      expect(currentIds).toContain(polyId1);
      expect(currentIds).toContain(polyId2);
      expect(cs.polygons.removed).toHaveLength(0);
      expect(cs.polygons.created).toHaveLength(0);
    });

    it("should throw if dragTo called without beginDrag", () => {
      expect(() => editor.dragTo(0, 0)).toThrow("No drag in progress");
    });

    it("should throw if endDrag called without beginDrag", () => {
      expect(() => editor.endDrag()).toThrow("No drag in progress");
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

  describe("removePolygon", () => {
    function makeTriangle(ed: NetworkPolygonEditor) {
      ed.startDrawing();
      ed.placeVertex(0, 0);
      ed.placeVertex(1, 0);
      ed.placeVertex(0.5, 1);
      const first = ed.getVertices().find((v) => v.lat === 0 && v.lng === 0)!;
      ed.snapToVertex(first.id);
      return ed.getPolygons()[0]!.id;
    }

    it("should remove an isolated polygon with all edges and vertices", () => {
      const polyId = makeTriangle(editor);
      expect(editor.getPolygons()).toHaveLength(1);

      const cs = editor.removePolygon(polyId);

      expect(cs.polygons.removed).toContain(polyId);
      expect(editor.getPolygons()).toHaveLength(0);
      expect(editor.getEdges()).toHaveLength(0);
      expect(editor.getVertices()).toHaveLength(0);
    });

    it("should support undo after removePolygon", () => {
      const polyId = makeTriangle(editor);

      editor.removePolygon(polyId);
      expect(editor.getPolygons()).toHaveLength(0);

      // Undo should restore the polygon
      editor.undo();
      expect(editor.getPolygons()).toHaveLength(1);
      expect(editor.getVertices()).toHaveLength(3);
      expect(editor.getEdges()).toHaveLength(3);
    });

    it("should support redo after undo of removePolygon", () => {
      const polyId = makeTriangle(editor);

      editor.removePolygon(polyId);
      editor.undo();
      expect(editor.getPolygons()).toHaveLength(1);

      // Redo should re-remove the polygon
      editor.redo();
      expect(editor.getPolygons()).toHaveLength(0);
      expect(editor.getEdges()).toHaveLength(0);
      expect(editor.getVertices()).toHaveLength(0);
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

  describe("polygon status", () => {
    function makeTriangle(ed: NetworkPolygonEditor) {
      ed.startDrawing();
      ed.placeVertex(0, 0);
      ed.placeVertex(1, 0);
      ed.placeVertex(0.5, 1);
      const first = ed.getVertices().find((v) => v.lat === 0 && v.lng === 0)!;
      ed.snapToVertex(first.id);
      return ed.getPolygons()[0]!.id;
    }

    it("should set and query locked status", () => {
      const polyId = makeTriangle(editor);
      expect(editor.isPolygonLocked(polyId)).toBe(false);

      const cs = editor.setPolygonLocked(polyId, true);
      expect(cs.polygons.statusChanged).toHaveLength(1);
      expect(cs.polygons.statusChanged[0]!.field).toBe("locked");
      expect(cs.polygons.statusChanged[0]!.before).toBe(false);
      expect(cs.polygons.statusChanged[0]!.after).toBe(true);
      expect(editor.isPolygonLocked(polyId)).toBe(true);
    });

    it("should set and query active status", () => {
      const polyId = makeTriangle(editor);
      expect(editor.isPolygonActive(polyId)).toBe(true);

      const cs = editor.setPolygonActive(polyId, false);
      expect(cs.polygons.statusChanged).toHaveLength(1);
      expect(cs.polygons.statusChanged[0]!.field).toBe("active");
      expect(editor.isPolygonActive(polyId)).toBe(false);
    });

    it("should undo setPolygonLocked", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonLocked(polyId, true);
      expect(editor.isPolygonLocked(polyId)).toBe(true);

      editor.undo();
      expect(editor.isPolygonLocked(polyId)).toBe(false);
    });

    it("should redo setPolygonLocked", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonLocked(polyId, true);
      editor.undo();
      editor.redo();
      expect(editor.isPolygonLocked(polyId)).toBe(true);
    });

    it("should undo setPolygonActive", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonActive(polyId, false);
      expect(editor.isPolygonActive(polyId)).toBe(false);

      editor.undo();
      expect(editor.isPolygonActive(polyId)).toBe(true);
    });

    it("should allow setActive on locked polygon", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonLocked(polyId, true);
      // Active change should work even when locked
      expect(() => editor.setPolygonActive(polyId, false)).not.toThrow();
      expect(editor.isPolygonActive(polyId)).toBe(false);
    });

    it("should block beginDrag on locked polygon vertex", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonLocked(polyId, true);
      const vId = editor.getVertices()[0]!.id;
      expect(() => editor.beginDrag(vId)).toThrow(LockedPolygonError);
    });

    it("should preserve status through save/load cycle", async () => {
      let savedData: any = null;
      const adapter = {
        loadAll: async () => savedData,
        saveAll: async (data: any) => {
          savedData = data;
        },
      };

      const ed1 = new NetworkPolygonEditor(adapter);
      ed1.startDrawing();
      ed1.placeVertex(0, 0);
      ed1.placeVertex(1, 0);
      ed1.placeVertex(0.5, 1);
      const first = ed1.getVertices().find((v) => v.lat === 0 && v.lng === 0)!;
      ed1.snapToVertex(first.id);
      const polyId = ed1.getPolygons()[0]!.id;
      ed1.setPolygonLocked(polyId, true);
      ed1.setPolygonActive(polyId, false);
      await ed1.save();

      // Load into new editor
      const ed2 = new NetworkPolygonEditor(adapter);
      await ed2.init();
      expect(ed2.getPolygons()).toHaveLength(1);
      const loadedPoly = ed2.getPolygons()[0]!;
      expect(loadedPoly.locked).toBe(true);
      expect(loadedPoly.active).toBe(false);
    });

    it("should include locked/active in GeoJSON properties", () => {
      const polyId = makeTriangle(editor);
      editor.setPolygonLocked(polyId, true);
      editor.setPolygonActive(polyId, false);

      const fc = editor.getAllGeoJSON();
      const props = fc.features[0]!.properties!;
      expect(props.locked).toBe(true);
      expect(props.active).toBe(false);
    });
  });
});
