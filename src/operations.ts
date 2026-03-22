import type { Network } from "./network";
import type { PolygonManager } from "./polygon-manager";
import { enumerateFaces } from "./half-edge";
import { findIntersections, resolveIntersections } from "./intersection";
import type {
  ChangeSet,
  Vertex,
  Edge,
  VertexID,
  EdgeID,
  PolygonID,
} from "./types";
import { emptyChangeSet, LockedPolygonError } from "./types";

export class Operations {
  constructor(
    private network: Network,
    private polygonManager: PolygonManager,
  ) {}

  private isVertexLocked(vertexId: VertexID): boolean {
    for (const poly of this.polygonManager.getAllPolygons()) {
      if (!(poly.locked ?? false)) continue;
      for (const eid of poly.edgeIds) {
        const edge = this.network.getEdge(eid);
        if (edge && (edge.v1 === vertexId || edge.v2 === vertexId)) return true;
      }
      for (const hole of poly.holes) {
        for (const eid of hole) {
          const edge = this.network.getEdge(eid);
          if (edge && (edge.v1 === vertexId || edge.v2 === vertexId))
            return true;
        }
      }
    }
    return false;
  }

  private isEdgeLocked(edgeId: EdgeID): boolean {
    for (const poly of this.polygonManager.getAllPolygons()) {
      if (!(poly.locked ?? false)) continue;
      if (poly.edgeIds.includes(edgeId)) return true;
      for (const hole of poly.holes) {
        if (hole.includes(edgeId)) return true;
      }
    }
    return false;
  }

  addVertex(lat: number, lng: number): ChangeSet {
    const vertex = this.network.addVertex(lat, lng);
    const cs = emptyChangeSet();
    cs.vertices.added.push(vertex);
    return cs;
  }

  addConnectedVertex(fromId: VertexID, lat: number, lng: number): ChangeSet {
    const newVertex = this.network.addVertex(lat, lng);
    const cs = emptyChangeSet();
    cs.vertices.added.push(newVertex);

    // Add edge with intersection resolution
    const result = resolveIntersections(fromId, newVertex.id, this.network);
    cs.vertices.added.push(...result.addedVertices);
    cs.edges.added.push(...result.addedEdges);
    cs.edges.removed.push(...result.removedEdgeIds);

    // Rebuild polygons
    this.rebuildPolygons(cs);
    return cs;
  }

  snapToVertex(fromId: VertexID, toId: VertexID): ChangeSet {
    const cs = emptyChangeSet();
    const result = resolveIntersections(fromId, toId, this.network);
    cs.vertices.added.push(...result.addedVertices);
    cs.edges.added.push(...result.addedEdges);
    cs.edges.removed.push(...result.removedEdgeIds);

    this.rebuildPolygons(cs);
    return cs;
  }

  snapToEdge(
    fromId: VertexID,
    edgeId: EdgeID,
    lat: number,
    lng: number,
  ): ChangeSet {
    const cs = emptyChangeSet();

    // Split the target edge at the given point
    const edge = this.network.getEdge(edgeId)!;
    const splitVertex = this.network.addVertex(lat, lng);
    cs.vertices.added.push(splitVertex);

    this.network.removeEdge(edgeId);
    cs.edges.removed.push(edgeId);

    const e1 = this.network.addEdge(edge.v1, splitVertex.id);
    const e2 = this.network.addEdge(splitVertex.id, edge.v2);
    cs.edges.added.push(e1, e2);

    // Connect from vertex to the split point (with intersection resolution)
    const result = resolveIntersections(fromId, splitVertex.id, this.network);
    cs.vertices.added.push(...result.addedVertices);
    cs.edges.added.push(...result.addedEdges);
    cs.edges.removed.push(...result.removedEdgeIds);

    this.rebuildPolygons(cs);
    return cs;
  }

  /**
   * Move vertex and rebuild polygons without intersection resolution.
   * Used for live drag preview — caller is responsible for undo.
   */
  moveVertexLight(vertexId: VertexID, lat: number, lng: number): ChangeSet {
    if (this.isVertexLocked(vertexId))
      throw new LockedPolygonError(
        `Vertex ${vertexId} belongs to a locked polygon`,
      );
    const cs = emptyChangeSet();
    const oldPos = this.network.moveVertex(vertexId, lat, lng);
    cs.vertices.moved.push({
      id: vertexId,
      from: oldPos,
      to: { lat, lng },
    });
    this.rebuildPolygons(cs);
    return cs;
  }

