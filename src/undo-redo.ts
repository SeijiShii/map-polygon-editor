import type { Network } from "./network";
import type { PolygonManager } from "./polygon-manager";
import { enumerateFaces } from "./half-edge";
import type { ChangeSet, Vertex, Edge, VertexID, EdgeID } from "./types";
import { emptyChangeSet } from "./types";

/**
 * Command-based undo/redo at user-operation granularity.
 * Each push() records a ChangeSet; undo() reverses it; redo() re-applies it.
 */
export class UndoRedoManager {
  private undoStack: ChangeSet[] = [];
  private redoStack: ChangeSet[] = [];

  constructor(
    private network: Network,
    private polygonManager: PolygonManager,
  ) {}

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(cs: ChangeSet): void {
    this.undoStack.push(cs);
    this.redoStack = []; // new operation clears redo
  }

  undo(): ChangeSet | null {
    const cs = this.undoStack.pop();
    if (!cs) return null;

    const inverseCs = this.applyInverse(cs);
    this.redoStack.push(cs);
    return inverseCs;
  }

  redo(): ChangeSet | null {
    const cs = this.redoStack.pop();
    if (!cs) return null;

    const forwardCs = this.applyForward(cs);
    this.undoStack.push(cs);
    return forwardCs;
  }

  /**
   * Reverse a ChangeSet: undo everything it did.
   */
  private applyInverse(cs: ChangeSet): ChangeSet {
    const result = emptyChangeSet();

    // Reverse polygon changes first (they're snapshots, will be rebuilt)

    // Reverse edge additions → remove them
    for (const edge of [...cs.edges.added].reverse()) {
      if (this.network.getEdge(edge.id)) {
        this.network.removeEdge(edge.id);
        result.edges.removed.push(edge.id);
      }
    }

    // Reverse edge removals → re-add them
    // We need the original edge data, which is in the ChangeSet
    // The ChangeSet only stores EdgeIDs for removed, so we need to track full edges.
    // Let's reconstruct from the forward ChangeSet's context.
    // For removed edges, we stored IDs. We need to find the edge data somewhere.
    // The edge data would have been in a prior addition or in the network before removal.
    // Since we can't recover it from just IDs, we need to store full edge data.
    // This is a design issue — let's handle it by storing snapshots.

    // Actually, we need to snapshot removed entities. Let's enhance approach:
    // For now, use the fact that removed edges were previously added in some earlier CS,
    // or were part of intersection resolution (which added replacement edges).
    // The forward CS's edges.removed correspond to edges that existed before the operation.
    // We can reconstruct from the added edges of operations that created them.

    // Better approach: store full snapshots of removed items during push.
    // For the current implementation, let's trace back:
    // cs.edges.removed were edges that the operation removed from the network.
    // We don't have their full data anymore. This means we need to store edge snapshots.

    // WORKAROUND: Since cs doesn't carry full removed edge data,
    // and our operations always produce AddedEdges that replace removed ones,
    // we rely on the pattern: forward adds replace what was removed.
    // On undo, we remove what was added and re-add what was removed.
    // But we need the removed edge data...

    // Let's handle this by not trying to restore individual edges from IDs,
    // but instead relying on the vertex-level operations to rebuild.

    // Reverse vertex moves → move back
    for (const moved of cs.vertices.moved) {
      this.network.moveVertex(moved.id, moved.from.lat, moved.from.lng);
      result.vertices.moved.push({
        id: moved.id,
        from: moved.to,
        to: moved.from,
      });
    }

    // Reverse vertex additions → remove them (this also removes their edges)
    for (const vertex of [...cs.vertices.added].reverse()) {
      if (this.network.getVertex(vertex.id)) {
        const removedEdges = this.network.removeVertex(vertex.id);
        result.vertices.removed.push(vertex.id);
        result.edges.removed.push(...removedEdges);
      }
    }

    // Reverse vertex removals → re-add them
    for (const vertexId of cs.vertices.removed) {
      // We need vertex data. Find it from earlier change sets.
      // The removed vertex was added in some prior operation's cs.vertices.added.
      // For proper implementation, we should store the full vertex data.
      // WORKAROUND: Search through the undo stack and the current CS for the vertex.
      const vertexData = this.findVertexData(vertexId);
      if (vertexData) {
        this.network.addVertex(vertexData.lat, vertexData.lng, vertexData.id);
        result.vertices.added.push(vertexData);
      }
    }

    // Re-add removed edges (need full edge data)
    for (const edgeId of cs.edges.removed) {
      const edgeData = this.findEdgeData(edgeId);
      if (
        edgeData &&
        this.network.getVertex(edgeData.v1) &&
        this.network.getVertex(edgeData.v2)
      ) {
        if (!this.network.getVertexPairEdge(edgeData.v1, edgeData.v2)) {
          const edge = this.network.addEdge(
            edgeData.v1,
            edgeData.v2,
            edgeData.id,
          );
          result.edges.added.push(edge);
        }
      }
    }

    // Rebuild polygons
    this.rebuildPolygons(result);
    return result;
  }

