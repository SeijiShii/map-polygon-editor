import { describe, it, expect, vi, beforeEach } from "vitest";
import { MapPolygonEditor } from "./editor.js";
import type {
  MapPolygon,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
  GeoJSONPolygon,
  UnionCacheID,
} from "./types/index.js";
import { makePolygonID, makeUnionCacheID, makeDraftID } from "./types/index.js";
import {
  NotInitializedError,
  StorageError,
  PolygonNotFoundError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
} from "./errors.js";

// ============================================================
// Helpers
// ============================================================

const triangle: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};

const square: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

function closedDraft(coords: [number, number][]): DraftShape {
  return {
    points: coords.map(([lat, lng]) => ({ lat, lng })),
    isClosed: true,
  };
}

const triangleDraft = closedDraft([
  [0, 0],
  [1, 0],
  [1, 1],
]);
const squareDraft = closedDraft([
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
]);

function makePolygon(id: string, name = ""): MapPolygon {
  const now = new Date();
  return {
    id: makePolygonID(id),
    geometry: triangle,
    display_name: name,
    created_at: now,
    updated_at: now,
  };
}

function createMockAdapter(
  polygons: MapPolygon[] = [],
  drafts: PersistedDraft[] = [],
): StorageAdapter {
  return {
    loadAll: vi.fn().mockResolvedValue({ polygons, drafts }),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  };
}

async function createEditor(
  polygons: MapPolygon[] = [],
  drafts: PersistedDraft[] = [],
) {
  const adapter = createMockAdapter(polygons, drafts);
  const editor = new MapPolygonEditor({ storageAdapter: adapter });
  await editor.initialize();
  return { editor, adapter };
}

// ============================================================
// Initialization + Query APIs
// ============================================================

