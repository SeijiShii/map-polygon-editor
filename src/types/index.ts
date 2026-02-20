// AreaID — opaque string alias
export type AreaID = string & { readonly __brand: "AreaID" };

export function makeAreaID(raw: string): AreaID {
  return raw as AreaID;
}

// GeoJSON geometry types (minimal, no external dependency)
export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJSONMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export type AreaGeometry = GeoJSONPolygon | GeoJSONMultiPolygon;

// AreaLevel — static config supplied at initialization
export interface AreaLevel {
  key: string;
  name: string;
  parent_level_key: string | null;
  description?: string;
}

// Area — the core entity
export interface Area {
  id: AreaID;
  display_name: string;
  level_key: string;
  parent_id: AreaID | null;
  geometry: AreaGeometry;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  is_implicit: boolean;
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

// AreaInput — used for bulkCreate
export interface AreaInput {
  display_name: string;
  level_key: string;
  parent_id: AreaID | null;
  geometry: AreaGeometry;
  metadata?: Record<string, unknown>;
}

// ChangeSet — passed to StorageAdapter.batchWrite
export interface ChangeSet {
  created: Area[];
  deleted: AreaID[];
  modified: Area[];
}

// HistoryEntry — used for undo/redo
export interface HistoryEntry {
  created: Area[];
  deleted: Area[];
  modified: Array<{ before: Area; after: Area }>;
}

// GeometryViolation — returned by validateDraft
export type GeometryViolationCode =
  | "TOO_FEW_VERTICES"
  | "SELF_INTERSECTION"
  | "ZERO_AREA";

export interface GeometryViolation {
  code: GeometryViolationCode;
}
