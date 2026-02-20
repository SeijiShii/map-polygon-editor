// Core types
export type {
  AreaID,
  AreaLevel,
  Area,
  AreaGeometry,
  GeoJSONPolygon,
  GeoJSONMultiPolygon,
  Point,
  DraftShape,
  DraftID,
  PersistedDraft,
  StorageAdapter,
  AreaInput,
  ChangeSet,
  HistoryEntry,
  GeometryViolation,
  GeometryViolationCode,
} from "./types/index.js";
export { makeAreaID, makeDraftID } from "./types/index.js";

// Error classes
export {
  NotInitializedError,
  InvalidAreaLevelConfigError,
  DataIntegrityError,
  StorageError,
  AreaNotFoundError,
  AreaLevelNotFoundError,
  LevelMismatchError,
  AreaHasChildrenError,
  ParentWouldBeEmptyError,
  CircularReferenceError,
  DraftNotClosedError,
  InvalidGeometryError,
  NoChildLevelError,
  DraftNotFoundError,
} from "./errors.js";

// AreaLevel validation and store
export { validateAreaLevels } from "./area-level/area-level-validator.js";
export { AreaLevelStore } from "./area-level/area-level-store.js";

// Area store
export { AreaStore } from "./area-store/area-store.js";

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

// Draft store
export { DraftStore } from "./draft/draft-store.js";

// Draft validation
export { validateDraft } from "./draft/validate-draft.js";

// Main editor facade
export { MapPolygonEditor } from "./editor.js";
