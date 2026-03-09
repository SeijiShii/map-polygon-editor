import { describe, it, expect, beforeEach } from "vitest";
import { PolygonStore } from "./polygon-store.js";
import type { MapPolygon, GeoJSONPolygon } from "../types/index.js";
import { makePolygonID, makeGroupID } from "../types/index.js";

const geom: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
};

function makePolygon(
  id: string,
  parentId: string | null = null,
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

describe("PolygonStore", () => {
  let store: PolygonStore;

  beforeEach(() => {
    store = new PolygonStore();
  });

  describe("add and get", () => {
    it("adds and retrieves a polygon by ID", () => {
      const p = makePolygon("p-1");
      store.add(p);
      expect(store.get(makePolygonID("p-1"))).toEqual(p);
    });

    it("returns null for non-existent ID", () => {
      expect(store.get(makePolygonID("nope"))).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all polygons", () => {
      store.add(makePolygon("p-1"));
      store.add(makePolygon("p-2"));
      expect(store.getAll()).toHaveLength(2);
    });

    it("returns empty array when store is empty", () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe("getByParent", () => {
    it("returns children of a given group", () => {
      store.add(makePolygon("p-1", "g-1"));
      store.add(makePolygon("p-2", "g-1"));
      store.add(makePolygon("p-3", "g-2"));
      const children = store.getByParent(makeGroupID("g-1"));
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(makePolygonID("p-1"));
      expect(children.map((c) => c.id)).toContain(makePolygonID("p-2"));
    });

    it("returns empty array for group with no polygon children", () => {
      expect(store.getByParent(makeGroupID("g-999"))).toEqual([]);
    });
  });

  describe("getRoots", () => {
    it("returns polygons with null parent_id", () => {
      store.add(makePolygon("p-1", null));
      store.add(makePolygon("p-2", "g-1"));
      store.add(makePolygon("p-3", null));
      const roots = store.getRoots();
      expect(roots).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates an existing polygon", () => {
      store.add(makePolygon("p-1", null, "old"));
      const updated = { ...makePolygon("p-1", null, "new") };
      store.update(updated);
      expect(store.get(makePolygonID("p-1"))?.display_name).toBe("new");
    });

    it("updates parent index when parent_id changes", () => {
      store.add(makePolygon("p-1", "g-1"));
      const moved = { ...makePolygon("p-1", "g-2") };
      store.update(moved);
      expect(store.getByParent(makeGroupID("g-1"))).toHaveLength(0);
      expect(store.getByParent(makeGroupID("g-2"))).toHaveLength(1);
    });

    it("handles move from group to root", () => {
      store.add(makePolygon("p-1", "g-1"));
      const moved = { ...makePolygon("p-1", null) };
      store.update(moved);
      expect(store.getRoots()).toHaveLength(1);
      expect(store.getByParent(makeGroupID("g-1"))).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("removes a polygon", () => {
      store.add(makePolygon("p-1"));
      store.delete(makePolygonID("p-1"));
      expect(store.get(makePolygonID("p-1"))).toBeNull();
    });

    it("removes from parent index", () => {
      store.add(makePolygon("p-1", "g-1"));
      store.delete(makePolygonID("p-1"));
      expect(store.getByParent(makeGroupID("g-1"))).toHaveLength(0);
    });

    it("is no-op for non-existent polygon", () => {
      expect(() => store.delete(makePolygonID("nope"))).not.toThrow();
    });
  });

  describe("count", () => {
    it("returns the number of polygons", () => {
      expect(store.count()).toBe(0);
      store.add(makePolygon("p-1"));
      store.add(makePolygon("p-2"));
      expect(store.count()).toBe(2);
      store.delete(makePolygonID("p-1"));
      expect(store.count()).toBe(1);
    });
  });
});
