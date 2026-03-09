import type {
  MapPolygon,
  Group,
  PolygonID,
  GroupID,
  DraftID,
  DraftShape,
  ChangeSet,
  HistoryEntry,
  PersistedDraft,
  StorageAdapter,
  GeometryViolation,
  GeoJSONPolygon,
} from "./types/index.js";
import { makePolygonID, makeGroupID, makeDraftID } from "./types/index.js";
import { PolygonStore } from "./polygon-store/polygon-store.js";
import { GroupStore } from "./group-store/group-store.js";
import { DraftStore } from "./draft/draft-store.js";
import { validateDraft as validateDraftFn } from "./draft/validate-draft.js";
import { draftToGeoJSON } from "./draft/draft-operations.js";
import {
  NotInitializedError,
  StorageError,
  PolygonNotFoundError,
  GroupNotFoundError,
  GroupWouldBeEmptyError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
  CircularReferenceError,
  SelfReferenceError,
  MixedParentError,
  DataIntegrityError,
} from "./errors.js";

interface MapPolygonEditorConfig {
  storageAdapter: StorageAdapter;
  maxUndoSteps?: number;
  epsilon?: number;
}

export class MapPolygonEditor {
  private storageAdapter: StorageAdapter;
  private maxUndoSteps: number;
  private epsilon: number;
  private initialized = false;

  private polygonStore = new PolygonStore();
  private groupStore = new GroupStore();
  private draftStore = new DraftStore([]);

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(config: MapPolygonEditorConfig) {
    this.storageAdapter = config.storageAdapter;
    this.maxUndoSteps = config.maxUndoSteps ?? 100;
    this.epsilon = config.epsilon ?? 1e-8;
  }

  // ============================================================
  // Initialization
  // ============================================================

