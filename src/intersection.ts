import type { Network } from "./network";
import type { Vertex, Edge, VertexID, EdgeID } from "./types";

interface Point {
  lat: number;
  lng: number;
}

interface IntersectionResult {
  edgeId: EdgeID;
  point: Point;
  t: number; // parameter along the query segment [0, 1]
}

interface ResolveResult {
  addedVertices: Vertex[];
  addedEdges: Edge[];
  removedEdgeIds: EdgeID[];
}

/**
 * Compute intersection point of two line segments.
 * Returns null if segments don't cross (parallel, non-intersecting, or shared endpoint).
 */
export function segmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1lat = p2.lat - p1.lat;
  const d1lng = p2.lng - p1.lng;
  const d2lat = p4.lat - p3.lat;
  const d2lng = p4.lng - p3.lng;

  const denom = d1lat * d2lng - d1lng * d2lat;
  if (Math.abs(denom) < 1e-12) {
    return null; // parallel or collinear
  }

  const dlat = p3.lat - p1.lat;
  const dlng = p3.lng - p1.lng;

  const t = (dlat * d2lng - dlng * d2lat) / denom;
  const u = (dlat * d1lng - dlng * d1lat) / denom;

  // Strict interior intersection only (exclude endpoints)
  const eps = 1e-10;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) {
    return null;
  }

  return {
    lat: p1.lat + t * d1lat,
    lng: p1.lng + t * d1lng,
  };
}

/**
 * Find all edges in the network that intersect with the line segment from start to end.
 * Returns intersections sorted by distance from start (parameter t).
 */
export function findIntersections(
  start: Point,
  end: Point,
  network: Network,
  excludeEdgeIds: Set<EdgeID>,
): IntersectionResult[] {
  const results: IntersectionResult[] = [];

  for (const edge of network.getAllEdges()) {
    if (excludeEdgeIds.has(edge.id)) continue;

    const v1 = network.getVertex(edge.v1)!;
    const v2 = network.getVertex(edge.v2)!;

    const point = segmentIntersection(start, end, v1, v2);
    if (point) {
      const dx = point.lat - start.lat;
      const dy = point.lng - start.lng;
      const totalDx = end.lat - start.lat;
      const totalDy = end.lng - start.lng;
      const t =
        Math.abs(totalDx) > Math.abs(totalDy) ? dx / totalDx : dy / totalDy;

      results.push({ edgeId: edge.id, point, t });
    }
  }

  // Sort by parameter t (distance from start)
  results.sort((a, b) => a.t - b.t);
  return results;
}

/**
 * Add an edge from v1 to v2 in the network, splitting any intersecting edges
 * and the new edge itself at intersection points.
 *
 * Returns details of all vertices/edges added and removed.
 */
export function resolveIntersections(
  v1Id: VertexID,
  v2Id: VertexID,
  network: Network,
): ResolveResult {
  const v1 = network.getVertex(v1Id)!;
  const v2 = network.getVertex(v2Id)!;

  // Find intersections with existing edges
  // Exclude edges that share an endpoint with v1 or v2
  const v1Edges = new Set(network.getEdgesOfVertex(v1Id).map((e) => e.id));
  const v2Edges = new Set(network.getEdgesOfVertex(v2Id).map((e) => e.id));
  const excludeEdgeIds = new Set([...v1Edges, ...v2Edges]);

  const intersections = findIntersections(v1, v2, network, excludeEdgeIds);

  // Also find existing vertices that lie on the new edge (vertex pass-through)
  const passThroughVertices = findVerticesOnSegment(
    v1,
    v2,
    v1Id,
    v2Id,
    network,
  );

  if (intersections.length === 0 && passThroughVertices.length === 0) {
    // No intersections — just add the edge
    const edge = network.addEdge(v1Id, v2Id);
    return {
      addedVertices: [],
      addedEdges: [edge],
      removedEdgeIds: [],
    };
  }

  // Process intersections: insert vertices and split edges
  const addedVertices: Vertex[] = [];
  const addedEdges: Edge[] = [];
  const removedEdgeIds: EdgeID[] = [];

  // Collect intersection vertices
  const intersectionVertices: VertexID[] = [];

  for (const ix of intersections) {
    // Create vertex at intersection point
    const newVertex = network.addVertex(ix.point.lat, ix.point.lng);
    addedVertices.push(newVertex);
    intersectionVertices.push(newVertex.id);

    // Split the existing edge at the intersection point
    const existingEdge = network.getEdge(ix.edgeId);
    if (existingEdge) {
      network.removeEdge(ix.edgeId);
      removedEdgeIds.push(ix.edgeId);

      const e1 = network.addEdge(existingEdge.v1, newVertex.id);
      const e2 = network.addEdge(newVertex.id, existingEdge.v2);
      addedEdges.push(e1, e2);
    }
  }

  // Build chain of edges along the new line: v1 → (pass-through & intersection vertices sorted by t) → v2
  // Merge intersection vertices and pass-through vertices, sorted by t parameter
  const allSplitPoints: Array<{ id: VertexID; t: number }> = [];
  for (let i = 0; i < intersections.length; i++) {
    allSplitPoints.push({
      id: intersectionVertices[i]!,
      t: intersections[i]!.t,
    });
  }
  for (const ptv of passThroughVertices) {
    allSplitPoints.push({ id: ptv.id, t: ptv.t });
  }
  allSplitPoints.sort((a, b) => a.t - b.t);

  const chain = [v1Id, ...allSplitPoints.map((p) => p.id), v2Id];
  for (let i = 0; i < chain.length - 1; i++) {
    // Skip if edge already exists (pass-through vertex may already be connected)
    if (network.getVertexPairEdge(chain[i]!, chain[i + 1]!)) continue;
    const edge = network.addEdge(chain[i]!, chain[i + 1]!);
    addedEdges.push(edge);
  }

  return { addedVertices, addedEdges, removedEdgeIds };
}

/**
 * Find existing vertices (excluding endpoints) that lie on the segment from p1 to p2.
 * Returns vertices sorted by parameter t along the segment.
 */
function findVerticesOnSegment(
  p1: Point,
  p2: Point,
  excludeV1: VertexID,
  excludeV2: VertexID,
  network: Network,
): Array<{ id: VertexID; t: number }> {
  const results: Array<{ id: VertexID; t: number }> = [];
  const dx = p2.lat - p1.lat;
  const dy = p2.lng - p1.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return results;

  const eps = 1e-8;

  for (const v of network.getAllVertices()) {
    if (v.id === excludeV1 || v.id === excludeV2) continue;

    // Project vertex onto segment
    const t = ((v.lat - p1.lat) * dx + (v.lng - p1.lng) * dy) / lenSq;
    if (t <= eps || t >= 1 - eps) continue; // not interior

    // Check distance from vertex to the line
    const projLat = p1.lat + t * dx;
    const projLng = p1.lng + t * dy;
    const dist = Math.hypot(v.lat - projLat, v.lng - projLng);
    if (dist < eps) {
      results.push({ id: v.id, t });
    }
  }

  results.sort((a, b) => a.t - b.t);
  return results;
}
