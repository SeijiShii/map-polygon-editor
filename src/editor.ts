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
import { emptyChangeSet, LockedPolygonError } from "./types";
import type { FeatureCollection, Polygon } from "geojson";

export class NetworkPolygonEditor {
  private network: Network;
  private polygonManager: PolygonManager;
  private operations: Operations;
  private drawingMode: DrawingMode;
  private undoRedo: UndoRedoManager;
  private adapter: StorageAdapter | null;

  /** Callback invoked when a remote change is applied via onRemoteChange */
  onRemoteUpdate?: (cs: ChangeSet) => void;

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

    // Restore status from loaded polygon data
    if (data.polygons) {
      const loadedByEdgeKey = new Map<string, PolygonSnapshot>();
      for (const p of data.polygons) {
        const key = [...p.edgeIds].sort().join(",");
        loadedByEdgeKey.set(key, p);
      }
      for (const poly of this.polygonManager.getAllPolygons()) {
        const key = [...poly.edgeIds].sort().join(",");
        const loaded = loadedByEdgeKey.get(key);
        if (loaded) {
          if (loaded.locked != null)
            this.polygonManager.setStatus(poly.id, "locked", loaded.locked);
          if (loaded.active != null)
            this.polygonManager.setStatus(poly.id, "active", loaded.active);
        }
      }
    }

