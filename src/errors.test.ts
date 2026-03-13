import { describe, it, expect } from "vitest";
import {
  NotInitializedError,
  DataIntegrityError,
  StorageError,
  PolygonNotFoundError,
  DraftNotClosedError,
  InvalidGeometryError,
  DraftNotFoundError,
} from "./errors.js";

describe("v2 error classes", () => {
  const errorCases: Array<[string, new (msg: string) => Error]> = [
    ["NotInitializedError", NotInitializedError],
    ["DataIntegrityError", DataIntegrityError],
    ["StorageError", StorageError],
    ["PolygonNotFoundError", PolygonNotFoundError],
    ["DraftNotClosedError", DraftNotClosedError],
    ["InvalidGeometryError", InvalidGeometryError],
    ["DraftNotFoundError", DraftNotFoundError],
  ];

  it("has exactly 7 error classes", () => {
    expect(errorCases).toHaveLength(7);
  });

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
  });

  describe("different error types are distinct classes", () => {
    it("DraftNotFoundError is not instanceof PolygonNotFoundError", () => {
      const err = new DraftNotFoundError("draft not found");
      expect(err).not.toBeInstanceOf(PolygonNotFoundError);
    });
  });
});
