/**
 * Graph-based closed loop detection.
 *
 * When multiple drafts and polygon boundary segments form a closed loop,
 * this module detects the cycle and extracts the coordinate ring.
 */

import type { DraftID, PolygonID } from "../types/index.js";
import { walkBoundary } from "./bridge-polygon.js";

// ============================================================
// Types
// ============================================================

export interface DraftEndpoint {
  id: DraftID;
  firstCoord: [number, number]; // [lng, lat]
  lastCoord: [number, number]; // [lng, lat]
}

export interface GraphEdge {
  type: "draft" | "polygon";
  /** DraftID for draft edges, PolygonID for polygon edges */
  entityId: string;
  fromKey: string;
  toKey: string;
}

export type AdjacencyMap = Map<
  string,
  Array<{ neighborKey: string; edge: GraphEdge }>
>;

export interface LoopPath {
  /** Ordered list of edges forming the cycle (excludes the new line) */
  edges: GraphEdge[];
  /** Ordered node keys visited */
  nodeKeys: string[];
}

// ============================================================
// Public API
// ============================================================

/**
 * Builds a connectivity graph from draft endpoints and polygon vertex co-location.
 *
 * Nodes: quantized coordinate keys of draft endpoints.
 * Edges: (1) drafts connecting two endpoint keys, (2) two keys sharing a polygon.
 */
export function buildConnectivityGraph(
  drafts: DraftEndpoint[],
  coordToPolygonIds: (key: string) => PolygonID[],
  gridKey: (lng: number, lat: number) => string,
  /** Additional coordinate nodes to include (e.g. new line endpoints) */
  extraNodes?: Array<[number, number]>,
): AdjacencyMap {
  const graph: AdjacencyMap = new Map();

  // Collect all unique nodes (coordinate keys) and their polygon associations
  const nodeCoords = new Map<string, [number, number]>(); // key → actual coord
  const nodePolygons = new Map<string, Set<string>>(); // key → Set<PolygonID>

  function ensureNode(key: string, coord: [number, number]) {
    if (!graph.has(key)) graph.set(key, []);
    nodeCoords.set(key, coord);
  }

  function addEdge(fromKey: string, toKey: string, edge: GraphEdge) {
    graph.get(fromKey)?.push({ neighborKey: toKey, edge });
    const reverseEdge: GraphEdge = { ...edge, fromKey: toKey, toKey: fromKey };
    graph.get(toKey)?.push({ neighborKey: fromKey, edge: reverseEdge });
  }

  // Step 0: Register extra nodes (e.g. new line endpoints)
  if (extraNodes) {
    for (const coord of extraNodes) {
      const key = gridKey(coord[0], coord[1]);
      ensureNode(key, coord);
    }
  }

  // Step 1: Register all draft endpoint nodes
  for (const d of drafts) {
    const firstKey = gridKey(d.firstCoord[0], d.firstCoord[1]);
    const lastKey = gridKey(d.lastCoord[0], d.lastCoord[1]);

    // Skip self-loop drafts
    if (firstKey === lastKey) continue;

    ensureNode(firstKey, d.firstCoord);
    ensureNode(lastKey, d.lastCoord);

    // Add draft edge
    const edge: GraphEdge = {
      type: "draft",
      entityId: d.id,
      fromKey: firstKey,
      toKey: lastKey,
    };
    addEdge(firstKey, lastKey, edge);
  }

  // Step 2: For each node, find which polygons contain it
  for (const [key] of graph) {
    const polyIds = coordToPolygonIds(key);
    if (polyIds.length > 0) {
      nodePolygons.set(key, new Set(polyIds));
    }
  }

  // Step 3: Add polygon edges between nodes that share a polygon
  const nodeKeys = [...graph.keys()];
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const keyA = nodeKeys[i]!;
      const keyB = nodeKeys[j]!;
      const polysA = nodePolygons.get(keyA);
      const polysB = nodePolygons.get(keyB);
      if (!polysA || !polysB) continue;

      // Find common polygons
      for (const pid of polysA) {
        if (polysB.has(pid)) {
          const edge: GraphEdge = {
            type: "polygon",
            entityId: pid,
            fromKey: keyA,
            toKey: keyB,
          };
          addEdge(keyA, keyB, edge);
          break; // one polygon edge per pair is sufficient
        }
      }
    }
  }

  return graph;
}

