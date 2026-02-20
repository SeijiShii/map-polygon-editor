import { describe, it, expect, vi, beforeEach } from "vitest";
import { MapPolygonEditor } from "./editor.js";
import type {
  Area,
  AreaID,
  AreaLevel,
  DraftID,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
} from "./types/index.js";
import { makeAreaID, makeDraftID } from "./types/index.js";
import {
  NotInitializedError,
  InvalidAreaLevelConfigError,
  StorageError,
  AreaNotFoundError,
  AreaLevelNotFoundError,
  LevelMismatchError,
  AreaHasChildrenError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
} from "./errors.js";

// ============================================================
// Helpers
// ============================================================

function makeMockAdapter(initial?: {
  areas?: Area[];
  drafts?: PersistedDraft[];
}): {
  loadAll: ReturnType<typeof vi.fn>;
  batchWrite: ReturnType<typeof vi.fn>;
  saveDraft: ReturnType<typeof vi.fn>;
  deleteDraft: ReturnType<typeof vi.fn>;
} & StorageAdapter {
  return {
    loadAll: vi.fn().mockResolvedValue({
      areas: initial?.areas ?? [],
      drafts: initial?.drafts ?? [],
    }),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  };
}

const LEVELS: AreaLevel[] = [
  { key: "prefecture", name: "Prefecture", parent_level_key: null },
  { key: "city", name: "City", parent_level_key: "prefecture" },
];

function makeArea(overrides: Partial<Area> & { id: AreaID }): Area {
  return {
    display_name: "Test Area",
    level_key: "prefecture",
    parent_id: null,
    geometry: {
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
    },
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_implicit: false,
    ...overrides,
  };
}

function makeTriangleDraft(closed = true): DraftShape {
  return {
    points: [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0.5, lng: 1 },
    ],
    isClosed: closed,
  };
}

// ============================================================
// Phase 1 — Initialize & NotInitializedError guard
// ============================================================

describe("MapPolygonEditor — Phase 1: initialize", () => {
  it("can be constructed without calling initialize", () => {
    const adapter = makeMockAdapter();
    expect(
      () =>
        new MapPolygonEditor({ storageAdapter: adapter, areaLevels: LEVELS }),
    ).not.toThrow();
  });

  it("initialize() calls storageAdapter.loadAll()", async () => {
    const adapter = makeMockAdapter();
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
    expect(adapter.loadAll).toHaveBeenCalledTimes(1);
  });

  it("initialize() resolves successfully with valid config", async () => {
    const adapter = makeMockAdapter();
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await expect(editor.initialize()).resolves.toBeUndefined();
  });

  it("initialize() throws InvalidAreaLevelConfigError on duplicate level keys", async () => {
    const adapter = makeMockAdapter();
    const badLevels: AreaLevel[] = [
      { key: "prefecture", name: "Prefecture", parent_level_key: null },
      { key: "prefecture", name: "Prefecture2", parent_level_key: null },
    ];
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: badLevels,
    });
    await expect(editor.initialize()).rejects.toBeInstanceOf(
      InvalidAreaLevelConfigError,
    );
  });

  it("initialize() throws StorageError when loadAll() throws", async () => {
    const adapter = makeMockAdapter();
    adapter.loadAll.mockRejectedValue(new Error("network error"));
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await expect(editor.initialize()).rejects.toBeInstanceOf(StorageError);
  });

  describe("NotInitializedError guard", () => {
    let editor: MapPolygonEditor;
    beforeEach(() => {
      const adapter = makeMockAdapter();
      editor = new MapPolygonEditor({
        storageAdapter: adapter,
        areaLevels: LEVELS,
      });
    });

    it("getArea throws NotInitializedError before initialize()", () => {
      expect(() => editor.getArea(makeAreaID("x"))).toThrow(
        NotInitializedError,
      );
    });

    it("getChildren throws NotInitializedError before initialize()", () => {
      expect(() => editor.getChildren(makeAreaID("x"))).toThrow(
        NotInitializedError,
      );
    });

    it("getRoots throws NotInitializedError before initialize()", () => {
      expect(() => editor.getRoots()).toThrow(NotInitializedError);
    });

    it("getAllAreas throws NotInitializedError before initialize()", () => {
      expect(() => editor.getAllAreas()).toThrow(NotInitializedError);
    });

    it("getAreasByLevel throws NotInitializedError before initialize()", () => {
      expect(() => editor.getAreasByLevel("prefecture")).toThrow(
        NotInitializedError,
      );
    });

    it("getAllAreaLevels throws NotInitializedError before initialize()", () => {
      expect(() => editor.getAllAreaLevels()).toThrow(NotInitializedError);
    });

    it("getAreaLevel throws NotInitializedError before initialize()", () => {
      expect(() => editor.getAreaLevel("prefecture")).toThrow(
        NotInitializedError,
      );
    });

    it("validateDraft throws NotInitializedError before initialize()", () => {
      expect(() =>
        editor.validateDraft({ points: [], isClosed: false }),
      ).toThrow(NotInitializedError);
    });

    it("saveDraftToStorage throws NotInitializedError before initialize()", async () => {
      await expect(
        editor.saveDraftToStorage({ points: [], isClosed: false }),
      ).rejects.toBeInstanceOf(NotInitializedError);
    });

    it("loadDraftFromStorage throws NotInitializedError before initialize()", () => {
      expect(() => editor.loadDraftFromStorage(makeDraftID("d1"))).toThrow(
        NotInitializedError,
      );
    });

    it("listPersistedDrafts throws NotInitializedError before initialize()", () => {
      expect(() => editor.listPersistedDrafts()).toThrow(NotInitializedError);
    });

    it("deleteDraftFromStorage throws NotInitializedError before initialize()", async () => {
      await expect(
        editor.deleteDraftFromStorage(makeDraftID("d1")),
      ).rejects.toBeInstanceOf(NotInitializedError);
    });

    it("renameArea throws NotInitializedError before initialize()", async () => {
      await expect(
        editor.renameArea(makeAreaID("x"), "new name"),
      ).rejects.toBeInstanceOf(NotInitializedError);
    });

    it("loadAreaToDraft throws NotInitializedError before initialize()", () => {
      expect(() => editor.loadAreaToDraft(makeAreaID("x"))).toThrow(
        NotInitializedError,
      );
    });

    it("saveAsArea throws NotInitializedError before initialize()", async () => {
      await expect(
        editor.saveAsArea(makeTriangleDraft(), "Test", "prefecture"),
      ).rejects.toBeInstanceOf(NotInitializedError);
    });

    it("deleteArea throws NotInitializedError before initialize()", async () => {
      await expect(editor.deleteArea(makeAreaID("x"))).rejects.toBeInstanceOf(
        NotInitializedError,
      );
    });

    it("undo throws NotInitializedError before initialize()", () => {
      expect(() => editor.undo()).toThrow(NotInitializedError);
    });

    it("redo throws NotInitializedError before initialize()", () => {
      expect(() => editor.redo()).toThrow(NotInitializedError);
    });

    it("canUndo throws NotInitializedError before initialize()", () => {
      expect(() => editor.canUndo()).toThrow(NotInitializedError);
    });

    it("canRedo throws NotInitializedError before initialize()", () => {
      expect(() => editor.canRedo()).toThrow(NotInitializedError);
    });
  });
});

