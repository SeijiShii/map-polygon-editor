import { describe, it, expect, vi } from "vitest";
import { NetworkPolygonEditor } from "./editor";
import type {
  StorageAdapter,
  Vertex,
  Edge,
  PolygonSnapshot,
  ChangeSet,
  VertexID,
  EdgeID,
  PolygonID,
} from "./types";
import { emptyChangeSet, createVertexID, createEdgeID } from "./types";

// --- Helper: create a record-level StorageAdapter mock ---

function createRecordAdapter() {
  const store = {
    vertices: new Map<VertexID, Vertex>(),
    edges: new Map<EdgeID, Edge>(),
    polygons: new Map<PolygonID, PolygonSnapshot>(),
  };
  let remoteHandler: ((change: ChangeSet) => void) | null = null;

  const adapter: StorageAdapter = {
    loadAll: vi.fn(async () => ({
      vertices: [...store.vertices.values()],
      edges: [...store.edges.values()],
      polygons: [...store.polygons.values()],
    })),
    putVertex: vi.fn(async (v: Vertex) => {
      store.vertices.set(v.id, v);
    }),
    deleteVertex: vi.fn(async (id: VertexID) => {
      store.vertices.delete(id);
    }),
    putEdge: vi.fn(async (e: Edge) => {
      store.edges.set(e.id, e);
    }),
    deleteEdge: vi.fn(async (id: EdgeID) => {
      store.edges.delete(id);
    }),
    putPolygon: vi.fn(async (p: PolygonSnapshot) => {
      store.polygons.set(p.id, p);
    }),
    deletePolygon: vi.fn(async (id: PolygonID) => {
      store.polygons.delete(id);
    }),
    onRemoteChange: vi.fn((handler: (change: ChangeSet) => void) => {
      remoteHandler = handler;
    }),
  };

  return { adapter, store, getRemoteHandler: () => remoteHandler };
}

// --- Helper: build a triangle and return the editor ---

function makeTriangle(editor: NetworkPolygonEditor) {
  editor.startDrawing();
  editor.placeVertex(0, 0);
  editor.placeVertex(1, 0);
  editor.placeVertex(0.5, 1);
  const first = editor.getVertices().find((v) => v.lat === 0 && v.lng === 0)!;
  editor.snapToVertex(first.id);
}

// ============================================================
// Tests
// ============================================================

