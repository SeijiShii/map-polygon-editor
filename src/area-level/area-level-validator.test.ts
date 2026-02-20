import { describe, it, expect } from "vitest";
import { validateAreaLevels, InvalidAreaLevelConfigError } from "./area-level-validator.js";
import type { AreaLevel } from "../types/index.js";

// Helper: assert that fn throws InvalidAreaLevelConfigError
function expectInvalidConfig(fn: () => void): void {
  expect(fn).toThrow(InvalidAreaLevelConfigError);
}

describe("validateAreaLevels", () => {
  // ---- VALID CONFIGS ----

  it("accepts a valid linear hierarchy (Japan)", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "国", parent_level_key: null },
      { key: "prefecture", name: "都道府県", parent_level_key: "country" },
      { key: "city", name: "市区町村", parent_level_key: "prefecture" },
      { key: "block", name: "丁目", parent_level_key: "city" },
    ];
    expect(() => validateAreaLevels(levels)).not.toThrow();
  });

  it("accepts a valid linear hierarchy (US)", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "Country", parent_level_key: null },
      { key: "state", name: "State", parent_level_key: "country" },
      { key: "county", name: "County", parent_level_key: "state" },
      { key: "city", name: "City", parent_level_key: "county" },
    ];
    expect(() => validateAreaLevels(levels)).not.toThrow();
  });

  it("accepts a single root-only level", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "Country", parent_level_key: null },
    ];
    expect(() => validateAreaLevels(levels)).not.toThrow();
  });

  it("accepts levels with optional description field", () => {
    const levels: AreaLevel[] = [
      {
        key: "country",
        name: "Country",
        parent_level_key: null,
        description: "Top level",
      },
      {
        key: "state",
        name: "State",
        parent_level_key: "country",
        description: "State level",
      },
    ];
    expect(() => validateAreaLevels(levels)).not.toThrow();
  });

  it("accepts empty area levels array", () => {
    expect(() => validateAreaLevels([])).not.toThrow();
  });

  // ---- DUPLICATE KEY ----

  it("throws InvalidAreaLevelConfigError when keys are duplicated", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "Country A", parent_level_key: null },
      { key: "country", name: "Country B", parent_level_key: null },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  // ---- NONEXISTENT PARENT KEY ----

  it("throws InvalidAreaLevelConfigError when parent_level_key references a nonexistent key", () => {
    const levels: AreaLevel[] = [
      { key: "city", name: "City", parent_level_key: "prefecture" },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  // ---- CIRCULAR REFERENCE ----

  it("throws InvalidAreaLevelConfigError on direct circular reference (A → A)", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "Country", parent_level_key: "country" },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  it("throws InvalidAreaLevelConfigError on indirect circular reference (A → B → A)", () => {
    const levels: AreaLevel[] = [
      { key: "country", name: "Country", parent_level_key: "state" },
      { key: "state", name: "State", parent_level_key: "country" },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  it("throws InvalidAreaLevelConfigError on 3-node cycle (A → B → C → A)", () => {
    const levels: AreaLevel[] = [
      { key: "a", name: "A", parent_level_key: "c" },
      { key: "b", name: "B", parent_level_key: "a" },
      { key: "c", name: "C", parent_level_key: "b" },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  // ---- LINEAR HIERARCHY CONSTRAINT (single child per parent) ----

  it("throws InvalidAreaLevelConfigError when two levels share the same parent_level_key", () => {
    const levels: AreaLevel[] = [
      { key: "prefecture", name: "Prefecture", parent_level_key: null },
      { key: "city", name: "City", parent_level_key: "prefecture" },
      { key: "ward", name: "Ward", parent_level_key: "prefecture" },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  it("throws InvalidAreaLevelConfigError when two root levels exist (both have parent_level_key: null)", () => {
    const levels: AreaLevel[] = [
      { key: "country_a", name: "Country A", parent_level_key: null },
      { key: "country_b", name: "Country B", parent_level_key: null },
    ];
    expectInvalidConfig(() => validateAreaLevels(levels));
  });

  // ---- ERROR CLASS IDENTITY ----

  it("throws an error with name 'InvalidAreaLevelConfigError'", () => {
    const levels: AreaLevel[] = [
      { key: "a", name: "A", parent_level_key: "nonexistent" },
    ];
    try {
      validateAreaLevels(levels);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAreaLevelConfigError);
      expect((e as Error).name).toBe("InvalidAreaLevelConfigError");
    }
  });

  it("includes a descriptive message in the error", () => {
    const levels: AreaLevel[] = [
      { key: "city", name: "City", parent_level_key: "missing" },
    ];
    try {
      validateAreaLevels(levels);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  });
});