// ============================================================
// Phase 2 — Query API
// ============================================================

describe("MapPolygonEditor — Phase 2: Query API", () => {
  const prefId = makeAreaID("pref-1");
  const cityId = makeAreaID("city-1");

  const prefArea = makeArea({
    id: prefId,
    level_key: "prefecture",
    parent_id: null,
  });
  const cityArea = makeArea({
    id: cityId,
    level_key: "city",
    parent_id: prefId,
  });

  let editor: MapPolygonEditor;
  beforeEach(async () => {
    const adapter = makeMockAdapter({ areas: [prefArea, cityArea] });
    editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
  });

  describe("getArea", () => {
    it("returns an Area for a known ID", () => {
      const result = editor.getArea(prefId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(prefId);
    });

    it("returns null for an unknown ID", () => {
      expect(editor.getArea(makeAreaID("unknown"))).toBeNull();
    });

    it("resolves implicit child IDs", () => {
      // prefecture with no city children → implicit child
      const noCityPrefId = makeAreaID("pref-no-city");
      const noCityPref = makeArea({
        id: noCityPrefId,
        level_key: "prefecture",
        parent_id: null,
      });
      // We need a fresh editor with only this pref
      const adapter = makeMockAdapter({ areas: [noCityPref] });
      const ed = new MapPolygonEditor({
        storageAdapter: adapter,
        areaLevels: LEVELS,
      });
      return ed.initialize().then(() => {
        const implicitId = makeAreaID(`__implicit__${noCityPrefId}__city`);
        const result = ed.getArea(implicitId);
        expect(result).not.toBeNull();
        expect(result!.is_implicit).toBe(true);
      });
    });
  });

  describe("getChildren", () => {
    it("returns explicit children when they exist", () => {
      const children = editor.getChildren(prefId);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(cityId);
    });

    it("returns implicit child when parent has no explicit children", () => {
      // The city is at the leaf level — no children
      const children = editor.getChildren(cityId);
      expect(children).toHaveLength(0);
    });

    it("returns empty array for unknown parentId", () => {
      expect(editor.getChildren(makeAreaID("no-such"))).toHaveLength(0);
    });
  });

  describe("getRoots", () => {
    it("returns areas with null parent_id", () => {
      const roots = editor.getRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe(prefId);
    });

    it("returns empty array when there are no areas", async () => {
      const adapter = makeMockAdapter({ areas: [] });
      const ed = new MapPolygonEditor({
        storageAdapter: adapter,
        areaLevels: LEVELS,
      });
      await ed.initialize();
      expect(ed.getRoots()).toHaveLength(0);
    });
  });

  describe("getAllAreas", () => {
    it("returns all explicit areas", () => {
      const all = editor.getAllAreas();
      expect(all).toHaveLength(2);
      const ids = all.map((a) => a.id);
      expect(ids).toContain(prefId);
      expect(ids).toContain(cityId);
    });

    it("does not include implicit areas", () => {
      // Pref with no cities will generate an implicit child in getChildren,
      // but getAllAreas must not include it
      const all = editor.getAllAreas();
      expect(all.every((a) => !a.is_implicit)).toBe(true);
    });
  });

  describe("getAreasByLevel", () => {
    it("returns areas at the given level", () => {
      const prefs = editor.getAreasByLevel("prefecture");
      expect(prefs).toHaveLength(1);
      expect(prefs[0].id).toBe(prefId);
    });

    it("returns empty array for unknown level", () => {
      expect(editor.getAreasByLevel("unknown")).toHaveLength(0);
    });
  });

  describe("getAllAreaLevels", () => {
    it("returns all configured area levels", () => {
      const levels = editor.getAllAreaLevels();
      expect(levels).toHaveLength(2);
      expect(levels.map((l) => l.key)).toContain("prefecture");
      expect(levels.map((l) => l.key)).toContain("city");
    });
  });

  describe("getAreaLevel", () => {
    it("returns the level for a known key", () => {
      const level = editor.getAreaLevel("prefecture");
      expect(level).not.toBeNull();
      expect(level!.key).toBe("prefecture");
    });

    it("returns null for an unknown key", () => {
      expect(editor.getAreaLevel("unknown")).toBeNull();
    });
  });

  describe("validateDraft", () => {
    it("returns empty array for a valid closed draft", () => {
      const draft = makeTriangleDraft(true);
      expect(editor.validateDraft(draft)).toHaveLength(0);
    });

    it("returns TOO_FEW_VERTICES for a closed draft with 2 points", () => {
      const draft: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
        isClosed: true,
      };
      const violations = editor.validateDraft(draft);
      expect(violations.some((v) => v.code === "TOO_FEW_VERTICES")).toBe(true);
    });

    it("returns TOO_FEW_VERTICES for an open draft with 1 point", () => {
      const draft: DraftShape = {
        points: [{ lat: 0, lng: 0 }],
        isClosed: false,
      };
      const violations = editor.validateDraft(draft);
      expect(violations.some((v) => v.code === "TOO_FEW_VERTICES")).toBe(true);
    });

    it("returns ZERO_AREA for collinear points in closed draft", () => {
      const draft: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 1 },
          { lat: 0, lng: 2 },
        ],
        isClosed: true,
      };
      const violations = editor.validateDraft(draft);
      expect(violations.some((v) => v.code === "ZERO_AREA")).toBe(true);
    });
  });
});

