import type {
  Area,
  AreaID,
  AreaInput,
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
  ParentWouldBeEmptyError,
  CircularReferenceError,
  NoChildLevelError,
} from "./errors.js";
import * as turf from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from "geojson";

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
      : c.geometry.coordinates,
  );
  if (allCoords.length === 1) {
    return { type: "Polygon", coordinates: allCoords[0] };
  }
  return { type: "MultiPolygon", coordinates: allCoords };
}

/**
 * Merges two area geometries into a single MultiPolygon by combining all
 * polygon rings from both geometries.
 */
function buildMergeGeometry(
  geomA: Area["geometry"],
  geomB: Area["geometry"],
): Area["geometry"] {
  const coordsA =
    geomA.type === "Polygon" ? [geomA.coordinates] : geomA.coordinates;
  const coordsB =
    geomB.type === "Polygon" ? [geomB.coordinates] : geomB.coordinates;
  const all = [...coordsA, ...coordsB];
  if (all.length === 1) {
    return { type: "Polygon", coordinates: all[0] };
  }
  return { type: "MultiPolygon", coordinates: all };
}

/**
 * Builds a typed FeatureCollection<Polygon | MultiPolygon> from an area geometry
 * and a second turf polygon feature, for use with turf.difference / turf.union.
 *
 * We use `as` casts here because TypeScript cannot narrow the union type through
 * the ternary when building the array, but the runtime values are always correct.
 */