  moveVertex(vertexId: VertexID, lat: number, lng: number): ChangeSet {
    if (this.isVertexLocked(vertexId))
      throw new LockedPolygonError(
        `Vertex ${vertexId} belongs to a locked polygon`,
      );
    const cs = emptyChangeSet();
    const oldPos = this.network.moveVertex(vertexId, lat, lng);
    cs.vertices.moved.push({
      id: vertexId,
      from: oldPos,
      to: { lat, lng },
    });

    // Check for new intersections on all edges connected to this vertex
    const connectedEdges = this.network.getEdgesOfVertex(vertexId);
    for (const edge of connectedEdges) {
      const otherVertex = edge.v1 === vertexId ? edge.v2 : edge.v1;
      const v = this.network.getVertex(vertexId)!;
      const other = this.network.getVertex(otherVertex)!;

      // Find intersections excluding the edge itself and neighbor edges
      const excludeIds = new Set(
        this.network
          .getEdgesOfVertex(vertexId)
          .map((e) => e.id)
          .concat(this.network.getEdgesOfVertex(otherVertex).map((e) => e.id)),
      );

      const intersections = findIntersections(
        v,
        other,
        this.network,
        excludeIds,
      );

      // If there are intersections, we need to split
      // For simplicity, remove the edge and re-add with intersection resolution
      if (intersections.length > 0) {
        this.network.removeEdge(edge.id);
        cs.edges.removed.push(edge.id);
        const result = resolveIntersections(
          vertexId,
          otherVertex,
          this.network,
        );
        cs.vertices.added.push(...result.addedVertices);
        cs.edges.added.push(...result.addedEdges);
        cs.edges.removed.push(...result.removedEdgeIds);
      }
    }

    this.rebuildPolygons(cs);
    return cs;
  }

  removeVertex(vertexId: VertexID): ChangeSet {
    if (this.isVertexLocked(vertexId))
      throw new LockedPolygonError(
        `Vertex ${vertexId} belongs to a locked polygon`,
      );
    const cs = emptyChangeSet();
    const removedEdgeIds = this.network.removeVertex(vertexId);
    cs.vertices.removed.push(vertexId);
    cs.edges.removed.push(...removedEdgeIds);

    this.rebuildPolygons(cs);
    return cs;
  }

  removeEdge(edgeId: EdgeID): ChangeSet {
    if (this.isEdgeLocked(edgeId))
      throw new LockedPolygonError(
        `Edge ${edgeId} belongs to a locked polygon`,
      );
    const cs = emptyChangeSet();
    this.network.removeEdge(edgeId);
    cs.edges.removed.push(edgeId);

    this.rebuildPolygons(cs);
    return cs;
  }

  splitEdgeAtPoint(edgeId: EdgeID, lat: number, lng: number): ChangeSet {
    if (this.isEdgeLocked(edgeId))
      throw new LockedPolygonError(
        `Edge ${edgeId} belongs to a locked polygon`,
      );
    const cs = emptyChangeSet();
    const edge = this.network.getEdge(edgeId)!;

    const splitVertex = this.network.addVertex(lat, lng);
    cs.vertices.added.push(splitVertex);

    this.network.removeEdge(edgeId);
    cs.edges.removed.push(edgeId);

    const e1 = this.network.addEdge(edge.v1, splitVertex.id);
    const e2 = this.network.addEdge(splitVertex.id, edge.v2);
    cs.edges.added.push(e1, e2);

    this.rebuildPolygons(cs);
    return cs;
  }

  removePolygon(polygonId: PolygonID): ChangeSet {
    const cs = emptyChangeSet();
    const polygon = this.polygonManager.getPolygon(polygonId);
    if (!polygon) return cs;
    if (polygon.locked ?? false)
      throw new LockedPolygonError(`Polygon ${polygonId} is locked`);

    // Collect all edge IDs of the target polygon (outer + holes)
    const targetEdgeIds = new Set<EdgeID>(polygon.edgeIds);
    for (const hole of polygon.holes) {
      for (const eid of hole) targetEdgeIds.add(eid);
    }

    // Collect edge IDs protected by other polygons
    const protectedEdgeIds = new Set<EdgeID>();
    for (const other of this.polygonManager.getAllPolygons()) {
      if (other.id === polygonId) continue;
      for (const eid of other.edgeIds) protectedEdgeIds.add(eid);
      for (const hole of other.holes) {
        for (const eid of hole) protectedEdgeIds.add(eid);
      }
    }

    // Edges to delete = target edges minus protected
    const edgesToDelete: EdgeID[] = [];
    for (const eid of targetEdgeIds) {
      if (!protectedEdgeIds.has(eid)) edgesToDelete.push(eid);
    }

    // Collect candidate vertices before deleting edges
    const candidateVertexIds = new Set<VertexID>();
    for (const eid of edgesToDelete) {
      const edge = this.network.getEdge(eid);
      if (edge) {
        candidateVertexIds.add(edge.v1);
        candidateVertexIds.add(edge.v2);
      }
    }

    // Delete edges
    for (const eid of edgesToDelete) {
      this.network.removeEdge(eid);
      cs.edges.removed.push(eid);
    }

    // Delete vertices that became isolated (degree 0) in the network
    for (const vid of candidateVertexIds) {
      if (
        this.network.getVertex(vid) &&
        this.network.getEdgesOfVertex(vid).length === 0
      ) {
        this.network.removeVertex(vid);
        cs.vertices.removed.push(vid);
      }
    }

    this.rebuildPolygons(cs);
    return cs;
  }

  private rebuildPolygons(cs: ChangeSet): void {
    const faces = enumerateFaces(this.network);
    const movedVertexIds = new Set(cs.vertices.moved.map((m) => m.id));
    const diff = this.polygonManager.updateFromFaces(
      faces,
      this.network,
      movedVertexIds,
    );
    cs.polygons.created.push(...diff.created);
    cs.polygons.modified.push(...diff.modified);
    cs.polygons.removed.push(...diff.removed);
  }
}