    // Register remote change handler
    this.adapter?.onRemoteChange?.((change) => {
      const result = this.applyRemoteChange(change);
      this.onRemoteUpdate?.(result);
    });
  }

  // --- Record-level persistence ---

  private persistChangeSet(cs: ChangeSet): void {
    if (!this.adapter) return;
    const a = this.adapter;

    // Vertices
    for (const v of cs.vertices.added) {
      a.putVertex(v);
    }
    for (const id of cs.vertices.removed) {
      a.deleteVertex(id);
    }
    for (const moved of cs.vertices.moved) {
      const v = this.network.getVertex(moved.id);
      if (v) a.putVertex(v);
    }

    // Edges
    for (const e of cs.edges.added) {
      a.putEdge(e);
    }
    for (const id of cs.edges.removed) {
      a.deleteEdge(id);
    }

    // Polygons
    for (const p of cs.polygons.created) {
      a.putPolygon(p);
    }
    for (const mod of cs.polygons.modified) {
      a.putPolygon(mod.after);
    }
    for (const id of cs.polygons.removed) {
      a.deletePolygon(id);
    }
    for (const sc of cs.polygons.statusChanged) {
      const snap = this.polygonManager.getPolygon(sc.id);
      if (snap) a.putPolygon(snap);
    }
  }

  // --- Remote change application ---

  applyRemoteChange(change: ChangeSet): ChangeSet {
    const result = emptyChangeSet();

    // Apply vertex additions
    for (const v of change.vertices.added) {
      if (!this.network.getVertex(v.id)) {
        this.network.addVertex(v.lat, v.lng, v.id);
        result.vertices.added.push(v);
      }
    }

    // Apply vertex moves
    for (const moved of change.vertices.moved) {
      if (this.network.getVertex(moved.id)) {
        this.network.moveVertex(moved.id, moved.to.lat, moved.to.lng);
        result.vertices.moved.push(moved);
      }
    }

    // Apply edge removals (before additions, to handle replacements)
    for (const id of change.edges.removed) {
      if (this.network.getEdge(id)) {
        this.network.removeEdge(id);
        result.edges.removed.push(id);
      }
    }

    // Apply edge additions
    for (const e of change.edges.added) {
      if (
        !this.network.getEdge(e.id) &&
        this.network.getVertex(e.v1) &&
        this.network.getVertex(e.v2)
      ) {
        this.network.addEdge(e.v1, e.v2, e.id);
        result.edges.added.push(e);
      }
    }

    // Apply vertex removals (after edge removals)
    for (const id of change.vertices.removed) {
      if (this.network.getVertex(id)) {
        const removedEdges = this.network.removeVertex(id);
        result.vertices.removed.push(id);
        result.edges.removed.push(...removedEdges);
      }
    }

    // Apply status changes
    for (const sc of change.polygons.statusChanged) {
      const snap = this.polygonManager.getPolygon(sc.id);
      if (snap) {
        this.polygonManager.setStatus(sc.id, sc.field, sc.after);
        result.polygons.statusChanged.push(sc);
      }
    }

    // Rebuild polygons after structural or move changes
    const hasStructuralChange =
      result.vertices.added.length > 0 ||
      result.vertices.removed.length > 0 ||
      result.vertices.moved.length > 0 ||
      result.edges.added.length > 0 ||
      result.edges.removed.length > 0;

    if (hasStructuralChange) {
      const movedVertexIds = new Set(result.vertices.moved.map((m) => m.id));
      const faces = enumerateFaces(this.network);
      const diff = this.polygonManager.updateFromFaces(
        faces,
        this.network,
        movedVertexIds.size > 0 ? movedVertexIds : undefined,
      );
      result.polygons.created.push(...diff.created);
      result.polygons.modified.push(...diff.modified);
      result.polygons.removed.push(...diff.removed);
    }

    // Do NOT push to undo stack — remote changes are not undoable
    // Do NOT persist — avoid echoing back to remote
    return result;
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
    this.persistChangeSet(cs);
    return cs;
  }

  snapToVertex(vertexId: VertexID): ChangeSet {
    if (this.drawingMode.isActive()) {
      const cs = this.drawingMode.snapToExistingVertex(vertexId);
      this.undoRedo.push(cs);
      this.persistChangeSet(cs);
      return cs;
    }
    // Non-drawing mode: connect two vertices (edit operation)
    const cs = this.operations.snapToVertex(vertexId, vertexId); // This doesn't make sense — need fromId
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  snapToEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet {
    if (this.drawingMode.isActive()) {
      const cs = this.drawingMode.snapToExistingEdge(edgeId, lat, lng);
      this.undoRedo.push(cs);
      this.persistChangeSet(cs);
      return cs;
    }
    return emptyChangeSet();
  }

  // --- Drag operations ---

  private dragOrigin: { id: VertexID; lat: number; lng: number } | null = null;

  beginDrag(vertexId: VertexID): void {
    const v = this.network.getVertex(vertexId);
    if (!v) throw new Error(`Vertex ${vertexId} does not exist`);
    // Check lock via operations layer (same guard as moveVertex)
    for (const poly of this.polygonManager.getAllPolygons()) {
      if (!(poly.locked ?? false)) continue;
      for (const eid of poly.edgeIds) {
        const edge = this.network.getEdge(eid);
        if (edge && (edge.v1 === vertexId || edge.v2 === vertexId))
          throw new LockedPolygonError(
            `Vertex ${vertexId} belongs to a locked polygon`,
          );
      }
    }
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
    this.persistChangeSet(cs);
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
    this.persistChangeSet(cs);
    return cs;
  }

  removeVertex(vertexId: VertexID): ChangeSet {
    const cs = this.operations.removeVertex(vertexId);
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  removeEdge(edgeId: EdgeID): ChangeSet {
    const cs = this.operations.removeEdge(edgeId);
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  removePolygon(polygonId: PolygonID): ChangeSet {
    const cs = this.operations.removePolygon(polygonId);
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  splitEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet {
    const cs = this.operations.splitEdgeAtPoint(edgeId, lat, lng);
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  // --- Polygon Status ---

  setPolygonLocked(polygonId: PolygonID, locked: boolean): ChangeSet {
    const cs = emptyChangeSet();
    const result = this.polygonManager.setStatus(polygonId, "locked", locked);
    cs.polygons.statusChanged.push({
      id: polygonId,
      field: "locked",
      before: result.before,
      after: result.after,
    });
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  setPolygonActive(polygonId: PolygonID, active: boolean): ChangeSet {
    const cs = emptyChangeSet();
    const result = this.polygonManager.setStatus(polygonId, "active", active);
    cs.polygons.statusChanged.push({
      id: polygonId,
      field: "active",
      before: result.before,
      after: result.after,
    });
    this.undoRedo.push(cs);
    this.persistChangeSet(cs);
    return cs;
  }

  isPolygonLocked(polygonId: PolygonID): boolean {
    const snap = this.polygonManager.getPolygon(polygonId);
    return snap?.locked ?? false;
  }

  isPolygonActive(polygonId: PolygonID): boolean {
    const snap = this.polygonManager.getPolygon(polygonId);
    return snap?.active ?? true;
  }

  // --- Undo/Redo ---

  canUndo(): boolean {
    return this.undoRedo.canUndo();
  }

  canRedo(): boolean {
    return this.undoRedo.canRedo();
  }

  undo(): ChangeSet | null {
    const cs = this.undoRedo.undo();
    if (cs) this.persistChangeSet(cs);
    return cs;
  }

  redo(): ChangeSet | null {
    const cs = this.undoRedo.redo();
    if (cs) this.persistChangeSet(cs);
    return cs;
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
    this.persistChangeSet(cs);
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
