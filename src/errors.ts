/**
 * All domain error classes for map-polygon-editor.
 *
 * Each class:
 * - Extends Error
 * - Restores the prototype chain for correct instanceof in transpiled output
 */

/** Thrown when any API is called before `initialize()` completes. */
export class NotInitializedError extends Error {
  override name = "NotInitializedError" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotInitializedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when `loadAll()` returns data with structural inconsistencies. */
export class DataIntegrityError extends Error {
  override name = "DataIntegrityError" as const;
  constructor(message: string) {
    super(message);
    this.name = "DataIntegrityError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when `batchWrite` / `loadAll` calls fail. */
export class StorageError extends Error {
  override name = "StorageError" as const;
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a referenced PolygonID does not exist. */
export class PolygonNotFoundError extends Error {
  override name = "PolygonNotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "PolygonNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a non-closed DraftShape is passed to an API requiring a polygon. */
export class DraftNotClosedError extends Error {
  override name = "DraftNotClosedError" as const;
  constructor(message: string) {
    super(message);
    this.name = "DraftNotClosedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when geometry is invalid (self-intersection, too few vertices, zero area). */
export class InvalidGeometryError extends Error {
  override name = "InvalidGeometryError" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidGeometryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when `loadDraftFromStorage` is called with an ID that does not exist. */
export class DraftNotFoundError extends Error {
  override name = "DraftNotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "DraftNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