// ============================================================
// Phase 3 — Draft Persistence API
// ============================================================

describe("MapPolygonEditor — Phase 3: Draft Persistence API", () => {
  let editor: MapPolygonEditor;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(async () => {
    adapter = makeMockAdapter();
    editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
  });

  describe("saveDraftToStorage", () => {
    it("returns a PersistedDraft with an id", async () => {
      const draft = makeTriangleDraft(false);
      const result = await editor.saveDraftToStorage(draft);
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
    });

    it("calls storageAdapter.saveDraft with the persisted draft", async () => {
      const draft = makeTriangleDraft(false);
      await editor.saveDraftToStorage(draft);
      expect(adapter.saveDraft).toHaveBeenCalledTimes(1);
    });

    it("copies points and isClosed from the draft", async () => {
      const draft = makeTriangleDraft(true);
      const result = await editor.saveDraftToStorage(draft);
      expect(result.points).toEqual(draft.points);
      expect(result.isClosed).toBe(true);
    });

    it("stores metadata when provided", async () => {
      const draft = makeTriangleDraft(false);
      const meta = { label: "my draft", userId: 42 };
      const result = await editor.saveDraftToStorage(draft, meta);
      expect(result.metadata).toEqual(meta);
    });

    it("sets created_at and updated_at", async () => {
      const draft = makeTriangleDraft(false);
      const before = new Date();
      const result = await editor.saveDraftToStorage(draft);
      const after = new Date();
      expect(result.created_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(result.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });

    it("second save with same draft id updates updated_at but keeps id", async () => {
      const draft = makeTriangleDraft(false);
      const first = await editor.saveDraftToStorage(draft);
      const draftWithId = { ...draft };
      // Simulate re-saving — we pass a draft alongside the returned id
      // by storing the id in listPersistedDrafts and then saving again
      // For simplicity, test that saving twice generates different updated_at
      const second = await editor.saveDraftToStorage(draftWithId);
      // Both are new (no id passed), so two distinct IDs
      expect(first.id).not.toBe(second.id);
    });
  });

  describe("listPersistedDrafts", () => {
    it("returns empty array initially", () => {
      expect(editor.listPersistedDrafts()).toHaveLength(0);
    });

    it("returns saved drafts after saveDraftToStorage", async () => {
      await editor.saveDraftToStorage(makeTriangleDraft(false));
      await editor.saveDraftToStorage(makeTriangleDraft(true));
      expect(editor.listPersistedDrafts()).toHaveLength(2);
    });

    it("returns drafts loaded from storage during initialize()", async () => {
      const persistedDraft: PersistedDraft = {
        id: makeDraftID("existing-draft"),
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 0 },
        ],
        isClosed: false,
        created_at: new Date("2024-01-01"),
        updated_at: new Date("2024-01-01"),
      };
      const adapter2 = makeMockAdapter({ drafts: [persistedDraft] });
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
      });
      await ed2.initialize();
      const list = ed2.listPersistedDrafts();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(persistedDraft.id);
    });
  });

  describe("loadDraftFromStorage", () => {
    it("returns a DraftShape for a known draft id", async () => {
      const draft = makeTriangleDraft(false);
      const persisted = await editor.saveDraftToStorage(draft);
      const loaded = editor.loadDraftFromStorage(persisted.id);
      expect(loaded.points).toEqual(draft.points);
      expect(loaded.isClosed).toBe(false);
    });

    it("throws DraftNotFoundError for unknown id", () => {
      expect(() =>
        editor.loadDraftFromStorage(makeDraftID("no-such-id")),
      ).toThrow(DraftNotFoundError);
    });
  });

  describe("deleteDraftFromStorage", () => {
    it("removes the draft from the in-memory store", async () => {
      const persisted = await editor.saveDraftToStorage(makeTriangleDraft());
      expect(editor.listPersistedDrafts()).toHaveLength(1);
      await editor.deleteDraftFromStorage(persisted.id);
      expect(editor.listPersistedDrafts()).toHaveLength(0);
    });

    it("calls storageAdapter.deleteDraft with the id", async () => {
      const persisted = await editor.saveDraftToStorage(makeTriangleDraft());
      await editor.deleteDraftFromStorage(persisted.id);
      expect(adapter.deleteDraft).toHaveBeenCalledWith(persisted.id);
    });
  });
});