describe("concurrent editing", () => {
  // --- Phase 2-3: persistChangeSet ---

  describe("persistChangeSet (auto-persist on operations)", () => {
    it("should call putVertex and putEdge when placing vertices in drawing mode", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);

      expect(adapter.putVertex).toHaveBeenCalledTimes(1);
      const calledVertex = (adapter.putVertex as any).mock.calls[0][0];
      expect(calledVertex.lat).toBe(0);
      expect(calledVertex.lng).toBe(0);
    });

    it("should call putEdge when edges are created", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);

      // Second placeVertex creates an edge
      expect(adapter.putEdge).toHaveBeenCalled();
    });

    it("should call putPolygon when a polygon is created (closing triangle)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);

      expect(adapter.putPolygon).toHaveBeenCalled();
    });

    it("should call putVertex with updated position on moveVertex", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const v = editor.getVertices()[0]!;

      // Reset mocks to isolate moveVertex calls
      vi.clearAllMocks();

      editor.moveVertex(v.id, 0.1, 0.1);

      expect(adapter.putVertex).toHaveBeenCalled();
      const movedVertex = (adapter.putVertex as any).mock.calls[0][0];
      expect(movedVertex.lat).toBe(0.1);
      expect(movedVertex.lng).toBe(0.1);
    });

    it("should call deleteVertex on removeVertex", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const v = editor.getVertices()[0]!;
      vi.clearAllMocks();

      editor.removeVertex(v.id);

      expect(adapter.deleteVertex).toHaveBeenCalledWith(v.id);
    });

    it("should call deleteEdge on removeEdge", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const e = editor.getEdges()[0]!;
      vi.clearAllMocks();

      editor.removeEdge(e.id);

      expect(adapter.deleteEdge).toHaveBeenCalledWith(e.id);
    });

    it("should call deletePolygon on removePolygon", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const polyId = editor.getPolygons()[0]!.id;
      vi.clearAllMocks();

      editor.removePolygon(polyId);

      expect(adapter.deletePolygon).toHaveBeenCalledWith(polyId);
    });

    it("should persist undo operations", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      vi.clearAllMocks();

      editor.undo(); // undo closing snap

      // Undo should trigger persist calls (deletions or additions as appropriate)
      const totalCalls =
        (adapter.putVertex as any).mock.calls.length +
        (adapter.deleteVertex as any).mock.calls.length +
        (adapter.putEdge as any).mock.calls.length +
        (adapter.deleteEdge as any).mock.calls.length +
        (adapter.putPolygon as any).mock.calls.length +
        (adapter.deletePolygon as any).mock.calls.length;
      expect(totalCalls).toBeGreaterThan(0);
    });

    it("should persist redo operations", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      editor.undo();
      vi.clearAllMocks();

      editor.redo();

      const totalCalls =
        (adapter.putVertex as any).mock.calls.length +
        (adapter.deleteVertex as any).mock.calls.length +
        (adapter.putEdge as any).mock.calls.length +
        (adapter.deleteEdge as any).mock.calls.length +
        (adapter.putPolygon as any).mock.calls.length +
        (adapter.deletePolygon as any).mock.calls.length;
      expect(totalCalls).toBeGreaterThan(0);
    });

    it("should persist splitEdge", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const edge = editor.getEdges()[0]!;
      vi.clearAllMocks();

      editor.splitEdge(edge.id, 0.5, 0);

      // Split should delete original edge, add new vertex, add new edges
      expect(adapter.deleteEdge).toHaveBeenCalled();
      expect(adapter.putVertex).toHaveBeenCalled();
      expect(adapter.putEdge).toHaveBeenCalled();
    });

    it("should persist setPolygonLocked (status change)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const polyId = editor.getPolygons()[0]!.id;
      vi.clearAllMocks();

      editor.setPolygonLocked(polyId, true);

      // Status change should persist the polygon
      expect(adapter.putPolygon).toHaveBeenCalled();
    });

    it("should persist setPolygonActive (status change)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const polyId = editor.getPolygons()[0]!.id;
      vi.clearAllMocks();

      editor.setPolygonActive(polyId, false);

      expect(adapter.putPolygon).toHaveBeenCalled();
    });

    it("should persist pruneOrphans", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      // Create a triangle, then add orphan vertices
      makeTriangle(editor);
      editor.startDrawing();
      editor.placeVertex(5, 5);
      editor.endDrawing();
      vi.clearAllMocks();

      const cs = editor.pruneOrphans();

      expect(cs.vertices.removed.length).toBeGreaterThan(0);
      expect(adapter.deleteVertex).toHaveBeenCalled();
    });

    it("should NOT call persistChangeSet during dragTo (light move)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const v = editor.getVertices()[0]!;
      vi.clearAllMocks();

      editor.beginDrag(v.id);
      editor.dragTo(0.1, 0.1);
      editor.dragTo(0.2, 0.2);

      // dragTo uses moveVertexLight — should NOT persist
      expect(adapter.putVertex).not.toHaveBeenCalled();
    });

    it("should persist on endDrag", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      makeTriangle(editor);
      const v = editor.getVertices()[0]!;
      vi.clearAllMocks();

      editor.beginDrag(v.id);
      editor.dragTo(0.1, 0.1);
      editor.endDrag();

      expect(adapter.putVertex).toHaveBeenCalled();
    });
  });

  // --- Backward compatibility ---

  describe("backward compatibility", () => {
    it("should work without any adapter at all", () => {
      const editor = new NetworkPolygonEditor();
      makeTriangle(editor);
      expect(editor.getPolygons()).toHaveLength(1);
    });
  });

  // --- Phase 4: applyRemoteChange ---

  describe("applyRemoteChange", () => {
    it("should apply remote vertex addition", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      const remoteCs = emptyChangeSet();
      const remoteVertex: Vertex = {
        id: createVertexID("remote-v1"),
        lat: 10,
        lng: 20,
      };
      remoteCs.vertices.added.push(remoteVertex);

      editor.applyRemoteChange(remoteCs);

      const v = editor.getVertex(createVertexID("remote-v1"));
      expect(v).not.toBeNull();
      expect(v!.lat).toBe(10);
      expect(v!.lng).toBe(20);
    });

    it("should apply remote vertex removal", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      // First add a vertex locally
      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();
      const v = editor.getVertices()[0]!;

      // Remote removes it
      const remoteCs = emptyChangeSet();
      remoteCs.vertices.removed.push(v.id);

      editor.applyRemoteChange(remoteCs);

      expect(editor.getVertex(v.id)).toBeNull();
    });

    it("should apply remote vertex move", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.endDrawing();
      const v = editor.getVertices()[0]!;

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.moved.push({
        id: v.id,
        from: { lat: 0, lng: 0 },
        to: { lat: 5, lng: 5 },
      });

      editor.applyRemoteChange(remoteCs);

      const updated = editor.getVertex(v.id)!;
      expect(updated.lat).toBe(5);
      expect(updated.lng).toBe(5);
    });

    it("should apply remote edge addition", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      // Add two vertices first
      const remoteCs1 = emptyChangeSet();
      const v1: Vertex = { id: createVertexID("rv1"), lat: 0, lng: 0 };
      const v2: Vertex = { id: createVertexID("rv2"), lat: 1, lng: 0 };
      remoteCs1.vertices.added.push(v1, v2);
      editor.applyRemoteChange(remoteCs1);

      // Now add edge
      const remoteCs2 = emptyChangeSet();
      const edge: Edge = { id: createEdgeID("re1"), v1: v1.id, v2: v2.id };
      remoteCs2.edges.added.push(edge);
      editor.applyRemoteChange(remoteCs2);

      expect(editor.getEdge(createEdgeID("re1"))).not.toBeNull();
    });

    it("should apply remote edge removal", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      editor.startDrawing();
      editor.placeVertex(0, 0);
      editor.placeVertex(1, 0);
      editor.endDrawing();

      const e = editor.getEdges()[0]!;
      const remoteCs = emptyChangeSet();
      remoteCs.edges.removed.push(e.id);

      editor.applyRemoteChange(remoteCs);

      expect(editor.getEdge(e.id)).toBeNull();
    });

    it("should NOT push to undo stack (remote changes are not undoable)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.added.push({
        id: createVertexID("rv1"),
        lat: 10,
        lng: 20,
      });

      editor.applyRemoteChange(remoteCs);

      expect(editor.canUndo()).toBe(false);
    });

    it("should return a ChangeSet describing what was applied", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.added.push({
        id: createVertexID("rv1"),
        lat: 10,
        lng: 20,
      });

      const result = editor.applyRemoteChange(remoteCs);

      expect(result.vertices.added).toHaveLength(1);
      expect(result.vertices.added[0].id).toBe(createVertexID("rv1"));
    });

    it("should NOT persist applyRemoteChange back to adapter (avoid echo)", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      vi.clearAllMocks();

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.added.push({
        id: createVertexID("rv1"),
        lat: 10,
        lng: 20,
      });

      editor.applyRemoteChange(remoteCs);

      // Should NOT call put/delete (to avoid echoing back to remote)
      expect(adapter.putVertex).not.toHaveBeenCalled();
      expect(adapter.deleteVertex).not.toHaveBeenCalled();
    });

    it("should detect polygon modification from remote vertex move", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      // Build triangle locally
      makeTriangle(editor);
      expect(editor.getPolygons()).toHaveLength(1);

      const v = editor.getVertices()[0]!;
      const remoteCs = emptyChangeSet();
      remoteCs.vertices.moved.push({
        id: v.id,
        from: { lat: v.lat, lng: v.lng },
        to: { lat: 0.05, lng: 0.05 },
      });

      const result = editor.applyRemoteChange(remoteCs);

      expect(result.vertices.moved).toHaveLength(1);
      // Polygon should be reported as modified (shape changed)
      expect(result.polygons.modified.length).toBeGreaterThanOrEqual(1);
    });

    it("should rebuild polygons after remote structural changes", () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      // Build a triangle remotely
      const v1: Vertex = { id: createVertexID("rv1"), lat: 0, lng: 0 };
      const v2: Vertex = { id: createVertexID("rv2"), lat: 1, lng: 0 };
      const v3: Vertex = { id: createVertexID("rv3"), lat: 0.5, lng: 1 };
      const e1: Edge = { id: createEdgeID("re1"), v1: v1.id, v2: v2.id };
      const e2: Edge = { id: createEdgeID("re2"), v1: v2.id, v2: v3.id };
      const e3: Edge = { id: createEdgeID("re3"), v1: v3.id, v2: v1.id };

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.added.push(v1, v2, v3);
      remoteCs.edges.added.push(e1, e2, e3);

      const result = editor.applyRemoteChange(remoteCs);

      // Should have created a polygon
      expect(editor.getPolygons().length).toBeGreaterThanOrEqual(1);
      expect(result.polygons.created.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Phase 5: onRemoteChange + onRemoteUpdate ---

  describe("onRemoteChange integration", () => {
    it("should register onRemoteChange handler during init", async () => {
      const { adapter } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);

      await editor.init();

      expect(adapter.onRemoteChange).toHaveBeenCalledTimes(1);
    });

    it("should invoke onRemoteUpdate callback when remote change arrives", async () => {
      const { adapter, getRemoteHandler } = createRecordAdapter();
      const editor = new NetworkPolygonEditor(adapter);
      const onUpdate = vi.fn();
      editor.onRemoteUpdate = onUpdate;

      await editor.init();

      // Simulate remote change
      const handler = getRemoteHandler()!;
      expect(handler).not.toBeNull();

      const remoteCs = emptyChangeSet();
      remoteCs.vertices.added.push({
        id: createVertexID("rv1"),
        lat: 10,
        lng: 20,
      });

      handler(remoteCs);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const resultCs = onUpdate.mock.calls[0][0];
      expect(resultCs.vertices.added).toHaveLength(1);
    });

    it("should not throw if adapter lacks onRemoteChange", async () => {
      const { adapter } = createRecordAdapter();
      // Remove the optional onRemoteChange
      delete (adapter as any).onRemoteChange;
      const editor = new NetworkPolygonEditor(adapter);

      // Should not throw
      await editor.init();
    });
  });
});
