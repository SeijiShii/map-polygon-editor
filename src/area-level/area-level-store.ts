import type { AreaLevel } from "../types/index.js";
import { validateAreaLevels } from "./area-level-validator.js";

/**
 * In-memory read-only store for AreaLevel definitions.
 * Validates the config on construction.
 */
export class AreaLevelStore {
  private readonly levels: AreaLevel[];
  private readonly levelByKey: Map<string, AreaLevel>;
  /** Maps parent_level_key → child AreaLevel */
  private readonly childByParentKey: Map<string | null, AreaLevel>;

  constructor(levels: AreaLevel[]) {
    validateAreaLevels(levels);

    this.levels = [...levels];
    this.levelByKey = new Map(levels.map((l) => [l.key, l]));
    this.childByParentKey = new Map(
      levels.map((l) => [l.parent_level_key, l])
    );
  }

  /** Returns all AreaLevels in insertion order. */
  getAllAreaLevels(): AreaLevel[] {
    return [...this.levels];
  }

  /** Returns the AreaLevel matching the given key, or null. */
  getAreaLevel(key: string): AreaLevel | null {
    return this.levelByKey.get(key) ?? null;
  }

  /**
   * Returns the child AreaLevel of the level identified by `key`.
   * Returns null if `key` is unknown or the leaf level.
   */
  getChildLevel(key: string): AreaLevel | null {
    if (!this.levelByKey.has(key)) return null;
    return this.childByParentKey.get(key) ?? null;
  }

  /**
   * Returns true if the level identified by `key` is the leaf level
   * (i.e. no other level has it as parent_level_key).
   */
  isLeafLevel(key: string): boolean {
    if (!this.levelByKey.has(key)) return false;
    return !this.childByParentKey.has(key);
  }

  /** Returns the root AreaLevel (parent_level_key = null), or null if empty. */
  getRootLevel(): AreaLevel | null {
    return this.childByParentKey.get(null) ?? null;
  }
}