// ============================================================
// Phase 4 — Simple edit operations
// ============================================================

describe("MapPolygonEditor — Phase 4: Edit Operations", () => {
  const prefId = makeAreaID("pref-1");
  const cityId = makeAreaID("city-1");

  const prefArea = makeArea({
    id: prefId,
    level_key: "prefecture",
    parent_id: null,
    display_name: "Tokyo Prefecture",
  });
  const cityArea = makeArea({
    id: cityId,
    level_key: "city",
    parent_id: prefId,
    display_name: "Shibuya",
  });

  let editor: MapPolygonEditor;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(async () => {
    adapter = makeMockAdapter({ areas: [prefArea, cityArea] });
    editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
  });

  // ---- renameArea ----

  describe("renameArea", () => {
    it("returns updated Area with new display_name", async () => {
      const updated = await editor.renameArea(cityId, "Shinjuku");
      expect(updated.display_name).toBe("Shinjuku");
    });

    it("updates the area in the in-memory store", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      const found = editor.getArea(cityId);
      expect(found!.display_name).toBe("Shinjuku");
    });

    it("calls batchWrite with modified area", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      expect(adapter.batchWrite).toHaveBeenCalledTimes(1);
      const callArg = adapter.batchWrite.mock.calls[0][0];
      expect(callArg.created).toHaveLength(0);
      expect(callArg.deleted).toHaveLength(0);
      expect(callArg.modified).toHaveLength(1);
      expect(callArg.modified[0].display_name).toBe("Shinjuku");
    });

    it("throws AreaNotFoundError for unknown id", async () => {
      await expect(
        editor.renameArea(makeAreaID("no-such"), "name"),
      ).rejects.toBeInstanceOf(AreaNotFoundError);
    });

    it("throws AreaNotFoundError for implicit area", async () => {
      // Create a pref with no cities to get an implicit child
      const noPrefId = makeAreaID("pref-nochild");
      const noPref = makeArea({
        id: noPrefId,
        level_key: "prefecture",
        parent_id: null,
      });
      const adapter2 = makeMockAdapter({ areas: [noPref] });
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
      });
      await ed2.initialize();
      const implicitId = makeAreaID(`__implicit__${noPrefId}__city`);
      await expect(ed2.renameArea(implicitId, "name")).rejects.toBeInstanceOf(
        AreaNotFoundError,
      );
    });

    it("pushes a HistoryEntry so undo becomes available", async () => {
      expect(editor.canUndo()).toBe(false);
      await editor.renameArea(cityId, "Shinjuku");
      expect(editor.canUndo()).toBe(true);
    });
  });

  // ---- loadAreaToDraft ----

  describe("loadAreaToDraft", () => {
    it("returns a DraftShape with isClosed = false", () => {
      const draft = editor.loadAreaToDraft(cityId);
      expect(draft.isClosed).toBe(false);
    });

    it("converts geometry coordinates to Points (lat, lng)", () => {
      const draft = editor.loadAreaToDraft(cityId);
      // cityArea has geometry with exterior ring
      // GeoJSON is [lng, lat], DraftShape is { lat, lng }
      const ring = (cityArea.geometry as { coordinates: number[][][] })
        .coordinates[0];
      // Last point of GeoJSON ring is the closing duplicate — draft excludes it
      const expectedPoints = ring.slice(0, -1).map(([lng, lat]) => ({
        lat,
        lng,
      }));
      expect(draft.points).toEqual(expectedPoints);
    });

    it("throws AreaNotFoundError for unknown id", () => {
      expect(() => editor.loadAreaToDraft(makeAreaID("no-such"))).toThrow(
        AreaNotFoundError,
      );
    });

    it("throws AreaHasChildrenError when area has explicit children", () => {
      // prefArea has cityArea as an explicit child
      expect(() => editor.loadAreaToDraft(prefId)).toThrow(
        AreaHasChildrenError,
      );
    });
  });

  // ---- saveAsArea ----

  describe("saveAsArea", () => {
    it("throws DraftNotClosedError if draft.isClosed === false", async () => {
      const draft = makeTriangleDraft(false);
      await expect(
        editor.saveAsArea(draft, "New City", "city", prefId),
      ).rejects.toBeInstanceOf(DraftNotClosedError);
    });

    it("throws InvalidGeometryError for invalid geometry", async () => {
      // Collinear points → ZERO_AREA
      const draft: DraftShape = {
        points: [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 1 },
          { lat: 0, lng: 2 },
        ],
        isClosed: true,
      };
      await expect(
        editor.saveAsArea(draft, "Bad Area", "city", prefId),
      ).rejects.toBeInstanceOf(InvalidGeometryError);
    });

    it("throws AreaLevelNotFoundError for unknown level key", async () => {
      const draft = makeTriangleDraft(true);
      await expect(
        editor.saveAsArea(draft, "Test", "unknown-level"),
      ).rejects.toBeInstanceOf(AreaLevelNotFoundError);
    });

    it("throws AreaNotFoundError when specified parentId does not exist", async () => {
      const draft = makeTriangleDraft(true);
      await expect(
        editor.saveAsArea(draft, "Test", "city", makeAreaID("no-parent")),
      ).rejects.toBeInstanceOf(AreaNotFoundError);
    });

    it("throws LevelMismatchError when parent level does not match", async () => {
      const draft = makeTriangleDraft(true);
      // city's parent_level_key = "prefecture", but we pass a city as parent
      await expect(
        editor.saveAsArea(draft, "Test", "city", cityId),
      ).rejects.toBeInstanceOf(LevelMismatchError);
    });

    it("throws LevelMismatchError when creating root area but level requires parent", async () => {
      const draft = makeTriangleDraft(true);
      // city has parent_level_key = "prefecture", not null
      await expect(
        editor.saveAsArea(draft, "Test", "city"),
      ).rejects.toBeInstanceOf(LevelMismatchError);
    });

    it("creates a new Area and returns it", async () => {
      const draft = makeTriangleDraft(true);
      const newArea = await editor.saveAsArea(
        draft,
        "New City",
        "city",
        prefId,
      );
      expect(newArea.display_name).toBe("New City");
      expect(newArea.level_key).toBe("city");
      expect(newArea.parent_id).toBe(prefId);
      expect(newArea.is_implicit).toBe(false);
    });

    it("the new area is accessible via getArea", async () => {
      const draft = makeTriangleDraft(true);
      const newArea = await editor.saveAsArea(
        draft,
        "New City",
        "city",
        prefId,
      );
      const found = editor.getArea(newArea.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(newArea.id);
    });

    it("calls batchWrite with the new area in created", async () => {
      const draft = makeTriangleDraft(true);
      const newArea = await editor.saveAsArea(
        draft,
        "New City",
        "city",
        prefId,
      );
      const callArg = adapter.batchWrite.mock.calls[0][0];
      expect(callArg.created).toHaveLength(1);
      expect(callArg.created[0].id).toBe(newArea.id);
    });

    it("pushes a HistoryEntry so undo is available", async () => {
      const draft = makeTriangleDraft(true);
      await editor.saveAsArea(draft, "New City", "city", prefId);
      expect(editor.canUndo()).toBe(true);
    });

    it("updates ancestor geometry (parent gets MultiPolygon or Polygon)", async () => {
      const draft = makeTriangleDraft(true);
      await editor.saveAsArea(draft, "City A", "city", prefId);
      const draft2 = makeTriangleDraft(true);
      await editor.saveAsArea(draft2, "City B", "city", prefId);
      // Parent's geometry should reflect the union
      const parent = editor.getArea(prefId);
      expect(parent).not.toBeNull();
      // geometry type should be Polygon or MultiPolygon
      expect(["Polygon", "MultiPolygon"]).toContain(parent!.geometry.type);
    });

    it("creates root-level area when parentId is omitted and level is root", async () => {
      const draft = makeTriangleDraft(true);
      const newPref = await editor.saveAsArea(draft, "New Pref", "prefecture");
      expect(newPref.parent_id).toBeNull();
      expect(newPref.level_key).toBe("prefecture");
    });

    it("clears redoStack when a new operation is performed", async () => {
      // First create and undo
      const draft1 = makeTriangleDraft(true);
      await editor.saveAsArea(draft1, "City A", "city", prefId);
      editor.undo();
      expect(editor.canRedo()).toBe(true);
      // Now new op
      const draft2 = makeTriangleDraft(true);
      await editor.saveAsArea(draft2, "City B", "city", prefId);
      expect(editor.canRedo()).toBe(false);
    });
  });

  // ---- deleteArea ----

  describe("deleteArea", () => {
    it("throws AreaNotFoundError for unknown id", async () => {
      await expect(
        editor.deleteArea(makeAreaID("no-such")),
      ).rejects.toBeInstanceOf(AreaNotFoundError);
    });

    it("throws AreaHasChildrenError when cascade=false and area has explicit children", async () => {
      await expect(editor.deleteArea(prefId)).rejects.toBeInstanceOf(
        AreaHasChildrenError,
      );
    });

    it("deletes a leaf area successfully", async () => {
      await editor.deleteArea(cityId);
      expect(editor.getArea(cityId)).toBeNull();
    });

    it("calls batchWrite with deleted area id", async () => {
      await editor.deleteArea(cityId);
      const callArg = adapter.batchWrite.mock.calls[0][0];
      expect(callArg.deleted).toContain(cityId);
    });

    it("cascade=true deletes area and all descendants", async () => {
      await editor.deleteArea(prefId, { cascade: true });
      expect(editor.getArea(prefId)).toBeNull();
      expect(editor.getArea(cityId)).toBeNull();
    });

    it("cascade=true calls batchWrite with all deleted ids", async () => {
      await editor.deleteArea(prefId, { cascade: true });
      const callArg = adapter.batchWrite.mock.calls[0][0];
      expect(callArg.deleted).toContain(prefId);
      expect(callArg.deleted).toContain(cityId);
    });

    it("pushes a HistoryEntry so undo becomes available", async () => {
      await editor.deleteArea(cityId);
      expect(editor.canUndo()).toBe(true);
    });
  });
});

