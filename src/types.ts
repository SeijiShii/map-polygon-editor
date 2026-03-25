// Branded ID types
export type VertexID = string & { readonly __brand: "VertexID" };
export type EdgeID = string & { readonly __brand: "EdgeID" };
export type PolygonID = string & { readonly __brand: "PolygonID" };

// Factory functions
export function createVertexID(id: string): VertexID {
  return id as VertexID;
}
export function createEdgeID(id: string): EdgeID {
  return id as EdgeID;
}
export function createPolygonID(id: string): PolygonID {
  return id as PolygonID;
}

// Core data structures
export interface Vertex {
  readonly id: VertexID;
  lat: number;
  lng: number;
}

export interface Edge {
  readonly id: EdgeID;
  readonly v1: VertexID; // unordered pair
  readonly v2: VertexID;
}

export interface PolygonSnapshot {
  readonly id: PolygonID;
  edgeIds: EdgeID[]; // ordered cycle (outer ring)
  holes: EdgeID[][]; // ordered cycles (inner rings)
  vertexIds: VertexID[]; // unique vertices of the outer ring
  locked?: boolean; // default false — prevents shape editing
  active?: boolean; // default true — false marks as inactive (e.g. lake)
}

export type PolygonStatusField = "locked" | "active";

export interface PolygonStatusChange {
  id: PolygonID;
  field: PolygonStatusField;
  before: boolean;
  after: boolean;
}

// ChangeSet returned by every operation
export interface ChangeSet {
  vertices: {
    added: Vertex[];
    removed: VertexID[];
    moved: Array<{
      id: VertexID;
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
    }>;
  };
  edges: {
    added: Edge[];
    removed: EdgeID[];
  };
  polygons: {
    created: PolygonSnapshot[];
    modified: Array<{
      id: PolygonID;
      before: PolygonSnapshot;
      after: PolygonSnapshot;
    }>;
    removed: PolygonID[];
    statusChanged: PolygonStatusChange[];
  };
}

export class LockedPolygonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockedPolygonError";
  }
}

export type EditorMode = "idle" | "drawing" | "editing";

// StorageAdapter interface
export interface StorageAdapter {
  loadAll(): Promise<{
    vertices: Vertex[];
    edges: Edge[];
    polygons: PolygonSnapshot[];
  }>;

  // Record-level operations
  putVertex(vertex: Vertex): Promise<void>;
  deleteVertex(id: VertexID): Promise<void>;
  putEdge(edge: Edge): Promise<void>;
  deleteEdge(id: EdgeID): Promise<void>;
  putPolygon(polygon: PolygonSnapshot): Promise<void>;
  deletePolygon(id: PolygonID): Promise<void>;

  // Remote change subscription (optional)
  onRemoteChange?(handler: (change: ChangeSet) => void): void;
}

// Half-edge face (internal use)
export interface Face {
  halfEdges: Array<[VertexID, VertexID]>;
  edgeIds: EdgeID[];
  signedArea: number;
}

// Empty ChangeSet helper
export function emptyChangeSet(): ChangeSet {
  return {
    vertices: { added: [], removed: [], moved: [] },
    edges: { added: [], removed: [] },
    polygons: { created: [], modified: [], removed: [], statusChanged: [] },
  };
}