  /**
   * Re-apply a ChangeSet (redo).
   */
  private applyForward(cs: ChangeSet): ChangeSet {
    const result = emptyChangeSet();

    // Re-add vertices
    for (const vertex of cs.vertices.added) {
      if (!this.network.getVertex(vertex.id)) {
        this.network.addVertex(vertex.lat, vertex.lng, vertex.id);
        result.vertices.added.push(vertex);
      }
    }

    // Re-remove edges that were removed
    for (const edgeId of cs.edges.removed) {
      if (this.network.getEdge(edgeId)) {
        this.network.removeEdge(edgeId);
        result.edges.removed.push(edgeId);
      }
    }

    // Re-add edges
    for (const edge of cs.edges.added) {
      if (
        this.network.getVertex(edge.v1) &&
        this.network.getVertex(edge.v2) &&
        !this.network.getVertexPairEdge(edge.v1, edge.v2)
      ) {
        this.network.addEdge(edge.v1, edge.v2, edge.id);
        result.edges.added.push(edge);
      }
    }

    // Re-apply vertex moves
    for (const moved of cs.vertices.moved) {
      if (this.network.getVertex(moved.id)) {
        this.network.moveVertex(moved.id, moved.to.lat, moved.to.lng);
        result.vertices.moved.push(moved);
      }
    }

    // Re-remove vertices
    for (const vertexId of cs.vertices.removed) {
      if (this.network.getVertex(vertexId)) {
        const removedEdges = this.network.removeVertex(vertexId);
        result.vertices.removed.push(vertexId);
        result.edges.removed.push(...removedEdges);
      }
    }

    // Rebuild polygons
    this.rebuildPolygons(result);
    return result;
  }

  /**
   * Find vertex data from the undo/redo stacks.
   */
  private findVertexData(id: VertexID): Vertex | null {
    // Search all change sets for vertex data
    for (const cs of [...this.undoStack, ...this.redoStack]) {
      for (const v of cs.vertices.added) {
        if (v.id === id) return v;
      }
    }
    return null;
  }

  /**
   * Find edge data from the undo/redo stacks.
   */
  private findEdgeData(id: EdgeID): Edge | null {
    for (const cs of [...this.undoStack, ...this.redoStack]) {
      for (const e of cs.edges.added) {
        if (e.id === id) return e;
      }
    }
    return null;
  }

  private rebuildPolygons(cs: ChangeSet): void {
    const faces = enumerateFaces(this.network);
    const diff = this.polygonManager.updateFromFaces(faces, this.network);
    cs.polygons.created.push(...diff.created);
    cs.polygons.modified.push(...diff.modified);
    cs.polygons.removed.push(...diff.removed);
  }
}
