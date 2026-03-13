import { describe, it, expect, beforeEach } from "vitest";
import { PolygonStore } from "./polygon-store.js";
import type { MapPolygon, GeoJSONPolygon } from "../types/index.js";
import { makePolygonID } from "../types/index.js";

const geom: GeoJSONPolygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
};

function makePolygon(id: string, name = ""): MapPolygon {
  const now = new Date();
  return {
    id: makePolygonID(id),
    geometry: geom,
    display_name: name,
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

  describe("update", () => {
    it("updates an existing polygon", () => {
      store.add(makePolygon("p-1", "old"));
      const updated = { ...makePolygon("p-1", "new") };
      store.update(updated);
      expect(store.get(makePolygonID("p-1"))?.display_name).toBe("new");
    });
  });

  describe("delete", () => {
    it("removes a polygon", () => {
      store.add(makePolygon("p-1"));
      store.delete(makePolygonID("p-1"));
      expect(store.get(makePolygonID("p-1"))).toBeNull();
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
