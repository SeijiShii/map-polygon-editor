/**
 * All domain error classes for map-polygon-editor.
 *
 * Each class:
 * - Extends Error
 * - Sets `this.name` to the class name for reliable instanceof checks
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

/** Thrown when `areaLevels` config has circular refs, duplicate keys, etc. */
export class InvalidAreaLevelConfigError extends Error {
  override name = "InvalidAreaLevelConfigError" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidAreaLevelConfigError";
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

/** Thrown when a referenced AreaID does not exist. */
export class AreaNotFoundError extends Error {
  override name = "AreaNotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "AreaNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a referenced level_key does not exist in areaLevels. */
export class AreaLevelNotFoundError extends Error {
  override name = "AreaLevelNotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "AreaLevelNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when Area level and parent level relationship is inconsistent. */
export class LevelMismatchError extends Error {
  override name = "LevelMismatchError" as const;
  constructor(message: string) {
    super(message);
    this.name = "LevelMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when trying to delete or directly edit an area that has explicit children. */
export class AreaHasChildrenError extends Error {
  override name = "AreaHasChildrenError" as const;
  constructor(message: string) {
    super(message);
    this.name = "AreaHasChildrenError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when reparenting would leave the old parent with zero explicit children. */
export class ParentWouldBeEmptyError extends Error {
  override name = "ParentWouldBeEmptyError" as const;
  constructor(message: string) {
    super(message);
    this.name = "ParentWouldBeEmptyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when reparenting would create a circular ancestor chain. */
export class CircularReferenceError extends Error {
  override name = "CircularReferenceError" as const;
  constructor(message: string) {
    super(message);
    this.name = "CircularReferenceError";
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

/** Thrown when a DraftShape has an invalid geometry (self-intersection, too few vertices, zero area). */
export class InvalidGeometryError extends Error {
  override name = "InvalidGeometryError" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidGeometryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an operation requires a child level but none is defined. */
export class NoChildLevelError extends Error {
  override name = "NoChildLevelError" as const;
  constructor(message: string) {
    super(message);
    this.name = "NoChildLevelError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when `loadDraftFromStorage` is called with an ID that does not exist in DraftStore. */
export class DraftNotFoundError extends Error {
  override name = "DraftNotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "DraftNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
