import type { Network } from "./network";
import type { Face, VertexID, EdgeID } from "./types";

/** A half-edge is a directed edge from `from` to `to`. */
interface HalfEdge {
  from: VertexID;
  to: VertexID;
  edgeId: EdgeID;
}

/**
 * Enumerate all minimal faces (cycles) in a planar network
 * using the half-edge / planar face traversal algorithm.
 *
 * Returns faces with positive signed area (CCW orientation),
 * excluding the unbounded outer face and zero-area faces.
 */
export function enumerateFaces(network: Network): Face[] {
  const allEdges = network.getAllEdges();
  if (allEdges.length === 0) return [];

  // Build half-edges: each undirected edge → two directed half-edges
  const halfEdges: HalfEdge[] = [];
  for (const edge of allEdges) {
    halfEdges.push({ from: edge.v1, to: edge.v2, edgeId: edge.id });
    halfEdges.push({ from: edge.v2, to: edge.v1, edgeId: edge.id });
  }

  // Group outgoing half-edges by source vertex, sorted by angle
  const outgoing = new Map<VertexID, HalfEdge[]>();
  for (const he of halfEdges) {
    let list = outgoing.get(he.from);
    if (!list) {
      list = [];
      outgoing.set(he.from, list);
    }
    list.push(he);
  }

  // Sort outgoing half-edges by angle from source to destination
  for (const [vertexId, heList] of outgoing) {
    const vertex = network.getVertex(vertexId)!;
    heList.sort((a, b) => {
      const va = network.getVertex(a.to)!;
      const vb = network.getVertex(b.to)!;
      const angleA = Math.atan2(va.lat - vertex.lat, va.lng - vertex.lng);
      const angleB = Math.atan2(vb.lat - vertex.lat, vb.lng - vertex.lng);
      return angleA - angleB;
    });
  }

  // Build "next" mapping:
  // For a half-edge arriving at vertex V (i.e., half-edge A→V),
  // the next half-edge is the one leaving V that is the NEXT one
  // in clockwise order after the reverse direction (V→A).
  // In the sorted outgoing list at V, find V→A, then pick the next one (wrapping).
  const nextMap = new Map<string, HalfEdge>();

  for (const he of halfEdges) {
    // he goes from→to. The twin goes to→from.
    // At vertex `to`, find the outgoing half-edge V→from in the sorted list,
    // then pick the next one clockwise (next index in the sorted array).
    const outList = outgoing.get(he.to);
    if (!outList) continue;

    // Find the index of the twin (to→from) in outgoing[to]
    const twinIdx = outList.findIndex(
      (o) => o.to === he.from && o.edgeId === he.edgeId,
    );
    if (twinIdx === -1) continue;

    // Next half-edge: advance one step in the CCW-sorted list from the twin.
    // This traces the face to the LEFT of the half-edge (interior face = positive area).
    const nextIdx = (twinIdx + 1) % outList.length;
    nextMap.set(heKey(he), outList[nextIdx]!);
  }

  // Traverse all half-edges to collect faces
  const visited = new Set<string>();
  const faces: Face[] = [];

  for (const startHe of halfEdges) {
    const startKey = heKey(startHe);
    if (visited.has(startKey)) continue;

    const cycle: HalfEdge[] = [];
    let current: HalfEdge | undefined = startHe;

    while (current && !visited.has(heKey(current))) {
      visited.add(heKey(current));
      cycle.push(current);
      current = nextMap.get(heKey(current));
    }

    // Valid cycle: must return to start
    if (cycle.length >= 3 && current && heKey(current) === startKey) {
      const coords = cycle.map((he) => {
        const v = network.getVertex(he.from)!;
        return [v.lat, v.lng] as [number, number];
      });

      const area = signedArea(coords);

      // Only keep faces with positive area (CCW = interior faces)
      // The outer face will have the largest negative area
      if (area > 1e-10) {
        const edgeIds = cycle.map((he) => he.edgeId);
        // Deduplicate edge IDs (a face won't have duplicate edges in valid planar graphs,
        // but dangling edges can cause a half-edge to appear twice)
        const uniqueEdgeIds = [...new Set(edgeIds)];

        faces.push({
          halfEdges: cycle.map(
            (he) => [he.from, he.to] as [VertexID, VertexID],
          ),
          edgeIds: uniqueEdgeIds,
          signedArea: area,
        });
      }
    }
  }

  // Filter out faces where edgeIds don't form a proper cycle
  // (dangling edges create degenerate traversals)
  return faces.filter((f) => f.halfEdges.length === f.edgeIds.length);
}

function heKey(he: HalfEdge): string {
  return `${he.from}->${he.to}:${he.edgeId}`;
}

/** Signed area of a polygon given as coordinate pairs [lat, lng]. Positive = CCW. */
function signedArea(coords: Array<[number, number]>): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[(i + 1) % n]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
