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
import { union } from "@turf/union";
import {
  polygon as turfPolygon,
  lineString as turfLineString,
  featureCollection,
} from "@turf/helpers";
import { lineIntersect } from "@turf/line-intersect";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { intersection as polyClipIntersection } from "polyclip-ts";
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

  /** Coordinate hash index: quantized "gx,gy" → Set of PolygonIDs that have a vertex in that cell */
  private coordIndex = new Map<string, Set<PolygonID>>();
  private readonly coordEpsilon = 1e-8;

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
    this.rebuildCoordIndex();
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

  getGroupPolygons(groupId: GroupID): GeoJSONPolygon[] {
    this.guard();
    const group = this.groupStore.get(groupId);
    if (!group) throw new GroupNotFoundError(`Group "${groupId}" not found`);

    const descendants = this.getDescendantPolygons(groupId);
    if (descendants.length === 0) return [];

    if (descendants.length === 1) {
      return [descendants[0].geometry];
    }

    // Compute union of all descendant geometries using @turf/turf
    const features = descendants.map((d) =>
      turfPolygon(d.geometry.coordinates),
    );
    const merged = union(featureCollection(features));
    if (!merged) return [];

    // If the union produces a MultiPolygon, split into individual Polygon features
    if (merged.geometry.type === "MultiPolygon") {
      return merged.geometry.coordinates.map(
        (coords): GeoJSONPolygon => ({
          type: "Polygon",
          coordinates: coords,
        }),
      );
    }

    return [
      {
        type: "Polygon",
        coordinates: merged.geometry.coordinates as number[][][],
      },
    ];
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
      createdGroups: [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons: [],
      deletedPolygonIds: [],
      modifiedPolygons: updatedPolygons,
      createdGroups: [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return updatedPolygons;
  }

  // ============================================================
  // Expand With Polygon
  // ============================================================

  async expandWithPolygon(
    polygonId: PolygonID,
    outerPath: { lat: number; lng: number }[],
    childName: string,
    options?: { wrapInGroup?: boolean },
  ): Promise<{ group?: Group; original: MapPolygon; added: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const wrapInGroup = options?.wrapInGroup ?? true;

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
    const originalParentId = polygon.parent_id;
    let createdGroup: Group | undefined;

    const parentId = wrapInGroup
      ? (() => {
          const group: Group = {
            id: makeGroupID(crypto.randomUUID()),
            display_name: polygon.display_name,
            parent_id: originalParentId,
            created_at: now,
            updated_at: now,
          };
          this.groupStore.add(group);
          createdGroup = group;
          return group.id;
        })()
      : originalParentId;

    // Create new polygon with original geometry (new id)
    const originalPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: polygon.geometry,
      display_name: polygon.display_name,
      parent_id: parentId,
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
      parent_id: parentId,
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
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return {
      ...(createdGroup ? { group: createdGroup } : {}),
      original: originalPoly,
      added: addedPoly,
    };
  }

  // ============================================================
  // Punch Hole
  // ============================================================

  async punchHole(
    polygonId: PolygonID,
    holePath: { lat: number; lng: number }[],
    options?: { wrapInGroup?: boolean },
  ): Promise<{ group?: Group; donut: MapPolygon; inner: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const wrapInGroup = options?.wrapInGroup ?? true;

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
    const originalParentId = polygon.parent_id;
    let createdGroup: Group | undefined;

    const parentId = wrapInGroup
      ? (() => {
          const group: Group = {
            id: makeGroupID(crypto.randomUUID()),
            display_name: polygon.display_name,
            parent_id: originalParentId,
            created_at: now,
            updated_at: now,
          };
          this.groupStore.add(group);
          createdGroup = group;
          return group.id;
        })()
      : originalParentId;

    // Create donut polygon
    const donutPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: { type: "Polygon", coordinates: donutCoords },
      display_name: "",
      parent_id: parentId,
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
      parent_id: parentId,
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
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return {
      ...(createdGroup ? { group: createdGroup } : {}),
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
    options?: { wrapInGroup?: boolean },
  ): Promise<{ group?: Group; outer: MapPolygon; inner: MapPolygon }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const wrapInGroup = options?.wrapInGroup ?? true;
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
    const originalParentId = polygon.parent_id;
    let createdGroup: Group | undefined;

    const parentId = wrapInGroup
      ? (() => {
          const group: Group = {
            id: makeGroupID(crypto.randomUUID()),
            display_name: polygon.display_name,
            parent_id: originalParentId,
            created_at: now,
            updated_at: now,
          };
          this.groupStore.add(group);
          createdGroup = group;
          return group.id;
        })()
      : originalParentId;

    // Create outer polygon
    const outerPoly: MapPolygon = {
      id: makePolygonID(crypto.randomUUID()),
      geometry: {
        type: "Polygon",
        coordinates: outerResult.length > 0 ? outerResult[0] : polyCoords,
      },
      display_name: "",
      parent_id: parentId,
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
      parent_id: parentId,
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
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return {
      ...(createdGroup ? { group: createdGroup } : {}),
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
    options?: { wrapInGroup?: boolean },
  ): Promise<{ group?: Group; polygons: MapPolygon[] }> {
    this.guard();
    const polygon = this.polygonStore.get(polygonId);
    if (!polygon)
      throw new PolygonNotFoundError(`Polygon "${polygonId}" not found`);

    const wrapInGroup = options?.wrapInGroup ?? true;

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
      return { polygons: [] };
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
        return { polygons: [] };
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
        return { polygons: [] };
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

      return { polygons: [] };
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
      return { polygons: [] };
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
      return { polygons: [] };
    }

    // Delete the original polygon
    this.unindexPolygon(polygon);
    this.polygonStore.delete(polygonId);

    const now = new Date();
    const originalParentId = polygon.parent_id;
    const createdPolygons: MapPolygon[] = [];
    let createdGroup: Group | undefined;

    if (wrapInGroup) {
      // Create a wrapper group
      const group: Group = {
        id: makeGroupID(crypto.randomUUID()),
        display_name: polygon.display_name,
        parent_id: originalParentId,
        created_at: now,
        updated_at: now,
      };
      this.groupStore.add(group);
      createdGroup = group;

      for (const coords of resultCoords) {
        const newPoly: MapPolygon = {
          id: makePolygonID(crypto.randomUUID()),
          geometry: { type: "Polygon", coordinates: coords },
          display_name: "",
          parent_id: group.id,
          created_at: now,
          updated_at: now,
        };
        this.polygonStore.add(newPoly);
        this.indexPolygon(newPoly);
        createdPolygons.push(newPoly);
      }
    } else {
      for (const coords of resultCoords) {
        const newPoly: MapPolygon = {
          id: makePolygonID(crypto.randomUUID()),
          geometry: { type: "Polygon", coordinates: coords },
          display_name: "",
          parent_id: originalParentId,
          created_at: now,
          updated_at: now,
        };
        this.polygonStore.add(newPoly);
        this.indexPolygon(newPoly);
        createdPolygons.push(newPoly);
      }
    }

    this.pushHistory({
      createdPolygons,
      deletedPolygons: [polygon],
      modifiedPolygons: [],
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroups: [],
      modifiedGroups: [],
    });

    await this.storageAdapter.batchWrite({
      createdPolygons,
      deletedPolygonIds: [polygonId],
      modifiedPolygons: [],
      createdGroups: createdGroup ? [createdGroup] : [],
      deletedGroupIds: [],
      modifiedGroups: [],
    });

    return {
      ...(createdGroup ? { group: createdGroup } : {}),
      polygons: createdPolygons,
    };
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
    this.indexPolygon(polygon);

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

    this.unindexPolygon(polygon);
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
    this.unindexPolygon(polygon);
    this.polygonStore.update(after);
    this.indexPolygon(after);

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

    for (const p of entry.createdPolygons) {
      this.unindexPolygon(p);
      this.polygonStore.delete(p.id);
    }
    for (const g of entry.createdGroups) this.groupStore.delete(g.id);
    for (const p of entry.deletedPolygons) {
      this.polygonStore.add(p);
      this.indexPolygon(p);
    }
    for (const g of entry.deletedGroups) this.groupStore.add(g);
    for (const { before, after } of entry.modifiedPolygons) {
      this.unindexPolygon(after);
      this.polygonStore.update(before);
      this.indexPolygon(before);
    }
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

    for (const p of entry.createdPolygons) {
      this.polygonStore.add(p);
      this.indexPolygon(p);
    }
    for (const g of entry.createdGroups) this.groupStore.add(g);
    for (const p of entry.deletedPolygons) {
      this.unindexPolygon(p);
      this.polygonStore.delete(p.id);
    }
    for (const g of entry.deletedGroups) this.groupStore.delete(g.id);
    for (const { before, after } of entry.modifiedPolygons) {
      this.unindexPolygon(before);
      this.polygonStore.update(after);
      this.indexPolygon(after);
    }
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
