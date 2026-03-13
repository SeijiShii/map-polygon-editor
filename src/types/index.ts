// PolygonID — opaque string alias
export type PolygonID = string & { readonly __brand: "PolygonID" };

// UnionCacheID — opaque string alias for cached union results
export type UnionCacheID = string & { readonly __brand: "UnionCacheID" };

// DraftID — opaque string alias for persisted draft IDs
export type DraftID = string & { readonly __brand: "DraftID" };

export function makePolygonID(raw: string): PolygonID {
  return raw as PolygonID;
}

export function makeUnionCacheID(raw: string): UnionCacheID {
  return raw as UnionCacheID;
}

export function makeDraftID(raw: string): DraftID {
  return raw as DraftID;
}

// GeoJSON geometry type (Polygon only — no MultiPolygon in v2)
export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

// MapPolygon — a leaf node with geometry
export interface MapPolygon {
  id: PolygonID;
  geometry: GeoJSONPolygon;
  display_name: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Point — a lat/lng coordinate
export interface Point {
  lat: number;
  lng: number;
}

// DraftShape — in-progress polygon being drawn
export interface DraftShape {
  points: Point[];
  isClosed: boolean;
}

// ChangeSet — passed to StorageAdapter.batchWrite
export interface ChangeSet {
  createdPolygons: MapPolygon[];
  deletedPolygonIds: PolygonID[];
  modifiedPolygons: MapPolygon[];
}

// HistoryEntry — used for undo/redo
export interface HistoryEntry {
  createdPolygons: MapPolygon[];
  deletedPolygons: MapPolygon[];
  modifiedPolygons: Array<{ before: MapPolygon; after: MapPolygon }>;
}

// GeometryViolation — returned by validateDraft
export type GeometryViolationCode =
  | "TOO_FEW_VERTICES"
  | "SELF_INTERSECTION"
  | "ZERO_AREA";

export interface GeometryViolation {
  code: GeometryViolationCode;
}

// PersistedDraft — a DraftShape saved to storage
export interface PersistedDraft {
  id: DraftID;
  points: Point[];
  isClosed: boolean;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
}

// StorageAdapter — external persistence interface
export interface StorageAdapter {
  loadAll(): Promise<{
    polygons: MapPolygon[];
    drafts: PersistedDraft[];
  }>;
  batchWrite(changes: ChangeSet): Promise<void>;
  saveDraft(draft: PersistedDraft): Promise<void>;
  deleteDraft(id: DraftID): Promise<void>;
}
