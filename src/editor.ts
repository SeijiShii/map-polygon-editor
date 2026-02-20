import type {
  Area,
  AreaID,
  AreaLevel,
  ChangeSet,
  DraftID,
  DraftShape,
  GeometryViolation,
  HistoryEntry,
  PersistedDraft,
  Point,
  StorageAdapter,
} from "./types/index.js";
import { makeDraftID } from "./types/index.js";
import { AreaLevelStore } from "./area-level/area-level-store.js";
import { AreaStore } from "./area-store/area-store.js";
import { DraftStore } from "./draft/draft-store.js";
import { validateDraft as validateDraftFn } from "./draft/validate-draft.js";
import { draftToGeoJSON } from "./draft/draft-operations.js";
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

// Re-export the error class from its original location to avoid duplication
export { InvalidAreaLevelConfigError } from "./errors.js";

interface MapPolygonEditorConfig {
  storageAdapter: StorageAdapter;
  areaLevels: AreaLevel[];
  maxUndoSteps?: number;
  epsilon?: number;
}

/**
 * Builds a simplified union geometry from a list of child areas.
 * Combines all children's polygon coordinates into a single
 * Polygon (if one child) or MultiPolygon (if multiple children).
 */
function buildUnionGeometry(children: Area[]): Area["geometry"] {
  const allCoords = children.flatMap((c) =>
    c.geometry.type === "Polygon"
      ? [c.geometry.coordinates]
      : c.geometry.coordinates
  );
  if (allCoords.length === 1) {
    return { type: "Polygon", coordinates: allCoords[0] };
  }
  return { type: "MultiPolygon", coordinates: allCoords };
}

export class MapPolygonEditor {
  private readonly config: MapPolygonEditorConfig;
  private initialized = false;

  private levelStore!: AreaLevelStore;
  private areaStore!: AreaStore;
  private draftStore!: DraftStore;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private readonly maxUndoSteps: number;

  constructor(config: MapPolygonEditorConfig) {
    this.config = config;
    this.maxUndoSteps = config.maxUndoSteps ?? 100;
  }

  // ============================================================
  // Initialize
  // ============================================================

  async initialize(): Promise<void> {
    // Step 1: validate area levels config
    // AreaLevelStore constructor calls validateAreaLevels internally,
    // which throws InvalidAreaLevelConfigError on bad config.
    // We let that propagate as-is (already the right type from errors.ts
    // via the re-export in area-level-validator.ts). But the validator
    // in area-level-validator.ts has its own copy of InvalidAreaLevelConfigError.
    // We need to wrap it to guarantee we use errors.ts version.
    try {
      this.levelStore = new AreaLevelStore(this.config.areaLevels);
    } catch (e) {
      // Re-throw as our canonical InvalidAreaLevelConfigError
      if (e instanceof Error) {
        throw new InvalidAreaLevelConfigError(e.message);
      }
      throw e;
    }

    // Step 2: load all areas and drafts from storage
    let areas: Area[];
    let drafts: PersistedDraft[];
    try {
      const result = await this.config.storageAdapter.loadAll();
      areas = result.areas;
      drafts = result.drafts;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new StorageError(`loadAll() failed: ${msg}`);
    }

    this.areaStore = new AreaStore(this.levelStore, areas);
    this.draftStore = new DraftStore(drafts);
    this.initialized = true;
  }

