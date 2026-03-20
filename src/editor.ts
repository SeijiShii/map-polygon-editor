import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { Operations } from "./operations";
import { DrawingMode } from "./drawing-mode";
import { UndoRedoManager } from "./undo-redo";
import { enumerateFaces } from "./half-edge";
import type {
  Vertex,
  Edge,
  PolygonSnapshot,
  ChangeSet,
  VertexID,
  EdgeID,
  PolygonID,
  EditorMode,
  StorageAdapter,
} from "./types";
import { emptyChangeSet } from "./types";
import type { FeatureCollection, Polygon } from "geojson";

export class NetworkPolygonEditor {
  private network: Network;
  private polygonManager: PolygonManager;
  private operations: Operations;
  private drawingMode: DrawingMode;
  private undoRedo: UndoRedoManager;
  private adapter: StorageAdapter | null;

  constructor(adapter?: StorageAdapter) {
    this.network = new Network();
    this.polygonManager = new PolygonManager();
    this.operations = new Operations(this.network, this.polygonManager);
    this.drawingMode = new DrawingMode(this.operations, this.network);
    this.undoRedo = new UndoRedoManager(this.network, this.polygonManager);
    this.adapter = adapter ?? null;
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    if (!this.adapter) return;
    const data = await this.adapter.loadAll();
    if (!data) return;

    // Restore vertices
    for (const v of data.vertices) {
      this.network.addVertex(v.lat, v.lng, v.id);
    }
    // Restore edges
    for (const e of data.edges) {
      this.network.addEdge(e.v1, e.v2, e.id);
    }
    // Rebuild polygon snapshots from network
    const faces = enumerateFaces(this.network);
    this.polygonManager.updateFromFaces(faces, this.network);
  }

  async save(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.saveAll({
      vertices: this.network.getAllVertices(),
      edges: this.network.getAllEdges(),
      polygons: this.polygonManager.getAllPolygons(),
    });
  }

  // --- Mode ---

  getMode(): EditorMode {
    if (this.drawingMode.isActive()) return "drawing";
    return "idle";
  }

  startDrawing(): void {
    this.drawingMode.start();
  }

  endDrawing(): ChangeSet {
    return this.drawingMode.end();
  }

  // --- Drawing operations ---

  placeVertex(lat: number, lng: number): ChangeSet {
    const cs = this.drawingMode.placeVertex(lat, lng);
    this.undoRedo.push(cs);
    return cs;
  }

  snapToVertex(vertexId: VertexID): ChangeSet {
    if (this.drawingMode.isActive()) {
      const cs = this.drawingMode.snapToExistingVertex(vertexId);
      this.undoRedo.push(cs);
      return cs;
    }
    // Non-drawing mode: connect two vertices (edit operation)
    const cs = this.operations.snapToVertex(
      vertexId,
      vertexId,
    ); // This doesn't make sense — need fromId
    this.undoRedo.push(cs);
    return cs;
  }

  snapToEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet {
    if (this.drawingMode.isActive()) {
      const cs = this.drawingMode.snapToExistingEdge(edgeId, lat, lng);
      this.undoRedo.push(cs);
      return cs;
    }
    return emptyChangeSet();
  }

  // --- Edit operations ---

  moveVertex(vertexId: VertexID, lat: number, lng: number): ChangeSet {
    const cs = this.operations.moveVertex(vertexId, lat, lng);
    this.undoRedo.push(cs);
    return cs;
  }

  removeVertex(vertexId: VertexID): ChangeSet {
    const cs = this.operations.removeVertex(vertexId);
    this.undoRedo.push(cs);
    return cs;
  }

  removeEdge(edgeId: EdgeID): ChangeSet {
    const cs = this.operations.removeEdge(edgeId);
    this.undoRedo.push(cs);
    return cs;
  }

  splitEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet {
    const cs = this.operations.splitEdgeAtPoint(edgeId, lat, lng);
    this.undoRedo.push(cs);
    return cs;
  }

  // --- Undo/Redo ---

  undo(): ChangeSet | null {
    return this.undoRedo.undo();
  }

  redo(): ChangeSet | null {
    return this.undoRedo.redo();
  }

  // --- Query ---

  getVertices(): Vertex[] {
    return this.network.getAllVertices();
  }

  getEdges(): Edge[] {
    return this.network.getAllEdges();
  }

  getPolygons(): PolygonSnapshot[] {
    return this.polygonManager.getAllPolygons();
  }

  getVertex(id: VertexID): Vertex | null {
    return this.network.getVertex(id);
  }

  getEdge(id: EdgeID): Edge | null {
    return this.network.getEdge(id);
  }

  getPolygonGeoJSON(id: PolygonID): Polygon | null {
    return this.polygonManager.toGeoJSON(id, this.network);
  }

  getAllGeoJSON(): FeatureCollection {
    return this.polygonManager.toFeatureCollection(this.network);
  }
}
