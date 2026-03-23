import { generateId } from "./id";
import { booleanContains, polygon as turfPolygon } from "@turf/turf";
import type { Network } from "./network";
import type {
  Face,
  PolygonSnapshot,
  PolygonID,
  PolygonStatusField,
  EdgeID,
  VertexID,
} from "./types";
import { createPolygonID } from "./types";
import type { Feature, FeatureCollection, Polygon } from "geojson";

interface PolygonDiff {
  created: PolygonSnapshot[];
  modified: Array<{
    id: PolygonID;
    before: PolygonSnapshot;
    after: PolygonSnapshot;
  }>;
  removed: PolygonID[];
}

export class PolygonManager {
  private polygons = new Map<PolygonID, PolygonSnapshot>();

  getAllPolygons(): PolygonSnapshot[] {
    return [...this.polygons.values()];
  }

  getPolygon(id: PolygonID): PolygonSnapshot | null {
    return this.polygons.get(id) ?? null;
  }

  setStatus(
    id: PolygonID,
    field: PolygonStatusField,
    value: boolean,
  ): { before: boolean; after: boolean } {
    const snap = this.polygons.get(id);
    if (!snap) throw new Error(`Polygon ${id} does not exist`);
    const defaultValue = field === "active" ? true : false;
    const before = snap[field] ?? defaultValue;
    snap[field] = value;
    return { before, after: value };
  }

  /**
   * Rebuild polygon snapshots from the current set of faces.
   * Handles identity matching (split/merge), hole detection, and returns a diff.
   */
  updateFromFaces(
    faces: Face[],
    network: Network,
    movedVertexIds?: Set<VertexID>,
  ): PolygonDiff {
    const previousPolygons = new Map(this.polygons);

    // Step 1: Detect containment (holes)
    const { outerFaces, holeMapping } = this.detectHoles(faces, network);

    // Step 2: Build new polygon snapshots (without IDs yet)
    const newFaceData = outerFaces.map((face) => ({
      edgeIds: face.edgeIds,
      holes: (holeMapping.get(face) ?? []).map((h) => h.edgeIds),
      area: face.signedArea,
    }));

    // Build set of edge IDs connected to moved vertices
    const movedEdgeIds = new Set<EdgeID>();
    if (movedVertexIds) {
      for (const vid of movedVertexIds) {
        for (const edge of network.getEdgesOfVertex(vid)) {
          movedEdgeIds.add(edge.id);
        }
      }
    }

    // Step 3: Match against previous polygons for identity
    const diff = this.matchIdentity(
      newFaceData,
      previousPolygons,
      movedEdgeIds,
      network,
    );

    return diff;
  }

  /**
   * Detect which faces are holes of other faces.
   * A face B is a hole of face A if A fully contains B.
   */
  private detectHoles(
    faces: Face[],
    network: Network,
  ): {
    outerFaces: Face[];
    holeMapping: Map<Face, Face[]>;
  } {
    if (faces.length <= 1) {
      return { outerFaces: faces, holeMapping: new Map() };
    }

    // Convert faces to coordinate arrays for containment testing
    const faceCoords = faces.map((face) => this.faceToCoords(face, network));

    const isHole = new Set<number>();
    const holeMapping = new Map<Face, Face[]>();

    // Build edge sets for shared-edge detection
    const facesEdgeSets = faces.map((f) => new Set(f.edgeIds));

    // Check all pairs for containment
    // A face is a hole ONLY if it is contained AND shares no edges with the container
    for (let i = 0; i < faces.length; i++) {
      if (isHole.has(i)) continue;
      for (let j = 0; j < faces.length; j++) {
        if (i === j || isHole.has(j)) continue;
        // Skip if faces share any edge — they are adjacent, not hole/container
        if (setsShareAny(facesEdgeSets[i]!, facesEdgeSets[j]!)) continue;
        // Check if face j is inside face i
        if (this.faceContainsFace(faceCoords[i]!, faceCoords[j]!)) {
          isHole.add(j);
          if (!holeMapping.has(faces[i]!)) {
            holeMapping.set(faces[i]!, []);
          }
          holeMapping.get(faces[i]!)!.push(faces[j]!);
        }
      }
    }

    const outerFaces = faces.filter((_, idx) => !isHole.has(idx));
    return { outerFaces, holeMapping };
  }

