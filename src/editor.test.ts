import { describe, it, expect, vi, beforeEach } from "vitest";
import { MapPolygonEditor } from "./editor.js";
import type {
  MapPolygon,
  Group,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
  GeoJSONPolygon,
} from "./types/index.js";
import { makePolygonID, makeGroupID, makeDraftID } from "./types/index.js";
import {
  NotInitializedError,
  StorageError,
  PolygonNotFoundError,
  GroupNotFoundError,
  GroupWouldBeEmptyError,
  NotRootPolygonError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
  CircularReferenceError,
  SelfReferenceError,
  MixedParentError,
  DataIntegrityError,
} from "./errors.js";

// ============================================================
// Helpers
// ============================================================

const triangle: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
};

const square: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
};

function closedDraft(coords: [number, number][]): DraftShape {
  return {
    points: coords.map(([lat, lng]) => ({ lat, lng })),
    isClosed: true,
  };
}

const triangleDraft = closedDraft([[0, 0], [1, 0], [1, 1]]);
const squareDraft = closedDraft([[0, 0], [2, 0], [2, 2], [0, 2]]);

function makePolygon(id: string, parentId: string | null = null, name = ""): MapPolygon {
  const now = new Date();
  return {
    id: makePolygonID(id),
    geometry: triangle,
    display_name: name,
    parent_id: parentId ? makeGroupID(parentId) : null,
    created_at: now,
    updated_at: now,
  };
}

function makeGroup(id: string, parentId: string | null = null, name = ""): Group {
  const now = new Date();
  return {
    id: makeGroupID(id),
    display_name: name,
    parent_id: parentId ? makeGroupID(parentId) : null,
    created_at: now,
    updated_at: now,
  };
}

function createMockAdapter(
  polygons: MapPolygon[] = [],
  groups: Group[] = [],
  drafts: PersistedDraft[] = [],
): StorageAdapter {
  return {
    loadAll: vi.fn().mockResolvedValue({ polygons, groups, drafts }),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  };
}

async function createEditor(
  polygons: MapPolygon[] = [],
  groups: Group[] = [],
  drafts: PersistedDraft[] = [],
) {
  const adapter = createMockAdapter(polygons, groups, drafts);
  const editor = new MapPolygonEditor({ storageAdapter: adapter });
  await editor.initialize();
  return { editor, adapter };
}

// ============================================================
// Phase 1: Initialization + Query APIs
// ============================================================

