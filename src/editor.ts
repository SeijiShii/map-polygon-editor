import type {
  MapPolygon,
  PolygonID,
  UnionCacheID,
  DraftID,
  DraftShape,
  ChangeSet,
  HistoryEntry,
  PersistedDraft,
  StorageAdapter,
  GeometryViolation,
  GeoJSONPolygon,
} from "./types/index.js";
import { makePolygonID, makeUnionCacheID, makeDraftID } from "./types/index.js";
import { PolygonStore } from "./polygon-store/polygon-store.js";
import { DraftStore } from "./draft/draft-store.js";
import { validateDraft as validateDraftFn } from "./draft/validate-draft.js";
import { draftToGeoJSON } from "./draft/draft-operations.js";
import {
  polygon as turfPolygon,
  lineString as turfLineString,
  featureCollection,
} from "@turf/helpers";
import { lineIntersect } from "@turf/line-intersect";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { intersection as polyClipIntersection } from "polyclip-ts";
import { computeUnion } from "./geometry/compute-union.js";
import { computeBridgePolygon } from "./geometry/bridge-polygon.js";
import {
  buildConnectivityGraph,
  findLoop,
  extractLoopRing,
} from "./geometry/detect-loop.js";
import type { DraftEndpoint } from "./geometry/detect-loop.js";
import {
  NotInitializedError,
  StorageError,
  PolygonNotFoundError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
} from "./errors.js";

export type BridgeResult =
  | { ok: true; polygon: MapPolygon }
  | { ok: false; draft: PersistedDraft };

