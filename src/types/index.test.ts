import { describe, it, expect } from "vitest";
import type {
  PolygonID,
  GroupID,
  DraftID,
  GeoJSONPolygon,
  MapPolygon,
  Group,
  Point,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
  ChangeSet,
  HistoryEntry,
  GeometryViolation,
  GeometryViolationCode,
} from "./index.js";
import {
  makePolygonID,
  makeGroupID,
  makeDraftID,
} from "./index.js";

describe("types", () => {
  describe("branded ID helpers", () => {
    it("makePolygonID creates a PolygonID", () => {
      const id = makePolygonID("p-1");
      expect(id).toBe("p-1");
      // Type-level: id satisfies PolygonID
      const _check: PolygonID = id;
      expect(_check).toBe("p-1");
    });

    it("makeGroupID creates a GroupID", () => {
      const id = makeGroupID("g-1");
      expect(id).toBe("g-1");
      const _check: GroupID = id;
      expect(_check).toBe("g-1");
    });

    it("makeDraftID creates a DraftID", () => {
      const id = makeDraftID("d-1");
      expect(id).toBe("d-1");
      const _check: DraftID = id;
      expect(_check).toBe("d-1");
    });
  });

  describe("MapPolygon type structure", () => {
    it("has all required fields", () => {
      const now = new Date();
      const polygon: MapPolygon = {
        id: makePolygonID("p-1"),
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        display_name: "Test Polygon",
        parent_id: null,
        created_at: now,
        updated_at: now,
      };
      expect(polygon.id).toBe("p-1");
      expect(polygon.geometry.type).toBe("Polygon");
      expect(polygon.display_name).toBe("Test Polygon");
      expect(polygon.parent_id).toBeNull();
      expect(polygon.metadata).toBeUndefined();
    });

    it("supports optional metadata", () => {
      const now = new Date();
      const polygon: MapPolygon = {
        id: makePolygonID("p-2"),
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        display_name: "",
        parent_id: makeGroupID("g-1"),
        metadata: { source: "import", originalId: "ext-123" },
        created_at: now,
        updated_at: now,
      };
      expect(polygon.metadata?.source).toBe("import");
      expect(polygon.parent_id).toBe("g-1");
    });
  });

  describe("Group type structure", () => {
    it("has all required fields", () => {
      const now = new Date();
      const group: Group = {
        id: makeGroupID("g-1"),
        display_name: "Tokyo",
        parent_id: null,
        created_at: now,
        updated_at: now,
      };
      expect(group.id).toBe("g-1");
      expect(group.display_name).toBe("Tokyo");
      expect(group.parent_id).toBeNull();
    });

    it("supports nested groups via parent_id", () => {
      const now = new Date();
      const group: Group = {
        id: makeGroupID("g-2"),
        display_name: "Shibuya",
        parent_id: makeGroupID("g-1"),
        metadata: { level: "city" },
        created_at: now,
        updated_at: now,
      };
      expect(group.parent_id).toBe("g-1");
    });
  });

  describe("GeoJSONPolygon type", () => {
    it("represents simple polygon", () => {
      const geom: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      };
      expect(geom.type).toBe("Polygon");
      expect(geom.coordinates).toHaveLength(1);
    });

    it("represents donut polygon with interior ring", () => {
      const geom: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],       // exterior
          [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]],             // hole
        ],
      };
      expect(geom.coordinates).toHaveLength(2);
    });
  });

  describe("ChangeSet type", () => {
    it("has separate polygon and group fields", () => {
      const cs: ChangeSet = {
        createdPolygons: [],
        deletedPolygonIds: [],
        modifiedPolygons: [],
        createdGroups: [],
        deletedGroupIds: [],
        modifiedGroups: [],
      };
      expect(cs.createdPolygons).toEqual([]);
      expect(cs.deletedGroupIds).toEqual([]);
    });
  });

  describe("HistoryEntry type", () => {
    it("has separate polygon and group fields", () => {
      const entry: HistoryEntry = {
        createdPolygons: [],
        deletedPolygons: [],
        modifiedPolygons: [],
        createdGroups: [],
        deletedGroups: [],
        modifiedGroups: [],
      };
      expect(entry.createdPolygons).toEqual([]);
      expect(entry.modifiedGroups).toEqual([]);
    });
  });

  describe("StorageAdapter interface", () => {
    it("loadAll returns polygons, groups, and drafts", async () => {
      const adapter: StorageAdapter = {
        loadAll: async () => ({ polygons: [], groups: [], drafts: [] }),
        batchWrite: async () => {},
        saveDraft: async () => {},
        deleteDraft: async () => {},
      };
      const result = await adapter.loadAll();
      expect(result).toHaveProperty("polygons");
      expect(result).toHaveProperty("groups");
      expect(result).toHaveProperty("drafts");
    });
  });

  describe("DraftShape and Point (unchanged from v1)", () => {
    it("DraftShape has points and isClosed", () => {
      const draft: DraftShape = { points: [{ lat: 0, lng: 0 }], isClosed: false };
      expect(draft.points).toHaveLength(1);
      expect(draft.isClosed).toBe(false);
    });
  });

  describe("GeometryViolation codes", () => {
    it("supports all violation codes", () => {
      const codes: GeometryViolationCode[] = [
        "TOO_FEW_VERTICES",
        "SELF_INTERSECTION",
        "ZERO_AREA",
      ];
      expect(codes).toHaveLength(3);
    });
  });
});
