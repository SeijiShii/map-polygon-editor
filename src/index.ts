// Core types
export type {
  PolygonID,
  GroupID,
  DraftID,
  GeoJSONPolygon,
  MapPolygon,
  Group,
  Point,
  DraftShape,
  PersistedDraft,
  StorageAdapter,
  ChangeSet,
  HistoryEntry,
  GeometryViolation,
  GeometryViolationCode,
} from "./types/index.js";
export { makePolygonID, makeGroupID, makeDraftID } from "./types/index.js";

// Error classes
export {
  NotInitializedError,
  DataIntegrityError,
  StorageError,
  PolygonNotFoundError,
  GroupNotFoundError,
  GroupWouldBeEmptyError,
  CircularReferenceError,
  SelfReferenceError,
  MixedParentError,
  NotRootPolygonError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
} from "./errors.js";

// Stores
export { PolygonStore } from "./polygon-store/polygon-store.js";
export { GroupStore } from "./group-store/group-store.js";
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

// Editor facade
export { MapPolygonEditor } from "./editor.js";