interface CachedUnion {
  id: UnionCacheID;
  sourcePolygonIds: PolygonID[];
  sourceUnionIds: UnionCacheID[];
  result: GeoJSONPolygon[];
  dirty: boolean;
}

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
  private draftStore = new DraftStore([]);

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  /** Coordinate hash index: quantized "gx,gy" → Set of PolygonIDs that have a vertex in that cell */
  private coordIndex = new Map<string, Set<PolygonID>>();
  private readonly coordEpsilon = 1e-8;

  /** Draft endpoint index: quantized "gx,gy" → Set of DraftIDs that have an endpoint in that cell */
  private draftEndpointIndex = new Map<string, Set<DraftID>>();

  /** Union cache */
  private unionCache = new Map<UnionCacheID, CachedUnion>();
  private polygonToUnionIndex = new Map<PolygonID, Set<UnionCacheID>>();
  /** Reverse index: child UnionCacheID → Set of parent UnionCacheIDs that depend on it */
  private unionToUnionIndex = new Map<UnionCacheID, Set<UnionCacheID>>();

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
      drafts: PersistedDraft[];
    };
    try {
      data = await this.storageAdapter.loadAll();
    } catch (e) {
      throw new StorageError(
        `Failed to load data: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    for (const polygon of data.polygons) {
      this.polygonStore.add(polygon);
    }
    for (const draft of data.drafts) {
      this.draftStore.save(draft);
    }

    this.rebuildCoordIndex();
    this.rebuildDraftEndpointIndex();
    this.initialized = true;
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

  getAllPolygons(): MapPolygon[] {
    this.guard();
    return this.polygonStore.getAll();
  }

  // ============================================================
  // Union Cache API
  // ============================================================

  computeUnion(polygonIds: PolygonID[]): UnionCacheID {
    this.guard();
    const geometries: GeoJSONPolygon[] = [];
    for (const pid of polygonIds) {
      const p = this.polygonStore.get(pid);
      if (p) geometries.push(p.geometry);
    }

    const id = makeUnionCacheID(crypto.randomUUID());
    const result = computeUnion(geometries);
    const entry: CachedUnion = {
      id,
      sourcePolygonIds: [...polygonIds],
      sourceUnionIds: [],
      result,
      dirty: false,
    };

    this.unionCache.set(id, entry);

    // Build reverse index
    for (const pid of polygonIds) {
      let set = this.polygonToUnionIndex.get(pid);
      if (!set) {
        set = new Set();
        this.polygonToUnionIndex.set(pid, set);
      }
      set.add(id);
    }

    return id;
  }

  computeUnionFromCaches(cacheIds: UnionCacheID[]): UnionCacheID {
    this.guard();
    // Gather geometries from child caches
    const geometries: GeoJSONPolygon[] = [];
    for (const cid of cacheIds) {
      const childResult = this.getCachedUnion(cid);
      if (childResult) {
        for (const g of childResult) geometries.push(g);
      }
    }

    const id = makeUnionCacheID(crypto.randomUUID());
    const result = computeUnion(geometries);
    const entry: CachedUnion = {
      id,
      sourcePolygonIds: [],
      sourceUnionIds: [...cacheIds],
      result,
      dirty: false,
    };

    this.unionCache.set(id, entry);

    // Build union-to-union reverse index
    for (const cid of cacheIds) {
      let set = this.unionToUnionIndex.get(cid);
      if (!set) {
        set = new Set();
        this.unionToUnionIndex.set(cid, set);
      }
      set.add(id);
    }

    return id;
  }

  getCachedUnion(cacheId: UnionCacheID): GeoJSONPolygon[] | null {
    this.guard();
    const entry = this.unionCache.get(cacheId);
    if (!entry) return null;

    if (entry.dirty) {
      if (entry.sourceUnionIds.length > 0) {
        // Composite cache: recompute from child caches
        const geometries: GeoJSONPolygon[] = [];
        const validUnionIds: UnionCacheID[] = [];
        for (const cid of entry.sourceUnionIds) {
          const childResult = this.getCachedUnion(cid);
          if (childResult) {
            for (const g of childResult) geometries.push(g);
            validUnionIds.push(cid);
          }
        }
        entry.sourceUnionIds = validUnionIds;
        entry.result = computeUnion(geometries);
      } else {
        // Leaf cache: recompute from polygons — exclude deleted
        const geometries: GeoJSONPolygon[] = [];
        const validIds: PolygonID[] = [];
        for (const pid of entry.sourcePolygonIds) {
          const p = this.polygonStore.get(pid);
          if (p) {
            geometries.push(p.geometry);
            validIds.push(pid);
          }
        }
        entry.sourcePolygonIds = validIds;
        entry.result = computeUnion(geometries);
      }
      entry.dirty = false;
    }

    return entry.result;
  }

  deleteCachedUnion(cacheId: UnionCacheID): void {
    this.guard();
    const entry = this.unionCache.get(cacheId);
    if (!entry) return;

    // Clean up polygon-to-union reverse index
    for (const pid of entry.sourcePolygonIds) {
      const set = this.polygonToUnionIndex.get(pid);
      if (set) {
        set.delete(cacheId);
        if (set.size === 0) this.polygonToUnionIndex.delete(pid);
      }
    }

    // Clean up union-to-union reverse index (this cache as child)
    for (const cid of entry.sourceUnionIds) {
      const set = this.unionToUnionIndex.get(cid);
      if (set) {
        set.delete(cacheId);
        if (set.size === 0) this.unionToUnionIndex.delete(cid);
      }
    }

    // Clean up union-to-union reverse index (this cache as parent)
    this.unionToUnionIndex.delete(cacheId);

    this.unionCache.delete(cacheId);
  }

  private invalidateUnionCaches(polygonId: PolygonID): void {
    const cacheIds = this.polygonToUnionIndex.get(polygonId);
    if (!cacheIds) return;
    for (const cacheId of cacheIds) {
      this.markDirtyAndCascade(cacheId);
    }
  }

  /** Mark a cache entry dirty and cascade upward to all parent caches */
  private markDirtyAndCascade(cacheId: UnionCacheID): void {
    const entry = this.unionCache.get(cacheId);
    if (!entry || entry.dirty) return; // already dirty — no need to cascade further
    entry.dirty = true;
    const parentIds = this.unionToUnionIndex.get(cacheId);
    if (parentIds) {
      for (const parentId of parentIds) {
        this.markDirtyAndCascade(parentId);
      }
    }
  }

  private invalidateUnionCachesForMany(polygonIds: PolygonID[]): void {
    for (const pid of polygonIds) {
      this.invalidateUnionCaches(pid);
    }
  }

  // ============================================================
  // Shared Edge Move
  // ============================================================

  async sharedEdgeMove(
    polygonId: PolygonID,
    index: number,
    lat: number,
    lng: number,
  ): Promise<MapPolygon[]> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const coords = polygon.geometry.coordinates[0];
    const oldCoord = coords[index];
    if (!oldCoord) {
      throw new PolygonNotFoundError(
        `Vertex index ${index} out of range for polygon "${polygonId}"`,
      );
    }

    const [oldLng, oldLat] = oldCoord;

    // Epsilon-based lookup: find all polygon IDs in neighboring grid cells
    const candidateIds = this.findNearbyPolygonIds(oldLng, oldLat);
    // Filter to only polygons that actually have a vertex within epsilon
    const polygonIdsToUpdate: PolygonID[] = [];
    for (const pid of candidateIds) {
      const p = this.polygonStore.get(pid);
      if (!p) continue;
      const hasMatch = p.geometry.coordinates[0].some((c) =>
        this.coordWithinEpsilon(c[0], c[1], oldLng, oldLat),
      );
      if (hasMatch) polygonIdsToUpdate.push(pid);
    }
    if (!polygonIdsToUpdate.includes(polygonId)) {
      polygonIdsToUpdate.push(polygonId);
    }

    const modifiedPolygons: Array<{ before: MapPolygon; after: MapPolygon }> =
      [];
    const updatedPolygons: MapPolygon[] = [];

    for (const pid of polygonIdsToUpdate) {
      const p = this.polygonStore.get(pid);
      if (!p) continue;

      const before = {
        ...p,
        geometry: {
          ...p.geometry,
          coordinates: [...p.geometry.coordinates.map((ring) => [...ring])],
        },
      };
      const newCoords = p.geometry.coordinates[0].map((c) =>
        this.coordWithinEpsilon(c[0], c[1], oldLng, oldLat)
          ? [lng, lat]
          : [...c],
      );
      const newGeometry: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [newCoords],
      };
      const after: MapPolygon = {
        ...p,
        geometry: newGeometry,
        updated_at: new Date(),
      };

      // Update coordinate index
      this.unindexPolygon(p);
      this.polygonStore.update(after);
      this.indexPolygon(after);

      modifiedPolygons.push({ before, after });
      updatedPolygons.push(after);
    }

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons,
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: updatedPolygons,
    });

    this.invalidateUnionCachesForMany(polygonIdsToUpdate);

    return updatedPolygons;
  }

  // ============================================================
  // Expand With Polygon
  // ============================================================

  async expandWithPolygon(
    polygonId: PolygonID,
    outerPath: { lat: number; lng: number }[],
    childName: string,
  ): Promise<{ original: MapPolygon; added: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    // Build added polygon from outer path
    const addedCoords = outerPath.map(
      (p) => [p.lng, p.lat] as [number, number],
    );
    // Ensure closure
    if (
      addedCoords[0][0] !== addedCoords[addedCoords.length - 1][0] ||
      addedCoords[0][1] !== addedCoords[addedCoords.length - 1][1]
    ) {
      addedCoords.push([...addedCoords[0]] as [number, number]);
    }

    // Delete original polygon
    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    const now = new Date();

    // Create new polygon with original geometry (new id)
    const originalPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: polygon.geometry,
      display_name: polygon.display_name,
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(originalPoly);
    this.indexPolygon(originalPoly);

    // Create added polygon
    const addedPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: [addedCoords] },
      display_name: childName,
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(addedPoly);
    this.indexPolygon(addedPoly);

    const createdPolygons = [originalPoly, addedPoly];

    this.pushHistory({
      createdPolygons,
      deletedPolygons: [polygon],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
    });

    this.invalidateUnionCaches(polygonId);

    return {
      original: originalPoly,
      added: addedPoly,
    };
  }

  // ============================================================
  // Bridge Polygons
  // ============================================================

  async bridgePolygons(
    polygonAId: PolygonID,
    aVertexIndex: number,
    polygonBId: PolygonID,
    bVertexIndex: number,
    bridgePath: { lat: number; lng: number }[],
    name: string,
  ): Promise<BridgeResult> {
    this.guard();

    const polyA = this.polygonStore.get(polygonAId);
    if (!polyA)
      throw new PolygonNotFoundError(`Polygon "${polygonAId}" not found`);

    const polyB = this.polygonStore.get(polygonBId);
    if (!polyB)
      throw new PolygonNotFoundError(`Polygon "${polygonBId}" not found`);

    const ringA = polyA.geometry.coordinates[0]!;
    const ringB = polyB.geometry.coordinates[0]!;

    // Convert bridge path to [lng, lat] format
    const bridgeLine = bridgePath.map((p) => [p.lng, p.lat]);

    const closedRing = computeBridgePolygon(
      ringA,
      ringB,
      aVertexIndex,
      bVertexIndex,
      bridgeLine,
      this.coordEpsilon,
    );

    // If no shared vertices, try loop detection through existing drafts
    if (closedRing === null) {
      const loopResult = this.detectAndBuildLoop(bridgeLine);
      if (loopResult) {
        // Loop found — create polygon and delete consumed drafts
        const now = new Date();
        const polygon: MapPolygon = {
          id: makePolygonID(crypto.randomUUID()),
          geometry: { type: "Polygon", coordinates: [loopResult.ring] },
          display_name: name,
          created_at: now,
          updated_at: now,
        };

        this.polygonStore.add(polygon);
        this.indexPolygon(polygon);

        this.pushHistory({
          createdPolygons: [polygon],
          deletedPolygons: [],
          modifiedPolygons: [],
        });

        await this.storageAdapter.batchWrite({
          createdPolygons: [polygon],
          deletedPolygonIds: [],
          modifiedPolygons: [],
        });

        // Delete consumed drafts
        for (const draftId of loopResult.consumedDraftIds) {
          await this.deleteDraftFromStorage(draftId);
        }

        return { ok: true, polygon };
      }

      // No loop — save as draft
      const draft = {
        points: bridgePath.map((p) => ({ lat: p.lat, lng: p.lng })),
        isClosed: false,
      };
      const persisted = await this.saveDraftToStorage(draft);
      return { ok: false, draft: persisted };
    }

    // Create the bridged polygon
    const now = new Date();
    const polygon: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: [closedRing] },
      display_name: name,
      created_at: now,
      updated_at: now,
    };

    this.polygonStore.add(polygon);
    this.indexPolygon(polygon);

    this.pushHistory({
      createdPolygons: [polygon],
      deletedPolygons: [],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [polygon],
      deletedPolygonIds: [],
      modifiedPolygons: [],
    });

    return { ok: true, polygon };
  }

  // ============================================================
  // Punch Hole
  // ============================================================

  async punchHole(
    polygonId: PolygonID,
    holePath: { lat: number; lng: number }[],
  ): Promise<{ donut: MapPolygon; inner: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    // Build hole coordinates
    const holeCoords = holePath.map((p) => [p.lng, p.lat] as [number, number]);
    if (
      holeCoords[0][0] !== holeCoords[holeCoords.length - 1][0] ||
      holeCoords[0][1] !== holeCoords[holeCoords.length - 1][1]
    ) {
      holeCoords.push([...holeCoords[0]] as [number, number]);
    }

    // Donut = outer ring + hole as inner ring
    const outerRing = polygon.geometry.coordinates[0];
    const donutCoords: number[][][] = [outerRing, holeCoords];

    // Delete original polygon
    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    const now = new Date();

    // Create donut polygon
    const donutPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: donutCoords },
      display_name: "",
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(donutPoly);
    this.indexPolygon(donutPoly);

    // Create inner polygon (fills the hole)
    const innerPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: [holeCoords] },
      display_name: "",
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(innerPoly);
    this.indexPolygon(innerPoly);

    const createdPolygons = [donutPoly, innerPoly];

    this.pushHistory({
      createdPolygons,
      deletedPolygons: [polygon],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
    });

    this.invalidateUnionCaches(polygonId);

    return {
      donut: donutPoly,
      inner: innerPoly,
    };
  }

  // ============================================================
  // Carve Inner Polygon
  // ============================================================

  async carveInnerPolygon(
    polygonId: PolygonID,
    loopPath: { lat: number; lng: number }[],
  ): Promise<{ outer: MapPolygon; inner: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const polyCoords = polygon.geometry.coordinates;

    // Build inner polygon from loop path
    const innerCoords = loopPath.map((p) => [p.lng, p.lat] as [number, number]);
    // Ensure closure
    if (
      innerCoords[0][0] !== innerCoords[innerCoords.length - 1][0] ||
      innerCoords[0][1] !== innerCoords[innerCoords.length - 1][1]
    ) {
      innerCoords.push([...innerCoords[0]] as [number, number]);
    }

    // Compute outer = original - inner using polyclip-ts difference
    const { difference: polyClipDifference } = await import("polyclip-ts");
    const outerResult = polyClipDifference(polyCoords as [number, number][][], [
      innerCoords,
    ]);

    // Delete original polygon
    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    const now = new Date();

    // Create outer polygon
    const outerPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: {
        type: "Polygon",
        coordinates: outerResult.length > 0 ? outerResult[0] : polyCoords,
      },
      display_name: "",
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(outerPoly);
    this.indexPolygon(outerPoly);

    // Create inner polygon
    const innerPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: [innerCoords] },
      display_name: "",
      created_at: now,
      updated_at: now,
    };
    this.polygonStore.add(innerPoly);
    this.indexPolygon(innerPoly);

    const createdPolygons = [outerPoly, innerPoly];

    this.pushHistory({
      createdPolygons,
      deletedPolygons: [polygon],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
    });

    this.invalidateUnionCaches(polygonId);

    return {
      outer: outerPoly,
      inner: innerPoly,
    };
  }

  // ============================================================
  // Split Polygon
  // ============================================================

  async splitPolygon(
    polygonId: PolygonID,
    draft: DraftShape,
  ): Promise<MapPolygon[]> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    // Build turf features
    const polyCoords = polygon.geometry.coordinates;
    const polyFeature = turfPolygon(polyCoords);
    const lineCoords = draft.points.map(
      (p) => [p.lng, p.lat] as [number, number],
    );
    const lineFeature = turfLineString(lineCoords);

    // Find intersections of cut line with polygon boundary
    const intersections = lineIntersect(polyFeature, lineFeature);
    const numIntersections = intersections.features.length;

    if (numIntersections === 0) {
      return [];
    }

    if (numIntersections === 1) {
      // Single intersection: insert vertex on polygon boundary
      const pt = intersections.features[0].geometry.coordinates as [
        number,
        number,
      ];
      const rings = polygon.geometry.coordinates;
      const outerRing = rings[0];
      const eps = 1e-8;

      // Check if vertex already exists
      const alreadyExists = outerRing.some(
        (v) => Math.abs(v[0] - pt[0]) < eps && Math.abs(v[1] - pt[1]) < eps,
      );
      if (alreadyExists) {
        return [];
      }

      // Find the edge where the intersection falls and insert
      let insertIdx = -1;
      for (let i = 0; i < outerRing.length - 1; i++) {
        const [ax, ay] = outerRing[i];
        const [bx, by] = outerRing[i + 1];
        // Check if pt is on segment [a, b] via distance sum
        const dAP = Math.sqrt((pt[0] - ax) ** 2 + (pt[1] - ay) ** 2);
        const dPB = Math.sqrt((bx - pt[0]) ** 2 + (by - pt[1]) ** 2);
        const dAB = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
        if (Math.abs(dAP + dPB - dAB) < eps * 1000) {
          insertIdx = i + 1;
          break;
        }
      }

      if (insertIdx === -1) {
        return [];
      }

      // Build new coordinates with inserted vertex
      const newOuterRing = [
        ...outerRing.slice(0, insertIdx),
        pt,
        ...outerRing.slice(insertIdx),
      ];
      const newCoords = [newOuterRing, ...rings.slice(1)];

      const before = { ...polygon, geometry: { ...polygon.geometry } };
      const after: MapPolygon = {
        ...polygon,
        geometry: { type: "Polygon" as const, coordinates: newCoords },
        updated_at: new Date(),
      };

      this.unindexPolygon(polygon);
      this.polygonStore.update(after);
      this.indexPolygon(after);

      this.pushHistory({
        createdPolygons: [],
        deletedPolygons: [],
        modifiedPolygons: [{ before, after }],
      });

      await this.storageAdapter.batchWrite({
        createdPolygons: [],
        deletedPolygonIds: [],
        modifiedPolygons: [after],
      });

      this.invalidateUnionCaches(polygonId);

      return [];
    }

    // Sort intersection points by parameter along the polyline (not simple projection)
    const intPts = intersections.features.map(
      (f) => f.geometry.coordinates as [number, number],
    );

    const paramAlongPolyline = (pt: [number, number]): number => {
      let cumDist = 0;
      for (let i = 0; i < lineCoords.length - 1; i++) {
        const [ax, ay] = lineCoords[i];
        const [bx, by] = lineCoords[i + 1];
        const segLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
        const dAP = Math.sqrt((pt[0] - ax) ** 2 + (pt[1] - ay) ** 2);
        const dPB = Math.sqrt((bx - pt[0]) ** 2 + (by - pt[1]) ** 2);
        if (Math.abs(dAP + dPB - segLen) < 1e-6) {
          return cumDist + dAP;
        }
        cumDist += segLen;
      }
      return cumDist;
    };

    intPts.sort((a, b) => paramAlongPolyline(a) - paramAlongPolyline(b));

    // Determine which segments between consecutive intersections are inside the polygon
    const insideSegments: [number, number][][] = [];
    for (let i = 0; i < intPts.length - 1; i++) {
      const mid: [number, number] = [
        (intPts[i][0] + intPts[i + 1][0]) / 2,
        (intPts[i][1] + intPts[i + 1][1]) / 2,
      ];
      if (booleanPointInPolygon(mid, polyFeature, { ignoreBoundary: true })) {
        insideSegments.push([intPts[i], intPts[i + 1]]);
      }
    }

    if (insideSegments.length === 0) {
      return [];
    }

    // Iterative splitting: for each inside segment, split pieces that it crosses
    let pieces: number[][][][] = [polyCoords as number[][][]];
    const halfPlaneOffset = 1000;

    for (const [p1, p2] of insideSegments) {
      const sdx = p2[0] - p1[0];
      const sdy = p2[1] - p1[1];
      const slen = Math.sqrt(sdx * sdx + sdy * sdy);
      if (slen < 1e-12) continue;
      const snx = -sdy / slen;
      const sny = sdx / slen;

      const newPieces: number[][][][] = [];
      for (const piece of pieces) {
        // Check if this segment intersects this piece
        const pieceFeature = turfPolygon(piece);
        const segLine = turfLineString([p1, p2]);
        const pieceIntersections = lineIntersect(pieceFeature, segLine);

        if (pieceIntersections.features.length >= 2) {
          // Split using half-plane approach
          const leftHalf: number[][] = [
            p1,
            p2,
            [p2[0] + snx * halfPlaneOffset, p2[1] + sny * halfPlaneOffset],
            [p1[0] + snx * halfPlaneOffset, p1[1] + sny * halfPlaneOffset],
            p1,
          ];
          const rightHalf: number[][] = [
            p1,
            p2,
            [p2[0] - snx * halfPlaneOffset, p2[1] - sny * halfPlaneOffset],
            [p1[0] - snx * halfPlaneOffset, p1[1] - sny * halfPlaneOffset],
            p1,
          ];

          const leftResult = polyClipIntersection(
            piece as [number, number][][],
            [leftHalf as [number, number][]],
          );
          const rightResult = polyClipIntersection(
            piece as [number, number][][],
            [rightHalf as [number, number][]],
          );

          if (leftResult.length > 0 || rightResult.length > 0) {
            for (const r of leftResult) newPieces.push(r);
            for (const r of rightResult) newPieces.push(r);
          } else {
            newPieces.push(piece);
          }
        } else {
          newPieces.push(piece);
        }
      }
      pieces = newPieces;
    }

    // Collect all result polygons
    const resultCoords = pieces;

    if (resultCoords.length < 2) {
      // Cut line doesn't effectively divide the polygon
      return [];
    }

    // Delete the original polygon
    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    const now = new Date();
    const createdPolygons: MapPolygon[] = [];

    for (const coords of resultCoords) {
      const newPoly: MapPolygon = {
        id: makePolygonID(crypto.randomUUID()),
        geometry: { type: "Polygon", coordinates: coords },
        display_name: "",
        created_at: now,
        updated_at: now,
      };
      this.polygonStore.add(newPoly);
      this.indexPolygon(newPoly);
      createdPolygons.push(newPoly);
    }

    this.pushHistory({
      createdPolygons,
      deletedPolygons: [polygon],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
    });

    this.invalidateUnionCaches(polygonId);

    return createdPolygons;
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
      created_at: now,
      updated_at: now,
    };

    this.polygonStore.add(polygon);
    this.indexPolygon(polygon);

    const entry: HistoryEntry = {
      createdPolygons: [polygon],
      deletedPolygons: [],
      modifiedPolygons: [],
    };
    this.pushHistory(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: [polygon],
      deletedPolygonIds: [],
      modifiedPolygons: [],
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
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: [after],
    });

    return after;
  }

  async deletePolygon(polygonId: PolygonID): Promise<void> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [polygon],
      modifiedPolygons: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
    });

    this.invalidateUnionCaches(polygonId);
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
    this.unindexPolygon(polygon);
    this.polygonStore.update(after);
    this.indexPolygon(after);

    this.pushHistory({
      createdPolygons: [],
      deletedPolygons: [],
      modifiedPolygons: [{ before, after }],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: [after],
    });

    this.invalidateUnionCaches(polygonId);

    return after;
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
    this.indexDraftEndpoints(persisted);
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
    const draft = this.draftStore.get(id);
    if (draft) this.unindexDraftEndpoints(draft);
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

    // Collect affected polygon IDs for cache invalidation
    const affectedIds: PolygonID[] = [];

    for (const p of entry.createdPolygons) {
      this.unindexPolygon(p);
      this.polygonStore.delete(p.id);
      affectedIds.push(p.id);
    }
    for (const p of entry.deletedPolygons) {
      this.polygonStore.add(p);
      this.indexPolygon(p);
      affectedIds.push(p.id);
    }
    for (const { before, after } of entry.modifiedPolygons) {
      this.unindexPolygon(after);
      this.polygonStore.update(before);
      this.indexPolygon(before);
      affectedIds.push(before.id);
    }

    this.redoStack.push(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: entry.deletedPolygons,
      deletedPolygonIds: entry.createdPolygons.map((p) => p.id),
      modifiedPolygons: entry.modifiedPolygons.map((m) => m.before),
    });

    this.invalidateUnionCachesForMany(affectedIds);
  }

  async redo(): Promise<void> {
    this.guard();
    const entry = this.redoStack.pop();
    if (!entry) return;

    // Collect affected polygon IDs for cache invalidation
    const affectedIds: PolygonID[] = [];

    for (const p of entry.createdPolygons) {
      this.polygonStore.add(p);
      this.indexPolygon(p);
      affectedIds.push(p.id);
    }
    for (const p of entry.deletedPolygons) {
      this.unindexPolygon(p);
      this.polygonStore.delete(p.id);
      affectedIds.push(p.id);
    }
    for (const { before, after } of entry.modifiedPolygons) {
      this.unindexPolygon(before);
      this.polygonStore.update(after);
      this.indexPolygon(after);
      affectedIds.push(after.id);
    }

    this.undoStack.push(entry);

    await this.storageAdapter.batchWrite({
      createdPolygons: entry.createdPolygons,
      deletedPolygonIds: entry.deletedPolygons.map((p) => p.id),
      modifiedPolygons: entry.modifiedPolygons.map((m) => m.after),
    });

    this.invalidateUnionCachesForMany(affectedIds);
  }

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  // ============================================================
  // Coordinate Hash Index
  // ============================================================

  private coordGridKey(lng: number, lat: number): string {
    const gx = Math.floor(lng / this.coordEpsilon);
    const gy = Math.floor(lat / this.coordEpsilon);
    return `${gx},${gy}`;
  }

  /** Find all polygon IDs that have a vertex within epsilon of (lng, lat) */
  private findNearbyPolygonIds(lng: number, lat: number): Set<PolygonID> {
    const gx = Math.floor(lng / this.coordEpsilon);
    const gy = Math.floor(lat / this.coordEpsilon);
    const result = new Set<PolygonID>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx},${gy + dy}`;
        const set = this.coordIndex.get(key);
        if (set) {
          for (const id of set) result.add(id);
        }
      }
    }
    return result;
  }

  private coordWithinEpsilon(
    a: number,
    b: number,
    c: number,
    d: number,
  ): boolean {
    return (
      Math.abs(a - c) < this.coordEpsilon && Math.abs(b - d) < this.coordEpsilon
    );
  }

  private indexPolygon(polygon: MapPolygon): void {
    const coords = polygon.geometry.coordinates[0];
    for (const [lng, lat] of coords) {
      const key = this.coordGridKey(lng, lat);
      let set = this.coordIndex.get(key);
      if (!set) {
        set = new Set();
        this.coordIndex.set(key, set);
      }
      set.add(polygon.id);
    }
  }

  private unindexPolygon(polygon: MapPolygon): void {
    const coords = polygon.geometry.coordinates[0];
    for (const [lng, lat] of coords) {
      const key = this.coordGridKey(lng, lat);
      const set = this.coordIndex.get(key);
      if (set) {
        set.delete(polygon.id);
        if (set.size === 0) this.coordIndex.delete(key);
      }
    }
  }

  private rebuildCoordIndex(): void {
    this.coordIndex.clear();
    for (const p of this.polygonStore.getAll()) {
      this.indexPolygon(p);
    }
  }

  // ============================================================
  // Draft Endpoint Index
  // ============================================================

  private indexDraftEndpoints(draft: PersistedDraft): void {
    if (draft.points.length < 2) return;
    const first = draft.points[0]!;
    const last = draft.points[draft.points.length - 1]!;
    for (const p of [first, last]) {
      const key = this.coordGridKey(p.lng, p.lat);
      let set = this.draftEndpointIndex.get(key);
      if (!set) {
        set = new Set();
        this.draftEndpointIndex.set(key, set);
      }
      set.add(draft.id);
    }
  }

  private unindexDraftEndpoints(draft: PersistedDraft): void {
    if (draft.points.length < 2) return;
    const first = draft.points[0]!;
    const last = draft.points[draft.points.length - 1]!;
    for (const p of [first, last]) {
      const key = this.coordGridKey(p.lng, p.lat);
      const set = this.draftEndpointIndex.get(key);
      if (set) {
        set.delete(draft.id);
        if (set.size === 0) this.draftEndpointIndex.delete(key);
      }
    }
  }

  private rebuildDraftEndpointIndex(): void {
    this.draftEndpointIndex.clear();
    for (const d of this.draftStore.getAll()) {
      this.indexDraftEndpoints(d);
    }
  }

  // ============================================================
  // Loop Detection
  // ============================================================

  private detectAndBuildLoop(
    newLine: number[][], // [lng, lat][]
  ): { ring: number[][]; consumedDraftIds: DraftID[] } | null {
    if (newLine.length < 2) return null;

    const allDrafts = this.draftStore.getAll();
    if (allDrafts.length === 0) return null;

    const newLineStart: [number, number] = [newLine[0]![0]!, newLine[0]![1]!];
    const newLineEnd: [number, number] = [
      newLine[newLine.length - 1]![0]!,
      newLine[newLine.length - 1]![1]!,
    ];

    // Build draft endpoints for graph construction
    const draftEndpoints: DraftEndpoint[] = allDrafts
      .filter((d) => d.points.length >= 2)
      .map((d) => ({
        id: d.id,
        firstCoord: [d.points[0]!.lng, d.points[0]!.lat] as [number, number],
        lastCoord: [
          d.points[d.points.length - 1]!.lng,
          d.points[d.points.length - 1]!.lat,
        ] as [number, number],
      }));

    // coordToPolygonIds callback using the existing coordIndex
    const coordToPolygonIds = (key: string): PolygonID[] => {
      const set = this.coordIndex.get(key);
      return set ? [...set] : [];
    };

    const gridKeyFn = (lng: number, lat: number) => this.coordGridKey(lng, lat);

    const graph = buildConnectivityGraph(
      draftEndpoints,
      coordToPolygonIds,
      gridKeyFn,
      [newLineStart, newLineEnd],
    );

    const startKey = this.coordGridKey(newLineStart[0], newLineStart[1]);
    const targetKey = this.coordGridKey(newLineEnd[0], newLineEnd[1]);

    const loop = findLoop(graph, startKey, targetKey);
    if (!loop) return null;

    // Build polygon rings map and draft points map for ring extraction
    const polygonRings = new Map<PolygonID, number[][]>();
    for (const p of this.polygonStore.getAll()) {
      polygonRings.set(p.id, p.geometry.coordinates[0]!);
    }

    const draftPointsMap = new Map<DraftID, number[][]>();
    for (const d of allDrafts) {
      draftPointsMap.set(
        d.id,
        d.points.map((p) => [p.lng, p.lat]),
      );
    }

    const ring = extractLoopRing(
      loop,
      newLine,
      polygonRings,
      draftPointsMap,
      gridKeyFn,
    );

    if (ring.length < 4) return null; // need at least 3 vertices + closing

    // Collect consumed draft IDs from the loop edges
    const consumedDraftIds: DraftID[] = [];
    for (const edge of loop.edges) {
      if (edge.type === "draft") {
        consumedDraftIds.push(edge.entityId as DraftID);
      }
    }

    return { ring, consumedDraftIds };
  }
}
