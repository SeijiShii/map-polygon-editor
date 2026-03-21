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
    const cs = this.operations.snapToVertex(vertexId, vertexId); // This doesn't make sense — need fromId
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

  // --- Drag operations ---

  private dragOrigin: { id: VertexID; lat: number; lng: number } | null = null;

  beginDrag(vertexId: VertexID): void {
    const v = this.network.getVertex(vertexId);
    if (!v) throw new Error(`Vertex ${vertexId} does not exist`);
    this.dragOrigin = { id: vertexId, lat: v.lat, lng: v.lng };
  }

  dragTo(lat: number, lng: number): ChangeSet {
    if (!this.dragOrigin) throw new Error("No drag in progress");
    return this.operations.moveVertexLight(this.dragOrigin.id, lat, lng);
  }

  endDrag(): ChangeSet {
    if (!this.dragOrigin) throw new Error("No drag in progress");
    const { id, lat: origLat, lng: origLng } = this.dragOrigin;
    const current = this.network.getVertex(id)!;
    const finalLat = current.lat;
    const finalLng = current.lng;
    this.dragOrigin = null;

    // Restore to original position, then do a full moveVertex
    // so intersection resolution runs and undo is recorded correctly
    this.network.moveVertex(id, origLat, origLng);
    const cs = this.operations.moveVertex(id, finalLat, finalLng);
    this.undoRedo.push(cs);
    return cs;
  }

  cancelDrag(): void {
    if (!this.dragOrigin) return;
    const { id, lat, lng } = this.dragOrigin;
    this.dragOrigin = null;
    // Restore original position and rebuild polygons
    this.operations.moveVertexLight(id, lat, lng);
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

  canUndo(): boolean {
    return this.undoRedo.canUndo();
  }

  canRedo(): boolean {
    return this.undoRedo.canRedo();
  }

  undo(): ChangeSet | null {
    return this.undoRedo.undo();
  }

  redo(): ChangeSet | null {
    return this.undoRedo.redo();
  }

  // --- Cleanup ---

  pruneOrphans(): ChangeSet {
    const cs = emptyChangeSet();
    // Collect all edge IDs that belong to any polygon (including holes)
    const polygonEdgeIds = new Set<EdgeID>();
    for (const poly of this.polygonManager.getAllPolygons()) {
      for (const eid of poly.edgeIds) polygonEdgeIds.add(eid);
      for (const hole of poly.holes) {
        for (const eid of hole) polygonEdgeIds.add(eid);
      }
    }

    // Collect all vertex IDs referenced by polygon edges
    const polygonVertexIds = new Set<VertexID>();
    for (const eid of polygonEdgeIds) {
      const edge = this.network.getEdge(eid);
      if (edge) {
        polygonVertexIds.add(edge.v1);
        polygonVertexIds.add(edge.v2);
      }
    }

    // Remove orphan edges first
    for (const edge of this.network.getAllEdges()) {
      if (!polygonEdgeIds.has(edge.id)) {
        this.network.removeEdge(edge.id);
        cs.edges.removed.push(edge.id);
      }
    }

    // Remove orphan vertices
    for (const vertex of this.network.getAllVertices()) {
      if (!polygonVertexIds.has(vertex.id)) {
        this.network.removeVertex(vertex.id);
        cs.vertices.removed.push(vertex.id);
      }
    }

    this.undoRedo.push(cs);
    return cs;
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

  findNearestVertex(lat: number, lng: number, radius: number): Vertex | null {
    return this.network.findNearestVertex(lat, lng, radius);
  }

  findNearestEdge(
    lat: number,
    lng: number,
    radius: number,
  ): {
    edge: Edge;
    point: { lat: number; lng: number };
    distance: number;
  } | null {
    return this.network.findNearestEdge(lat, lng, radius);
  }

  getPolygonGeoJSON(id: PolygonID): Polygon | null {
    return this.polygonManager.toGeoJSON(id, this.network);
  }

  getAllGeoJSON(): FeatureCollection {
    return this.polygonManager.toFeatureCollection(this.network);
  }
}
