import type { Area, AreaID } from "../types/index.js";
import { makeAreaID } from "../types/index.js";
import type { AreaLevelStore } from "../area-level/area-level-store.js";

/** Prefix used for deterministic implicit child area IDs. */
const IMPLICIT_PREFIX = "__implicit__";

/**
 * Parses an implicit virtual ID of the form `__implicit__<parentId>__<levelKey>`.
 * Returns null if the id does not match this pattern.
 */
function parseImplicitId(
  id: string
): { parentId: AreaID; levelKey: string } | null {
  if (!id.startsWith(IMPLICIT_PREFIX)) return null;
  const rest = id.slice(IMPLICIT_PREFIX.length);
  const sep = "__";
  const sepIdx = rest.lastIndexOf(sep);
  if (sepIdx === -1) return null;
  const parentIdStr = rest.slice(0, sepIdx);
  const levelKey = rest.slice(sepIdx + sep.length);
  if (!parentIdStr || !levelKey) return null;
  return { parentId: makeAreaID(parentIdStr), levelKey };
}

/** Builds the deterministic virtual ID for an implicit child. */
function makeImplicitId(parentId: AreaID, childLevelKey: string): AreaID {
  return makeAreaID(`__implicit__${parentId}__${childLevelKey}`);
}

/**
 * In-memory store for Area entities.
 *
 * Provides:
 * - `getArea(id)` — by explicit ID or virtual implicit ID
 * - `getChildren(parentId)` — explicit or implicit children
 * - `getRoots()` — areas with parent_id = null
 * - `getAllAreas()` — all explicit (non-implicit) areas
 * - `getAreasByLevel(levelKey)` — explicit areas at a given level
 * - Mutation helpers: `addArea`, `updateArea`, `deleteArea`
 */
export class AreaStore {
  private readonly areas: Map<AreaID, Area> = new Map();
  /** parentId → Set of child IDs */
  private readonly childrenIndex: Map<AreaID | null, Set<AreaID>> = new Map();
  /** levelKey → Set of area IDs */
  private readonly levelIndex: Map<string, Set<AreaID>> = new Map();

  constructor(
    private readonly levelStore: AreaLevelStore,
    initialAreas: Area[]
  ) {
    for (const area of initialAreas) {
      this.indexArea(area);
    }
  }

  // ---- private indexing ----

  private indexArea(area: Area): void {
    this.areas.set(area.id, area);

    if (!this.childrenIndex.has(area.parent_id)) {
      this.childrenIndex.set(area.parent_id, new Set());
    }
    this.childrenIndex.get(area.parent_id)!.add(area.id);

    if (!this.levelIndex.has(area.level_key)) {
      this.levelIndex.set(area.level_key, new Set());
    }
    this.levelIndex.get(area.level_key)!.add(area.id);
  }

  private deindexArea(area: Area): void {
    this.areas.delete(area.id);

    const siblings = this.childrenIndex.get(area.parent_id);
    siblings?.delete(area.id);

    const levelSet = this.levelIndex.get(area.level_key);
    levelSet?.delete(area.id);
  }

  // ---- query API ----

  /**
   * Returns an Area by ID.
   * Also resolves virtual implicit child IDs (e.g. `__implicit__tokyo__city`).
   * Returns null if not found.
   */
  getArea(id: AreaID): Area | null {
    const explicit = this.areas.get(id);
    if (explicit !== undefined) return explicit;

    // Try to resolve as implicit virtual ID
    const parsed = parseImplicitId(id);
    if (parsed === null) return null;

    const parent = this.areas.get(parsed.parentId);
    if (parent === null || parent === undefined) return null;

    // Verify the level key is the correct child level for the parent
    const childLevel = this.levelStore.getChildLevel(parent.level_key);
    if (childLevel === null || childLevel.key !== parsed.levelKey) return null;

    // Only synthesize if the parent has NO explicit children
    const explicitChildren = this.getExplicitChildren(parent.id);
    if (explicitChildren.length > 0) return null;

    return this.synthesizeImplicitChild(parent, childLevel.key);
  }

  /** Returns all areas with parent_id = null. */
  getRoots(): Area[] {
    const rootIds = this.childrenIndex.get(null);
    if (!rootIds) return [];
    return Array.from(rootIds)
      .map((id) => this.areas.get(id))
      .filter((a): a is Area => a !== undefined);
  }

  /** Returns all explicit (non-implicit) areas. */
  getAllAreas(): Area[] {
    return Array.from(this.areas.values()).filter((a) => !a.is_implicit);
  }

  /**
   * Returns the children of the given parent.
   * - If the parent has explicit children → returns them.
   * - If the parent is non-leaf with NO explicit children → returns a single
   *   implicit child (is_implicit: true) with the parent's geometry.
   * - If the parent is at the leaf level → returns [].
   */
  getChildren(parentId: AreaID): Area[] {
    const explicit = this.getExplicitChildren(parentId);
    if (explicit.length > 0) return explicit;

    const parent = this.areas.get(parentId);
    if (parent === undefined) return [];

    // Leaf level → no children
    if (this.levelStore.isLeafLevel(parent.level_key)) return [];

    const childLevel = this.levelStore.getChildLevel(parent.level_key);
    if (childLevel === null) return [];

    return [this.synthesizeImplicitChild(parent, childLevel.key)];
  }

  /** Returns all explicit areas at a given level key. */
  getAreasByLevel(levelKey: string): Area[] {
    const ids = this.levelIndex.get(levelKey);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.areas.get(id))
      .filter((a): a is Area => a !== undefined && !a.is_implicit);
  }

  // ---- mutation API ----

  addArea(area: Area): void {
    this.indexArea(area);
  }

  updateArea(area: Area): void {
    const existing = this.areas.get(area.id);
    if (existing !== undefined) {
      this.deindexArea(existing);
    }
    this.indexArea(area);
  }

  deleteArea(id: AreaID): void {
    const existing = this.areas.get(id);
    if (existing !== undefined) {
      this.deindexArea(existing);
    }
  }

  // ---- private helpers ----

  private getExplicitChildren(parentId: AreaID): Area[] {
    const ids = this.childrenIndex.get(parentId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.areas.get(id))
      .filter((a): a is Area => a !== undefined);
  }

  private synthesizeImplicitChild(parent: Area, childLevelKey: string): Area {
    return {
      id: makeImplicitId(parent.id, childLevelKey),
      display_name: "",
      level_key: childLevelKey,
      parent_id: parent.id,
      geometry: parent.geometry,
      created_at: parent.created_at,
      updated_at: parent.updated_at,
      is_implicit: true,
    };
  }
}
