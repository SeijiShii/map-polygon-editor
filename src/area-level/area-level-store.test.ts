import { describe, it, expect } from "vitest";
import { AreaLevelStore } from "./area-level-store.js";
import { InvalidAreaLevelConfigError } from "./area-level-validator.js";
import type { AreaLevel } from "../types/index.js";

const japanLevels: AreaLevel[] = [
  { key: "country", name: "国", parent_level_key: null },
  { key: "prefecture", name: "都道府県", parent_level_key: "country" },
  { key: "city", name: "市区町村", parent_level_key: "prefecture" },
  { key: "block", name: "丁目", parent_level_key: "city" },
];

describe("AreaLevelStore", () => {
  describe("construction", () => {
    it("creates a store from valid levels without throwing", () => {
      expect(() => new AreaLevelStore(japanLevels)).not.toThrow();
    });

    it("throws InvalidAreaLevelConfigError for invalid config", () => {
      const bad: AreaLevel[] = [
        { key: "a", name: "A", parent_level_key: "nonexistent" },
      ];
      expect(() => new AreaLevelStore(bad)).toThrow(InvalidAreaLevelConfigError);
    });
  });

  describe("getAllAreaLevels()", () => {
    it("returns all configured levels", () => {
      const store = new AreaLevelStore(japanLevels);
      const all = store.getAllAreaLevels();
      expect(all).toHaveLength(4);
    });

    it("returns the same level objects in insertion order", () => {
      const store = new AreaLevelStore(japanLevels);
      const all = store.getAllAreaLevels();
      expect(all.map((l) => l.key)).toEqual([
        "country",
        "prefecture",
        "city",
        "block",
      ]);
    });

    it("returns an empty array when constructed with no levels", () => {
      const store = new AreaLevelStore([]);
      expect(store.getAllAreaLevels()).toEqual([]);
    });

    it("returns a copy — mutations do not affect the store", () => {
      const store = new AreaLevelStore(japanLevels);
      const all = store.getAllAreaLevels();
      all.push({ key: "extra", name: "Extra", parent_level_key: null });
      expect(store.getAllAreaLevels()).toHaveLength(4);
    });
  });

  describe("getAreaLevel(key)", () => {
    it("returns the matching AreaLevel by key", () => {
      const store = new AreaLevelStore(japanLevels);
      const level = store.getAreaLevel("prefecture");
      expect(level).not.toBeNull();
      expect(level?.key).toBe("prefecture");
      expect(level?.name).toBe("都道府県");
      expect(level?.parent_level_key).toBe("country");
    });

    it("returns null for an unknown key", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getAreaLevel("unknown")).toBeNull();
    });

    it("returns null for an empty string key", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getAreaLevel("")).toBeNull();
    });

    it("returns the root level (parent_level_key = null)", () => {
      const store = new AreaLevelStore(japanLevels);
      const root = store.getAreaLevel("country");
      expect(root?.parent_level_key).toBeNull();
    });
  });

  describe("getChildLevel(key)", () => {
    it("returns the child level of a non-leaf level", () => {
      const store = new AreaLevelStore(japanLevels);
      const child = store.getChildLevel("country");
      expect(child?.key).toBe("prefecture");
    });

    it("returns the child of a mid-level (prefecture → city)", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getChildLevel("prefecture")?.key).toBe("city");
    });

    it("returns the child of a mid-level (city → block)", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getChildLevel("city")?.key).toBe("block");
    });

    it("returns null for the leaf level (block has no child)", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getChildLevel("block")).toBeNull();
    });

    it("returns null for an unknown key", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.getChildLevel("unknown")).toBeNull();
    });
  });

  describe("isLeafLevel(key)", () => {
    it("returns true for the leaf level", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.isLeafLevel("block")).toBe(true);
    });

    it("returns false for the root level", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.isLeafLevel("country")).toBe(false);
    });

    it("returns false for mid-level prefecture", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.isLeafLevel("prefecture")).toBe(false);
    });

    it("returns false for mid-level city", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.isLeafLevel("city")).toBe(false);
    });

    it("returns false for unknown keys", () => {
      const store = new AreaLevelStore(japanLevels);
      expect(store.isLeafLevel("unknown")).toBe(false);
    });
  });

  describe("getRootLevel()", () => {
    it("returns the level with parent_level_key = null", () => {
      const store = new AreaLevelStore(japanLevels);
      const root = store.getRootLevel();
      expect(root?.key).toBe("country");
      expect(root?.parent_level_key).toBeNull();
    });

    it("returns null for an empty store", () => {
      const store = new AreaLevelStore([]);
      expect(store.getRootLevel()).toBeNull();
    });
  });
});
