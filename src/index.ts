// Core types
export type {
  PolygonID,
  UnionCacheID,
  DraftID,
  GeoJSONPolygon,
  MapPolygon,
  Point,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
  ChangeSet,
  HistoryEntry,
  GeometryViolation,
  GeometryViolationCode,
} from "./types/index.js";
export { makePolygonID, makeUnionCacheID, makeDraftID } from "./types/index.js";

// Error classes
export {
  NotInitializedError,
  DataIntegrityError,
  StorageError,
  PolygonNotFoundError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
  NoSharedEdgeError,
} from "./errors.js";

// Stores
export { PolygonStore } from "./polygon-store/polygon-store.js";
export { DraftStore } from "./draft/draft-store.js";

// Draft operations (pure functions)
export {
  createDraft,
  addPoint,
  insertPoint,
  movePoint,
  removePoint,
  closeDraft,
  openDraft,
  draftToGeoJSON,
} from "./draft/draft-operations.js";

// Draft validation
export { validateDraft } from "./draft/validate-draft.js";

// Geometry utilities
export { computeUnion } from "./geometry/compute-union.js";
export { computeBridgePolygon } from "./geometry/bridge-polygon.js";

// Editor facade
export { MapPolygonEditor } from "./editor.js";
export type { BridgeResult } from "./editor.js";