  async initialize(): Promise<void> {
    let data: {
      polygons: MapPolygon[];
      groups: Group[];
      drafts: PersistedDraft[];
    };
    try {
      data = await this.storageAdapter.loadAll();
    } catch (e) {
      throw new StorageError(
        `Failed to load data: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    for (const group of data.groups) {
      this.groupStore.add(group);
    }
    for (const polygon of data.polygons) {
      this.polygonStore.add(polygon);
    }
    for (const draft of data.drafts) {
      this.draftStore.save(draft);
    }

    this.validateDataIntegrity();
    this.initialized = true;
  }

  private validateDataIntegrity(): void {
    for (const p of this.polygonStore.getAll()) {
      if (p.parent_id !== null && this.groupStore.get(p.parent_id) === null) {
        throw new DataIntegrityError(
          `Polygon "${p.id}" references non-existent parent group "${p.parent_id}"`,
        );
      }
    }
    for (const g of this.groupStore.getAll()) {
      if (g.parent_id !== null && this.groupStore.get(g.parent_id) === null) {
        throw new DataIntegrityError(
          `Group "${g.id}" references non-existent parent group "${g.parent_id}"`,
        );
      }
    }
  }

  private guard(): void {
    if (!this.initialized) {
      throw new NotInitializedError(
        "initialize() must be called before using the editor",
      );
    }
  }

  // ============================================================
  // Query APIs (synchronous)
  // ============================================================

  getPolygon(id: PolygonID): MapPolygon | null {
    this.guard();
    return this.polygonStore.get(id);
  }

  getGroup(id: GroupID): Group | null {
    this.guard();
    return this.groupStore.get(id);
  }

  getChildren(groupId: GroupID): (MapPolygon | Group)[] {
    this.guard();
    const polygons = this.polygonStore.getByParent(groupId);
    const groups = this.groupStore.getChildGroups(groupId);
    return [...polygons, ...groups];
  }

  getRoots(): (MapPolygon | Group)[] {
    this.guard();
    return [...this.polygonStore.getRoots(), ...this.groupStore.getRoots()];
  }

  getAllPolygons(): MapPolygon[] {
    this.guard();
    return this.polygonStore.getAll();
  }

  getAllGroups(): Group[] {
    this.guard();
    return this.groupStore.getAll();
  }

  getDescendantPolygons(groupId: GroupID): MapPolygon[] {
    this.guard();
    const result: MapPolygon[] = [];
    this.collectDescendantPolygons(groupId, result);
    return result;
  }

  private collectDescendantPolygons(
    groupId: GroupID,
    result: MapPolygon[],
  ): void {
    result.push(...this.polygonStore.getByParent(groupId));
    for (const child of this.groupStore.getChildGroups(groupId)) {
      this.collectDescendantPolygons(child.id, result);
    }
  }

  validateDraft(draft: DraftShape): GeometryViolation[] {
    this.guard();
    return validateDraftFn(draft);
  }

  // ============================================================
  // Polygon CRUD
  // ============================================================

  async saveAsPolygon(draft: DraftShape, name: string): Promise<MapPolygon> {
    this.guard();
    if (!draft.isClosed) {
      throw new DraftNotClosedError(
        "DraftShape must be closed to save as polygon",
      );
    }
    const violations = validateDraftFn(draft);
    if (violations.length > 0) {
      throw new InvalidGeometryError(
        `Invalid geometry: ${violations.map((v) => v.code).join(", ")}`,
      );
    }

    const geometry = draftToGeoJSON(draft) as GeoJSONPolygon;
    const now = new Date();
    const polygon: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry,
      display_name: name,
      parent_id: null,
      created_at: now,
      updated_at: now,
    };

    this.polygonStore.add(polygon);

    const entry: HistoryEntry = {
      createdPolygons: [polygon],
      deletedPolygons: [],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [],
    };
    this.pushHistory(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: [polygon],
      deletedPolygonIds: [],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return polygon;
  }

  async renamePolygon(polygonId: PolygonID, name: string): Promise<MapPolygon> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const before = { ...polygon };
    const after: MapPolygon = {
      ...polygon,
      display_name: name,
      updated_at: new Date(),
    };
    this.polygonStore.update(after);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons: [{ before, after }],
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: [after],
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return after;
  }

  async deletePolygon(polygonId: PolygonID): Promise<void> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    if (polygon.parent_id !== null) {
      this.checkGroupWouldBeEmpty(polygon.parent_id, polygonId, null);
    }

    this.polygonStore.delete(polygonId);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [polygon],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });
  }

  loadPolygonToDraft(polygonId: PolygonID): DraftShape {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const coords = polygon.geometry.coordinates[0];
    const points = coords.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
    return { points, isClosed: true };
  }

  async updatePolygonGeometry(
    polygonId: PolygonID,
    draft: DraftShape,
  ): Promise<MapPolygon> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);
    if (!draft.isClosed) {
      throw new DraftNotClosedError("DraftShape must be closed");
    }
    const violations = validateDraftFn(draft);
    if (violations.length > 0) {
      throw new InvalidGeometryError(
        `Invalid geometry: ${violations.map((v) => v.code).join(", ")}`,
      );
    }

    const geometry = draftToGeoJSON(draft) as GeoJSONPolygon;
    const before = { ...polygon };
    const after: MapPolygon = { ...polygon, geometry, updated_at: new Date() };
    this.polygonStore.update(after);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons: [{ before, after }],
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: [after],
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return after;
  }

  // ============================================================
  // Group Management
  // ============================================================

  async createGroup(
    name: string,
    childIds: (PolygonID | GroupID)[],
  ): Promise<Group> {
    this.guard();
    if (childIds.length === 0) {
      throw new GroupWouldBeEmptyError(
        "createGroup requires at least one child",
      );
    }

    const parentIds = new Set<string>();
    const childPolygons: MapPolygon[] = [];
    const childGroups: Group[] = [];

    for (const id of childIds) {
      const polygon = this.polygonStore.get(id as PolygonID);
      if (polygon) {
        parentIds.add(polygon.parent_id ?? "__root__");
        childPolygons.push(polygon);
        continue;
      }
      const group = this.groupStore.get(id as GroupID);
      if (group) {
        parentIds.add(group.parent_id ?? "__root__");
        childGroups.push(group);
        continue;
      }
      throw new PolygonNotFoundError(`Node "${id}" not found`);
    }

    if (parentIds.size > 1) {
      throw new MixedParentError("All children must share the same parent");
    }

    const commonParentRaw = [...parentIds][0];
    const commonParent =
      commonParentRaw === "__root__" ? null : (commonParentRaw as GroupID);

    const now = new Date();
    const group: Group = {
      id: makeGroupID(crypto.randomUUID()),
      display_name: name,
      parent_id: commonParent,
      created_at: now,
      updated_at: now,
    };

    this.groupStore.add(group);

    const modifiedPolygons: Array<{ before: MapPolygon; after: MapPolygon }> =
      [];
    const modifiedGroups: Array<{ before: Group; after: Group }> = [];

    for (const p of childPolygons) {
      const before = { ...p };
      const after: MapPolygon = { ...p, parent_id: group.id, updated_at: now };
      this.polygonStore.update(after);
      modifiedPolygons.push({ before, after });
    }
    for (const g of childGroups) {
      const before = { ...g };
      const after: Group = { ...g, parent_id: group.id, updated_at: now };
      this.groupStore.update(after);
      modifiedGroups.push({ before, after });
    }

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons,
      createdGroups: [group],
      deletedGroups: [],
      modifiedGroups,
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: modifiedPolygons.map((m) => m.after),
      createdGroups: [group],
      deletedGroupIds: [],
      modifiedGroups: modifiedGroups.map((m) => m.after),
    });

    return group;
  }

  async renameGroup(groupId: GroupID, name: string): Promise<Group> {
    this.guard();
    const group = this.groupStore.get(groupId);
    if (!group) throw new GroupNotFoundError(`Group "${groupId}" not found`);

    const before = { ...group };
    const after: Group = {
      ...group,
      display_name: name,
      updated_at: new Date(),
    };
    this.groupStore.update(after);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [{ before, after }],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [after],
    });

    return after;
  }

  async deleteGroup(
    groupId: GroupID,
    options?: { cascade?: boolean },
  ): Promise<void> {
    this.guard();
    const group = this.groupStore.get(groupId);
    if (!group) throw new GroupNotFoundError(`Group "${groupId}" not found`);

    if (options?.cascade) {
      await this.deleteGroupCascade(group);
    } else {
      await this.deleteGroupUngroup(group);
    }
  }

  private async deleteGroupCascade(group: Group): Promise<void> {
    const deletedPolygons: MapPolygon[] = [];
    const deletedGroups: Group[] = [];
    const deletedPolygonIds: PolygonID[] = [];
    const deletedGroupIds: GroupID[] = [];

    this.collectAllDescendants(group.id, deletedPolygons, deletedGroups);

    for (const p of deletedPolygons) {
      this.polygonStore.delete(p.id);
      deletedPolygonIds.push(p.id);
    }
    for (const g of deletedGroups) {
      this.groupStore.delete(g.id);
      deletedGroupIds.push(g.id);
    }
    this.groupStore.delete(group.id);
    deletedGroups.push(group);
    deletedGroupIds.push(group.id);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons,
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroups,
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds,
      modifiedPolygons: [],
      createdGroups: [],
      deletedGroupIds,
      modifiedGroups: [],
    });
  }

  private collectAllDescendants(
    groupId: GroupID,
    polygons: MapPolygon[],
    groups: Group[],
  ): void {
    polygons.push(...this.polygonStore.getByParent(groupId));
    for (const child of this.groupStore.getChildGroups(groupId)) {
      this.collectAllDescendants(child.id, polygons, groups);
      groups.push(child);
    }
  }

  private async deleteGroupUngroup(group: Group): Promise<void> {
    const parentId = group.parent_id;
    const now = new Date();
    const modifiedPolygons: Array<{ before: MapPolygon; after: MapPolygon }> =
      [];
    const modifiedGroups: Array<{ before: Group; after: Group }> = [];

    for (const p of this.polygonStore.getByParent(group.id)) {
      const before = { ...p };
      const after: MapPolygon = { ...p, parent_id: parentId, updated_at: now };
      this.polygonStore.update(after);
      modifiedPolygons.push({ before, after });
    }
    for (const g of this.groupStore.getChildGroups(group.id)) {
      const before = { ...g };
      const after: Group = { ...g, parent_id: parentId, updated_at: now };
      this.groupStore.update(after);
      modifiedGroups.push({ before, after });
    }

    this.groupStore.delete(group.id);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons,
      createdGroups: [],
      deletedGroups: [group],
      modifiedGroups,
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: modifiedPolygons.map((m) => m.after),
      createdGroups: [],
      deletedGroupIds: [group.id],
      modifiedGroups: modifiedGroups.map((m) => m.after),
    });
  }

  async moveToGroup(
    nodeId: PolygonID | GroupID,
    newParentId: GroupID | null,
  ): Promise<void> {
    this.guard();

    const polygon = this.polygonStore.get(nodeId as PolygonID);
    const group = this.groupStore.get(nodeId as GroupID);
    if (!polygon && !group) {
      throw new PolygonNotFoundError(`Node "${nodeId}" not found`);
    }

    const isGroup = !!group;
    const oldParentId = isGroup ? group!.parent_id : polygon!.parent_id;

    if (isGroup && newParentId === nodeId) {
      throw new SelfReferenceError(`Cannot move group "${nodeId}" into itself`);
    }

    if (isGroup && newParentId !== null) {
      let cursor: GroupID | null = newParentId;
      while (cursor !== null) {
        if (cursor === nodeId) {
          throw new CircularReferenceError(
            `Moving group "${nodeId}" under "${newParentId}" would create a cycle`,
          );
        }
        const parent = this.groupStore.get(cursor);
        cursor = parent?.parent_id ?? null;
      }
    }

    if (oldParentId !== null) {
      this.checkGroupWouldBeEmpty(
        oldParentId,
        nodeId as PolygonID,
        nodeId as GroupID,
      );
    }

    if (newParentId !== null && this.groupStore.get(newParentId) === null) {
      throw new GroupNotFoundError(`Group "${newParentId}" not found`);
    }

    const now = new Date();
    if (polygon) {
      const before = { ...polygon };
      const after: MapPolygon = {
        ...polygon,
        parent_id: newParentId,
        updated_at: now,
      };
      this.polygonStore.update(after);

      this.pushHistory({
        createdPolygons: [],
        deletedPolygons: [],
        modifiedPolygons: [{ before, after }],
        createdGroups: [],
        deletedGroups: [],
        modifiedGroups: [],
      });

      await this.storageAdapter.batchWrite({
        createdPolygons: [],
        deletedPolygonIds: [],
        modifiedPolygons: [after],
        createdGroups: [],
        deletedGroupIds: [],
        modifiedGroups: [],
      });
    } else {
      const before = { ...group! };
      const after: Group = {
        ...group!,
        parent_id: newParentId,
        updated_at: now,
      };
      this.groupStore.update(after);

      this.pushHistory({
        createdPolygons: [],
        deletedPolygons: [],
        modifiedPolygons: [],
        createdGroups: [],
        deletedGroups: [],
        modifiedGroups: [{ before, after }],
      });

      await this.storageAdapter.batchWrite({
        createdPolygons: [],
        deletedPolygonIds: [],
        modifiedPolygons: [],
        createdGroups: [],
        deletedGroupIds: [],
        modifiedGroups: [after],
      });
    }
  }

  async ungroupChildren(groupId: GroupID): Promise<void> {
    await this.deleteGroup(groupId, { cascade: false });
  }

  // ============================================================
  // Draft Persistence
  // ============================================================

  async saveDraftToStorage(
    draft: DraftShape,
    metadata?: Record<string, unknown>,
  ): Promise<PersistedDraft> {
    this.guard();
    const now = new Date();
    const persisted: PersistedDraft = {
      id: makeDraftID(crypto.randomUUID()),
      points: draft.points,
      isClosed: draft.isClosed,
      created_at: now,
      updated_at: now,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this.draftStore.save(persisted);
    await this.storageAdapter.saveDraft(persisted);
    return persisted;
  }

  loadDraftFromStorage(id: DraftID): DraftShape {
    this.guard();
    const persisted = this.draftStore.get(id);
    if (!persisted) throw new DraftNotFoundError(`Draft "${id}" not found`);
    return { points: persisted.points, isClosed: persisted.isClosed };
  }

  listPersistedDrafts(): PersistedDraft[] {
    this.guard();
    return this.draftStore.getAll();
  }

  async deleteDraftFromStorage(id: DraftID): Promise<void> {
    this.guard();
    this.draftStore.delete(id);
    await this.storageAdapter.deleteDraft(id);
  }

  // ============================================================
  // Undo / Redo
  // ============================================================

  canUndo(): boolean {
    this.guard();
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    this.guard();
    return this.redoStack.length > 0;
  }

  async undo(): Promise<void> {
    this.guard();
    const entry = this.undoStack.pop();
    if (!entry) return;

    for (const p of entry.createdPolygons) this.polygonStore.delete(p.id);
    for (const g of entry.createdGroups) this.groupStore.delete(g.id);
    for (const p of entry.deletedPolygons) this.polygonStore.add(p);
    for (const g of entry.deletedGroups) this.groupStore.add(g);
    for (const { before } of entry.modifiedPolygons)
      this.polygonStore.update(before);
    for (const { before } of entry.modifiedGroups)
      this.groupStore.update(before);

    this.redoStack.push(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: entry.deletedPolygons,
      deletedPolygonIds: entry.createdPolygons.map((p) => p.id),
      modifiedPolygons: entry.modifiedPolygons.map((m) => m.before),
      createdGroups: entry.deletedGroups,
      deletedGroupIds: entry.createdGroups.map((g) => g.id),
      modifiedGroups: entry.modifiedGroups.map((m) => m.before),
    });
  }

  async redo(): Promise<void> {
    this.guard();
    const entry = this.redoStack.pop();
    if (!entry) return;

    for (const p of entry.createdPolygons) this.polygonStore.add(p);
    for (const g of entry.createdGroups) this.groupStore.add(g);
    for (const p of entry.deletedPolygons) this.polygonStore.delete(p.id);
    for (const g of entry.deletedGroups) this.groupStore.delete(g.id);
    for (const { after } of entry.modifiedPolygons)
      this.polygonStore.update(after);
    for (const { after } of entry.modifiedGroups) this.groupStore.update(after);

    this.undoStack.push(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: entry.createdPolygons,
      deletedPolygonIds: entry.deletedPolygons.map((p) => p.id),
      modifiedPolygons: entry.modifiedPolygons.map((m) => m.after),
      createdGroups: entry.createdGroups,
      deletedGroupIds: entry.deletedGroups.map((g) => g.id),
      modifiedGroups: entry.modifiedGroups.map((m) => m.after),
    });
  }

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private checkGroupWouldBeEmpty(
    groupId: GroupID,
    removingPolygonId: PolygonID | null,
    removingGroupId: GroupID | null,
  ): void {
    const childPolygons = this.polygonStore.getByParent(groupId);
    const childGroups = this.groupStore.getChildGroups(groupId);
    let count = childPolygons.length + childGroups.length;

    if (removingPolygonId) {
      for (const p of childPolygons) {
        if (p.id === removingPolygonId) {
          count--;
          break;
        }
      }
    }
    if (removingGroupId) {
      for (const g of childGroups) {
        if (g.id === removingGroupId) {
          count--;
          break;
        }
      }
    }

    if (count < 1) {
      throw new GroupWouldBeEmptyError(
        `Removing from group "${groupId}" would leave it empty`,
      );
    }
  }
}