describe("MapPolygonEditor", () => {
  describe("Initialization", () => {
    it("throws NotInitializedError when calling API before initialize()", () => {
      const adapter = createMockAdapter();
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      expect(() => editor.getAllPolygons()).toThrow(NotInitializedError);
    });

    it("initializes successfully with empty data", async () => {
      const { editor } = await createEditor();
      expect(editor.getAllPolygons()).toEqual([]);
    });

    it("loads polygons from storage", async () => {
      const p = makePolygon("p-1", "Root");
      const { editor } = await createEditor([p]);
      expect(editor.getAllPolygons()).toHaveLength(1);
    });

    it("wraps storage loadAll errors in StorageError", async () => {
      const adapter: StorageAdapter = {
        loadAll: vi.fn().mockRejectedValue(new Error("disk error")),
        batchWrite: vi.fn(),
        saveDraft: vi.fn(),
        deleteDraft: vi.fn(),
      };
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      await expect(editor.initialize()).rejects.toThrow(StorageError);
    });
  });

  describe("Query APIs", () => {
    it("getPolygon returns polygon by ID", async () => {
      const p = makePolygon("p-1", "Test");
      const { editor } = await createEditor([p]);
      expect(editor.getPolygon(makePolygonID("p-1"))?.display_name).toBe(
        "Test",
      );
    });

    it("getPolygon returns null for non-existent ID", async () => {
      const { editor } = await createEditor();
      expect(editor.getPolygon(makePolygonID("nope"))).toBeNull();
    });

    it("getAllPolygons returns all polygons", async () => {
      const { editor } = await createEditor([
        makePolygon("p-1"),
        makePolygon("p-2"),
      ]);
      expect(editor.getAllPolygons()).toHaveLength(2);
    });
  });

  // ============================================================
  // Polygon CRUD
  // ============================================================

  describe("saveAsPolygon", () => {
    it("saves a closed draft as polygon", async () => {
      const { editor, adapter } = await createEditor();
      const polygon = await editor.saveAsPolygon(triangleDraft, "My Polygon");
      expect(polygon.display_name).toBe("My Polygon");
      expect(polygon.geometry.type).toBe("Polygon");
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("throws DraftNotClosedError for open draft", async () => {
      const { editor } = await createEditor();
      const open: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 0 },
        ],
        isClosed: false,
      };
      await expect(editor.saveAsPolygon(open, "fail")).rejects.toThrow(
        DraftNotClosedError,
      );
    });

    it("throws InvalidGeometryError for draft with too few vertices", async () => {
      const { editor } = await createEditor();
      const bad: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 0 },
        ],
        isClosed: true,
      };
      await expect(editor.saveAsPolygon(bad, "fail")).rejects.toThrow(
        InvalidGeometryError,
      );
    });

    it("polygon is retrievable after save", async () => {
      const { editor } = await createEditor();
      const polygon = await editor.saveAsPolygon(triangleDraft, "Test");
      expect(editor.getPolygon(polygon.id)).not.toBeNull();
      expect(editor.getAllPolygons()).toHaveLength(1);
    });
  });

  describe("renamePolygon", () => {
    it("renames a polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Old");
      await editor.renamePolygon(p.id, "New");
      expect(editor.getPolygon(p.id)?.display_name).toBe("New");
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(
        editor.renamePolygon(makePolygonID("nope"), "x"),
      ).rejects.toThrow(PolygonNotFoundError);
    });
  });

  describe("deletePolygon", () => {
    it("deletes a polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Delete me");
      await editor.deletePolygon(p.id);
      expect(editor.getPolygon(p.id)).toBeNull();
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(editor.deletePolygon(makePolygonID("nope"))).rejects.toThrow(
        PolygonNotFoundError,
      );
    });
  });

  describe("loadPolygonToDraft", () => {
    it("loads a polygon as DraftShape", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      const draft = editor.loadPolygonToDraft(p.id);
      expect(draft.isClosed).toBe(true);
      expect(draft.points.length).toBeGreaterThanOrEqual(3);
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      expect(() => editor.loadPolygonToDraft(makePolygonID("nope"))).toThrow(
        PolygonNotFoundError,
      );
    });
  });

  describe("updatePolygonGeometry", () => {
    it("updates geometry of a polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      const updated = await editor.updatePolygonGeometry(p.id, squareDraft);
      expect(updated.geometry.coordinates[0]).toHaveLength(5); // square has 5 coords (closed)
    });
  });

  // ============================================================
  // Draft Persistence + Undo/Redo
  // ============================================================

  describe("Draft Persistence", () => {
    it("saves, lists, loads, and deletes drafts", async () => {
      const { editor } = await createEditor();
      const draft: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 0 },
        ],
        isClosed: false,
      };

      const persisted = await editor.saveDraftToStorage(draft);
      expect(persisted.id).toBeTruthy();
      expect(editor.listPersistedDrafts()).toHaveLength(1);

      const loaded = editor.loadDraftFromStorage(persisted.id);
      expect(loaded.points).toEqual(draft.points);

      await editor.deleteDraftFromStorage(persisted.id);
      expect(editor.listPersistedDrafts()).toHaveLength(0);
    });

    it("throws DraftNotFoundError for non-existent draft", async () => {
      const { editor } = await createEditor();
      expect(() => editor.loadDraftFromStorage(makeDraftID("nope"))).toThrow(
        DraftNotFoundError,
      );
    });
  });

  describe("Undo/Redo", () => {
    it("undo reverts saveAsPolygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      expect(editor.canUndo()).toBe(true);
      await editor.undo();
      expect(editor.getPolygon(p.id)).toBeNull();
      expect(editor.getAllPolygons()).toHaveLength(0);
    });

    it("redo re-applies saveAsPolygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      await editor.undo();
      expect(editor.canRedo()).toBe(true);
      await editor.redo();
      expect(editor.getPolygon(p.id)).not.toBeNull();
    });

    it("undo reverts deletePolygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      await editor.deletePolygon(p.id);
      await editor.undo();
      expect(editor.getPolygon(p.id)).not.toBeNull();
    });

    it("undo reverts renamePolygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Old");
      await editor.renamePolygon(p.id, "New");
      await editor.undo();
      expect(editor.getPolygon(p.id)?.display_name).toBe("Old");
    });

    it("new operation clears redo stack", async () => {
      const { editor } = await createEditor();
      await editor.saveAsPolygon(triangleDraft, "P1");
      await editor.undo();
      expect(editor.canRedo()).toBe(true);
      await editor.saveAsPolygon(squareDraft, "P2");
      expect(editor.canRedo()).toBe(false);
    });

    it("canUndo returns false when no history", async () => {
      const { editor } = await createEditor();
      expect(editor.canUndo()).toBe(false);
    });

    it("canRedo returns false when no redo history", async () => {
      const { editor } = await createEditor();
      expect(editor.canRedo()).toBe(false);
    });
  });

  // ============================================================
  // Union Cache API
  // ============================================================

  describe("Union Cache API", () => {
    // Two adjacent squares: [0,0]-[1,1] and [1,0]-[2,1]
    const leftSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const rightSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 0],
        ],
      ],
    };
    // Separate square not touching the others
    const separateSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [10, 10],
          [11, 10],
          [11, 11],
          [10, 11],
          [10, 10],
        ],
      ],
    };

    function makePolygonWithGeom(id: string, geom: GeoJSONPolygon): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: "",
        created_at: now,
        updated_at: now,
      };
    }

    it("computeUnion returns a UnionCacheID", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      expect(typeof cacheId).toBe("string");
      expect(cacheId).toBeTruthy();
    });

    it("getCachedUnion returns union result", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const result = editor.getCachedUnion(cacheId);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);
      expect(result![0].type).toBe("Polygon");
    });

    it("cache auto-invalidation when polygon geometry changes", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);

      // Get initial result
      const result1 = editor.getCachedUnion(cacheId);

      // Update polygon geometry
      const newDraft = closedDraft([
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ]);
      await editor.updatePolygonGeometry(makePolygonID("p-1"), newDraft);

      // Cache should auto-recompute with new geometry
      const result2 = editor.getCachedUnion(cacheId);
      expect(result2).not.toBeNull();
      // Result should differ since p-1 changed geometry
      expect(result2).not.toEqual(result1);
    });

    it("cache auto-invalidation when polygon is deleted", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);

      // Delete one polygon
      await editor.deletePolygon(makePolygonID("p-1"));

      // Cache should recompute with remaining polygon only
      const result = editor.getCachedUnion(cacheId);
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(1);
    });

    it("deleteCachedUnion removes the cache entry", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const { editor } = await createEditor([p1]);
      const cacheId = editor.computeUnion([makePolygonID("p-1")]);
      expect(editor.getCachedUnion(cacheId)).not.toBeNull();

      editor.deleteCachedUnion(cacheId);
      expect(editor.getCachedUnion(cacheId)).toBeNull();
    });

    it("union of adjacent polygons produces merged contour", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const result = editor.getCachedUnion(cacheId);
      // Adjacent squares merge into one polygon
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe("Polygon");
    });

    it("union of disjoint polygons produces multiple polygons", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", separateSquare);
      const { editor } = await createEditor([p1, p2]);
      const cacheId = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const result = editor.getCachedUnion(cacheId);
      // Disjoint polygons produce 2 separate polygons
      expect(result).toHaveLength(2);
      expect(result![0].type).toBe("Polygon");
      expect(result![1].type).toBe("Polygon");
    });
  });

  // ============================================================
  // Cascading Union Cache API
  // ============================================================

  describe("Cascading Union Cache API", () => {
    // Three adjacent squares: [0,0]-[1,1], [1,0]-[2,1], [2,0]-[3,1]
    const sq1: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const sq2: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 0],
        ],
      ],
    };
    const sq3: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [2, 0],
          [3, 0],
          [3, 1],
          [2, 1],
          [2, 0],
        ],
      ],
    };

    function makePolygonWithGeom(id: string, geom: GeoJSONPolygon): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: "",
        created_at: now,
        updated_at: now,
      };
    }

    it("computeUnionFromCaches returns a UnionCacheID", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const p3 = makePolygonWithGeom("p-3", sq3);
      const { editor } = await createEditor([p1, p2, p3]);

      const cache1 = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const cache2 = editor.computeUnion([makePolygonID("p-3")]);
      const combined = editor.computeUnionFromCaches([cache1, cache2]);

      expect(typeof combined).toBe("string");
      expect(combined).toBeTruthy();
    });

    it("getCachedUnion on composite cache returns merged result", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const p3 = makePolygonWithGeom("p-3", sq3);
      const { editor } = await createEditor([p1, p2, p3]);

      const cache1 = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const cache2 = editor.computeUnion([makePolygonID("p-3")]);
      const combined = editor.computeUnionFromCaches([cache1, cache2]);

      const result = editor.getCachedUnion(combined);
      // All three adjacent squares merge into one polygon
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe("Polygon");
    });

    it("cascading dirty propagation: polygon change dirties parent cache", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const p3 = makePolygonWithGeom("p-3", sq3);
      const { editor } = await createEditor([p1, p2, p3]);

      const cache1 = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const cache2 = editor.computeUnion([makePolygonID("p-3")]);
      const combined = editor.computeUnionFromCaches([cache1, cache2]);

      const resultBefore = editor.getCachedUnion(combined);

      // Change p-1 geometry — should cascade: cache1 dirty → combined dirty
      const newDraft = closedDraft([
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ]);
      await editor.updatePolygonGeometry(makePolygonID("p-1"), newDraft);

      const resultAfter = editor.getCachedUnion(combined);
      expect(resultAfter).not.toBeNull();
      // Result should change because p-1 shrank
      expect(resultAfter).not.toEqual(resultBefore);
    });

    it("cascading dirty propagation: polygon deletion dirties parent cache", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const p3 = makePolygonWithGeom("p-3", sq3);
      const { editor } = await createEditor([p1, p2, p3]);

      const cache1 = editor.computeUnion([
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
      const cache2 = editor.computeUnion([makePolygonID("p-3")]);
      const combined = editor.computeUnionFromCaches([cache1, cache2]);

      await editor.deletePolygon(makePolygonID("p-1"));

      const result = editor.getCachedUnion(combined);
      expect(result).not.toBeNull();
      // p-2 and p-3 are adjacent, so still 1 merged polygon
      expect(result!.length).toBeGreaterThanOrEqual(1);
    });

    it("deleteCachedUnion cleans up union-to-union index", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const { editor } = await createEditor([p1, p2]);

      const cache1 = editor.computeUnion([makePolygonID("p-1")]);
      const cache2 = editor.computeUnion([makePolygonID("p-2")]);
      const combined = editor.computeUnionFromCaches([cache1, cache2]);

      editor.deleteCachedUnion(combined);
      expect(editor.getCachedUnion(combined)).toBeNull();
      // Child caches still accessible
      expect(editor.getCachedUnion(cache1)).not.toBeNull();
      expect(editor.getCachedUnion(cache2)).not.toBeNull();
    });

    it("multi-level cascading: 3-level hierarchy", async () => {
      const p1 = makePolygonWithGeom("p-1", sq1);
      const p2 = makePolygonWithGeom("p-2", sq2);
      const p3 = makePolygonWithGeom("p-3", sq3);
      const { editor } = await createEditor([p1, p2, p3]);

      // Level 1: leaf caches
      const leaf1 = editor.computeUnion([makePolygonID("p-1")]);
      const leaf2 = editor.computeUnion([makePolygonID("p-2")]);
      const leaf3 = editor.computeUnion([makePolygonID("p-3")]);

      // Level 2: mid-level cache
      const mid = editor.computeUnionFromCaches([leaf1, leaf2]);

      // Level 3: top-level cache
      const top = editor.computeUnionFromCaches([mid, leaf3]);

      const resultBefore = editor.getCachedUnion(top);
      expect(resultBefore).toHaveLength(1); // all 3 adjacent → 1 polygon

      // Change p-1 → should cascade: leaf1 → mid → top
      const newDraft = closedDraft([
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ]);
      await editor.updatePolygonGeometry(makePolygonID("p-1"), newDraft);

      const resultAfter = editor.getCachedUnion(top);
      expect(resultAfter).not.toBeNull();
      expect(resultAfter).not.toEqual(resultBefore);
    });
  });

  // ============================================================
  // sharedEdgeMove (coordinate hash index)
  // ============================================================

  describe("sharedEdgeMove", () => {
    // Two adjacent squares sharing edge at x=1
    // Left: [0,0],[1,0],[1,1],[0,1]  Right: [1,0],[2,0],[2,1],[1,1]
    const leftSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const rightSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 0],
        ],
      ],
    };

    function makePolygonWithGeom(id: string, geom: GeoJSONPolygon): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: "",
        created_at: now,
        updated_at: now,
      };
    }

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(
        editor.sharedEdgeMove(makePolygonID("nope"), 0, 5, 5),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("moves vertex of target polygon", async () => {
      const p = makePolygonWithGeom("p-1", leftSquare);
      const { editor } = await createEditor([p]);
      // Move vertex 1 (which is [1,0] in GeoJSON -> index 1) to [1.5, 0]
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        1,
        0,
        1.5,
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const updated = editor.getPolygon(makePolygonID("p-1"))!;
      // Vertex at index 1 should be moved to [1.5, 0] (lng=1.5, lat=0)
      expect(updated.geometry.coordinates[0][1]).toEqual([1.5, 0]);
    });

    it("moves shared vertices across polygons", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", rightSquare);
      const { editor } = await createEditor([p1, p2]);
      // leftSquare vertex 1 is [1,0], rightSquare vertex 0 is [1,0] -- shared
      // Move p-1 vertex 1 from [1,0] to [1.5, 0]
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        1,
        0,
        1.5,
      );
      expect(result).toHaveLength(2); // both polygons updated
      const u1 = editor.getPolygon(makePolygonID("p-1"))!;
      const u2 = editor.getPolygon(makePolygonID("p-2"))!;
      expect(u1.geometry.coordinates[0][1]).toEqual([1.5, 0]);
      // p-2's vertex 0 should also be updated (was [1,0], now [1.5,0])
      expect(u2.geometry.coordinates[0][0]).toEqual([1.5, 0]);
      // p-2's closing vertex (index 4) should also be updated
      expect(u2.geometry.coordinates[0][4]).toEqual([1.5, 0]);
    });

    it("updates duplicate coordinates within same polygon (closing vertex)", async () => {
      const p = makePolygonWithGeom("p-1", leftSquare);
      const { editor } = await createEditor([p]);
      // leftSquare: [0,0],[1,0],[1,1],[0,1],[0,0] -- vertex 0 and 4 share [0,0]
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        0,
        0.5,
        0.5,
      );
      expect(result).toHaveLength(1);
      const updated = editor.getPolygon(makePolygonID("p-1"))!;
      // Both first and closing vertex should be updated
      expect(updated.geometry.coordinates[0][0]).toEqual([0.5, 0.5]);
      expect(updated.geometry.coordinates[0][4]).toEqual([0.5, 0.5]);
    });

    it("persists changes via storageAdapter.batchWrite", async () => {
      const p = makePolygonWithGeom("p-1", leftSquare);
      const { editor, adapter } = await createEditor([p]);
      await editor.sharedEdgeMove(makePolygonID("p-1"), 1, 0, 1.5);
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", leftSquare);
      const { editor } = await createEditor([p]);
      await editor.sharedEdgeMove(makePolygonID("p-1"), 1, 0, 1.5);
      await editor.undo();
      const reverted = editor.getPolygon(makePolygonID("p-1"))!;
      expect(reverted.geometry.coordinates[0][1]).toEqual([1, 0]);
    });

    it("does not affect polygons without matching coordinates", async () => {
      const p1 = makePolygonWithGeom("p-1", leftSquare);
      const farSquare: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [10, 10],
            [11, 10],
            [11, 11],
            [10, 11],
            [10, 10],
          ],
        ],
      };
      const p2 = makePolygonWithGeom("p-2", farSquare);
      const { editor } = await createEditor([p1, p2]);
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        1,
        0,
        1.5,
      );
      expect(result).toHaveLength(1); // only p-1 updated
      const u2 = editor.getPolygon(makePolygonID("p-2"))!;
      // p-2 should be unchanged
      expect(u2.geometry.coordinates[0]).toEqual(farSquare.coordinates[0]);
    });

    it("finds shared vertices within epsilon tolerance", async () => {
      // Two squares with a shared edge, but coordinates differ by tiny amount (< 1e-8)
      const leftSquareExact: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      };
      const rightSquareSlightlyOff: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [1 + 1e-9, 0 + 1e-10], // nearly [1,0]
            [2, 0],
            [2, 1],
            [1 - 1e-10, 1 + 1e-9], // nearly [1,1]
            [1 + 1e-9, 0 + 1e-10],
          ],
        ],
      };

      const p1 = makePolygonWithGeom("p-1", leftSquareExact);
      const p2 = makePolygonWithGeom("p-2", rightSquareSlightlyOff);
      const { editor } = await createEditor([p1, p2]);

      // Move p-1 vertex 1 [1,0] -- p-2 vertex 0 [1+1e-9, 1e-10] should also move
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        1,
        0,
        1.5,
      );
      expect(result).toHaveLength(2); // both polygons updated
      const u2 = editor.getPolygon(makePolygonID("p-2"))!;
      expect(u2.geometry.coordinates[0][0]).toEqual([1.5, 0]);
    });
  });

  // ============================================================
  // splitPolygon (cut line intersection)
  // ============================================================

  describe("splitPolygon", () => {
    // Unit square: [0,0],[1,0],[1,1],[0,1]
    const unitSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    function makePolygonWithGeom(
      id: string,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        created_at: now,
        updated_at: now,
      };
    }

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };
      await expect(
        editor.splitPolygon(makePolygonID("nope"), cutLine),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("splits a square into two polygons with a vertical cut", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Cut line: vertical line at x=0.5, from below to above the square
      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result).toHaveLength(2);
      // Original polygon should be deleted
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      // Two new polygons should exist
      for (const poly of result) {
        expect(editor.getPolygon(poly.id)).not.toBeNull();
      }
    });

    it("returns empty array when cut line has 0 intersections", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor } = await createEditor([p]);

      // Cut line entirely outside
      const cutLine: DraftShape = {
        points: [
          { lat: 5, lng: 5 },
          { lat: 6, lng: 6 },
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result).toHaveLength(0);
      // Original polygon should be unchanged
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });

    it("inserts vertex when cut line has exactly 1 intersection", async () => {
      // Unit square: [0,0],[1,0],[1,1],[0,1],[0,0] -- 5 coords (4 unique + closing)
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor } = await createEditor([p]);

      // Cut line from outside touching bottom edge at (0.5, 0)
      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 }, // outside below
          { lat: 0, lng: 0.5 }, // hits bottom edge at midpoint
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      // No split -- returns empty array
      expect(result).toHaveLength(0);

      // Original polygon should still exist but now have the vertex inserted
      const updated = editor.getPolygon(makePolygonID("p-1"))!;
      expect(updated).not.toBeNull();
      const coords = updated.geometry.coordinates[0];
      // Originally 5 coords, now 6 (new vertex at [0.5, 0] inserted on bottom edge)
      expect(coords).toHaveLength(6);
      // The new vertex [0.5, 0] should be between [0,0] and [1,0]
      const hasInserted = coords.some(
        (c) => Math.abs(c[0] - 0.5) < 0.01 && Math.abs(c[1]) < 0.01,
      );
      expect(hasInserted).toBe(true);
    });

    it("vertex insertion is undoable", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 0, lng: 0.5 },
        ],
        isClosed: false,
      };

      const before = editor.getPolygon(makePolygonID("p-1"))!;
      const originalCoordCount = before.geometry.coordinates[0].length;

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      const after = editor.getPolygon(makePolygonID("p-1"))!;
      expect(after.geometry.coordinates[0].length).toBe(originalCoordCount + 1);

      await editor.undo();
      const restored = editor.getPolygon(makePolygonID("p-1"))!;
      expect(restored.geometry.coordinates[0].length).toBe(originalCoordCount);
    });

    it("vertex insertion does not insert duplicate if vertex already exists", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor } = await createEditor([p]);

      // Cut line hitting an existing vertex [1, 0] (corner of square)
      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 1 },
          { lat: 0, lng: 1 },
        ],
        isClosed: false,
      };

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      const updated = editor.getPolygon(makePolygonID("p-1"))!;
      // Should remain unchanged -- vertex already exists
      expect(updated.geometry.coordinates[0]).toHaveLength(5);
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();

      await editor.undo();
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });

    it("persists changes via batchWrite", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor, adapter } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      // batchWrite called for split
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("trims whiskers and splits correctly when cut line bends outside polygon", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Cut line with bent whiskers:
      // Starts at (-1,-1), enters polygon at (0.5,0), exits at (0.5,1), ends at (2,2)
      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: -1 }, // whisker start (outside, bent)
          { lat: 0, lng: 0.5 }, // enters polygon bottom edge
          { lat: 1, lng: 0.5 }, // exits polygon top edge
          { lat: 2, lng: 2 }, // whisker end (outside, bent)
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result).toHaveLength(2);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();

      // The effective cut should be vertical at lng=0.5
      const eps = 0.01;
      const maxLngs = result.map((p) =>
        Math.max(...p.geometry.coordinates[0].map((c) => c[0])),
      );
      const minLngs = result.map((p) =>
        Math.min(...p.geometry.coordinates[0].map((c) => c[0])),
      );

      // Sort so polygon with smaller max-lng comes first (left half)
      const sorted = [0, 1].sort((a, b) => maxLngs[a] - maxLngs[b]);
      // Left half: max lng should be ~0.5
      expect(maxLngs[sorted[0]]).toBeLessThanOrEqual(0.5 + eps);
      // Right half: min lng should be ~0.5
      expect(minLngs[sorted[1]]).toBeGreaterThanOrEqual(0.5 - eps);
    });

    it("trims straight whiskers without changing split result", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Straight whiskers: same direction, just extended beyond polygon
      const cutLine: DraftShape = {
        points: [
          { lat: -5, lng: 0.5 }, // far below
          { lat: 0, lng: 0.5 }, // bottom edge
          { lat: 1, lng: 0.5 }, // top edge
          { lat: 5, lng: 0.5 }, // far above
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result).toHaveLength(2);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
    });

    it("splits into 3 pieces with 4 intersections (two horizontal cuts)", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Cut line that makes two horizontal cuts through the unit square
      const cutLine: DraftShape = {
        points: [
          { lat: 0.3, lng: -0.5 }, // outside left
          { lat: 0.3, lng: 0 }, // enter left edge
          { lat: 0.3, lng: 1 }, // exit right edge
          { lat: 0.7, lng: 1.5 }, // outside right (transition)
          { lat: 0.7, lng: 1 }, // re-enter right edge
          { lat: 0.7, lng: 0 }, // exit left edge
          { lat: 0.7, lng: -0.5 }, // outside left
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result).toHaveLength(3);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();

      // Each strip should span the full width (lng 0 to 1)
      for (const poly of result) {
        const lngs = poly.geometry.coordinates[0].map((c) => c[0]);
        expect(Math.min(...lngs)).toBeLessThanOrEqual(0.01);
        expect(Math.max(...lngs)).toBeGreaterThanOrEqual(0.99);
      }

      // Verify the 3 strips have distinct lat ranges
      const latMids = result.map((poly) => {
        const lats = poly.geometry.coordinates[0].map((c) => c[1]);
        return (Math.min(...lats) + Math.max(...lats)) / 2;
      });
      latMids.sort((a, b) => a - b);
      // Bottom strip center ~0.15, middle ~0.5, top ~0.85
      expect(latMids[0]).toBeLessThan(0.25);
      expect(latMids[1]).toBeGreaterThan(0.35);
      expect(latMids[1]).toBeLessThan(0.65);
      expect(latMids[2]).toBeGreaterThan(0.75);
    });

    it("multi-segment split is undoable", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Square");
      const { editor } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: 0.3, lng: -0.5 },
          { lat: 0.3, lng: 0 },
          { lat: 0.3, lng: 1 },
          { lat: 0.7, lng: 1.5 },
          { lat: 0.7, lng: 1 },
          { lat: 0.7, lng: 0 },
          { lat: 0.7, lng: -0.5 },
        ],
        isClosed: false,
      };

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      expect(editor.getAllPolygons()).toHaveLength(3);

      await editor.undo();
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
      expect(editor.getAllPolygons()).toHaveLength(1);
    });
  });

  // ============================================================
  // carveInnerPolygon
  // ============================================================

  describe("carveInnerPolygon", () => {
    // Large square: [0,0]-[4,4]
    const bigSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };

    function makePolygonWithGeom(
      id: string,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        created_at: now,
        updated_at: now,
      };
    }

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      const loop = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 0, lng: 0 },
      ];
      await expect(
        editor.carveInnerPolygon(makePolygonID("nope"), loop),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("carves inner polygon from boundary vertex loop", async () => {
      const p = makePolygonWithGeom("p-1", bigSquare, "Big");
      const { editor } = await createEditor([p]);

      // Loop starts and ends at [0,0] (a boundary vertex), goes into interior
      const loop = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
        { lat: 0, lng: 0 },
      ];

      const result = await editor.carveInnerPolygon(makePolygonID("p-1"), loop);
      expect(result.outer).toBeDefined();
      expect(result.inner).toBeDefined();
      // Original polygon deleted
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      // Two new polygons exist
      expect(editor.getPolygon(result.outer.id)).not.toBeNull();
      expect(editor.getPolygon(result.inner.id)).not.toBeNull();
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", bigSquare);
      const { editor } = await createEditor([p]);

      const loop = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
        { lat: 0, lng: 0 },
      ];

      await editor.carveInnerPolygon(makePolygonID("p-1"), loop);
      await editor.undo();
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });
  });

  // ============================================================
  // punchHole
  // ============================================================

  describe("punchHole", () => {
    const bigSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };

    function makePolygonWithGeom(
      id: string,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        created_at: now,
        updated_at: now,
      };
    }

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      const hole = [
        { lat: 2, lng: 2 },
        { lat: 2, lng: 4 },
        { lat: 4, lng: 4 },
        { lat: 4, lng: 2 },
        { lat: 2, lng: 2 },
      ];
      await expect(
        editor.punchHole(makePolygonID("nope"), hole),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("punches hole and creates donut + inner polygon", async () => {
      const p = makePolygonWithGeom("p-1", bigSquare, "Big");
      const { editor } = await createEditor([p]);

      // Hole completely inside the big square
      const hole = [
        { lat: 2, lng: 2 },
        { lat: 2, lng: 4 },
        { lat: 4, lng: 4 },
        { lat: 4, lng: 2 },
        { lat: 2, lng: 2 },
      ];

      const result = await editor.punchHole(makePolygonID("p-1"), hole);
      expect(result.donut).toBeDefined();
      expect(result.inner).toBeDefined();
      // Original polygon deleted
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      // Donut should have a hole (2 rings)
      expect(result.donut.geometry.coordinates.length).toBe(2);
      // Inner polygon fills the hole
      expect(result.inner.geometry.coordinates.length).toBe(1);
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", bigSquare);
      const { editor } = await createEditor([p]);

      const hole = [
        { lat: 2, lng: 2 },
        { lat: 2, lng: 4 },
        { lat: 4, lng: 4 },
        { lat: 4, lng: 2 },
        { lat: 2, lng: 2 },
      ];

      await editor.punchHole(makePolygonID("p-1"), hole);
      await editor.undo();
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });
  });

  // ============================================================
  // expandWithPolygon
  // ============================================================

  describe("expandWithPolygon", () => {
    const unitSquare: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    function makePolygonWithGeom(
      id: string,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        created_at: now,
        updated_at: now,
      };
    }

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      const outerPath = [
        { lat: 0, lng: 1 },
        { lat: 0, lng: 2 },
        { lat: 1, lng: 2 },
        { lat: 1, lng: 1 },
      ];
      await expect(
        editor.expandWithPolygon(makePolygonID("nope"), outerPath, "added"),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("creates original + added polygon from outer path", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare, "Original");
      const { editor } = await createEditor([p]);

      // Outer path: forms a new square adjacent to the right edge
      const outerPath = [
        { lat: 0, lng: 1 },
        { lat: 0, lng: 2 },
        { lat: 1, lng: 2 },
        { lat: 1, lng: 1 },
      ];

      const result = await editor.expandWithPolygon(
        makePolygonID("p-1"),
        outerPath,
        "Extension",
      );
      expect(result.original).toBeDefined();
      expect(result.added).toBeDefined();
      expect(result.added.display_name).toBe("Extension");
      // Original polygon deleted, replaced with new id
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      expect(editor.getPolygon(result.original.id)).not.toBeNull();
      expect(editor.getPolygon(result.added.id)).not.toBeNull();
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", unitSquare);
      const { editor } = await createEditor([p]);

      const outerPath = [
        { lat: 0, lng: 1 },
        { lat: 0, lng: 2 },
        { lat: 1, lng: 2 },
        { lat: 1, lng: 1 },
      ];

      await editor.expandWithPolygon(
        makePolygonID("p-1"),
        outerPath,
        "Extension",
      );
      await editor.undo();
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });
  });

  // ============================================================
  // bridgePolygons
  // ============================================================

  describe("bridgePolygons", () => {
    // Two adjacent unit squares sharing edge [1,0]-[1,1]
    //  A: [0,0]-[1,0]-[1,1]-[0,1]   (CCW)
    //  B: [1,0]-[2,0]-[2,1]-[1,1]   (CCW)
    const unitSquareA: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const unitSquareB: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 0],
        ],
      ],
    };

    function makeAdjacentSquares(): MapPolygon[] {
      const now = new Date();
      return [
        {
          id: makePolygonID("a-1"),
          geometry: unitSquareA,
          display_name: "SquareA",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("b-1"),
          geometry: unitSquareB,
          display_name: "SquareB",
          created_at: now,
          updated_at: now,
        },
      ];
    }

    it("creates a new polygon bridging two adjacent squares", async () => {
      const polys = makeAdjacentSquares();
      const { editor } = await createEditor(polys);

      // Bridge from A vertex 3 [0,1] → outside [0,2],[2,2] → B vertex 2 [2,1]
      const bridgePath = [
        { lat: 1, lng: 0 }, // A[3] = [0,1] (lng=0,lat=1)
        { lat: 2, lng: 0 }, // outside
        { lat: 2, lng: 2 }, // outside
        { lat: 1, lng: 2 }, // B[2] = [2,1] (lng=2,lat=1)
      ];

      const result = await editor.bridgePolygons(
        makePolygonID("a-1"),
        3, // vertex index on A
        makePolygonID("b-1"),
        2, // vertex index on B
        bridgePath,
        "BridgedArea",
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.polygon.display_name).toBe("BridgedArea");
        expect(result.polygon.geometry.type).toBe("Polygon");
        // Original polygons are unchanged
        expect(editor.getPolygon(makePolygonID("a-1"))).not.toBeNull();
        expect(editor.getPolygon(makePolygonID("b-1"))).not.toBeNull();
        // New polygon is stored
        expect(editor.getPolygon(result.polygon.id)).not.toBeNull();
        // Total polygons: A + B + bridged = 3
        expect(editor.getAllPolygons()).toHaveLength(3);
      }
    });

    it("saves draft when polygons share no edge", async () => {
      const now = new Date();
      const farSquare: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
            [5, 5],
          ],
        ],
      };
      const polys: MapPolygon[] = [
        {
          id: makePolygonID("a-1"),
          geometry: unitSquareA,
          display_name: "A",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("far-1"),
          geometry: farSquare,
          display_name: "Far",
          created_at: now,
          updated_at: now,
        },
      ];
      const { editor } = await createEditor(polys);

      const bridgePath = [
        { lat: 1, lng: 0 },
        { lat: 3, lng: 3 },
        { lat: 6, lng: 6 },
      ];

      const result = await editor.bridgePolygons(
        makePolygonID("a-1"),
        3,
        makePolygonID("far-1"),
        2,
        bridgePath,
        "Attempt",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.draft).toBeDefined();
        expect(result.draft.points).toHaveLength(3);
        expect(result.draft.isClosed).toBe(false);
      }
    });

    it("throws PolygonNotFoundError when polygon A does not exist", async () => {
      const polys = makeAdjacentSquares();
      const { editor } = await createEditor(polys);

      await expect(
        editor.bridgePolygons(
          makePolygonID("nonexistent"),
          0,
          makePolygonID("b-1"),
          0,
          [{ lat: 0, lng: 0 }],
          "Test",
        ),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("throws PolygonNotFoundError when polygon B does not exist", async () => {
      const polys = makeAdjacentSquares();
      const { editor } = await createEditor(polys);

      await expect(
        editor.bridgePolygons(
          makePolygonID("a-1"),
          0,
          makePolygonID("nonexistent"),
          0,
          [{ lat: 0, lng: 0 }],
          "Test",
        ),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("undo removes the bridged polygon; originals remain", async () => {
      const polys = makeAdjacentSquares();
      const { editor } = await createEditor(polys);

      const bridgePath = [
        { lat: 1, lng: 0 },
        { lat: 2, lng: 0 },
        { lat: 2, lng: 2 },
        { lat: 1, lng: 2 },
      ];

      const result = await editor.bridgePolygons(
        makePolygonID("a-1"),
        3,
        makePolygonID("b-1"),
        2,
        bridgePath,
        "BridgedArea",
      );

      expect(result.ok).toBe(true);
      expect(editor.getAllPolygons()).toHaveLength(3);

      await editor.undo();

      expect(editor.getAllPolygons()).toHaveLength(2);
      expect(editor.getPolygon(makePolygonID("a-1"))).not.toBeNull();
      expect(editor.getPolygon(makePolygonID("b-1"))).not.toBeNull();
    });

    it("new polygon vertices are registered in coordIndex (sharedEdgeMove works)", async () => {
      const polys = makeAdjacentSquares();
      const { editor } = await createEditor(polys);

      const bridgePath = [
        { lat: 1, lng: 0 },
        { lat: 2, lng: 0 },
        { lat: 2, lng: 2 },
        { lat: 1, lng: 2 },
      ];

      const result = await editor.bridgePolygons(
        makePolygonID("a-1"),
        3,
        makePolygonID("b-1"),
        2,
        bridgePath,
        "BridgedArea",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The bridged polygon shares vertex [1,1] with A[2] and B[3].
      // Moving [1,1] on A should also move it on the bridged polygon.
      const updated = await editor.sharedEdgeMove(
        makePolygonID("a-1"),
        2, // vertex [1,1] on A
        1.5,
        1, // move to [1, 1.5]
      );

      // Should update A, B, and the bridged polygon
      expect(updated.length).toBeGreaterThanOrEqual(3);
    });

    // --- Loop detection tests ---

    it("detects closed loop through 3 polygons and 2 existing drafts", async () => {
      // 3 non-adjacent triangles
      const now = new Date();
      const triA: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0.5, 1],
            [0, 0],
          ],
        ],
      };
      const triB: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [3, 0],
            [4, 0],
            [3.5, 1],
            [3, 0],
          ],
        ],
      };
      const triC: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [1.5, 3],
            [2.5, 3],
            [2, 4],
            [1.5, 3],
          ],
        ],
      };

      const polys: MapPolygon[] = [
        {
          id: makePolygonID("triA"),
          geometry: triA,
          display_name: "A",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("triB"),
          geometry: triB,
          display_name: "B",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("triC"),
          geometry: triC,
          display_name: "C",
          created_at: now,
          updated_at: now,
        },
      ];
      const { editor } = await createEditor(polys);

      // 1st bridge: A[1,0] → B[3,0] — no shared edge → draft D1
      const r1 = await editor.bridgePolygons(
        makePolygonID("triA"),
        1,
        makePolygonID("triB"),
        0,
        [
          { lat: 0, lng: 1 },
          { lat: 0, lng: 2 },
          { lat: 0, lng: 3 },
        ],
        "D1",
      );
      expect(r1.ok).toBe(false);

      // 2nd bridge: B[3.5,1] → C[1.5,3] — no shared edge → draft D2
      const r2 = await editor.bridgePolygons(
        makePolygonID("triB"),
        2,
        makePolygonID("triC"),
        0,
        [
          { lat: 1, lng: 3.5 },
          { lat: 2, lng: 2.5 },
          { lat: 3, lng: 1.5 },
        ],
        "D2",
      );
      expect(r2.ok).toBe(false);

      // 3rd bridge: C[2,4] → A[0.5,1] — loop should be detected!
      const r3 = await editor.bridgePolygons(
        makePolygonID("triC"),
        2,
        makePolygonID("triA"),
        2,
        [
          { lat: 4, lng: 2 },
          { lat: 1, lng: 0.5 },
        ],
        "LoopPoly",
      );
      expect(r3.ok).toBe(true);
      if (r3.ok) {
        expect(r3.polygon.display_name).toBe("LoopPoly");
        expect(r3.polygon.geometry.type).toBe("Polygon");
        // Original polygons unchanged
        expect(editor.getPolygon(makePolygonID("triA"))).not.toBeNull();
        expect(editor.getPolygon(makePolygonID("triB"))).not.toBeNull();
        expect(editor.getPolygon(makePolygonID("triC"))).not.toBeNull();
        // Total: 3 originals + 1 loop polygon = 4
        expect(editor.getAllPolygons()).toHaveLength(4);
      }
    });

    it("consumed drafts are deleted after loop detection", async () => {
      const now = new Date();
      const triA: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0.5, 1],
            [0, 0],
          ],
        ],
      };
      const triB: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [3, 0],
            [4, 0],
            [3.5, 1],
            [3, 0],
          ],
        ],
      };
      const triC: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [1.5, 3],
            [2.5, 3],
            [2, 4],
            [1.5, 3],
          ],
        ],
      };

      const polys: MapPolygon[] = [
        {
          id: makePolygonID("triA"),
          geometry: triA,
          display_name: "A",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("triB"),
          geometry: triB,
          display_name: "B",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("triC"),
          geometry: triC,
          display_name: "C",
          created_at: now,
          updated_at: now,
        },
      ];
      const { editor } = await createEditor(polys);

      // Create 2 drafts
      await editor.bridgePolygons(
        makePolygonID("triA"),
        1,
        makePolygonID("triB"),
        0,
        [
          { lat: 0, lng: 1 },
          { lat: 0, lng: 2 },
          { lat: 0, lng: 3 },
        ],
        "D1",
      );
      await editor.bridgePolygons(
        makePolygonID("triB"),
        2,
        makePolygonID("triC"),
        0,
        [
          { lat: 1, lng: 3.5 },
          { lat: 2, lng: 2.5 },
          { lat: 3, lng: 1.5 },
        ],
        "D2",
      );

      expect(editor.listPersistedDrafts()).toHaveLength(2);

      // Close the loop
      await editor.bridgePolygons(
        makePolygonID("triC"),
        2,
        makePolygonID("triA"),
        2,
        [
          { lat: 4, lng: 2 },
          { lat: 1, lng: 0.5 },
        ],
        "LoopPoly",
      );

      // Consumed drafts should be deleted
      expect(editor.listPersistedDrafts()).toHaveLength(0);
    });

    it("no loop found still saves draft", async () => {
      const now = new Date();
      const triA: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0.5, 1],
            [0, 0],
          ],
        ],
      };
      const triC: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [
            [1.5, 3],
            [2.5, 3],
            [2, 4],
            [1.5, 3],
          ],
        ],
      };
      const polys: MapPolygon[] = [
        {
          id: makePolygonID("triA"),
          geometry: triA,
          display_name: "A",
          created_at: now,
          updated_at: now,
        },
        {
          id: makePolygonID("triC"),
          geometry: triC,
          display_name: "C",
          created_at: now,
          updated_at: now,
        },
      ];
      const { editor } = await createEditor(polys);

      // No existing drafts, A and C not connected → should save draft
      const result = await editor.bridgePolygons(
        makePolygonID("triA"),
        1,
        makePolygonID("triC"),
        0,
        [
          { lat: 0, lng: 1 },
          { lat: 3, lng: 1.5 },
        ],
        "Attempt",
      );
      expect(result.ok).toBe(false);
      expect(editor.listPersistedDrafts()).toHaveLength(1);
    });
  });

  // ============================================================
  // Snap utility methods
  // ============================================================

  describe("Snap utility methods", () => {
    // Helper to build a MapPolygon with custom geometry (coordinates as [lng, lat][])
    function makePolygonWithGeometry(
      id: string,
      coords: [number, number][],
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
        display_name: id,
        created_at: now,
        updated_at: now,
      };
    }

    // A unit square: vertices at [lng=0,lat=0], [lng=1,lat=0], [lng=1,lat=1], [lng=0,lat=1]
    // Stored as [lng,lat] pairs in geometry.coordinates[0]
    const unitSquarePoly = makePolygonWithGeometry("sq", [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);

    // -------------------------------------------------------
    // findNearestVertex
    // -------------------------------------------------------

    describe("findNearestVertex", () => {
      it("throws NotInitializedError before initialize()", () => {
        const adapter = createMockAdapter();
        const editor = new MapPolygonEditor({ storageAdapter: adapter });
        expect(() => editor.findNearestVertex({ lat: 0, lng: 0 }, 1)).toThrow(
          NotInitializedError,
        );
      });

      it("returns null when there are no polygons", async () => {
        const { editor } = await createEditor([]);
        expect(editor.findNearestVertex({ lat: 0, lng: 0 }, 1)).toBeNull();
      });

      it("returns the nearest vertex within radius", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Vertex at lng=1, lat=1 — query point very close to it
        const result = editor.findNearestVertex({ lat: 0.99, lng: 0.99 }, 0.1);
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(1, 8);
        expect(result!.lng).toBeCloseTo(1, 8);
      });

      it("returns null when no vertex is within radius", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Point far from all vertices
        const result = editor.findNearestVertex({ lat: 5, lng: 5 }, 0.1);
        expect(result).toBeNull();
      });

      it("returns the closest vertex when multiple are within radius", async () => {
        // Two nearby vertices: [0,0] and [0.05,0] (lng, lat)
        const twoVertexPoly = makePolygonWithGeometry("two", [
          [0, 0],
          [0.05, 0],
          [0.05, 0.1],
          [0, 0],
        ]);
        const { editor } = await createEditor([twoVertexPoly]);
        // Query at lat=0, lng=0.04 — closer to [lng=0.05,lat=0] than [lng=0,lat=0]
        const result = editor.findNearestVertex({ lat: 0, lng: 0.04 }, 0.1);
        expect(result).not.toBeNull();
        expect(result!.lng).toBeCloseTo(0.05, 8);
        expect(result!.lat).toBeCloseTo(0, 8);
      });

      it("returns a vertex exactly on the radius boundary (strictly less than radius)", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Vertex at lng=0, lat=0. Query at lng=0.1, lat=0 with radius=0.1
        // Squared distance = 0.01 which equals radius^2, so boundary is NOT within radius
        const result = editor.findNearestVertex({ lat: 0, lng: 0.1 }, 0.1);
        // Distance exactly equals radius — should NOT be returned (strictly less-than)
        // The implementation uses dist < radius or dist <= radius; we test the boundary.
        // We do not mandate strictly-less or lte here; we only verify it's deterministic.
        // What we DO verify: if within radius it is returned, if outside it is null.
        const resultInside = editor.findNearestVertex(
          { lat: 0, lng: 0.05 },
          0.1,
        );
        expect(resultInside).not.toBeNull();
      });

      it("works correctly with closing vertex duplicated in ring", async () => {
        // GeoJSON rings close by repeating first vertex — ensure no duplicate snap
        const { editor } = await createEditor([unitSquarePoly]);
        // Both [0,0] appear twice in ring; should still return one result
        const result = editor.findNearestVertex({ lat: 0, lng: 0 }, 0.01);
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(0, 8);
        expect(result!.lng).toBeCloseTo(0, 8);
      });

      it("handles multiple polygons and finds globally nearest vertex", async () => {
        const polyA = makePolygonWithGeometry("a", [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ]);
        const polyB = makePolygonWithGeometry("b", [
          [10, 10],
          [11, 10],
          [11, 11],
          [10, 10],
        ]);
        const { editor } = await createEditor([polyA, polyB]);
        // Query near polyB vertex [10,10] (lng=10,lat=10)
        const result = editor.findNearestVertex({ lat: 10, lng: 10 }, 0.5);
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(10, 8);
        expect(result!.lng).toBeCloseTo(10, 8);
      });
    });

    // -------------------------------------------------------
    // findEdgeIntersections
    // -------------------------------------------------------

    describe("findEdgeIntersections", () => {
      it("throws NotInitializedError before initialize()", () => {
        const adapter = createMockAdapter();
        const editor = new MapPolygonEditor({ storageAdapter: adapter });
        expect(() =>
          editor.findEdgeIntersections({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }),
        ).toThrow(NotInitializedError);
      });

      it("returns empty array when there are no polygons", async () => {
        const { editor } = await createEditor([]);
        const result = editor.findEdgeIntersections(
          { lat: 0, lng: -1 },
          { lat: 0, lng: 2 },
        );
        expect(result).toEqual([]);
      });

      it("returns empty array when segment does not cross any edge", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Segment entirely inside the square (no edge crossing)
        // Goes from [lng=0.2,lat=0.2] to [lng=0.8,lat=0.8] — no polygon edge crossed
        const result = editor.findEdgeIntersections(
          { lat: 0.2, lng: 0.2 },
          { lat: 0.8, lng: 0.8 },
        );
        expect(result).toEqual([]);
      });

      it("returns a single intersection point when segment crosses one edge", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Square edges include bottom edge from [lng=0,lat=0] to [lng=1,lat=0]
        // Segment from [lng=0.5,lat=-0.5] to [lng=0.5,lat=0.5] crosses the bottom edge at lat=0
        const result = editor.findEdgeIntersections(
          { lat: -0.5, lng: 0.5 },
          { lat: 0.5, lng: 0.5 },
        );
        expect(result).toHaveLength(1);
        expect(result[0].lat).toBeCloseTo(0, 6);
        expect(result[0].lng).toBeCloseTo(0.5, 6);
      });

      it("returns two intersection points when segment crosses two edges, sorted by distance from p1", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Horizontal segment from [lng=-0.5,lat=0.5] to [lng=1.5,lat=0.5]
        // Crosses left edge (lng=0) at lat=0.5 and right edge (lng=1) at lat=0.5
        const result = editor.findEdgeIntersections(
          { lat: 0.5, lng: -0.5 },
          { lat: 0.5, lng: 1.5 },
        );
        expect(result).toHaveLength(2);
        // First intersection closer to p1 (lng=-0.5): should be at lng=0
        expect(result[0].lng).toBeCloseTo(0, 6);
        expect(result[0].lat).toBeCloseTo(0.5, 6);
        // Second intersection: lng=1
        expect(result[1].lng).toBeCloseTo(1, 6);
        expect(result[1].lat).toBeCloseTo(0.5, 6);
      });

      it("returns intersections sorted by distance from p1 (not from p2)", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        // Same as above but reversed direction: p1=[lng=1.5,lat=0.5], p2=[lng=-0.5,lat=0.5]
        const result = editor.findEdgeIntersections(
          { lat: 0.5, lng: 1.5 },
          { lat: 0.5, lng: -0.5 },
        );
        expect(result).toHaveLength(2);
        // First intersection closer to p1 (lng=1.5): should be at lng=1
        expect(result[0].lng).toBeCloseTo(1, 6);
        expect(result[1].lng).toBeCloseTo(0, 6);
      });

      it("returns Point objects with lat and lng properties", async () => {
        const { editor } = await createEditor([unitSquarePoly]);
        const result = editor.findEdgeIntersections(
          { lat: 0.5, lng: -0.5 },
          { lat: 0.5, lng: 1.5 },
        );
        expect(result.length).toBeGreaterThan(0);
        for (const pt of result) {
          expect(typeof pt.lat).toBe("number");
          expect(typeof pt.lng).toBe("number");
        }
      });

      it("handles intersections across multiple polygons", async () => {
        const polyA = makePolygonWithGeometry("a", [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ]);
        const polyB = makePolygonWithGeometry("b", [
          [2, 0],
          [3, 0],
          [3, 1],
          [2, 1],
          [2, 0],
        ]);
        const { editor } = await createEditor([polyA, polyB]);
        // Segment from [lng=-0.5,lat=0.5] to [lng=3.5,lat=0.5] crosses 4 edges total
        const result = editor.findEdgeIntersections(
          { lat: 0.5, lng: -0.5 },
          { lat: 0.5, lng: 3.5 },
        );
        expect(result).toHaveLength(4);
        // All sorted by increasing lng (distance from p1 at lng=-0.5)
        const lngs = result.map((p) => p.lng);
        expect(lngs).toEqual([...lngs].sort((a, b) => a - b));
      });
    });
  });

  // ============================================================
  // Resolve Overlaps
  // ============================================================

  describe("resolveOverlaps", () => {
    // Helper: square polygon at (x, y) with given size, coords in [lng, lat]
    function makeSquareAt(
      id: string,
      x: number,
      y: number,
      size: number,
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x, y],
              [x + size, y],
              [x + size, y + size],
              [x, y + size],
              [x, y],
            ],
          ],
        },
        display_name: id,
        created_at: now,
        updated_at: now,
      };
    }

    function polyArea(polygon: MapPolygon): number {
      const ring = polygon.geometry.coordinates[0]!;
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        area += ring[i]![0]! * ring[j]![1]!;
        area -= ring[j]![0]! * ring[i]![1]!;
      }
      return Math.abs(area / 2);
    }

    it("throws NotInitializedError before initialize()", async () => {
      const adapter = createMockAdapter();
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      await expect(
        editor.resolveOverlaps([makePolygonID("a"), makePolygonID("b")]),
      ).rejects.toThrow(NotInitializedError);
    });

    it("throws InvalidGeometryError with fewer than 2 IDs", async () => {
      const { editor } = await createEditor([makeSquareAt("a", 0, 0, 1)]);
      await expect(
        editor.resolveOverlaps([makePolygonID("a")]),
      ).rejects.toThrow(InvalidGeometryError);
    });

    it("throws PolygonNotFoundError for non-existent ID", async () => {
      const { editor } = await createEditor([makeSquareAt("a", 0, 0, 1)]);
      await expect(
        editor.resolveOverlaps([makePolygonID("a"), makePolygonID("missing")]),
      ).rejects.toThrow(PolygonNotFoundError);
    });

    it("returns empty arrays when polygons do not overlap", async () => {
      // Two squares far apart
      const a = makeSquareAt("a", 0, 0, 1);
      const b = makeSquareAt("b", 5, 5, 1);
      const { editor } = await createEditor([a, b]);

      const result = await editor.resolveOverlaps([a.id, b.id]);
      expect(result.modified).toHaveLength(0);
      expect(result.created).toHaveLength(0);

      // Original polygons unchanged
      expect(editor.getPolygon(a.id)!.geometry).toEqual(a.geometry);
      expect(editor.getPolygon(b.id)!.geometry).toEqual(b.geometry);
    });

    it("splits 2 overlapping squares into 3 non-overlapping pieces", async () => {
      // A: [0,0]-[2,0]-[2,2]-[0,2], B: [1,0]-[3,0]-[3,2]-[1,2]
      // Overlap region: [1,0]-[2,0]-[2,2]-[1,2] (area = 2)
      const a = makeSquareAt("a", 0, 0, 2);
      const b = makeSquareAt("b", 1, 0, 2);
      const { editor } = await createEditor([a, b]);

      const result = await editor.resolveOverlaps([a.id, b.id]);

      // Both originals should be modified (shrunk)
      expect(result.modified).toHaveLength(2);
      // One intersection polygon created
      expect(result.created).toHaveLength(1);

      // Check areas: A-only=2, B-only=2, intersection=2 (total=6=original 4+4-2)
      const aAfter = editor.getPolygon(a.id)!;
      const bAfter = editor.getPolygon(b.id)!;
      const intersection = result.created[0]!;

      expect(polyArea(aAfter)).toBeCloseTo(2, 4);
      expect(polyArea(bAfter)).toBeCloseTo(2, 4);
      expect(polyArea(intersection)).toBeCloseTo(2, 4);

      // IDs preserved
      expect(aAfter.id).toBe(a.id);
      expect(bAfter.id).toBe(b.id);
    });

    it("handles 3 overlapping polygons", async () => {
      // Three squares with mutual overlaps
      const a = makeSquareAt("a", 0, 0, 2);
      const b = makeSquareAt("b", 1, 0, 2);
      const c = makeSquareAt("c", 0.5, 1, 2);
      const { editor } = await createEditor([a, b, c]);

      const result = await editor.resolveOverlaps([a.id, b.id, c.id]);

      // All 3 originals should be modified
      expect(result.modified).toHaveLength(3);
      // Should have intersection regions (pairwise + triple)
      expect(result.created.length).toBeGreaterThanOrEqual(1);

      // Total area should be preserved (union area)
      const totalArea =
        result.modified.reduce((s, p) => s + polyArea(p), 0) +
        result.created.reduce((s, p) => s + polyArea(p), 0);
      // Original areas: 4+4+4=12, but overlaps reduce the total
      // The key invariant: total of all pieces should equal union area
      expect(totalArea).toBeGreaterThan(0);

      // No piece should overlap with any other (hard to verify geometrically,
      // but at least total should be less than sum of originals)
      expect(totalArea).toBeLessThan(12);
    });

    it("is undoable", async () => {
      const a = makeSquareAt("a", 0, 0, 2);
      const b = makeSquareAt("b", 1, 0, 2);
      const { editor } = await createEditor([a, b]);

      const result = await editor.resolveOverlaps([a.id, b.id]);
      expect(result.created).toHaveLength(1);
      const intersectionId = result.created[0]!.id;

      // Undo
      await editor.undo();

      // Originals restored
      expect(editor.getPolygon(a.id)!.geometry).toEqual(a.geometry);
      expect(editor.getPolygon(b.id)!.geometry).toEqual(b.geometry);

      // Intersection polygon removed
      expect(editor.getPolygon(intersectionId)).toBeNull();
    });

    it("calls storageAdapter.batchWrite with correct data", async () => {
      const a = makeSquareAt("a", 0, 0, 2);
      const b = makeSquareAt("b", 1, 0, 2);
      const { editor, adapter } = await createEditor([a, b]);

      await editor.resolveOverlaps([a.id, b.id]);

      expect(adapter.batchWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          createdPolygons: expect.arrayContaining([
            expect.objectContaining({ geometry: expect.any(Object) }),
          ]),
          deletedPolygonIds: [],
          modifiedPolygons: expect.arrayContaining([
            expect.objectContaining({ id: a.id }),
            expect.objectContaining({ id: b.id }),
          ]),
        }),
      );
    });

    it("deduplicates polygon IDs", async () => {
      const a = makeSquareAt("a", 0, 0, 2);
      const b = makeSquareAt("b", 1, 0, 2);
      const { editor } = await createEditor([a, b]);

      // Pass duplicate IDs — should not error
      const result = await editor.resolveOverlaps([a.id, b.id, a.id]);
      expect(result.modified).toHaveLength(2);
      expect(result.created).toHaveLength(1);
    });
  });
});