function buildPolygonFeatureCollection(
  areaGeometry: Area["geometry"],
  secondFeature: Feature<Polygon>,
): { type: "FeatureCollection"; features: Feature<Polygon | MultiPolygon>[] } {
  const first: Feature<Polygon | MultiPolygon> =
    areaGeometry.type === "Polygon"
      ? {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: areaGeometry.coordinates as number[][][],
          },
          properties: {},
        }
      : {
          type: "Feature",
          geometry: {
            type: "MultiPolygon",
            coordinates: areaGeometry.coordinates as number[][][][],
          },
          properties: {},
        };
  return {
    type: "FeatureCollection",
    features: [first, secondFeature],
  };
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
        "Call initialize() before using MapPolygonEditor",
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
    metadata?: Record<string, unknown>,
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
        `Area "${areaId}" is implicit and cannot be renamed`,
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
        `Area "${areaId}" has explicit children and cannot be directly edited`,
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
    parentId?: AreaID,
  ): Promise<Area> {
    this.assertInitialized();

    // 1. Draft must be closed
    if (!draft.isClosed) {
      throw new DraftNotClosedError(
        "Draft must be closed (isClosed = true) to save as area",
      );
    }

    // 2. Geometry validation
    const violations = validateDraftFn(draft);
    if (violations.length > 0) {
      const codes = violations.map((v) => v.code).join(", ");
      throw new InvalidGeometryError(`Draft has geometry violations: ${codes}`);
    }

    // 3. Level must exist
    const level = this.levelStore.getAreaLevel(levelKey);
    if (level === null) {
      throw new AreaLevelNotFoundError(`Area level "${levelKey}" not found`);
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
          `Level "${levelKey}" requires parent at level "${level.parent_level_key}", but parent is at "${parent.level_key}"`,
        );
      }
      resolvedParentId = parentId;
    } else {
      // No parentId: this must be a root level
      if (level.parent_level_key !== null) {
        throw new LevelMismatchError(
          `Level "${levelKey}" requires a parent (parent_level_key = "${level.parent_level_key}"), but no parentId was provided`,
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
    options?: { cascade?: boolean },
  ): Promise<void> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }
    // Implicit areas cannot be deleted (they are virtual)
    if (area.is_implicit) {
      throw new AreaNotFoundError(
        `Area "${areaId}" is implicit and cannot be deleted`,
      );
    }

    const cascade = options?.cascade ?? false;
    const explicitChildren = this.getExplicitChildrenOf(areaId);

    if (!cascade && explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children. Use cascade: true to delete recursively`,
      );
    }

    // Collect all areas to delete (the target + all descendants if cascade)
    const toDelete: Area[] = cascade ? this.collectDescendants(areaId) : [area];

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

  // ---- bulkCreate ----

  async bulkCreate(items: AreaInput[]): Promise<Area[]> {
    this.assertInitialized();

    if (items.length === 0) {
      return [];
    }

    // Validate all items before making any changes (fail-fast, no partial apply)
    for (const item of items) {
      // 1. level_key must exist
      const level = this.levelStore.getAreaLevel(item.level_key);
      if (level === null) {
        throw new AreaLevelNotFoundError(
          `Area level "${item.level_key}" not found`,
        );
      }

      // 2. parent_id validation
      if (item.parent_id !== null) {
        const parent = this.areaStore.getArea(item.parent_id);
        if (parent === null) {
          throw new AreaNotFoundError(
            `Parent area "${item.parent_id}" not found`,
          );
        }
        // Level mismatch: parent's level must equal item's level.parent_level_key
        if (parent.level_key !== level.parent_level_key) {
          throw new LevelMismatchError(
            `Level "${item.level_key}" requires parent at level "${level.parent_level_key}", but parent is at "${parent.level_key}"`,
          );
        }
      } else {
        // No parent: level must be root
        if (level.parent_level_key !== null) {
          throw new LevelMismatchError(
            `Level "${item.level_key}" requires a parent (parent_level_key = "${level.parent_level_key}"), but parent_id is null`,
          );
        }
      }
    }

    // All validations passed — create all areas
    const now = new Date();
    const newAreas: Area[] = items.map((item) => ({
      id: crypto.randomUUID() as AreaID,
      display_name: item.display_name,
      level_key: item.level_key,
      parent_id: item.parent_id,
      geometry: item.geometry,
      created_at: now,
      updated_at: now,
      is_implicit: false,
      ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
    }));

    for (const area of newAreas) {
      this.areaStore.addArea(area);
    }

    // Update ancestor geometries for all unique affected parent chains
    const affectedParentIds = new Set(
      items
        .map((item) => item.parent_id)
        .filter((id): id is AreaID => id !== null),
    );
    const allModified: Array<{ before: Area; after: Area }> = [];
    for (const parentId of affectedParentIds) {
      const modified = this.updateAncestorGeometries(parentId);
      allModified.push(...modified);
    }

    const historyEntry: HistoryEntry = {
      created: newAreas,
      deleted: [],
      modified: allModified,
    };
    const changeSet: ChangeSet = {
      created: newAreas,
      deleted: [],
      modified: allModified.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return newAreas;
  }

  // ---- updateAreaGeometry ----

  async updateAreaGeometry(areaId: AreaID, draft: DraftShape): Promise<Area> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Cannot update geometry of areas with explicit children
    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children and cannot have its geometry directly updated`,
      );
    }

    // Draft must be closed
    if (!draft.isClosed) {
      throw new DraftNotClosedError(
        "Draft must be closed (isClosed = true) to update area geometry",
      );
    }

    // Geometry validation
    const violations = validateDraftFn(draft);
    if (violations.length > 0) {
      const codes = violations.map((v) => v.code).join(", ");
      throw new InvalidGeometryError(`Draft has geometry violations: ${codes}`);
    }

    const before = { ...area };
    const newGeometry = draftToGeoJSON(draft);
    const after: Area = {
      ...area,
      geometry: newGeometry,
      updated_at: new Date(),
    };

    this.areaStore.updateArea(after);

    // Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(area.parent_id);

    const historyEntry: HistoryEntry = {
      created: [],
      deleted: [],
      modified: [{ before, after }, ...modifiedAncestors],
    };
    const changeSet: ChangeSet = {
      created: [],
      deleted: [],
      modified: [after, ...modifiedAncestors.map((m) => m.after)],
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return after;
  }

  // ---- reparentArea ----

  async reparentArea(
    areaId: AreaID,
    newParentId: AreaID | null,
  ): Promise<Area> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    const level = this.levelStore.getAreaLevel(area.level_key);
    // level is guaranteed to exist since area was loaded with valid level_key

    if (newParentId !== null) {
      // Validate new parent exists
      const newParent = this.areaStore.getArea(newParentId);
      if (newParent === null) {
        throw new AreaNotFoundError(`Parent area "${newParentId}" not found`);
      }

      // Level mismatch: newParent's level must equal area's level.parent_level_key
      if (newParent.level_key !== level!.parent_level_key) {
        throw new LevelMismatchError(
          `Area "${areaId}" (level "${area.level_key}") requires parent at level "${level!.parent_level_key}", but new parent is at "${newParent.level_key}"`,
        );
      }

      // Circular reference check: newParentId must not be a descendant of areaId
      if (this.isDescendant(newParentId, areaId)) {
        throw new CircularReferenceError(
          `Cannot reparent area "${areaId}" to "${newParentId}" because it would create a circular reference`,
        );
      }
    } else {
      // newParentId is null: area must be root-level (parent_level_key must be null)
      if (level!.parent_level_key !== null) {
        throw new LevelMismatchError(
          `Area "${areaId}" (level "${area.level_key}") requires a parent (parent_level_key = "${level!.parent_level_key}"), cannot become a root`,
        );
      }
    }

    // Check that old parent would not be left with zero explicit children
    if (area.parent_id !== null) {
      const oldParentExplicitChildren = this.getExplicitChildrenOf(
        area.parent_id,
      );
      if (oldParentExplicitChildren.length === 1) {
        // This area is the only explicit child; moving it would leave old parent empty
        throw new ParentWouldBeEmptyError(
          `Reparenting area "${areaId}" would leave parent "${area.parent_id}" with no explicit children`,
        );
      }
    }

    const before = { ...area };
    const after: Area = {
      ...area,
      parent_id: newParentId,
      updated_at: new Date(),
    };

    this.areaStore.updateArea(after);

    const historyEntry: HistoryEntry = {
      created: [],
      deleted: [],
      modified: [{ before, after }],
    };
    const changeSet: ChangeSet = {
      created: [],
      deleted: [],
      modified: [after],
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return after;
  }

  // ---- mergeArea ----

  async mergeArea(areaId: AreaID, otherAreaId: AreaID): Promise<Area> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    const otherArea = this.areaStore.getArea(otherAreaId);
    if (otherArea === null) {
      throw new AreaNotFoundError(`Area "${otherAreaId}" not found`);
    }

    // Both areas must have the same parent_id (siblings) and same level_key
    if (area.parent_id !== otherArea.parent_id) {
      throw new LevelMismatchError(
        `Areas "${areaId}" and "${otherAreaId}" have different parent_ids and cannot be merged`,
      );
    }

    if (area.level_key !== otherArea.level_key) {
      throw new LevelMismatchError(
        `Areas "${areaId}" and "${otherAreaId}" have different level_keys and cannot be merged`,
      );
    }

    // Neither area may have explicit children
    const areaChildren = this.getExplicitChildrenOf(areaId);
    if (areaChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children and cannot be merged`,
      );
    }

    const otherChildren = this.getExplicitChildrenOf(otherAreaId);
    if (otherChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${otherAreaId}" has explicit children and cannot be merged`,
      );
    }

    // Merge geometries: combine into MultiPolygon (or Polygon if trivial)
    const mergedGeometry = buildMergeGeometry(
      area.geometry,
      otherArea.geometry,
    );

    const survivingBefore = { ...area };
    const survivingAfter: Area = {
      ...area,
      geometry: mergedGeometry,
      updated_at: new Date(),
    };

    // Update surviving area in store
    this.areaStore.updateArea(survivingAfter);

    // Delete the other area from store
    this.areaStore.deleteArea(otherAreaId);

    const historyEntry: HistoryEntry = {
      created: [],
      deleted: [otherArea],
      modified: [{ before: survivingBefore, after: survivingAfter }],
    };
    const changeSet: ChangeSet = {
      created: [],
      deleted: [otherAreaId],
      modified: [survivingAfter],
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return survivingAfter;
  }

  // ============================================================
  // Phase 6 — Cutting / Geometry APIs
  // ============================================================

  // ---- sharedEdgeMove ----

  async sharedEdgeMove(
    areaId: AreaID,
    index: number,
    lat: number,
    lng: number,
  ): Promise<Area[]> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${areaId}" has explicit children and cannot use sharedEdgeMove`,
      );
    }

    // Get the actual area (could be implicit, in which case we use its real parent)
    // The spec says sharedEdgeMove works on leaf/implicit areas
    const resolvedArea = area;

    // Get current vertex at index from the exterior ring of the area's polygon
    const exteriorRing = this.getExteriorRing(resolvedArea.geometry);
    // GeoJSON ring is closed: coordinates[0] === coordinates[n-1]
    // The "logical" vertices are indices 0..n-2 (last = first)
    const ringLen = exteriorRing.length - 1; // exclude duplicate closing vertex
    const normalizedIndex = ((index % ringLen) + ringLen) % ringLen;
    const currentVertex = exteriorRing[normalizedIndex]; // [lng, lat]
    const oldLng = currentVertex[0];
    const oldLat = currentVertex[1];
    const epsilon = this.config.epsilon ?? 1e-8;

    // Find all siblings (same parent_id) including the area itself
    const siblings: Area[] = [];
    if (resolvedArea.parent_id !== null) {
      const sibs = this.areaStore
        .getChildren(resolvedArea.parent_id)
        .filter((c) => !c.is_implicit);
      siblings.push(...sibs);
    } else {
      // Root area: only itself
      siblings.push(resolvedArea);
    }

    // Move vertex in each sibling that has this vertex (within epsilon)
    const updatedAreas: Area[] = [];
    const historyModified: Array<{ before: Area; after: Area }> = [];

    for (const sibling of siblings) {
      const updated = this.moveVertexInArea(
        sibling,
        oldLng,
        oldLat,
        lng,
        lat,
        epsilon,
      );
      if (updated !== null) {
        const before = { ...sibling };
        this.areaStore.updateArea(updated);
        historyModified.push({ before, after: updated });
        updatedAreas.push(updated);
      }
    }

    // Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(
      resolvedArea.parent_id,
    );
    const allModified = [...historyModified, ...modifiedAncestors];
    const allUpdated = [
      ...updatedAreas,
      ...modifiedAncestors.map((m) => m.after),
    ];

    const historyEntry: HistoryEntry = {
      created: [],
      deleted: [],
      modified: allModified,
    };
    const changeSet: ChangeSet = {
      created: [],
      deleted: [],
      modified: allModified.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return allUpdated;
  }

  // ---- splitAsChildren ----

  async splitAsChildren(areaId: AreaID, draft: DraftShape): Promise<Area[]> {
    this.assertInitialized();

    // Resolve the area — handle implicit IDs too
    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Draft must be open (a cutting line)
    if (draft.isClosed) {
      throw new DraftNotClosedError(
        "Draft must be open (isClosed = false) for splitAsChildren",
      );
    }

    // Must have at least 2 points
    if (draft.points.length < 2) {
      throw new InvalidGeometryError(
        "Draft must have at least 2 points (TOO_FEW_VERTICES)",
      );
    }

    // Determine the actual area to split and the parent_id for children
    let targetArea: Area;
    let childParentId: AreaID;

    if (area.is_implicit) {
      // For implicit areas: the actual geometry to split is the parent's geometry
      // Children get parent_id = area's parent_id (grandparent of implicit child)
      const parent = this.areaStore.getArea(area.parent_id!);
      if (parent === null) {
        throw new AreaNotFoundError(
          `Parent area "${area.parent_id}" not found`,
        );
      }
      targetArea = parent;
      childParentId = area.parent_id!;
    } else {
      targetArea = area;
      childParentId = areaId;
    }

    // Area must not have explicit children
    const explicitChildren = this.getExplicitChildrenOf(targetArea.id);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(
        `Area "${targetArea.id}" has explicit children`,
      );
    }

    // Determine child level
    const childLevel = this.levelStore.getChildLevel(targetArea.level_key);
    if (childLevel === null) {
      throw new NoChildLevelError(
        `Area level "${targetArea.level_key}" has no child level`,
      );
    }

    // Perform whisker removal and splitting
    const cleanedPoints = this.removeWhiskers(draft.points);
    if (cleanedPoints.length < 2) {
      throw new InvalidGeometryError(
        "After whisker removal, draft has fewer than 2 points (TOO_FEW_VERTICES)",
      );
    }

    // Split the polygon using the cutting line
    const splitPolygons = this.splitPolygonWithLine(
      targetArea.geometry,
      cleanedPoints,
    );

    if (splitPolygons.length < 2) {
      // No split happened (line doesn't intersect) — return empty or handle
      // Per spec: if no intersection, no-op. Return empty array.
      return [];
    }

    // Create child areas
    const now = new Date();
    const newChildren: Area[] = splitPolygons.map((geom) => ({
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: childLevel.key,
      parent_id: childParentId,
      geometry: geom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    }));

    for (const child of newChildren) {
      this.areaStore.addArea(child);
    }

    // Update ancestor geometries starting from childParentId
    const modifiedAncestors = this.updateAncestorGeometries(childParentId);

    const historyEntry: HistoryEntry = {
      created: newChildren,
      deleted: [],
      modified: modifiedAncestors,
    };
    const changeSet: ChangeSet = {
      created: newChildren,
      deleted: [],
      modified: modifiedAncestors.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return newChildren;
  }

  // ---- splitReplace ----

  async splitReplace(areaId: AreaID, draft: DraftShape): Promise<Area[]> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Draft must be open
    if (draft.isClosed) {
      throw new DraftNotClosedError(
        "Draft must be open (isClosed = false) for splitReplace",
      );
    }

    // Must have at least 2 points
    if (draft.points.length < 2) {
      throw new InvalidGeometryError(
        "Draft must have at least 2 points (TOO_FEW_VERTICES)",
      );
    }

    // Area must not have explicit children
    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(`Area "${areaId}" has explicit children`);
    }

    // Perform whisker removal
    const cleanedPoints = this.removeWhiskers(draft.points);
    if (cleanedPoints.length < 2) {
      throw new InvalidGeometryError(
        "After whisker removal, draft has fewer than 2 points (TOO_FEW_VERTICES)",
      );
    }

    // Split the polygon
    const splitPolygons = this.splitPolygonWithLine(
      area.geometry,
      cleanedPoints,
    );

    if (splitPolygons.length < 2) {
      return [];
    }

    const now = new Date();
    const newAreas: Area[] = splitPolygons.map((geom) => ({
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: area.level_key,
      parent_id: area.parent_id,
      geometry: geom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    }));

    // Add new areas
    for (const a of newAreas) {
      this.areaStore.addArea(a);
    }

    // Delete original area
    this.areaStore.deleteArea(areaId);

    // Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(area.parent_id);

    const historyEntry: HistoryEntry = {
      created: newAreas,
      deleted: [area],
      modified: modifiedAncestors,
    };
    const changeSet: ChangeSet = {
      created: newAreas,
      deleted: [areaId],
      modified: modifiedAncestors.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return newAreas;
  }

  // ---- carveInnerChild ----

  async carveInnerChild(
    areaId: AreaID,
    points: Point[],
  ): Promise<[Area, Area]> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Area must not have explicit children
    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(`Area "${areaId}" has explicit children`);
    }

    // Determine child level
    const childLevel = this.levelStore.getChildLevel(area.level_key);
    if (childLevel === null) {
      throw new NoChildLevelError(
        `Area level "${area.level_key}" has no child level`,
      );
    }

    // Validate inner loop: need at least 3 unique points to form a polygon
    const uniquePoints = this.deduplicatePoints(points);
    if (uniquePoints.length < 3) {
      throw new InvalidGeometryError(
        "carveInnerChild: points must form a valid polygon (at least 3 unique points)",
      );
    }

    // Build inner polygon geometry
    const innerCoords = uniquePoints.map((p) => [p.lng, p.lat]);
    // Ensure it's a closed ring
    if (
      innerCoords[0][0] !== innerCoords[innerCoords.length - 1][0] ||
      innerCoords[0][1] !== innerCoords[innerCoords.length - 1][1]
    ) {
      innerCoords.push(innerCoords[0]);
    }

    // Ensure CCW winding for outer ring (inner child exterior)
    const innerGeom: Area["geometry"] = {
      type: "Polygon",
      coordinates: [innerCoords],
    };

    // Outer geometry: parent geometry minus inner (using turf difference)
    const innerTurf = turf.polygon([innerCoords]);
    const outerTurf = turf.difference(
      buildPolygonFeatureCollection(area.geometry, innerTurf),
    );

    let outerGeom: Area["geometry"];
    if (outerTurf === null) {
      // Fallback: use parent geometry as outer
      outerGeom = area.geometry;
    } else {
      outerGeom = this.turfGeomToArea(
        outerTurf.geometry as { type: string; coordinates: unknown },
      );
    }

    const now = new Date();
    const outer: Area = {
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: childLevel.key,
      parent_id: areaId,
      geometry: outerGeom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    };
    const inner: Area = {
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: childLevel.key,
      parent_id: areaId,
      geometry: innerGeom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    };

    this.areaStore.addArea(outer);
    this.areaStore.addArea(inner);

    // Update ancestor geometries (parent itself and above)
    const modifiedAncestors = this.updateAncestorGeometries(areaId);

    const historyEntry: HistoryEntry = {
      created: [outer, inner],
      deleted: [],
      modified: modifiedAncestors,
    };
    const changeSet: ChangeSet = {
      created: [outer, inner],
      deleted: [],
      modified: modifiedAncestors.map((m) => m.after),
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return [outer, inner];
  }

  // ---- punchHole ----

  async punchHole(
    areaId: AreaID,
    holePath: Point[],
  ): Promise<{ donut: Area; inner: Area }> {
    this.assertInitialized();

    const area = this.areaStore.getArea(areaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${areaId}" not found`);
    }

    // Area must not have explicit children
    const explicitChildren = this.getExplicitChildrenOf(areaId);
    if (explicitChildren.length > 0) {
      throw new AreaHasChildrenError(`Area "${areaId}" has explicit children`);
    }

    // Validate hole path: at least 3 unique points
    const uniquePoints = this.deduplicatePoints(holePath);
    if (uniquePoints.length < 3) {
      throw new InvalidGeometryError(
        "punchHole: holePath must form a valid polygon (at least 3 unique points)",
      );
    }

    // Build hole polygon
    const holeCoords = uniquePoints.map((p) => [p.lng, p.lat]);
    if (
      holeCoords[0][0] !== holeCoords[holeCoords.length - 1][0] ||
      holeCoords[0][1] !== holeCoords[holeCoords.length - 1][1]
    ) {
      holeCoords.push(holeCoords[0]);
    }

    // Inner area geometry (the hole, as a normal polygon)
    const innerGeom: Area["geometry"] = {
      type: "Polygon",
      coordinates: [holeCoords],
    };

    // Donut geometry: parent minus the hole (using turf difference)
    const parentTurf = this.areaGeomToTurf(area.geometry);
    const holeTurf = turf.polygon([holeCoords]);
    const donutTurf = turf.difference(
      turf.featureCollection([parentTurf, holeTurf]) as FeatureCollection<
        Polygon | MultiPolygon
      >,
    );

    let donutGeom: Area["geometry"];
    if (donutTurf === null) {
      donutGeom = area.geometry;
    } else {
      donutGeom = this.turfGeomToArea(donutTurf.geometry);
    }

    const now = new Date();
    const beforeArea = { ...area };

    // Update area in place (donut retains the same id)
    const donut: Area = {
      ...area,
      geometry: donutGeom,
      updated_at: now,
    };
    this.areaStore.updateArea(donut);

    // Create inner sibling area (same parent_id and level_key as the donut)
    const inner: Area = {
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: area.level_key,
      parent_id: area.parent_id,
      geometry: innerGeom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    };
    this.areaStore.addArea(inner);

    // Update ancestor geometries
    const modifiedAncestors = this.updateAncestorGeometries(area.parent_id);

    const historyEntry: HistoryEntry = {
      created: [inner],
      deleted: [],
      modified: [{ before: beforeArea, after: donut }, ...modifiedAncestors],
    };
    const changeSet: ChangeSet = {
      created: [inner],
      deleted: [],
      modified: [donut, ...modifiedAncestors.map((m) => m.after)],
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return { donut, inner };
  }

  // ---- expandWithChild ----

  async expandWithChild(
    parentAreaId: AreaID,
    outerPath: Point[],
  ): Promise<{ parent: Area; child: Area }> {
    this.assertInitialized();

    const area = this.areaStore.getArea(parentAreaId);
    if (area === null) {
      throw new AreaNotFoundError(`Area "${parentAreaId}" not found`);
    }

    // Must have a child level
    const childLevel = this.levelStore.getChildLevel(area.level_key);
    if (childLevel === null) {
      throw new NoChildLevelError(
        `Area level "${area.level_key}" has no child level`,
      );
    }

    // outerPath needs at least 2 points
    if (outerPath.length < 2) {
      throw new InvalidGeometryError(
        "expandWithChild: outerPath must have at least 2 points",
      );
    }

    // Build the new child polygon from the outer path combined with the
    // parent boundary segment (from B back to A).
    // The child polygon is: outerPath[0] → ... → outerPath[n-1] → (parent boundary back to outerPath[0])
    // For simplicity, we form a polygon from outerPath as a closed ring.
    const outerCoords = outerPath.map((p) => [p.lng, p.lat]);
    if (
      outerCoords[0][0] !== outerCoords[outerCoords.length - 1][0] ||
      outerCoords[0][1] !== outerCoords[outerCoords.length - 1][1]
    ) {
      outerCoords.push(outerCoords[0]);
    }

    const childGeom: Area["geometry"] = {
      type: "Polygon",
      coordinates: [outerCoords],
    };

    // New parent geometry: union of current parent + child
    const parentTurf = this.areaGeomToTurf(area.geometry);
    const childTurf = turf.polygon([outerCoords]);
    const unionTurf = turf.union(
      turf.featureCollection([parentTurf, childTurf]) as FeatureCollection<
        Polygon | MultiPolygon
      >,
    );

    let newParentGeom: Area["geometry"];
    if (unionTurf === null) {
      newParentGeom = area.geometry;
    } else {
      newParentGeom = this.turfGeomToArea(unionTurf.geometry);
    }

    const now = new Date();
    const beforeParent = { ...area };

    // Create the new child area
    const child: Area = {
      id: crypto.randomUUID() as AreaID,
      display_name: "",
      level_key: childLevel.key,
      parent_id: parentAreaId,
      geometry: childGeom,
      created_at: now,
      updated_at: now,
      is_implicit: false,
    };
    this.areaStore.addArea(child);

    // Update parent geometry
    const updatedParent: Area = {
      ...area,
      geometry: newParentGeom,
      updated_at: now,
    };
    this.areaStore.updateArea(updatedParent);

    // Update ancestor geometries above parent
    const modifiedAncestors = this.updateAncestorGeometries(area.parent_id);

    const historyEntry: HistoryEntry = {
      created: [child],
      deleted: [],
      modified: [
        { before: beforeParent, after: updatedParent },
        ...modifiedAncestors,
      ],
    };
    const changeSet: ChangeSet = {
      created: [child],
      deleted: [],
      modified: [updatedParent, ...modifiedAncestors.map((m) => m.after)],
    };

    await this.callBatchWrite(changeSet);
    this.pushHistory(historyEntry);

    return { parent: updatedParent, child };
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

  // ============================================================
  // Private geometry helpers
  // ============================================================

  /**
   * Returns the exterior ring of an area geometry as an array of [lng, lat] pairs.
   * For a Polygon, this is coordinates[0]. For a MultiPolygon, this is coordinates[0][0].
   */
  private getExteriorRing(geometry: Area["geometry"]): number[][] {
    if (geometry.type === "Polygon") {
      return geometry.coordinates[0] as number[][];
    }
    // MultiPolygon: use the first polygon's exterior ring
    return (geometry.coordinates[0] as number[][][])[0] as number[][];
  }

  /**
   * Converts an area geometry to a turf Feature (Polygon or MultiPolygon).
   * Returns a plain GeoJSON Feature object to avoid turf type gymnastics.
   */
  private areaGeomToTurf(
    geometry: Area["geometry"],
  ): Feature<Polygon | MultiPolygon> {
    return {
      type: "Feature" as const,
      geometry: geometry as unknown as Polygon | MultiPolygon,
      properties: {},
    };
  }

  /**
   * Converts a turf result geometry (Polygon or MultiPolygon) to Area geometry type.
   */
  private turfGeomToArea(geometry: {
    type: string;
    coordinates: unknown;
  }): Area["geometry"] {
    if (geometry.type === "Polygon") {
      return {
        type: "Polygon",
        coordinates: geometry.coordinates as number[][][],
      };
    }
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates as number[][][][],
    };
  }

  /**
   * Removes duplicate consecutive points from a list (within epsilon = 1e-8).
   * Also handles the case where the first and last points in the input are the
   * same (as can happen with closed loops passed as arrays).
   */
  private deduplicatePoints(points: Point[]): Point[] {
    if (points.length === 0) return [];
    const epsilon = 1e-8;
    const first = points[0]!;
    const result: Point[] = [first];
    for (let i = 1; i < points.length; i++) {
      const prev = result[result.length - 1]!;
      const curr = points[i]!;
      const dlat = Math.abs(curr.lat - prev.lat);
      const dlng = Math.abs(curr.lng - prev.lng);
      if (dlat > epsilon || dlng > epsilon) {
        result.push(curr);
      }
    }
    // If the last point equals the first (closed ring input), remove the duplicate closing point
    if (result.length > 1) {
      const firstPt = result[0]!;
      const lastPt = result[result.length - 1]!;
      const dlat = Math.abs(lastPt.lat - firstPt.lat);
      const dlng = Math.abs(lastPt.lng - firstPt.lng);
      if (dlat <= epsilon && dlng <= epsilon) {
        result.pop();
      }
    }
    return result;
  }

  /**
   * Removes "whisker" segments from a cutting line.
   *
   * Whiskers are portions of the line that extend outside the polygon being cut.
   * This is implemented by removing consecutive duplicate points (within epsilon),
   * and trimming backtrack sequences where a segment immediately reverses direction.
   *
   * A simple approach: remove consecutive near-duplicate points, then remove any
   * point where the direction immediately reverses (dot product of consecutive
   * segment vectors is strongly negative, meaning the line backtracks).
   */
  private removeWhiskers(points: Point[]): Point[] {
    if (points.length <= 1) return [...points];

    const epsilon = 1e-8;

    // Step 1: remove consecutive duplicates
    const deduped: Point[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const prev = deduped[deduped.length - 1]!;
      const curr = points[i]!;
      if (
        Math.abs(curr.lat - prev.lat) > epsilon ||
        Math.abs(curr.lng - prev.lng) > epsilon
      ) {
        deduped.push(curr);
      }
    }

    if (deduped.length <= 2) return deduped;

    // Step 2: remove backtracking "whisker" points
    // A whisker occurs when point[i] causes the line to fold back:
    // vector(i-1 → i) · vector(i → i+1) < -0.99 * |v1| * |v2|
    // i.e., the direction almost exactly reverses.
    let changed = true;
    let result = deduped;
    while (changed && result.length > 2) {
      changed = false;
      const next: Point[] = [result[0]!];
      let i = 1;
      while (i < result.length - 1) {
        const p0 = next[next.length - 1]!;
        const p1 = result[i]!;
        const p2 = result[i + 1]!;

        const v1lat = p1.lat - p0.lat;
        const v1lng = p1.lng - p0.lng;
        const v2lat = p2.lat - p1.lat;
        const v2lng = p2.lng - p1.lng;

        const dot = v1lat * v2lat + v1lng * v2lng;
        const len1 = Math.sqrt(v1lat * v1lat + v1lng * v1lng);
        const len2 = Math.sqrt(v2lat * v2lat + v2lng * v2lng);

        // If the direction reverses sharply (dot / (len1 * len2) < -0.99)
        // skip point[i] (it's a whisker turning point)
        if (len1 > epsilon && len2 > epsilon && dot < -0.99 * len1 * len2) {
          // Whisker detected: skip p1, jump to p2
          changed = true;
          i += 2; // skip p1, process p2 next
        } else {
          next.push(p1);
          i++;
        }
      }
      if (i === result.length - 1) {
        next.push(result[result.length - 1]!);
      }
      result = next;
    }

    return result;
  }

  /**
   * Splits the given area geometry using a cutting line defined by points.
   * Returns an array of resulting polygon geometries.
   * If the line doesn't intersect, returns an array with one element (the original).
   *
   * Algorithm: builds two large half-plane polygons on each side of the cutting line,
   * then intersects each half-plane with the area polygon using turf.intersect.
   */
  private splitPolygonWithLine(
    geometry: Area["geometry"],
    points: Point[],
  ): Area["geometry"][] {
    if (points.length < 2) return [geometry];

    // Helper to split a single Polygon
    const splitSinglePolygon = (
      polyCoords: number[][][],
    ): Area["geometry"][] => {
      // Get bounding box of the polygon, extended by a large margin
      let minLng = Infinity,
        maxLng = -Infinity;
      let minLat = Infinity,
        maxLat = -Infinity;
      for (const ring of polyCoords) {
        for (const coord of ring) {
          if (coord[0]! < minLng) minLng = coord[0]!;
          if (coord[0]! > maxLng) maxLng = coord[0]!;
          if (coord[1]! < minLat) minLat = coord[1]!;
          if (coord[1]! > maxLat) maxLat = coord[1]!;
        }
      }
      // Extend bbox by a large margin so half-planes fully cover the polygon
      const margin = Math.max(maxLng - minLng, maxLat - minLat, 1) * 10;
      const bboxMinLng = minLng - margin;
      const bboxMaxLng = maxLng + margin;
      const bboxMinLat = minLat - margin;
      const bboxMaxLat = maxLat + margin;

      // Build the cutting line, extended to bbox edges
      const lineStart = points[0]!;
      const lineEnd = points[points.length - 1]!;

      // Direction vector of the line
      const dx = lineEnd.lng - lineStart.lng;
      const dy = lineEnd.lat - lineStart.lat;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-12) return [{ type: "Polygon", coordinates: polyCoords }];

      // Extend line to bbox boundaries by scaling
      const scale =
        (Math.max(bboxMaxLng - bboxMinLng, bboxMaxLat - bboxMinLat) * 2) / len;
      const extStart: [number, number] = [
        lineStart.lng - dx * scale,
        lineStart.lat - dy * scale,
      ];
      const extEnd: [number, number] = [
        lineEnd.lng + dx * scale,
        lineEnd.lat + dy * scale,
      ];

      // Perpendicular direction (rotated 90° CCW)
      const perpDx = -dy / len;
      const perpDy = dx / len;
      const perpScale = margin * 2;

      // Build two half-plane polygons by offsetting the line in each direction
      // Half-plane 1: to the left of the line (+ perpendicular direction)
      const halfPlane1Coords: [number, number][] = [
        extStart,
        extEnd,
        [extEnd[0] + perpDx * perpScale, extEnd[1] + perpDy * perpScale],
        [extStart[0] + perpDx * perpScale, extStart[1] + perpDy * perpScale],
        extStart,
      ];
      // Half-plane 2: to the right of the line (- perpendicular direction)
      const halfPlane2Coords: [number, number][] = [
        extStart,
        extEnd,
        [extEnd[0] - perpDx * perpScale, extEnd[1] - perpDy * perpScale],
        [extStart[0] - perpDx * perpScale, extStart[1] - perpDy * perpScale],
        extStart,
      ];

      const areaPoly = turf.polygon(polyCoords as number[][][]);
      const half1 = turf.polygon([halfPlane1Coords]);
      const half2 = turf.polygon([halfPlane2Coords]);

      const piece1 = turf.intersect(turf.featureCollection([areaPoly, half1]));
      const piece2 = turf.intersect(turf.featureCollection([areaPoly, half2]));

      const results: Area["geometry"][] = [];
      if (piece1 !== null) {
        results.push(
          this.turfGeomToArea(
            piece1.geometry as { type: string; coordinates: unknown },
          ),
        );
      }
      if (piece2 !== null) {
        results.push(
          this.turfGeomToArea(
            piece2.geometry as { type: string; coordinates: unknown },
          ),
        );
      }

      if (results.length === 0) {
        return [{ type: "Polygon", coordinates: polyCoords }];
      }
      return results;
    };

    // For MultiPolygon, split each polygon and collect all pieces
    if (geometry.type === "MultiPolygon") {
      const allPieces: Area["geometry"][] = [];
      for (const polyCoords of geometry.coordinates) {
        const pieces = splitSinglePolygon(polyCoords as number[][][]);
        allPieces.push(...pieces);
      }
      return allPieces;
    }

    // Polygon case
    return splitSinglePolygon(geometry.coordinates as number[][][]);
  }

  /**
   * Moves all vertices matching (oldLng, oldLat) within the given area's geometry
   * to the new coordinates (newLng, newLat), within the given epsilon tolerance.
   *
   * Returns the updated Area if any vertices were moved, or null if none matched.
   */
  private moveVertexInArea(
    area: Area,
    oldLng: number,
    oldLat: number,
    newLng: number,
    newLat: number,
    epsilon: number,
  ): Area | null {
    let moved = false;

    const moveInRing = (ring: number[][]): number[][] => {
      return ring.map((coord) => {
        const c = coord as number[];
        const dlat = Math.abs((c[1] as number) - oldLat);
        const dlng = Math.abs((c[0] as number) - oldLng);
        if (dlat <= epsilon && dlng <= epsilon) {
          moved = true;
          return [newLng, newLat];
        }
        return coord;
      });
    };

    let newGeometry: Area["geometry"];

    if (area.geometry.type === "Polygon") {
      const newCoords = (area.geometry.coordinates as number[][][]).map(
        moveInRing,
      );
      newGeometry = { type: "Polygon", coordinates: newCoords };
    } else {
      const newCoords = (area.geometry.coordinates as number[][][][]).map(
        (poly) => (poly as number[][][]).map(moveInRing),
      );
      newGeometry = { type: "MultiPolygon", coordinates: newCoords };
    }

    if (!moved) return null;

    return {
      ...area,
      geometry: newGeometry,
      updated_at: new Date(),
    };
  }

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
    return this.areaStore.getChildren(parentId).filter((c) => !c.is_implicit);
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
   * Returns true if `candidateId` is a descendant (direct or indirect child)
   * of `ancestorId`. Used to detect circular references in reparentArea.
   */
  private isDescendant(candidateId: AreaID, ancestorId: AreaID): boolean {
    const visited = new Set<AreaID>();
    const queue: AreaID[] = [ancestorId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const children = this.getExplicitChildrenOf(current);
      for (const child of children) {
        if (child.id === candidateId) return true;
        queue.push(child.id);
      }
    }
    return false;
  }

  /**
   * Walks up the ancestor chain from `startParentId` and rebuilds each
   * ancestor's geometry as the union of its explicit children.
   *
   * Returns an array of { before, after } pairs for the HistoryEntry.
   */
  private updateAncestorGeometries(
    startParentId: AreaID | null,
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