  private faceToCoords(face: Face, network: Network): number[][] {
    const coords = face.halfEdges.map(([from]) => {
      const v = network.getVertex(from)!;
      return [v.lng, v.lat]; // GeoJSON uses [lng, lat]
    });
    // Close the ring
    coords.push(coords[0]!);
    return coords;
  }

  private faceContainsFace(
    outerCoords: number[][],
    innerCoords: number[][],
  ): boolean {
    try {
      const outer = turfPolygon([outerCoords]);
      const inner = turfPolygon([innerCoords]);
      return booleanContains(outer, inner);
    } catch {
      return false;
    }
  }

  /**
   * Match new faces against previous polygons to preserve UUIDs.
   */
  private matchIdentity(
    newFaces: Array<{
      edgeIds: EdgeID[];
      holes: EdgeID[][];
      area: number;
    }>,
    previousPolygons: Map<PolygonID, PolygonSnapshot>,
    movedEdgeIds: Set<EdgeID>,
    network: Network,
  ): PolygonDiff {
    const diff: PolygonDiff = { created: [], modified: [], removed: [] };
    const usedPrevIds = new Set<PolygonID>();
    const newPolygons = new Map<PolygonID, PolygonSnapshot>();

    // Build edge set for each new face and each previous polygon
    const newEdgeSets = newFaces.map((f) => new Set(f.edgeIds));
    const prevEntries = [...previousPolygons.entries()].map(([id, snap]) => ({
      id,
      snap,
      edgeSet: new Set(snap.edgeIds),
    }));

    // For each new face, find overlapping previous polygons
    for (let i = 0; i < newFaces.length; i++) {
      const newFace = newFaces[i]!;
      const newEdgeSet = newEdgeSets[i]!;

      // Find previous polygons that share edges with this new face
      const overlapping = prevEntries.filter(
        (prev) =>
          !usedPrevIds.has(prev.id) && setsOverlap(newEdgeSet, prev.edgeSet),
      );

      if (overlapping.length === 0) {
        // Brand new polygon — but check if it was split from a used prev polygon
        const splitParent = prevEntries.find(
          (prev) =>
            usedPrevIds.has(prev.id) && setsOverlap(newEdgeSet, prev.edgeSet),
        );
        const id = createPolygonID(generateId());
        const snap: PolygonSnapshot = {
          id,
          edgeIds: newFace.edgeIds,
          holes: newFace.holes,
          vertexIds: collectVertexIds(newFace.edgeIds, network),
          ...(splitParent?.snap.locked != null && {
            locked: splitParent.snap.locked,
          }),
          ...(splitParent?.snap.active != null && {
            active: splitParent.snap.active,
          }),
        };
        newPolygons.set(id, snap);
        diff.created.push(snap);
      } else if (overlapping.length === 1) {
        const prev = overlapping[0]!;
        usedPrevIds.add(prev.id);

        const snap: PolygonSnapshot = {
          id: prev.id,
          edgeIds: newFace.edgeIds,
          holes: newFace.holes,
          vertexIds: collectVertexIds(newFace.edgeIds, network),
          ...(prev.snap.locked != null && { locked: prev.snap.locked }),
          ...(prev.snap.active != null && { active: prev.snap.active }),
        };
        newPolygons.set(prev.id, snap);

        // Check if actually modified (edge set changed, holes changed,
        // or any edge touches a moved vertex)
        const touchesMoved =
          movedEdgeIds.size > 0 &&
          newFace.edgeIds.some((eid) => movedEdgeIds.has(eid));
        if (
          touchesMoved ||
          !edgeArraysEqual(prev.snap.edgeIds, newFace.edgeIds) ||
          !holesEqual(prev.snap.holes, newFace.holes)
        ) {
          diff.modified.push({ id: prev.id, before: prev.snap, after: snap });
        }
      } else {
        // Merge: multiple previous polygons → one new face
        // Largest area previous polygon inherits UUID
        const largest = overlapping.reduce((a, b) => {
          const aArea = computeAreaFromEdgeCount(a.edgeSet.size);
          const bArea = computeAreaFromEdgeCount(b.edgeSet.size);
          return aArea >= bArea ? a : b;
        });

        // Actually use area from the face data we have
        // For merge, inherit the UUID from the one with more shared edges
        const bestMatch = overlapping.reduce((a, b) => {
          const aOverlap = intersectionSize(newEdgeSet, a.edgeSet);
          const bOverlap = intersectionSize(newEdgeSet, b.edgeSet);
          return aOverlap >= bOverlap ? a : b;
        });

        for (const prev of overlapping) {
          usedPrevIds.add(prev.id);
        }

        const snap: PolygonSnapshot = {
          id: bestMatch.id,
          edgeIds: newFace.edgeIds,
          holes: newFace.holes,
          vertexIds: collectVertexIds(newFace.edgeIds, network),
          ...(bestMatch.snap.locked != null && {
            locked: bestMatch.snap.locked,
          }),
          ...(bestMatch.snap.active != null && {
            active: bestMatch.snap.active,
          }),
        };
        newPolygons.set(bestMatch.id, snap);
        diff.modified.push({
          id: bestMatch.id,
          before: bestMatch.snap,
          after: snap,
        });

        // Other merged polygons are removed
        for (const prev of overlapping) {
          if (prev.id !== bestMatch.id) {
            diff.removed.push(prev.id);
          }
        }
      }
    }

    // Handle split: one previous polygon → multiple new faces
    // This is detected when a previous polygon was used by multiple new faces
    // But with the above algorithm, each new face picks at most one previous polygon.
    // Split is handled differently: if a previous polygon wasn't matched but
    // its edges appear in multiple new faces.
    // Let's re-check: in split case, multiple new faces share edges with one prev polygon.
    // The first new face (by iteration) claims the prev ID, the second becomes "created".
    // We need to ensure the LARGER new face gets the prev ID.

    // Re-do assignment for split cases: group new faces by their matched prev ID
    // This is already handled above since overlapping finds unused prev IDs.
    // But order matters — let's sort new faces by area descending to ensure larger gets priority.
    // TODO: This is a simplification. For now, the iteration order determines priority.

    // Vertex-based fallback: match unmatched new faces (created) against
    // unmatched previous polygons using shared vertices.
    // This handles cases where intersection resolution replaces all edge IDs
    // but the topological vertex connectivity is preserved.
    const unmatchedPrevEntries = prevEntries.filter(
      (prev) => !usedPrevIds.has(prev.id),
    );
    if (unmatchedPrevEntries.length > 0 && diff.created.length > 0) {
      // Collect vertices for each unmatched previous polygon (from stored vertexIds)
      const prevVertexSets = unmatchedPrevEntries.map((prev) => ({
        ...prev,
        vertices: new Set(prev.snap.vertexIds),
      }));

      // Try to match each created face by vertex overlap
      const remainingCreated: PolygonSnapshot[] = [];
      for (const createdSnap of diff.created) {
        const faceVertices = new Set(createdSnap.vertexIds);

        // Find the best matching unmatched previous polygon (most shared vertices, ≥2)
        let bestMatch: (typeof prevVertexSets)[number] | null = null;
        let bestShared = 0;
        for (const prev of prevVertexSets) {
          if (usedPrevIds.has(prev.id)) continue;
          let shared = 0;
          for (const v of faceVertices) {
            if (prev.vertices.has(v)) shared++;
          }
          if (shared >= 2 && shared > bestShared) {
            bestShared = shared;
            bestMatch = prev;
          }
        }

        if (bestMatch) {
          usedPrevIds.add(bestMatch.id);
          // Re-register with inherited ID
          const snap: PolygonSnapshot = {
            id: bestMatch.id,
            edgeIds: createdSnap.edgeIds,
            holes: createdSnap.holes,
            vertexIds: createdSnap.vertexIds,
            ...(bestMatch.snap.locked != null && {
              locked: bestMatch.snap.locked,
            }),
            ...(bestMatch.snap.active != null && {
              active: bestMatch.snap.active,
            }),
          };
          // Replace in newPolygons map
          newPolygons.delete(createdSnap.id);
          newPolygons.set(bestMatch.id, snap);
          diff.modified.push({
            id: bestMatch.id,
            before: bestMatch.snap,
            after: snap,
          });
        } else {
          remainingCreated.push(createdSnap);
        }
      }
      diff.created = remainingCreated;
    }

    // Previous polygons that were not matched → removed
    for (const [id] of previousPolygons) {
      if (!usedPrevIds.has(id)) {
        diff.removed.push(id);
      }
    }

    this.polygons = newPolygons;
    return diff;
  }