describe("MapPolygonEditor", () => {
  describe("Phase 1: Initialization", () => {
    it("throws NotInitializedError when calling API before initialize()", () => {
      const adapter = createMockAdapter();
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      expect(() => editor.getRoots()).toThrow(NotInitializedError);
    });

    it("initializes successfully with empty data", async () => {
      const { editor } = await createEditor();
      expect(editor.getAllPolygons()).toEqual([]);
      expect(editor.getAllGroups()).toEqual([]);
    });

    it("loads polygons and groups from storage", async () => {
      const p = makePolygon("p-1", null, "Root");
      const g = makeGroup("g-1", null, "Group");
      const { editor } = await createEditor([p], [g]);
      expect(editor.getAllPolygons()).toHaveLength(1);
      expect(editor.getAllGroups()).toHaveLength(1);
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

    it("detects orphan polygon (parent group does not exist)", async () => {
      const p = makePolygon("p-1", "g-missing");
      const adapter = createMockAdapter([p]);
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      await expect(editor.initialize()).rejects.toThrow(DataIntegrityError);
    });

    it("detects orphan group (parent group does not exist)", async () => {
      const g = makeGroup("g-child", "g-missing");
      const adapter = createMockAdapter([], [g]);
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      await expect(editor.initialize()).rejects.toThrow(DataIntegrityError);
    });
  });

  describe("Phase 1: Query APIs", () => {
    it("getPolygon returns polygon by ID", async () => {
      const p = makePolygon("p-1", null, "Test");
      const { editor } = await createEditor([p]);
      expect(editor.getPolygon(makePolygonID("p-1"))?.display_name).toBe("Test");
    });

    it("getPolygon returns null for non-existent ID", async () => {
      const { editor } = await createEditor();
      expect(editor.getPolygon(makePolygonID("nope"))).toBeNull();
    });

    it("getGroup returns group by ID", async () => {
      const g = makeGroup("g-1", null, "G");
      const { editor } = await createEditor([], [g]);
      expect(editor.getGroup(makeGroupID("g-1"))?.display_name).toBe("G");
    });

    it("getGroup returns null for non-existent ID", async () => {
      const { editor } = await createEditor();
      expect(editor.getGroup(makeGroupID("nope"))).toBeNull();
    });

    it("getChildren returns polygons and groups under a group", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygon("p-1", "g-1");
      const p2 = makePolygon("p-2", "g-1");
      const sub = makeGroup("g-2", "g-1");
      const { editor } = await createEditor([p1, p2], [g, sub]);
      const children = editor.getChildren(makeGroupID("g-1"));
      expect(children).toHaveLength(3);
    });

    it("getRoots returns root polygons and groups", async () => {
      const p = makePolygon("p-1");
      const g = makeGroup("g-1");
      const pChild = makePolygon("p-2", "g-1");
      const { editor } = await createEditor([p, pChild], [g]);
      const roots = editor.getRoots();
      expect(roots).toHaveLength(2); // p-1 and g-1
    });

    it("getAllPolygons returns all polygons", async () => {
      const { editor } = await createEditor([makePolygon("p-1"), makePolygon("p-2", "g-1")], [makeGroup("g-1")]);
      expect(editor.getAllPolygons()).toHaveLength(2);
    });

    it("getAllGroups returns all groups", async () => {
      const { editor } = await createEditor([], [makeGroup("g-1"), makeGroup("g-2", "g-1")]);
      expect(editor.getAllGroups()).toHaveLength(2);
    });

    it("getDescendantPolygons returns all nested polygons recursively", async () => {
      const g1 = makeGroup("g-1");
      const g2 = makeGroup("g-2", "g-1");
      const p1 = makePolygon("p-1", "g-1");
      const p2 = makePolygon("p-2", "g-2");
      const p3 = makePolygon("p-3", "g-2");
      const { editor } = await createEditor([p1, p2, p3], [g1, g2]);
      const descendants = editor.getDescendantPolygons(makeGroupID("g-1"));
      expect(descendants).toHaveLength(3);
    });
  });

  // ============================================================
  // Phase 2: Polygon CRUD
  // ============================================================

  describe("Phase 2: saveAsPolygon", () => {
    it("saves a closed draft as root polygon", async () => {
      const { editor, adapter } = await createEditor();
      const polygon = await editor.saveAsPolygon(triangleDraft, "My Polygon");
      expect(polygon.display_name).toBe("My Polygon");
      expect(polygon.parent_id).toBeNull();
      expect(polygon.geometry.type).toBe("Polygon");
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("throws DraftNotClosedError for open draft", async () => {
      const { editor } = await createEditor();
      const open: DraftShape = { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }], isClosed: false };
      await expect(editor.saveAsPolygon(open, "fail")).rejects.toThrow(DraftNotClosedError);
    });

    it("throws InvalidGeometryError for draft with too few vertices", async () => {
      const { editor } = await createEditor();
      const bad: DraftShape = { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }], isClosed: true };
      await expect(editor.saveAsPolygon(bad, "fail")).rejects.toThrow(InvalidGeometryError);
    });

    it("polygon is retrievable after save", async () => {
      const { editor } = await createEditor();
      const polygon = await editor.saveAsPolygon(triangleDraft, "Test");
      expect(editor.getPolygon(polygon.id)).not.toBeNull();
      expect(editor.getRoots()).toHaveLength(1);
    });
  });

  describe("Phase 2: renamePolygon", () => {
    it("renames a polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Old");
      await editor.renamePolygon(p.id, "New");
      expect(editor.getPolygon(p.id)?.display_name).toBe("New");
    });

    it("renames a non-root polygon (no restriction)", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1", "Old");
      const { editor } = await createEditor([p], [g]);
      await editor.renamePolygon(makePolygonID("p-1"), "New");
      expect(editor.getPolygon(makePolygonID("p-1"))?.display_name).toBe("New");
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(editor.renamePolygon(makePolygonID("nope"), "x")).rejects.toThrow(PolygonNotFoundError);
    });
  });

  describe("Phase 2: deletePolygon", () => {
    it("deletes a root polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Delete me");
      await editor.deletePolygon(p.id);
      expect(editor.getPolygon(p.id)).toBeNull();
    });

    it("deletes a non-root polygon", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygon("p-1", "g-1");
      const p2 = makePolygon("p-2", "g-1");
      const { editor } = await createEditor([p1, p2], [g]);
      await editor.deletePolygon(makePolygonID("p-1"));
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
    });

    it("throws GroupWouldBeEmptyError when deleting last child of group", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      await expect(editor.deletePolygon(makePolygonID("p-1"))).rejects.toThrow(GroupWouldBeEmptyError);
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(editor.deletePolygon(makePolygonID("nope"))).rejects.toThrow(PolygonNotFoundError);
    });
  });

  describe("Phase 2: loadPolygonToDraft", () => {
    it("loads a root polygon as DraftShape", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      const draft = editor.loadPolygonToDraft(p.id);
      expect(draft.isClosed).toBe(true);
      expect(draft.points.length).toBeGreaterThanOrEqual(3);
    });

    it("throws NotRootPolygonError for non-root polygon", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      expect(() => editor.loadPolygonToDraft(makePolygonID("p-1"))).toThrow(NotRootPolygonError);
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      expect(() => editor.loadPolygonToDraft(makePolygonID("nope"))).toThrow(PolygonNotFoundError);
    });
  });

  describe("Phase 2: updatePolygonGeometry", () => {
    it("updates geometry of a root polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      const updated = await editor.updatePolygonGeometry(p.id, squareDraft);
      expect(updated.geometry.coordinates[0]).toHaveLength(5); // square has 5 coords (closed)
    });

    it("throws NotRootPolygonError for non-root polygon", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      await expect(editor.updatePolygonGeometry(makePolygonID("p-1"), squareDraft)).rejects.toThrow(NotRootPolygonError);
    });
  });

  // ============================================================
  // Phase 3: Group Management
  // ============================================================

  describe("Phase 3: createGroup", () => {
    it("creates a group from root polygons", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("My Group", [p1.id, p2.id]);
      expect(group.display_name).toBe("My Group");
      expect(group.parent_id).toBeNull(); // parent of root nodes
      expect(editor.getChildren(group.id)).toHaveLength(2);
      // polygons are now children of the group
      expect(editor.getPolygon(p1.id)?.parent_id).toBe(group.id);
    });

    it("creates a group from children of an existing group", async () => {
      const g = makeGroup("g-parent");
      const p1 = makePolygon("p-1", "g-parent");
      const p2 = makePolygon("p-2", "g-parent");
      const p3 = makePolygon("p-3", "g-parent");
      const { editor } = await createEditor([p1, p2, p3], [g]);
      const sub = await editor.createGroup("Sub", [makePolygonID("p-1"), makePolygonID("p-2")]);
      expect(sub.parent_id).toBe(makeGroupID("g-parent"));
      expect(editor.getChildren(makeGroupID("g-parent"))).toHaveLength(2); // sub + p-3
    });

    it("throws MixedParentError when children have different parents", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const g = makeGroup("g-1");
      const p2 = makePolygon("p-2", "g-1");
      // Need to re-create editor with mixed parents
      const { editor: editor2 } = await createEditor(
        [makePolygon("p-1"), makePolygon("p-2", "g-1")],
        [makeGroup("g-1")],
      );
      await expect(
        editor2.createGroup("fail", [makePolygonID("p-1"), makePolygonID("p-2")]),
      ).rejects.toThrow(MixedParentError);
    });

    it("throws GroupWouldBeEmptyError with empty childIds", async () => {
      const { editor } = await createEditor();
      await expect(editor.createGroup("empty", [])).rejects.toThrow(GroupWouldBeEmptyError);
    });
  });

  describe("Phase 3: renameGroup", () => {
    it("renames a group", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("Old", [p1.id, p2.id]);
      await editor.renameGroup(group.id, "New");
      expect(editor.getGroup(group.id)?.display_name).toBe("New");
    });

    it("throws GroupNotFoundError for non-existent group", async () => {
      const { editor } = await createEditor();
      await expect(editor.renameGroup(makeGroupID("nope"), "x")).rejects.toThrow(GroupNotFoundError);
    });
  });

  describe("Phase 3: deleteGroup (cascade: false — ungroup)", () => {
    it("deletes group and promotes children to parent", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("G", [p1.id, p2.id]);
      await editor.deleteGroup(group.id);
      expect(editor.getGroup(group.id)).toBeNull();
      // Children promoted to root
      expect(editor.getPolygon(p1.id)?.parent_id).toBeNull();
      expect(editor.getPolygon(p2.id)?.parent_id).toBeNull();
    });

    it("promotes children to grandparent group", async () => {
      const gParent = makeGroup("g-parent");
      const gChild = makeGroup("g-child", "g-parent");
      const p1 = makePolygon("p-1", "g-child");
      const p2 = makePolygon("p-2", "g-child");
      const { editor } = await createEditor([p1, p2], [gParent, gChild]);
      await editor.deleteGroup(makeGroupID("g-child"));
      expect(editor.getPolygon(makePolygonID("p-1"))?.parent_id).toBe(makeGroupID("g-parent"));
    });
  });

  describe("Phase 3: deleteGroup (cascade: true)", () => {
    it("deletes group and all descendants", async () => {
      const g = makeGroup("g-1");
      const gSub = makeGroup("g-2", "g-1");
      const p1 = makePolygon("p-1", "g-1");
      const p2 = makePolygon("p-2", "g-2");
      const { editor } = await createEditor([p1, p2], [g, gSub]);
      await editor.deleteGroup(makeGroupID("g-1"), { cascade: true });
      expect(editor.getGroup(makeGroupID("g-1"))).toBeNull();
      expect(editor.getGroup(makeGroupID("g-2"))).toBeNull();
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      expect(editor.getPolygon(makePolygonID("p-2"))).toBeNull();
    });
  });

  describe("Phase 3: moveToGroup", () => {
    it("moves a root polygon into a group", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1");
      const p2 = makePolygon("p-2", "g-1"); // existing child so group isn't empty
      const { editor } = await createEditor([p, p2], [g]);
      await editor.moveToGroup(makePolygonID("p-1"), makeGroupID("g-1"));
      expect(editor.getPolygon(makePolygonID("p-1"))?.parent_id).toBe(makeGroupID("g-1"));
    });

    it("moves a polygon to root (null)", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygon("p-1", "g-1");
      const p2 = makePolygon("p-2", "g-1");
      const { editor } = await createEditor([p1, p2], [g]);
      await editor.moveToGroup(makePolygonID("p-1"), null);
      expect(editor.getPolygon(makePolygonID("p-1"))?.parent_id).toBeNull();
    });

    it("throws GroupWouldBeEmptyError when moving last child out", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      await expect(editor.moveToGroup(makePolygonID("p-1"), null)).rejects.toThrow(GroupWouldBeEmptyError);
    });

    it("throws SelfReferenceError when moving group into itself", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      await expect(editor.moveToGroup(makeGroupID("g-1"), makeGroupID("g-1"))).rejects.toThrow(SelfReferenceError);
    });

    it("throws CircularReferenceError when creating cycle", async () => {
      const g1 = makeGroup("g-1");
      const g2 = makeGroup("g-2", "g-1");
      const p = makePolygon("p-1", "g-2"); // so g-2 isn't empty
      const p2 = makePolygon("p-2", "g-1"); // so g-1 won't be empty
      const { editor } = await createEditor([p, p2], [g1, g2]);
      await expect(editor.moveToGroup(makeGroupID("g-1"), makeGroupID("g-2"))).rejects.toThrow(CircularReferenceError);
    });
  });

  describe("Phase 3: ungroupChildren", () => {
    it("promotes children to parent and removes group", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("G", [p1.id, p2.id]);
      await editor.ungroupChildren(group.id);
      expect(editor.getGroup(group.id)).toBeNull();
      expect(editor.getPolygon(p1.id)?.parent_id).toBeNull();
    });
  });

  // ============================================================
  // Phase 4: Draft Persistence + Undo/Redo
  // ============================================================

  describe("Phase 4: Draft Persistence", () => {
    it("saves, lists, loads, and deletes drafts", async () => {
      const { editor } = await createEditor();
      const draft: DraftShape = { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }], isClosed: false };

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
      expect(() => editor.loadDraftFromStorage(makeDraftID("nope"))).toThrow(DraftNotFoundError);
    });
  });

  describe("Phase 4: Undo/Redo", () => {
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

    it("undo reverts createGroup", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("G", [p1.id, p2.id]);
      await editor.undo();
      expect(editor.getGroup(group.id)).toBeNull();
      // Polygons should be back at root
      expect(editor.getPolygon(p1.id)?.parent_id).toBeNull();
    });

    it("undo reverts deleteGroup (cascade: false)", async () => {
      const { editor } = await createEditor();
      const p1 = await editor.saveAsPolygon(triangleDraft, "P1");
      const p2 = await editor.saveAsPolygon(squareDraft, "P2");
      const group = await editor.createGroup("G", [p1.id, p2.id]);
      await editor.deleteGroup(group.id);
      await editor.undo();
      expect(editor.getGroup(group.id)).not.toBeNull();
      expect(editor.getPolygon(p1.id)?.parent_id).toBe(group.id);
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
});
