import { generateId } from "./id";
import type { Vertex, Edge, VertexID, EdgeID } from "./types";
import { createVertexID, createEdgeID } from "./types";

export class Network {
  private vertices = new Map<VertexID, Vertex>();
  private edges = new Map<EdgeID, Edge>();
  private adjacency = new Map<VertexID, Set<EdgeID>>();
  // Key: "v1:v2" where v1 < v2 lexicographically → EdgeID
  private pairIndex = new Map<string, EdgeID>();

  // --- Vertex operations ---

  addVertex(lat: number, lng: number, id?: VertexID): Vertex {
    const vertexId = id ?? createVertexID(generateId());
    const vertex: Vertex = { id: vertexId, lat, lng };
    this.vertices.set(vertexId, vertex);
    this.adjacency.set(vertexId, new Set());
    return vertex;
  }

  getVertex(id: VertexID): Vertex | null {
    return this.vertices.get(id) ?? null;
  }

  removeVertex(id: VertexID): EdgeID[] {
    if (!this.vertices.has(id)) {
      throw new Error(`Vertex ${id} does not exist`);
    }
    const edgeIds = this.adjacency.get(id);
    const removedEdgeIds: EdgeID[] = [];
    if (edgeIds) {
      for (const edgeId of [...edgeIds]) {
        removedEdgeIds.push(edgeId);
        this.removeEdge(edgeId);
      }
    }
    this.adjacency.delete(id);
    this.vertices.delete(id);
    return removedEdgeIds;
  }

  moveVertex(
    id: VertexID,
    lat: number,
    lng: number,
  ): { lat: number; lng: number } {
    const vertex = this.vertices.get(id);
    if (!vertex) {
      throw new Error(`Vertex ${id} does not exist`);
    }
    const old = { lat: vertex.lat, lng: vertex.lng };
    vertex.lat = lat;
    vertex.lng = lng;
    return old;
  }

  getAllVertices(): Vertex[] {
    return [...this.vertices.values()];
  }

  // --- Edge operations ---

  addEdge(v1: VertexID, v2: VertexID, id?: EdgeID): Edge {
    if (v1 === v2) {
      throw new Error("Self-loop is not allowed");
    }
    if (!this.vertices.has(v1)) {
      throw new Error(`Vertex ${v1} does not exist`);
    }
    if (!this.vertices.has(v2)) {
      throw new Error(`Vertex ${v2} does not exist`);
    }
    const pairKey = this.makePairKey(v1, v2);
    if (this.pairIndex.has(pairKey)) {
      throw new Error(`Edge between ${v1} and ${v2} already exists`);
    }

    const edgeId = id ?? createEdgeID(generateId());
    const edge: Edge = { id: edgeId, v1, v2 };
    this.edges.set(edgeId, edge);
    this.adjacency.get(v1)!.add(edgeId);
    this.adjacency.get(v2)!.add(edgeId);
    this.pairIndex.set(pairKey, edgeId);
    return edge;
  }

  getEdge(id: EdgeID): Edge | null {
    return this.edges.get(id) ?? null;
  }

  removeEdge(id: EdgeID): void {
    const edge = this.edges.get(id);
    if (!edge) {
      throw new Error(`Edge ${id} does not exist`);
    }
    this.adjacency.get(edge.v1)?.delete(id);
    this.adjacency.get(edge.v2)?.delete(id);
    this.pairIndex.delete(this.makePairKey(edge.v1, edge.v2));
    this.edges.delete(id);
  }

  getAllEdges(): Edge[] {
    return [...this.edges.values()];
  }

  // --- Adjacency queries ---

  getEdgesOfVertex(id: VertexID): Edge[] {
    const edgeIds = this.adjacency.get(id);
    if (!edgeIds) return [];
    return [...edgeIds]
      .map((eid) => this.edges.get(eid))
      .filter((e): e is Edge => e !== undefined);
  }

  getNeighborVertices(id: VertexID): Vertex[] {
    const edges = this.getEdgesOfVertex(id);
    return edges
      .map((e) => {
        const neighborId = e.v1 === id ? e.v2 : e.v1;
        return this.vertices.get(neighborId);
      })
      .filter((v): v is Vertex => v !== undefined);
  }

  getVertexPairEdge(v1: VertexID, v2: VertexID): EdgeID | undefined {
    return this.pairIndex.get(this.makePairKey(v1, v2));
  }

  // --- Internal ---

  private makePairKey(v1: VertexID, v2: VertexID): string {
    return v1 < v2 ? `${v1}:${v2}` : `${v2}:${v1}`;
  }
}
