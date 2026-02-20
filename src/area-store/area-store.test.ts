import { describe, it, expect, beforeEach } from "vitest";
import { AreaStore } from "./area-store.js";
import { AreaLevelStore } from "../area-level/area-level-store.js";
import type { Area, AreaLevel } from "../types/index.js";
import { makeAreaID } from "../types/index.js";

// ---- shared fixtures ----

const japanLevels: AreaLevel[] = [
  { key: "country", name: "国", parent_level_key: null },
  { key: "prefecture", name: "都道府県", parent_level_key: "country" },
  { key: "city", name: "市区町村", parent_level_key: "prefecture" },
  { key: "block", name: "丁目", parent_level_key: "city" },
];

const levelStore = new AreaLevelStore(japanLevels);

const now = new Date("2024-01-01T00:00:00Z");

const squarePoly = {
  type: "Polygon" as const,
  coordinates: [
    [
      [139.0, 35.0],
      [140.0, 35.0],
      [140.0, 36.0],
      [139.0, 36.0],
      [139.0, 35.0],
    ],
  ],
};

function makeArea(
  id: string,
  levelKey: string,
  parentId: string | null,
  displayName = "",
): Area {
  return {
    id: makeAreaID(id),
    display_name: displayName,
    level_key: levelKey,
    parent_id: parentId !== null ? makeAreaID(parentId) : null,
    geometry: squarePoly,
    created_at: now,
    updated_at: now,
    is_implicit: false,
  };
}

// Build a small hierarchy:
//   japan (country)
//     └─ tokyo (prefecture)
//          ├─ shibuya (city)
//          │    └─ shibuya1 (block)
//          └─ shinjuku (city)
//               └─ shinjuku1 (block)

const japan = makeArea("japan", "country", null, "日本");
const tokyo = makeArea("tokyo", "prefecture", "japan", "東京都");
const shibuya = makeArea("shibuya", "city", "tokyo", "渋谷区");
const shinjuku = makeArea("shinjuku", "city", "tokyo", "新宿区");
const shibuya1 = makeArea("shibuya1", "block", "shibuya", "渋谷一丁目");
const shinjuku1 = makeArea("shinjuku1", "block", "shinjuku", "新宿一丁目");

const allAreas = [japan, tokyo, shibuya, shinjuku, shibuya1, shinjuku1];