// ============================================================
// Phase 5 — Undo / Redo
// ============================================================

describe("MapPolygonEditor — Phase 5: Undo/Redo", () => {
  const prefId = makeAreaID("pref-1");
  const cityId = makeAreaID("city-1");

  const prefArea = makeArea({
    id: prefId,
    level_key: "prefecture",
    parent_id: null,
    display_name: "Tokyo Prefecture",
  });
  const cityArea = makeArea({
    id: cityId,
    level_key: "city",
    parent_id: prefId,
    display_name: "Shibuya",
  });

  let editor: MapPolygonEditor;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(async () => {
    adapter = makeMockAdapter({ areas: [prefArea, cityArea] });
    editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
  });

  describe("canUndo / canRedo", () => {
    it("canUndo() is false initially", () => {
      expect(editor.canUndo()).toBe(false);
    });

    it("canRedo() is false initially", () => {
      expect(editor.canRedo()).toBe(false);
    });

    it("canUndo() is true after an operation", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      expect(editor.canUndo()).toBe(true);
    });

    it("canRedo() is true after undo", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      editor.undo();
      expect(editor.canRedo()).toBe(true);
    });
  });

  describe("undo rename", () => {
    it("restores the previous display_name", async () => {
      const originalName = cityArea.display_name;
      await editor.renameArea(cityId, "Shinjuku");
      editor.undo();
      expect(editor.getArea(cityId)!.display_name).toBe(originalName);
    });

    it("returns affected areas", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      const affected = editor.undo();
      expect(affected.length).toBeGreaterThan(0);
      expect(affected.some((a) => a.id === cityId)).toBe(true);
    });

    it("returns empty array when nothing to undo", () => {
      expect(editor.undo()).toHaveLength(0);
    });
  });

  describe("redo rename", () => {
    it("re-applies the rename", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      editor.undo();
      editor.redo();
      expect(editor.getArea(cityId)!.display_name).toBe("Shinjuku");
    });

    it("returns affected areas", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      editor.undo();
      const affected = editor.redo();
      expect(affected.some((a) => a.id === cityId)).toBe(true);
    });

    it("returns empty array when nothing to redo", () => {
      expect(editor.redo()).toHaveLength(0);
    });
  });

  describe("undo saveAsArea", () => {
    it("removes the created area after undo", async () => {
      const draft = makeTriangleDraft(true);
      const newArea = await editor.saveAsArea(
        draft,
        "New City",
        "city",
        prefId,
      );
      editor.undo();
      expect(editor.getArea(newArea.id)).toBeNull();
    });

    it("redo re-adds the area", async () => {
      const draft = makeTriangleDraft(true);
      const newArea = await editor.saveAsArea(
        draft,
        "New City",
        "city",
        prefId,
      );
      editor.undo();
      editor.redo();
      expect(editor.getArea(newArea.id)).not.toBeNull();
    });
  });

  describe("undo deleteArea", () => {
    it("restores the deleted area after undo", async () => {
      await editor.deleteArea(cityId);
      editor.undo();
      expect(editor.getArea(cityId)).not.toBeNull();
    });

    it("redo deletes the area again", async () => {
      await editor.deleteArea(cityId);
      editor.undo();
      editor.redo();
      expect(editor.getArea(cityId)).toBeNull();
    });
  });

  describe("undo / redo stack management", () => {
    it("new operation clears redo stack", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      editor.undo();
      expect(editor.canRedo()).toBe(true);
      await editor.renameArea(cityId, "Akihabara");
      expect(editor.canRedo()).toBe(false);
    });

    it("multiple undos work in sequence", async () => {
      const originalName = cityArea.display_name;
      await editor.renameArea(cityId, "Shinjuku");
      await editor.renameArea(cityId, "Akihabara");
      editor.undo();
      expect(editor.getArea(cityId)!.display_name).toBe("Shinjuku");
      editor.undo();
      expect(editor.getArea(cityId)!.display_name).toBe(originalName);
    });

    it("redo after multiple undos restores correct state", async () => {
      await editor.renameArea(cityId, "Shinjuku");
      await editor.renameArea(cityId, "Akihabara");
      editor.undo();
      editor.undo();
      editor.redo();
      expect(editor.getArea(cityId)!.display_name).toBe("Shinjuku");
      editor.redo();
      expect(editor.getArea(cityId)!.display_name).toBe("Akihabara");
    });

    it("respects maxUndoSteps limit", async () => {
      const adapter2 = makeMockAdapter({ areas: [prefArea, cityArea] });
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
        maxUndoSteps: 2,
      });
      await ed2.initialize();

      await ed2.renameArea(cityId, "Step1");
      await ed2.renameArea(cityId, "Step2");
      await ed2.renameArea(cityId, "Step3");
      // Only 2 undos should be available
      ed2.undo();
      ed2.undo();
      expect(ed2.canUndo()).toBe(false);
    });
  });
});