  // --- GeoJSON export ---

  toGeoJSON(id: PolygonID, network: Network): Polygon | null {
    const snap = this.polygons.get(id);
    if (!snap) return null;

    const outerRing = this.edgeIdsToCoordRing(snap.edgeIds, network);
    if (!outerRing) return null;

    const coordinates = [outerRing];
    for (const holeEdgeIds of snap.holes) {
      const holeRing = this.edgeIdsToCoordRing(holeEdgeIds, network);
      if (holeRing) {
        coordinates.push(holeRing);
      }
    }

    return { type: "Polygon", coordinates };
  }

  toFeatureCollection(network: Network): FeatureCollection {
    const features: Feature[] = [];
    for (const [id, snap] of this.polygons) {
      const geometry = this.toGeoJSON(id, network);
      if (geometry) {
        features.push({
          type: "Feature",
          properties: {
            id,
            locked: snap.locked ?? false,
            active: snap.active ?? true,
          },
          geometry,
        });
      }
    }
    return { type: "FeatureCollection", features };
  }

  /**
   * Convert ordered edge IDs to a coordinate ring [lng, lat][].
   * Edges must form a connected cycle.
   */
  private edgeIdsToCoordRing(
    edgeIds: EdgeID[],
    network: Network,
  ): number[][] | null {
    if (edgeIds.length === 0) return null;

    // Walk the edge chain to get ordered vertices
    const vertices: VertexID[] = [];
    const firstEdge = network.getEdge(edgeIds[0]!);
    if (!firstEdge) return null;

    // Determine starting vertex by checking which endpoint of the first edge
    // is NOT shared with the second edge (shared vertex = end of first edge)
    let currentVertex: VertexID;
    if (edgeIds.length >= 2) {
      const secondEdge = network.getEdge(edgeIds[1]!);
      if (!secondEdge) return null;
      if (firstEdge.v1 === secondEdge.v1 || firstEdge.v1 === secondEdge.v2) {
        currentVertex = firstEdge.v2;
      } else {
        currentVertex = firstEdge.v1;
      }
    } else {
      currentVertex = firstEdge.v1;
    }
    vertices.push(currentVertex);

    for (const edgeId of edgeIds) {
      const edge = network.getEdge(edgeId);
      if (!edge) return null;
      const next = edge.v1 === currentVertex ? edge.v2 : edge.v1;
      vertices.push(next);
      currentVertex = next;
    }

    // Convert to [lng, lat] coordinates (GeoJSON format)
    const coords = vertices.map((vid) => {
      const v = network.getVertex(vid)!;
      return [v.lng, v.lat];
    });

    return coords;
  }
}

// --- Utility functions ---

function setsOverlap<T>(a: Set<T>, b: Set<T>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function setsShareAny<T>(a: Set<T>, b: Set<T>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

function edgeArraysEqual(a: EdgeID[], b: EdgeID[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

function holesEqual(a: EdgeID[][], b: EdgeID[][]): boolean {
  if (a.length !== b.length) return false;
  // Simple comparison: same number of holes with same edge sets
  const aSorted = a.map((h) => [...h].sort().join(",")).sort();
  const bSorted = b.map((h) => [...h].sort().join(",")).sort();
  return aSorted.every((val, idx) => val === bSorted[idx]);
}

function computeAreaFromEdgeCount(n: number): number {
  // Rough proxy when actual area isn't available
  return n;
}

function collectVertexIds(edgeIds: EdgeID[], network: Network): VertexID[] {
  const set = new Set<VertexID>();
  for (const eid of edgeIds) {
    const edge = network.getEdge(eid);
    if (edge) {
      set.add(edge.v1);
      set.add(edge.v2);
    }
  }
  return [...set];
}