/**
 * BFS from `startKey` to `targetKey` on the connectivity graph.
 * Returns the shortest path (fewest edges) or null if no path exists.
 */
export function findLoop(
  graph: AdjacencyMap,
  startKey: string,
  targetKey: string,
): LoopPath | null {
  if (startKey === targetKey) return null;
  if (!graph.has(startKey) || !graph.has(targetKey)) return null;

  // BFS
  const visited = new Set<string>();
  const parent = new Map<string, { prevKey: string; edge: GraphEdge }>();
  const queue: string[] = [startKey];
  visited.add(startKey);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === targetKey) {
      // Reconstruct path
      const edges: GraphEdge[] = [];
      const nodeKeys: string[] = [];
      let node = targetKey;

      while (node !== startKey) {
        const p = parent.get(node)!;
        edges.unshift(p.edge);
        nodeKeys.unshift(node);
        node = p.prevKey;
      }
      nodeKeys.unshift(startKey);

      return { edges, nodeKeys };
    }

    const neighbors = graph.get(current) ?? [];
    for (const { neighborKey, edge } of neighbors) {
      if (!visited.has(neighborKey)) {
        visited.add(neighborKey);
        parent.set(neighborKey, { prevKey: current, edge });
        queue.push(neighborKey);
      }
    }
  }

  return null;
}

/**
 * Assembles a closed coordinate ring from a loop path.
 *
 * For draft edges: uses the draft's point array (possibly reversed).
 * For polygon edges: walks the polygon boundary between the two vertices.
 */
export function extractLoopRing(
  path: LoopPath,
  newLinePoints: number[][],
  polygonRings: Map<PolygonID, number[][]>,
  draftPoints: Map<DraftID, number[][]>,
  gridKey: (lng: number, lat: number) => string,
): number[][] {
  const result: number[][] = [];

  // Start with the new line points
  for (const p of newLinePoints) {
    result.push(p);
  }

  // Follow the path edges
  for (const edge of path.edges) {
    if (edge.type === "draft") {
      const points = draftPoints.get(edge.entityId as DraftID);
      if (!points || points.length === 0) continue;

      // Determine direction: does the draft's first point match edge.fromKey?
      const firstKey = gridKey(points[0]![0]!, points[0]![1]!);
      const ordered =
        firstKey === edge.fromKey ? points : [...points].reverse();

      // Skip the first point (already in the ring from previous segment)
      for (let i = 1; i < ordered.length; i++) {
        result.push(ordered[i]!);
      }
    } else {
      // Polygon edge — walk boundary
      const ring = polygonRings.get(edge.entityId as PolygonID);
      if (!ring) continue;

      // Strip closing vertex for walkBoundary
      const openRing = stripClosing(ring);

      // Find vertex indices for from/to coordinates
      const fromIdx = findVertexIndex(openRing, edge.fromKey, gridKey);
      const toIdx = findVertexIndex(openRing, edge.toKey, gridKey);
      if (fromIdx === -1 || toIdx === -1) continue;

      // Walk the shorter path
      const intermediate = walkBoundary(
        openRing,
        fromIdx,
        toIdx,
        openRing.length,
      );
      for (const p of intermediate) {
        result.push(p);
      }

      // Add the destination vertex
      result.push(openRing[toIdx]!);
    }
  }

  // Normalize to CCW
  if (signedArea(result) < 0) {
    result.reverse();
  }

  // Close the ring
  result.push([...result[0]!]);

  return result;
}

// ============================================================
// Internal helpers
// ============================================================

function stripClosing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

function findVertexIndex(
  ring: number[][],
  coordKey: string,
  gridKey: (lng: number, lat: number) => string,
): number {
  for (let i = 0; i < ring.length; i++) {
    if (gridKey(ring[i]![0]!, ring[i]![1]!) === coordKey) {
      return i;
    }
  }
  return -1;
}

function signedArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i]!;
    const b = ring[j]!;
    area += a[0]! * b[1]!;
    area -= b[0]! * a[1]!;
  }
  return area / 2;
}
