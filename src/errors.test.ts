import { describe, it, expect } from "vitest";
import {
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

describe("Error classes", () => {
  const errorCases: Array<[string, new (msg: string) => Error]> = [
    ["NotInitializedError", NotInitializedError],
    ["InvalidAreaLevelConfigError", InvalidAreaLevelConfigError],
    ["DataIntegrityError", DataIntegrityError],
    ["StorageError", StorageError],
    ["AreaNotFoundError", AreaNotFoundError],
    ["AreaLevelNotFoundError", AreaLevelNotFoundError],
    ["LevelMismatchError", LevelMismatchError],
    ["AreaHasChildrenError", AreaHasChildrenError],
    ["ParentWouldBeEmptyError", ParentWouldBeEmptyError],
    ["CircularReferenceError", CircularReferenceError],
    ["DraftNotClosedError", DraftNotClosedError],
    ["InvalidGeometryError", InvalidGeometryError],
    ["NoChildLevelError", NoChildLevelError],
    ["DraftNotFoundError", DraftNotFoundError],
  ];

  for (const [name, ErrorClass] of errorCases) {
    describe(name, () => {
      it("is instanceof Error", () => {
        const err = new ErrorClass("test message");
        expect(err).toBeInstanceOf(Error);
      });

      it("is instanceof its own class", () => {
        const err = new ErrorClass("test message");
        expect(err).toBeInstanceOf(ErrorClass);
      });

      it("has correct .name property", () => {
        const err = new ErrorClass("test message");
        expect(err.name).toBe(name);
      });

      it("carries the provided message", () => {
        const msg = `error in ${name}`;
        const err = new ErrorClass(msg);
        expect(err.message).toBe(msg);
      });

      it("has a stack trace", () => {
        const err = new ErrorClass("stack check");
        expect(err.stack).toBeDefined();
      });
    });
  }

  describe("instanceof checks across catch boundaries", () => {
    it("NotInitializedError can be caught as Error and checked", () => {
      try {
        throw new NotInitializedError("not ready");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(NotInitializedError);
        expect((e as Error).name).toBe("NotInitializedError");
      }
    });

    it("StorageError can be caught and checked", () => {
      try {
        throw new StorageError("adapter failed");
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError);
        expect((e as StorageError).message).toBe("adapter failed");
      }
    });

    it("DraftNotFoundError can be caught and checked", () => {
      try {
        throw new DraftNotFoundError("draft-123 not found");
      } catch (e) {
        expect(e).toBeInstanceOf(DraftNotFoundError);
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("different error types are distinct classes", () => {
    it("AreaNotFoundError is not instanceof AreaLevelNotFoundError", () => {
      const err = new AreaNotFoundError("area-1 not found");
      expect(err).not.toBeInstanceOf(AreaLevelNotFoundError);
    });

    it("DraftNotFoundError is not instanceof AreaNotFoundError", () => {
      const err = new DraftNotFoundError("draft not found");
      expect(err).not.toBeInstanceOf(AreaNotFoundError);
    });

    it("InvalidAreaLevelConfigError is not instanceof InvalidGeometryError", () => {
      const err = new InvalidAreaLevelConfigError("bad config");
      expect(err).not.toBeInstanceOf(InvalidGeometryError);
    });
  });
});
