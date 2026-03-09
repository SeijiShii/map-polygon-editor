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

function makePolygon(
  id: string,
  parentId: string | null = null,
  name = "",
): MapPolygon {
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

function makeGroup(
  id: string,
  parentId: string | null = null,
  name = "",
): Group {
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
      expect(editor.getPolygon(makePolygonID("p-1"))?.display_name).toBe(
        "Test",
      );
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
      const { editor } = await createEditor(
        [makePolygon("p-1"), makePolygon("p-2", "g-1")],
        [makeGroup("g-1")],
      );
      expect(editor.getAllPolygons()).toHaveLength(2);
    });

    it("getAllGroups returns all groups", async () => {
      const { editor } = await createEditor(
        [],
        [makeGroup("g-1"), makeGroup("g-2", "g-1")],
      );
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
      await expect(
        editor.renamePolygon(makePolygonID("nope"), "x"),
      ).rejects.toThrow(PolygonNotFoundError);
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
      await expect(editor.deletePolygon(makePolygonID("p-1"))).rejects.toThrow(
        GroupWouldBeEmptyError,
      );
    });

    it("throws PolygonNotFoundError for non-existent polygon", async () => {
      const { editor } = await createEditor();
      await expect(editor.deletePolygon(makePolygonID("nope"))).rejects.toThrow(
        PolygonNotFoundError,
      );
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

    it("loads a non-root polygon as DraftShape (no root restriction)", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      const draft = editor.loadPolygonToDraft(makePolygonID("p-1"));
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

  describe("Phase 2: updatePolygonGeometry", () => {
    it("updates geometry of a root polygon", async () => {
      const { editor } = await createEditor();
      const p = await editor.saveAsPolygon(triangleDraft, "Test");
      const updated = await editor.updatePolygonGeometry(p.id, squareDraft);
      expect(updated.geometry.coordinates[0]).toHaveLength(5); // square has 5 coords (closed)
    });

    it("updates geometry of a non-root polygon (no root restriction)", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      const updated = await editor.updatePolygonGeometry(
        makePolygonID("p-1"),
        squareDraft,
      );
      expect(updated.geometry.coordinates[0]).toHaveLength(5);
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
      const sub = await editor.createGroup("Sub", [
        makePolygonID("p-1"),
        makePolygonID("p-2"),
      ]);
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
        editor2.createGroup("fail", [
          makePolygonID("p-1"),
          makePolygonID("p-2"),
        ]),
      ).rejects.toThrow(MixedParentError);
    });

    it("throws GroupWouldBeEmptyError with empty childIds", async () => {
      const { editor } = await createEditor();
      await expect(editor.createGroup("empty", [])).rejects.toThrow(
        GroupWouldBeEmptyError,
      );
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
      await expect(
        editor.renameGroup(makeGroupID("nope"), "x"),
      ).rejects.toThrow(GroupNotFoundError);
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
      expect(editor.getPolygon(makePolygonID("p-1"))?.parent_id).toBe(
        makeGroupID("g-parent"),
      );
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
      expect(editor.getPolygon(makePolygonID("p-1"))?.parent_id).toBe(
        makeGroupID("g-1"),
      );
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
      await expect(
        editor.moveToGroup(makePolygonID("p-1"), null),
      ).rejects.toThrow(GroupWouldBeEmptyError);
    });

    it("throws SelfReferenceError when moving group into itself", async () => {
      const g = makeGroup("g-1");
      const p = makePolygon("p-1", "g-1");
      const { editor } = await createEditor([p], [g]);
      await expect(
        editor.moveToGroup(makeGroupID("g-1"), makeGroupID("g-1")),
      ).rejects.toThrow(SelfReferenceError);
    });

    it("throws CircularReferenceError when creating cycle", async () => {
      const g1 = makeGroup("g-1");
      const g2 = makeGroup("g-2", "g-1");
      const p = makePolygon("p-1", "g-2"); // so g-2 isn't empty
      const p2 = makePolygon("p-2", "g-1"); // so g-1 won't be empty
      const { editor } = await createEditor([p, p2], [g1, g2]);
      await expect(
        editor.moveToGroup(makeGroupID("g-1"), makeGroupID("g-2")),
      ).rejects.toThrow(CircularReferenceError);
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

  // ============================================================
  // Phase 5: getGroupPolygons (Union calculation)
  // ============================================================

  describe("Phase 5: getGroupPolygons", () => {
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

    function makePolygonWithGeom(
      id: string,
      parentId: string | null,
      geom: GeoJSONPolygon,
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: "",
        parent_id: parentId ? makeGroupID(parentId) : null,
        created_at: now,
        updated_at: now,
      };
    }

    it("throws GroupNotFoundError for non-existent group", async () => {
      const { editor } = await createEditor();
      expect(() => editor.getGroupPolygons(makeGroupID("nope"))).toThrow(
        GroupNotFoundError,
      );
    });

    it("returns empty array for group with no descendant polygons", async () => {
      // Group with a sub-group but no actual polygons
      const g1 = makeGroup("g-1");
      const g2 = makeGroup("g-2", "g-1");
      const p = makePolygon("p-1"); // root polygon, not in g-1
      const { editor } = await createEditor([p], [g1, g2]);
      const result = editor.getGroupPolygons(makeGroupID("g-1"));
      expect(result).toEqual([]);
    });

    it("returns single polygon's geometry when group has one child", async () => {
      const g = makeGroup("g-1");
      const p = makePolygonWithGeom("p-1", "g-1", leftSquare);
      const { editor } = await createEditor([p], [g]);
      const result = editor.getGroupPolygons(makeGroupID("g-1"));
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("Polygon");
    });

    it("returns union of adjacent polygons as single polygon", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygonWithGeom("p-1", "g-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", "g-1", rightSquare);
      const { editor } = await createEditor([p1, p2], [g]);
      const result = editor.getGroupPolygons(makeGroupID("g-1"));
      // Adjacent squares merge into one polygon
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("Polygon");
    });

    it("returns multiple polygons when descendants are disjoint", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygonWithGeom("p-1", "g-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", "g-1", separateSquare);
      const { editor } = await createEditor([p1, p2], [g]);
      const result = editor.getGroupPolygons(makeGroupID("g-1"));
      // Disjoint polygons → MultiPolygon → split into 2 GeoJSON Polygons
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("Polygon");
      expect(result[1].type).toBe("Polygon");
    });

    it("includes deeply nested descendant polygons in union", async () => {
      const g1 = makeGroup("g-1");
      const g2 = makeGroup("g-2", "g-1");
      const p1 = makePolygonWithGeom("p-1", "g-1", leftSquare);
      const p2 = makePolygonWithGeom("p-2", "g-2", rightSquare);
      const { editor } = await createEditor([p1, p2], [g1, g2]);
      const result = editor.getGroupPolygons(makeGroupID("g-1"));
      // p1 is direct child, p2 is grandchild — both included in union
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("Polygon");
    });

    it("throws NotInitializedError before initialize()", () => {
      const adapter = createMockAdapter();
      const editor = new MapPolygonEditor({ storageAdapter: adapter });
      expect(() => editor.getGroupPolygons(makeGroupID("g-1"))).toThrow(
        NotInitializedError,
      );
    });
  });

  // ============================================================
  // Phase 6: sharedEdgeMove (coordinate hash index)
  // ============================================================

  describe("Phase 6: sharedEdgeMove", () => {
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

    function makePolygonWithGeom(
      id: string,
      parentId: string | null,
      geom: GeoJSONPolygon,
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: "",
        parent_id: parentId ? makeGroupID(parentId) : null,
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
      const p = makePolygonWithGeom("p-1", null, leftSquare);
      const { editor } = await createEditor([p]);
      // Move vertex 1 (which is [1,0] in GeoJSON → index 1) to [1.5, 0]
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
      const p1 = makePolygonWithGeom("p-1", null, leftSquare);
      const p2 = makePolygonWithGeom("p-2", null, rightSquare);
      const { editor } = await createEditor([p1, p2]);
      // leftSquare vertex 1 is [1,0], rightSquare vertex 0 is [1,0] — shared
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

    it("moves shared vertices across group boundaries", async () => {
      const g = makeGroup("g-1");
      const p1 = makePolygonWithGeom("p-1", null, leftSquare);
      const p2 = makePolygonWithGeom("p-2", "g-1", rightSquare);
      const { editor } = await createEditor([p1, p2], [g]);
      // p-1 is root, p-2 is in group g-1. Vertex [1,0] is shared.
      const result = await editor.sharedEdgeMove(
        makePolygonID("p-1"),
        1,
        0,
        1.5,
      );
      expect(result).toHaveLength(2);
      const u2 = editor.getPolygon(makePolygonID("p-2"))!;
      expect(u2.geometry.coordinates[0][0]).toEqual([1.5, 0]);
    });

    it("updates duplicate coordinates within same polygon (closing vertex)", async () => {
      const p = makePolygonWithGeom("p-1", null, leftSquare);
      const { editor } = await createEditor([p]);
      // leftSquare: [0,0],[1,0],[1,1],[0,1],[0,0] — vertex 0 and 4 share [0,0]
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
      const p = makePolygonWithGeom("p-1", null, leftSquare);
      const { editor, adapter } = await createEditor([p]);
      await editor.sharedEdgeMove(makePolygonID("p-1"), 1, 0, 1.5);
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", null, leftSquare);
      const { editor } = await createEditor([p]);
      await editor.sharedEdgeMove(makePolygonID("p-1"), 1, 0, 1.5);
      await editor.undo();
      const reverted = editor.getPolygon(makePolygonID("p-1"))!;
      expect(reverted.geometry.coordinates[0][1]).toEqual([1, 0]);
    });

    it("does not affect polygons without matching coordinates", async () => {
      const p1 = makePolygonWithGeom("p-1", null, leftSquare);
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
      const p2 = makePolygonWithGeom("p-2", null, farSquare);
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

      const p1 = makePolygonWithGeom("p-1", null, leftSquareExact);
      const p2 = makePolygonWithGeom("p-2", null, rightSquareSlightlyOff);
      const { editor } = await createEditor([p1, p2]);

      // Move p-1 vertex 1 [1,0] — p-2 vertex 0 [1+1e-9, 1e-10] should also move
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
  // Phase 7: splitPolygon (cut line intersection)
  // ============================================================

  describe("Phase 7: splitPolygon", () => {
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
      parentId: string | null,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        parent_id: parentId ? makeGroupID(parentId) : null,
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
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
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
      expect(result.polygons).toHaveLength(2);
      // Original polygon should be deleted
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
      // Two new polygons should exist
      for (const poly of result.polygons) {
        expect(editor.getPolygon(poly.id)).not.toBeNull();
      }
    });

    it("wraps results in group by default (wrapInGroup: true)", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
      const { editor } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      expect(result.group).toBeDefined();
      expect(result.group!.display_name).toBe("Square"); // inherits original name
      // Both result polygons should be children of the group
      for (const poly of result.polygons) {
        expect(poly.parent_id).toBe(result.group!.id);
      }
    });

    it("places results at original parent when wrapInGroup: false", async () => {
      const g = makeGroup("g-1");
      const p = makePolygonWithGeom("p-1", "g-1", unitSquare);
      const { editor } = await createEditor([p], [g]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      const result = await editor.splitPolygon(makePolygonID("p-1"), cutLine, {
        wrapInGroup: false,
      });
      expect(result.group).toBeUndefined();
      for (const poly of result.polygons) {
        expect(poly.parent_id).toBe(makeGroupID("g-1"));
      }
    });

    it("does nothing when cut line has 0 intersections", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare);
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
      expect(result.polygons).toHaveLength(0);
      expect(result.group).toBeUndefined();
      // Original polygon should be unchanged
      expect(editor.getPolygon(makePolygonID("p-1"))).not.toBeNull();
    });

    it("inserts vertex when cut line has exactly 1 intersection", async () => {
      // Unit square: [0,0],[1,0],[1,1],[0,1],[0,0] — 5 coords (4 unique + closing)
      const p = makePolygonWithGeom("p-1", null, unitSquare);
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
      // No split — returns empty polygons
      expect(result.polygons).toHaveLength(0);
      expect(result.group).toBeUndefined();

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
      const p = makePolygonWithGeom("p-1", null, unitSquare);
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
      const p = makePolygonWithGeom("p-1", null, unitSquare);
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
      // Should remain unchanged — vertex already exists
      expect(updated.geometry.coordinates[0]).toHaveLength(5);
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
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
      const p = makePolygonWithGeom("p-1", null, unitSquare);
      const { editor, adapter } = await createEditor([p]);

      const cutLine: DraftShape = {
        points: [
          { lat: -1, lng: 0.5 },
          { lat: 2, lng: 0.5 },
        ],
        isClosed: false,
      };

      await editor.splitPolygon(makePolygonID("p-1"), cutLine);
      // batchWrite called: once for initialize (no), and once for split
      expect(adapter.batchWrite).toHaveBeenCalled();
    });

    it("trims whiskers and splits correctly when cut line bends outside polygon", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Cut line with bent whiskers:
      // Starts at (-1,-1), enters polygon at (0.5,0), exits at (0.5,1), ends at (2,2)
      // Effective cut is vertical at lng=0.5
      // But raw first→last direction is diagonal (-1,-1)→(2,2)
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
      expect(result.polygons).toHaveLength(2);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();

      // The effective cut should be vertical at lng=0.5
      // One polygon should have all lng ≤ 0.5+ε, the other all lng ≥ 0.5-ε
      const eps = 0.01;
      const maxLngs = result.polygons.map((p) =>
        Math.max(...p.geometry.coordinates[0].map((c) => c[0])),
      );
      const minLngs = result.polygons.map((p) =>
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
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
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
      expect(result.polygons).toHaveLength(2);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();
    });

    it("splits into 3 pieces with 4 intersections (two horizontal cuts)", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
      const { editor } = await createEditor([p]);

      // Cut line that makes two horizontal cuts through the unit square:
      // Enter left edge at (0, 0.3), cross to right edge at (1, 0.3),
      // go outside, come back at (1, 0.7), cross to left edge at (0, 0.7)
      // Result: 3 horizontal strips
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
      expect(result.polygons).toHaveLength(3);
      expect(editor.getPolygon(makePolygonID("p-1"))).toBeNull();

      // Each strip should span the full width (lng 0 to 1)
      for (const poly of result.polygons) {
        const lngs = poly.geometry.coordinates[0].map((c) => c[0]);
        expect(Math.min(...lngs)).toBeLessThanOrEqual(0.01);
        expect(Math.max(...lngs)).toBeGreaterThanOrEqual(0.99);
      }

      // Verify the 3 strips have distinct lat ranges
      const latMids = result.polygons.map((poly) => {
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
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Square");
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
  // Phase 8: carveInnerPolygon
  // ============================================================

  describe("Phase 8: carveInnerPolygon", () => {
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
      parentId: string | null,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        parent_id: parentId ? makeGroupID(parentId) : null,
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
      const p = makePolygonWithGeom("p-1", null, bigSquare, "Big");
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

    it("wraps results in group by default", async () => {
      const p = makePolygonWithGeom("p-1", null, bigSquare, "Big");
      const { editor } = await createEditor([p]);

      const loop = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
        { lat: 0, lng: 0 },
      ];

      const result = await editor.carveInnerPolygon(makePolygonID("p-1"), loop);
      expect(result.group).toBeDefined();
      expect(result.group!.display_name).toBe("Big");
      expect(result.outer.parent_id).toBe(result.group!.id);
      expect(result.inner.parent_id).toBe(result.group!.id);
    });

    it("places at original parent when wrapInGroup: false", async () => {
      const g = makeGroup("g-1");
      const p = makePolygonWithGeom("p-1", "g-1", bigSquare);
      const { editor } = await createEditor([p], [g]);

      const loop = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
        { lat: 0, lng: 0 },
      ];

      const result = await editor.carveInnerPolygon(
        makePolygonID("p-1"),
        loop,
        { wrapInGroup: false },
      );
      expect(result.group).toBeUndefined();
      expect(result.outer.parent_id).toBe(makeGroupID("g-1"));
      expect(result.inner.parent_id).toBe(makeGroupID("g-1"));
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", null, bigSquare);
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
  // Phase 9: punchHole
  // ============================================================

  describe("Phase 9: punchHole", () => {
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
      parentId: string | null,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        parent_id: parentId ? makeGroupID(parentId) : null,
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
      const p = makePolygonWithGeom("p-1", null, bigSquare, "Big");
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

    it("wraps results in group by default", async () => {
      const p = makePolygonWithGeom("p-1", null, bigSquare, "Big");
      const { editor } = await createEditor([p]);

      const hole = [
        { lat: 2, lng: 2 },
        { lat: 2, lng: 4 },
        { lat: 4, lng: 4 },
        { lat: 4, lng: 2 },
        { lat: 2, lng: 2 },
      ];

      const result = await editor.punchHole(makePolygonID("p-1"), hole);
      expect(result.group).toBeDefined();
      expect(result.group!.display_name).toBe("Big");
      expect(result.donut.parent_id).toBe(result.group!.id);
      expect(result.inner.parent_id).toBe(result.group!.id);
    });

    it("places at original parent when wrapInGroup: false", async () => {
      const g = makeGroup("g-1");
      const p = makePolygonWithGeom("p-1", "g-1", bigSquare);
      const { editor } = await createEditor([p], [g]);

      const hole = [
        { lat: 2, lng: 2 },
        { lat: 2, lng: 4 },
        { lat: 4, lng: 4 },
        { lat: 4, lng: 2 },
        { lat: 2, lng: 2 },
      ];

      const result = await editor.punchHole(makePolygonID("p-1"), hole, {
        wrapInGroup: false,
      });
      expect(result.group).toBeUndefined();
      expect(result.donut.parent_id).toBe(makeGroupID("g-1"));
      expect(result.inner.parent_id).toBe(makeGroupID("g-1"));
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", null, bigSquare);
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
  // Phase 10: expandWithPolygon
  // ============================================================

  describe("Phase 10: expandWithPolygon", () => {
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
      parentId: string | null,
      geom: GeoJSONPolygon,
      name = "",
    ): MapPolygon {
      const now = new Date();
      return {
        id: makePolygonID(id),
        geometry: geom,
        display_name: name,
        parent_id: parentId ? makeGroupID(parentId) : null,
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
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Original");
      const { editor } = await createEditor([p]);

      // Outer path: from [1,0] along outside to [1,1]
      // Forms a new square adjacent to the right edge
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

    it("wraps results in group by default", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare, "Original");
      const { editor } = await createEditor([p]);

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
      expect(result.group).toBeDefined();
      expect(result.group!.display_name).toBe("Original");
      expect(result.original.parent_id).toBe(result.group!.id);
      expect(result.added.parent_id).toBe(result.group!.id);
    });

    it("places at original parent when wrapInGroup: false", async () => {
      const g = makeGroup("g-1");
      const p = makePolygonWithGeom("p-1", "g-1", unitSquare);
      const { editor } = await createEditor([p], [g]);

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
        { wrapInGroup: false },
      );
      expect(result.group).toBeUndefined();
      expect(result.original.parent_id).toBe(makeGroupID("g-1"));
      expect(result.added.parent_id).toBe(makeGroupID("g-1"));
    });

    it("is undoable", async () => {
      const p = makePolygonWithGeom("p-1", null, unitSquare);
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
});