  // ============================================================
  // Guard
  // ============================================================

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new NotInitializedError(
        "Call initialize() before using MapPolygonEditor"
      );
    }
  }

  // ============================================================
  // Phase 2 — Query API (synchronous)
  // ============================================================

  getArea(id: AreaID): Area | null {
    this.assertInitialized();
    return this.areaStore.getArea(id);
  }

  getChildren(parentId: AreaID): Area[] {
    this.assertInitialized();
    return this.areaStore.getChildren(parentId);
  }

  getRoots(): Area[] {
    this.assertInitialized();
    return this.areaStore.getRoots();
  }

  getAllAreas(): Area[] {
    this.assertInitialized();
    return this.areaStore.getAllAreas();
  }

  getAreasByLevel(levelKey: string): Area[] {
    this.assertInitialized();
    return this.areaStore.getAreasByLevel(levelKey);
  }

  getAllAreaLevels(): AreaLevel[] {
    this.assertInitialized();
    return this.levelStore.getAllAreaLevels();
  }

  getAreaLevel(key: string): AreaLevel | null {
    this.assertInitialized();
    return this.levelStore.getAreaLevel(key);
  }

  validateDraft(draft: DraftShape): GeometryViolation[] {
    this.assertInitialized();
    return validateDraftFn(draft);
  }

  // ============================================================
  // Phase 3 — Draft Persistence API
  // ============================================================

  async saveDraftToStorage(
    draft: DraftShape,
    metadata?: Record<string, unknown>
  ): Promise<PersistedDraft> {
    this.assertInitialized();

    const now = new Date();
    const id = makeDraftID(crypto.randomUUID());

    const persisted: PersistedDraft = {
      id,
      points: [...draft.points],
      isClosed: draft.isClosed,
      created_at: now,
      updated_at: now,
      ...(metadata !== undefined ? { metadata } : {}),
    };

    this.draftStore.save(persisted);
    await this.config.storageAdapter.saveDraft(persisted);
    return persisted;
  }

  loadDraftFromStorage(id: DraftID): DraftShape {
    this.assertInitialized();
    const persisted = this.draftStore.get(id);
    if (persisted === null) {
      throw new DraftNotFoundError(`Draft with id "${id}" not found`);
    }
    return { points: persisted.points, isClosed: persisted.isClosed };
  }

  listPersistedDrafts(): PersistedDraft[] {
    this.assertInitialized();
    return this.draftStore.getAll();
  }

  async deleteDraftFromStorage(id: DraftID): Promise<void> {
    this.assertInitialized();
    this.draftStore.delete(id);
    await this.config.storageAdapter.deleteDraft(id);
  }

  // ============================================================
  // Phase 4 — Edit Operations
  // ============================================================

  // ---- renameArea ----

  async renameArea(areaId: AreaID, name: string): Promise<Area> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }
    // Implicit areas cannot be renamed
    if (area.is_implicit) {
      throw new AreaNotFoundError(
        `Area "${areaId}" is implicit and cannot be renamed`
      );
    }

    const before = { ...area };
    const after: Area = {
      ...area,
      display_name: name,
      updated_at: new Date(),
    };

    this.areaStore.updateArea(after);

    const changeSet: ChangeSet = {
      created: [],
      deleted: [],
      modified: [after],
    };
    await this.callBatchWrite(changeSet);

    const historyEntry: HistoryEntry = {
      created: [],
      deleted: [],
      modified: [{ before, after }],
    };
    this.pushHistory(historyEntry);

    return after;
  }

  // ---- loadAreaToDraft ----

  loadAreaToDraft(areaId: AreaID): DraftShape {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Cannot load if area has explicit children
    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children and cannot be directly edited`
      );
    }

    // Extract the exterior ring from the first ring of the geometry
    const geometry = area.geometry;
    const exteriorRing =
      geometry.type === "Polygon"
        ? geometry.coordinates[0]
        : geometry.coordinates[0][0];

    // GeoJSON ring is closed (last === first), strip the closing point
    // GeoJSON coordinates are [lng, lat], convert to Point { lat, lng }
    const points: Point[] = exteriorRing
      .slice(0, -1)
      .map(([lng, lat]: number[]) => ({ lat, lng }));

    return { points, isClosed: false };
  }

  // ---- saveAsArea ----

  async saveAsArea(
    draft: DraftShape,
    name: string,
    levelKey: string,
    parentId?: AreaID
  ): Promise<Area> {
    this.assertInitialized();

    // 1. Draft must be closed
    if (!draft.isClosed) {
      throw new DraftNotClosedError(
        "Draft must be closed (isClosed = true) to save as area"
      );
    }

    // 2. Geometry validation
    const violations = validateDraftFn(draft);
    if (violations.length > 0) {
      const codes = violations.map((v) => v.code).join(", ");
      throw new InvalidGeometryError(
        `Draft has geometry violations: ${codes}`
      );
    }

    // 3. Level must exist
    const level = this.levelStore.getAreaLevel(levelKey);
    if (level === null) {
      throw new AreaLevelNotFoundError(
        `Area level "${levelKey}" not found`
      );
    }

    // 4. Parent validation
    let resolvedParentId: AreaID | null = null;
    if (parentId !== undefined) {
      const parent = this.areaStore.getArea(parentId);
      if (parent === null) {
        throw new AreaNotFoundError(`Parent area "${parentId}" not found`);
      }
      // Level mismatch: parent's level must equal this level's parent_level_key
      if (parent.level_key !== level.parent_level_key) {
        throw new LevelMismatchError(
          `Level "${levelKey}" requires parent at level "${level.parent_level_key}", but parent is at "${parent.level_key}"`
        );
      }
      resolvedParentId = parentId;
    } else {
      // No parentId: this must be a root level
      if (level.parent_level_key !== null) {
        throw new LevelMismatchError(
          `Level "${levelKey}" requires a parent (parent_level_key = "${level.parent_level_key}"), but no parentId was provided`
        );
      }
      resolvedParentId = null;
    }

    // 5. Create Area
    const newId = crypto.randomUUID() as AreaID;
    const now = new Date();
    const geometry = draftToGeoJSON(draft);
    const newArea: Area = {
      id: newId,
      display_name: name,
      level_key: levelKey,
      parent_id: resolvedParentId,
      geometry,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    };

    this.areaStore.addArea(newArea);

    // 6. Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(resolvedParentId);

    // 7. Build HistoryEntry and ChangeSet
    const historyEntry: HistoryEntry = {
      created: [newArea],
      deleted: [],
      modified: modifiedAncestors,
    };
    const changeSet: ChangeSet = {
      created: [newArea],
      deleted: [],
      modified: modifiedAncestors.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return newArea;
  }

  // ---- deleteArea ----

  async deleteArea(
    areaId: AreaID,
    options?: { cascade?: boolean }
  ): Promise<void> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }
    // Implicit areas cannot be deleted (they are virtual)
    if (area.is_implicit) {
      throw new AreaNotFoundError(
        `Area "${areaId}" is implicit and cannot be deleted`
      );
    }

    const cascade = options?.cascade ?? false;
    const explicitChildren = this.getExplicitChildrenOf(areaId);

    if (!cascade && explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children. Use cascade: true to delete recursively`
      );
    }

    // Collect all areas to delete (the target + all descendants if cascade)
    const toDelete: Area[] = cascade
      ? this.collectDescendants(areaId)
      : [area];

    // Delete from store
    for (const a of toDelete) {
      this.areaStore.deleteArea(a.id);
    }

    // Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(area.parent_id);

    // Build HistoryEntry and ChangeSet
    const historyEntry: HistoryEntry = {
      created: [],
      deleted: toDelete,
      modified: modifiedAncestors,
    };
    const changeSet: ChangeSet = {
      created: [],
      deleted: toDelete.map((a) => a.id),
      modified: modifiedAncestors.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);
  }

  // ============================================================
  // Phase 5 — Undo / Redo
  // ============================================================

  canUndo(): boolean {
    this.assertInitialized();
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    this.assertInitialized();
    return this.redoStack.length > 0;
  }

  undo(): Area[] {
    this.assertInitialized();
    const entry = this.undoStack.pop();
    if (entry === undefined) return [];

    const affected: Area[] = [];

    // Reverse: delete created, restore deleted, restore modified.before
    for (const area of entry.created) {
      this.areaStore.deleteArea(area.id);
      affected.push(area);
    }
    for (const area of entry.deleted) {
      this.areaStore.addArea(area);
      affected.push(area);
    }
    for (const { before } of entry.modified) {
      this.areaStore.updateArea(before);
      affected.push(before);
    }

    this.redoStack.push(entry);
    return affected;
  }

  redo(): Area[] {
    this.assertInitialized();
    const entry = this.redoStack.pop();
    if (entry === undefined) return [];

    const affected: Area[] = [];

    // Re-apply: restore created, delete deleted, apply modified.after
    for (const area of entry.created) {
      this.areaStore.addArea(area);
      affected.push(area);
    }
    for (const area of entry.deleted) {
      this.areaStore.deleteArea(area.id);
      affected.push(area);
    }
    for (const { after } of entry.modified) {
      this.areaStore.updateArea(after);
      affected.push(after);
    }

    this.undoStack.push(entry);
    return affected;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Calls batchWrite on the storage adapter. Wraps any thrown error in a
   * StorageError so callers get a predictable error type.
   */
  private async callBatchWrite(changeSet: ChangeSet): Promise<void> {
    try {
      await this.config.storageAdapter.batchWrite(changeSet);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new StorageError(`batchWrite() failed: ${msg}`);
    }
  }

  /**
   * Pushes a HistoryEntry to the undo stack, enforcing maxUndoSteps.
   * Clears the redo stack (new operation invalidates forward history).
   */
  private pushHistory(entry: HistoryEntry): void {
    this.redoStack = [];
    this.undoStack.push(entry);
    // Trim if over the limit
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
  }

  /**
   * Returns all explicit (non-implicit) children of an area.
   */
  private getExplicitChildrenOf(parentId: AreaID): Area[] {
    return this.areaStore
      .getChildren(parentId)
      .filter((c) => !c.is_implicit);
  }

  /**
   * Recursively collects an area and all of its descendants (including the
   * target area itself).
   */
  private collectDescendants(areaId: AreaID): Area[] {
    const result: Area[] = [];
    const queue: AreaID[] = [areaId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const area = this.areaStore.getArea(id);
      if (area === null || area.is_implicit) continue;
      result.push(area);
      const children = this.getExplicitChildrenOf(id);
      for (const child of children) {
        queue.push(child.id);
      }
    }
    return result;
  }

  /**
   * Walks up the ancestor chain from `startParentId` and rebuilds each
   * ancestor's geometry as the union of its explicit children.
   *
   * Returns an array of { before, after } pairs for the HistoryEntry.
   */
  private updateAncestorGeometries(
    startParentId: AreaID | null
  ): Array<{ before: Area; after: Area }> {
    const modified: Array<{ before: Area; after: Area }> = [];
    let currentId: AreaID | null = startParentId;

    while (currentId !== null) {
      const ancestor = this.areaStore.getArea(currentId);
      if (ancestor === null || ancestor.is_implicit) break;

      const children = this.getExplicitChildrenOf(ancestor.id);
      if (children.length === 0) {
        // No explicit children — no union to build
        currentId = ancestor.parent_id;
        continue;
      }

      const before = { ...ancestor };
      const newGeometry = buildUnionGeometry(children);
      const after: Area = {
        ...ancestor,
        geometry: newGeometry,
        updated_at: new Date(),
      };

      this.areaStore.updateArea(after);
      modified.push({ before, after });

      currentId = ancestor.parent_id;
    }

    return modified;
  }
}
