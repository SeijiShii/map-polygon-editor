import type { Operations } from "./operations";
import type { Network } from "./network";
import type { ChangeSet, VertexID, EdgeID } from "./types";
import { emptyChangeSet } from "./types";

export class DrawingMode {
  private active = false;
  private currentVertexId: VertexID | null = null;
  private sessionVertices: VertexID[] = [];
  private sessionEdges: EdgeID[] = [];

  constructor(
    private ops: Operations,
    private network: Network,
  ) {}

  isActive(): boolean {
    return this.active;
  }

  getSessionVertices(): VertexID[] {
    return [...this.sessionVertices];
  }

  start(): void {
    this.active = true;
    this.currentVertexId = null;
    this.sessionVertices = [];
    this.sessionEdges = [];
  }

  end(): ChangeSet {
    this.active = false;
    this.currentVertexId = null;
    this.sessionVertices = [];
    this.sessionEdges = [];
    return emptyChangeSet();
  }

  placeVertex(lat: number, lng: number): ChangeSet {
    if (!this.active) {
      throw new Error("Drawing mode is not active");
    }

    if (this.currentVertexId === null) {
      // First vertex — isolated
      const cs = this.ops.addVertex(lat, lng);
      const newId = cs.vertices.added[0]!.id;
      this.currentVertexId = newId;
      this.sessionVertices.push(newId);
      return cs;
    }

    // Subsequent vertex — connected to current
    const cs = this.ops.addConnectedVertex(this.currentVertexId, lat, lng);
    const newId = cs.vertices.added[0]!.id;
    this.currentVertexId = newId;
    this.sessionVertices.push(newId);
    if (cs.edges.added.length > 0) {
      this.sessionEdges.push(cs.edges.added[0]!.id);
    }
    return cs;
  }

  snapToExistingVertex(vertexId: VertexID): ChangeSet {
    if (!this.active) {
      throw new Error("Drawing mode is not active");
    }

    let cs: ChangeSet;
    if (this.currentVertexId === null) {
      // No current vertex — just set it as current and end
      this.currentVertexId = vertexId;
      cs = emptyChangeSet();
    } else {
      cs = this.ops.snapToVertex(this.currentVertexId, vertexId);
      if (cs.edges.added.length > 0) {
        this.sessionEdges.push(cs.edges.added[0]!.id);
      }
    }

    // End drawing
    this.active = false;
    this.currentVertexId = null;
    this.sessionVertices = [];
    this.sessionEdges = [];
    return cs;
  }

  snapToExistingEdge(
    edgeId: EdgeID,
    lat: number,
    lng: number,
  ): ChangeSet {
    if (!this.active) {
      throw new Error("Drawing mode is not active");
    }

    let cs: ChangeSet;
    if (this.currentVertexId === null) {
      // Split edge and set split point as current, then end
      cs = this.ops.splitEdgeAtPoint(edgeId, lat, lng);
      // The split vertex is the last added
    } else {
      cs = this.ops.snapToEdge(this.currentVertexId, edgeId, lat, lng);
    }

    // End drawing
    this.active = false;
    this.currentVertexId = null;
    this.sessionVertices = [];
    this.sessionEdges = [];
    return cs;
  }

  undoLastVertex(): ChangeSet {
    if (!this.active || this.sessionVertices.length === 0) {
      return emptyChangeSet();
    }

    const lastVertexId = this.sessionVertices.pop()!;

    // Remove the edge connecting to this vertex (if any)
    if (this.sessionEdges.length > 0) {
      const lastEdgeId = this.sessionEdges.pop()!;
      // Edge might already be gone if intersection resolution changed things
      if (this.network.getEdge(lastEdgeId)) {
        this.network.removeEdge(lastEdgeId);
      }
    }

    // Remove the vertex
    const cs = emptyChangeSet();
    if (this.network.getVertex(lastVertexId)) {
      const removedEdges = this.network.removeVertex(lastVertexId);
      cs.vertices.removed.push(lastVertexId);
      cs.edges.removed.push(...removedEdges);
    }

    // Update current vertex
    this.currentVertexId =
      this.sessionVertices.length > 0
        ? this.sessionVertices[this.sessionVertices.length - 1]!
        : null;

    return cs;
  }
}