describe("AreaStore", () => {
  describe("construction", () => {
    it("creates an empty store", () => {
      const store = new AreaStore(levelStore, []);
      expect(store.getAllAreas()).toEqual([]);
    });

    it("creates a store with pre-loaded areas", () => {
      const store = new AreaStore(levelStore, allAreas);
      expect(store.getAllAreas()).toHaveLength(6);
    });
  });

  describe("getArea(id)", () => {
    let store: AreaStore;
    beforeEach(() => {
      store = new AreaStore(levelStore, allAreas);
    });

    it("returns an area by ID", () => {
      const area = store.getArea(makeAreaID("tokyo"));
      expect(area).not.toBeNull();
      expect(area?.display_name).toBe("東京都");
      expect(area?.level_key).toBe("prefecture");
    });

    it("returns null for an unknown ID", () => {
      expect(store.getArea(makeAreaID("nonexistent"))).toBeNull();
    });

    it("returns null from an empty store", () => {
      const empty = new AreaStore(levelStore, []);
      expect(empty.getArea(makeAreaID("any"))).toBeNull();
    });

    it("returns different areas by different IDs", () => {
      const s = store.getArea(makeAreaID("shibuya"));
      const sj = store.getArea(makeAreaID("shinjuku"));
      expect(s?.display_name).toBe("渋谷区");
      expect(sj?.display_name).toBe("新宿区");
    });
  });

  describe("getRoots()", () => {
    it("returns only areas with parent_id = null", () => {
      const store = new AreaStore(levelStore, allAreas);
      const roots = store.getRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]?.id).toBe(makeAreaID("japan"));
    });

    it("returns empty array when there are no root areas", () => {
      // All areas have parents (hypothetical — shouldn't happen in practice)
      const noRoots = [tokyo, shibuya];
      const store = new AreaStore(levelStore, noRoots);
      expect(store.getRoots()).toEqual([]);
    });

    it("returns multiple roots when multiple areas have null parent_id", () => {
      const japan2 = makeArea("japan2", "country", null, "日本2");
      const usa = makeArea("usa", "country", null, "USA");
      const store = new AreaStore(levelStore, [japan2, usa]);
      const roots = store.getRoots();
      expect(roots).toHaveLength(2);
      const ids = roots.map((r) => r.id);
      expect(ids).toContain(makeAreaID("japan2"));
      expect(ids).toContain(makeAreaID("usa"));
    });
  });

  describe("getAllAreas()", () => {
    it("returns all explicit (non-implicit) areas", () => {
      const store = new AreaStore(levelStore, allAreas);
      const all = store.getAllAreas();
      expect(all).toHaveLength(6);
    });

    it("does NOT include implicit areas", () => {
      const implicitArea: Area = {
        ...shibuya,
        id: makeAreaID("__implicit__tokyo__city"),
        is_implicit: true,
        display_name: "",
      };
      const store = new AreaStore(levelStore, [...allAreas, implicitArea]);
      const all = store.getAllAreas();
      // implicit area must be excluded
      expect(all.every((a) => !a.is_implicit)).toBe(true);
      expect(all).toHaveLength(6);
    });

    it("returns a copy — mutations do not affect the store", () => {
      const store = new AreaStore(levelStore, allAreas);
      const all = store.getAllAreas();
      all.push(makeArea("extra", "block", "shibuya", "Extra"));
      expect(store.getAllAreas()).toHaveLength(6);
    });
  });

  describe("getChildren(parentId)", () => {
    let store: AreaStore;
    beforeEach(() => {
      store = new AreaStore(levelStore, allAreas);
    });

    it("returns explicit children of tokyo (prefecture level)", () => {
      const children = store.getChildren(makeAreaID("tokyo"));
      expect(children).toHaveLength(2);
      const ids = children.map((c) => c.id);
      expect(ids).toContain(makeAreaID("shibuya"));
      expect(ids).toContain(makeAreaID("shinjuku"));
    });

    it("returns explicit children of shibuya (city level)", () => {
      const children = store.getChildren(makeAreaID("shibuya"));
      expect(children).toHaveLength(1);
      expect(children[0]?.id).toBe(makeAreaID("shibuya1"));
    });

    it("returns an empty array for a leaf area with no children", () => {
      // shibuya1 is a block (leaf) and has no children
      const children = store.getChildren(makeAreaID("shibuya1"));
      // leaf areas with no children return empty (no implicit children for leaf)
      expect(children).toEqual([]);
    });

    it("returns empty array for an unknown parentId", () => {
      expect(store.getChildren(makeAreaID("nonexistent"))).toEqual([]);
    });

    // ---- IMPLICIT CHILDREN ----
    // When a non-leaf area has NO explicit children, getChildren returns a
    // single implicit child with is_implicit: true.

    it("returns an implicit child when a non-leaf area has no explicit children", () => {
      // kyoto is a prefecture with no children
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const storeWithKyoto = new AreaStore(levelStore, [japan, tokyo, kyoto]);
      const children = storeWithKyoto.getChildren(makeAreaID("kyoto"));
      expect(children).toHaveLength(1);
      expect(children[0]?.is_implicit).toBe(true);
      expect(children[0]?.level_key).toBe("city"); // child level of prefecture
      expect(children[0]?.parent_id).toBe(makeAreaID("kyoto"));
    });

    it("implicit child has deterministic ID based on parent and child level", () => {
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const storeWithKyoto = new AreaStore(levelStore, [japan, tokyo, kyoto]);
      const children = storeWithKyoto.getChildren(makeAreaID("kyoto"));
      // Deterministic virtual ID
      expect(children[0]?.id).toBe(makeAreaID("__implicit__kyoto__city"));
    });

    it("implicit child inherits geometry from parent", () => {
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const storeWithKyoto = new AreaStore(levelStore, [japan, tokyo, kyoto]);
      const children = storeWithKyoto.getChildren(makeAreaID("kyoto"));
      expect(children[0]?.geometry).toEqual(kyoto.geometry);
    });

    it("implicit child has empty display_name", () => {
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const storeWithKyoto = new AreaStore(levelStore, [japan, tokyo, kyoto]);
      const children = storeWithKyoto.getChildren(makeAreaID("kyoto"));
      expect(children[0]?.display_name).toBe("");
    });

    it("does NOT return implicit child when area has explicit children", () => {
      // tokyo has explicit children (shibuya, shinjuku)
      const children = store.getChildren(makeAreaID("tokyo"));
      expect(children.every((c) => !c.is_implicit)).toBe(true);
    });

    it("returns implicit child chain: country with no children returns implicit prefecture", () => {
      // Only japan exists, no prefectures
      const soloStore = new AreaStore(levelStore, [japan]);
      const children = soloStore.getChildren(makeAreaID("japan"));
      expect(children).toHaveLength(1);
      expect(children[0]?.is_implicit).toBe(true);
      expect(children[0]?.level_key).toBe("prefecture");
    });

    it("leaf level area (block) returns no children even without explicit children", () => {
      // shibuya1 is a block (leaf level) — no child level exists
      const children = store.getChildren(makeAreaID("shibuya1"));
      expect(children).toEqual([]);
    });
  });

  describe("getAreasByLevel(levelKey)", () => {
    let store: AreaStore;
    beforeEach(() => {
      store = new AreaStore(levelStore, allAreas);
    });

    it("returns all areas at the prefecture level", () => {
      const areas = store.getAreasByLevel("prefecture");
      expect(areas).toHaveLength(1);
      expect(areas[0]?.id).toBe(makeAreaID("tokyo"));
    });

    it("returns all areas at the city level", () => {
      const areas = store.getAreasByLevel("city");
      expect(areas).toHaveLength(2);
      const ids = areas.map((a) => a.id);
      expect(ids).toContain(makeAreaID("shibuya"));
      expect(ids).toContain(makeAreaID("shinjuku"));
    });

    it("returns all areas at the block level", () => {
      const areas = store.getAreasByLevel("block");
      expect(areas).toHaveLength(2);
    });

    it("returns empty array for an unknown level key", () => {
      expect(store.getAreasByLevel("nonexistent")).toEqual([]);
    });

    it("does not include implicit areas in level results", () => {
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const storeWithKyoto = new AreaStore(levelStore, [japan, tokyo, kyoto]);
      const areas = storeWithKyoto.getAreasByLevel("city");
      // city level should have no explicit areas
      expect(areas).toEqual([]);
    });
  });

  describe("addArea(area)", () => {
    it("adds an area and makes it retrievable", () => {
      const store = new AreaStore(levelStore, []);
      store.addArea(japan);
      expect(store.getArea(makeAreaID("japan"))).toEqual(japan);
    });

    it("getAllAreas reflects added area", () => {
      const store = new AreaStore(levelStore, []);
      store.addArea(japan);
      store.addArea(tokyo);
      expect(store.getAllAreas()).toHaveLength(2);
    });

    it("getChildren reflects added children", () => {
      const store = new AreaStore(levelStore, [japan, tokyo]);
      store.addArea(shibuya);
      const children = store.getChildren(makeAreaID("tokyo"));
      expect(children.some((c) => c.id === makeAreaID("shibuya"))).toBe(true);
    });
  });

  describe("updateArea(area)", () => {
    it("updates an existing area", () => {
      const store = new AreaStore(levelStore, allAreas);
      const updated: Area = { ...tokyo, display_name: "東京" };
      store.updateArea(updated);
      expect(store.getArea(makeAreaID("tokyo"))?.display_name).toBe("東京");
    });

    it("does not affect other areas when updating one", () => {
      const store = new AreaStore(levelStore, allAreas);
      const updated: Area = { ...tokyo, display_name: "東京" };
      store.updateArea(updated);
      expect(store.getArea(makeAreaID("shibuya"))?.display_name).toBe("渋谷区");
    });
  });

  describe("deleteArea(id)", () => {
    it("removes an area from the store", () => {
      const store = new AreaStore(levelStore, allAreas);
      store.deleteArea(makeAreaID("shibuya1"));
      expect(store.getArea(makeAreaID("shibuya1"))).toBeNull();
    });

    it("getAllAreas no longer includes the deleted area", () => {
      const store = new AreaStore(levelStore, allAreas);
      store.deleteArea(makeAreaID("shibuya1"));
      expect(store.getAllAreas()).toHaveLength(5);
    });

    it("is a no-op for unknown IDs", () => {
      const store = new AreaStore(levelStore, allAreas);
      expect(() => store.deleteArea(makeAreaID("unknown"))).not.toThrow();
      expect(store.getAllAreas()).toHaveLength(6);
    });
  });

  describe("getArea with implicit area ID", () => {
    it("returns the implicit child area when queried by virtual ID", () => {
      const kyoto = makeArea("kyoto", "prefecture", "japan", "京都府");
      const store = new AreaStore(levelStore, [japan, kyoto]);
      const implicitId = makeAreaID("__implicit__kyoto__city");
      const area = store.getArea(implicitId);
      expect(area).not.toBeNull();
      expect(area?.is_implicit).toBe(true);
      expect(area?.level_key).toBe("city");
      expect(area?.parent_id).toBe(makeAreaID("kyoto"));
    });

    it("returns null for an implicit-style ID with unknown parent", () => {
      const store = new AreaStore(levelStore, allAreas);
      const implicitId = makeAreaID("__implicit__unknown__city");
      expect(store.getArea(implicitId)).toBeNull();
    });
  });
});