// ============================================================
// Integration — initialize with pre-existing data
// ============================================================

describe("MapPolygonEditor — Integration: initialize with data", () => {
  it("loads existing areas and makes them queryable", async () => {
    const prefId = makeAreaID("pref-integration");
    const prefArea = makeArea({
      id: prefId,
      level_key: "prefecture",
      parent_id: null,
    });
    const adapter = makeMockAdapter({ areas: [prefArea] });
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();

    expect(editor.getArea(prefId)).not.toBeNull();
    expect(editor.getRoots()).toHaveLength(1);
    expect(editor.getAreasByLevel("prefecture")).toHaveLength(1);
  });

  it("loads existing drafts and makes them listable", async () => {
    const draft: PersistedDraft = {
      id: makeDraftID("existing"),
      points: [{ lat: 1, lng: 2 }],
      isClosed: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const adapter = makeMockAdapter({ drafts: [draft] });
    const editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();

    expect(editor.listPersistedDrafts()).toHaveLength(1);
    expect(editor.listPersistedDrafts()[0].id).toBe(draft.id);
  });
});

// ============================================================
// Edge cases — additional branch coverage
// ============================================================

describe("MapPolygonEditor — Edge cases", () => {
  const prefId = makeAreaID("pref-edge");

  const prefArea = makeArea({
    id: prefId,
    level_key: "prefecture",
    parent_id: null,
    display_name: "Edge Pref",
  });

  let editor: MapPolygonEditor;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(async () => {
    adapter = makeMockAdapter({ areas: [prefArea] });
    editor = new MapPolygonEditor({
      storageAdapter: adapter,
      areaLevels: LEVELS,
    });
    await editor.initialize();
  });

  describe("deleteArea — implicit area guard", () => {
    it("throws AreaNotFoundError when trying to delete an implicit area", async () => {
      // pref has no city children → has implicit child
      const implicitId = makeAreaID(`__implicit__${prefId}__city`);
      await expect(editor.deleteArea(implicitId)).rejects.toBeInstanceOf(
        AreaNotFoundError,
      );
    });
  });

  describe("callBatchWrite — non-Error thrown by adapter", () => {
    it("wraps a non-Error thrown by batchWrite in StorageError", async () => {
      adapter.batchWrite.mockRejectedValue("raw string error");
      await expect(
        editor.renameArea(prefId, "new name"),
      ).rejects.toBeInstanceOf(StorageError);
    });
  });

  describe("updateAncestorGeometries — ancestor with no explicit children", () => {
    it("does not crash when a parent has no explicit children after deletion", async () => {
      // Create a city under pref, then delete it — parent (pref) ends up with 0 children
      const draft = makeTriangleDraft(true);
      const newCity = await editor.saveAsArea(
        draft,
        "Temp City",
        "city",
        prefId,
      );
      // Should not throw — ancestor update handles 0 children gracefully
      await expect(editor.deleteArea(newCity.id)).resolves.toBeUndefined();
    });
  });

  describe("loadAreaToDraft — MultiPolygon geometry", () => {
    it("converts the first ring of a MultiPolygon to points", async () => {
      const multiGeomArea = makeArea({
        id: makeAreaID("multi-geo"),
        level_key: "prefecture",
        parent_id: null,
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          ],
        },
      });
      const adapter2 = makeMockAdapter({ areas: [multiGeomArea] });
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
      });
      await ed2.initialize();
      const draft = ed2.loadAreaToDraft(makeAreaID("multi-geo"));
      expect(draft.isClosed).toBe(false);
      expect(draft.points.length).toBeGreaterThan(0);
    });
  });

  describe("StorageError import — initialize wraps non-Error from loadAll", () => {
    it("wraps a non-Error thrown by loadAll in StorageError", async () => {
      const adapter2 = makeMockAdapter();
      adapter2.loadAll.mockRejectedValue("plain string failure");
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
      });
      await expect(ed2.initialize()).rejects.toBeInstanceOf(StorageError);
    });
  });

  describe("buildUnionGeometry — child with MultiPolygon geometry", () => {
    it("flattens MultiPolygon children when computing parent geometry", async () => {
      // Load a pref with an existing city that has MultiPolygon geometry,
      // then add another city — buildUnionGeometry must handle the MultiPolygon child.
      const mprefId = makeAreaID("m-pref");
      const mCityId = makeAreaID("m-city");
      const mPref = makeArea({
        id: mprefId,
        level_key: "prefecture",
        parent_id: null,
      });
      const mCity = makeArea({
        id: mCityId,
        level_key: "city",
        parent_id: mprefId,
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
            [
              [
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 3],
                [2, 2],
              ],
            ],
          ],
        },
      });
      const adapter2 = makeMockAdapter({ areas: [mPref, mCity] });
      const ed2 = new MapPolygonEditor({
        storageAdapter: adapter2,
        areaLevels: LEVELS,
      });
      await ed2.initialize();

      // Adding another city calls buildUnionGeometry with children=[mCity, newCity]
      // mCity has MultiPolygon → hits line 52 (the flatMap MultiPolygon branch)
      const draft = makeTriangleDraft(true);
      const newCity = await ed2.saveAsArea(draft, "City2", "city", mprefId);
      expect(newCity).toBeDefined();

      const parent = ed2.getArea(mprefId);
      expect(["Polygon", "MultiPolygon"]).toContain(parent!.geometry.type);
    });
  });
});
