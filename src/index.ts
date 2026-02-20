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
  AreaInput,
  ChangeSet,
  HistoryEntry,
  GeometryViolation,
  GeometryViolationCode,
} from "./types/index.js";
export { makeAreaID } from "./types/index.js";

// AreaLevel validation and store
export {
  validateAreaLevels,
  InvalidAreaLevelConfigError,
} from "./area-level/area-level-validator.js";
export { AreaLevelStore } from "./area-level/area-level-store.js";

// Area store
export { AreaStore } from "./area-store/area-store.js";
