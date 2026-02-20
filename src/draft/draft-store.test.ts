import { describe, it, expect, beforeEach } from "vitest";
import { DraftStore } from "./draft-store.js";
import type { DraftID, PersistedDraft, Point } from "../types/index.js";
import { makeDraftID } from "../types/index.js";

// ---- helpers ----

function pt(lat: number, lng: number): Point {
  return { lat, lng };
}

function id(raw: string): DraftID {
  return makeDraftID(raw);
}

function makePersistedDraft(
  raw: string,
  overrides: Partial<PersistedDraft> = {}
): PersistedDraft {
  return {
    id: id(raw),
    points: [pt(0, 0), pt(1, 0), pt(1, 1)],
    isClosed: false,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    ...overrides,
  };
}

// ============================================================
// constructor
// ============================================================

describe("DraftStore — constructor", () => {
  it("initializes with the provided drafts", () => {
    const draft = makePersistedDraft("d1");
    const store = new DraftStore([draft]);
    expect(store.getAll()).toHaveLength(1);
  });

  it("initializes with an empty array", () => {
    const store = new DraftStore([]);
    expect(store.getAll()).toEqual([]);
  });

  it("does not share array reference with the input", () => {
    const initial: PersistedDraft[] = [makePersistedDraft("d1")];
    const store = new DraftStore(initial);
    initial.push(makePersistedDraft("d2"));
    // Store should still have only 1 entry
    expect(store.getAll()).toHaveLength(1);
  });

  it("initializes with multiple drafts", () => {
    const drafts = [
      makePersistedDraft("d1"),
      makePersistedDraft("d2"),
      makePersistedDraft("d3"),
    ];
    const store = new DraftStore(drafts);
    expect(store.getAll()).toHaveLength(3);
  });
});

// ============================================================
// getAll
// ============================================================

describe("DraftStore — getAll()", () => {
  it("returns all stored drafts", () => {
    const d1 = makePersistedDraft("d1");
    const d2 = makePersistedDraft("d2");
    const store = new DraftStore([d1, d2]);
    const all = store.getAll();
    const allIds = all.map((d) => d.id);
    expect(allIds).toContain(id("d1"));
    expect(allIds).toContain(id("d2"));
  });

  it("returns a defensive copy (mutating result does not affect store)", () => {
    const store = new DraftStore([makePersistedDraft("d1")]);
    const result = store.getAll();
    result.push(makePersistedDraft("d2"));
    expect(store.getAll()).toHaveLength(1);
  });

  it("returns empty array when store is empty", () => {
    const store = new DraftStore([]);
    expect(store.getAll()).toEqual([]);
  });
});

// ============================================================
// get
// ============================================================

describe("DraftStore — get(id)", () => {
  let store: DraftStore;
  let draft: PersistedDraft;

  beforeEach(() => {
    draft = makePersistedDraft("d1", {
      points: [pt(10, 20), pt(30, 40)],
      isClosed: true,
    });
    store = new DraftStore([draft]);
  });

  it("returns the draft matching the given ID", () => {
    const result = store.get(id("d1"));
    expect(result).not.toBeNull();
    expect(result!.id).toEqual(id("d1"));
  });

  it("returns the draft with the correct data", () => {
    const result = store.get(id("d1"));
    expect(result!.points).toEqual([pt(10, 20), pt(30, 40)]);
    expect(result!.isClosed).toBe(true);
  });

  it("returns null for an unknown ID", () => {
    expect(store.get(id("not-exist"))).toBeNull();
  });

  it("returns null when store is empty", () => {
    const empty = new DraftStore([]);
    expect(empty.get(id("d1"))).toBeNull();
  });
});

// ============================================================
// save (upsert)
// ============================================================

describe("DraftStore — save(draft)", () => {
  it("inserts a new draft (not previously in store)", () => {
    const store = new DraftStore([]);
    const draft = makePersistedDraft("d1");
    store.save(draft);
    expect(store.get(id("d1"))).not.toBeNull();
  });

  it("all fields are persisted correctly", () => {
    const store = new DraftStore([]);
    const draft = makePersistedDraft("d1", {
      points: [pt(1, 2), pt(3, 4)],
      isClosed: true,
      metadata: { label: "test" },
    });
    store.save(draft);
    const result = store.get(id("d1"))!;
    expect(result.points).toEqual([pt(1, 2), pt(3, 4)]);
    expect(result.isClosed).toBe(true);
    expect(result.metadata).toEqual({ label: "test" });
  });

  it("updates an existing draft (upsert)", () => {
    const original = makePersistedDraft("d1", {
      points: [pt(0, 0), pt(1, 1), pt(2, 0)],
      isClosed: false,
    });
    const store = new DraftStore([original]);

    const updated = makePersistedDraft("d1", {
      points: [pt(5, 5), pt(6, 6), pt(7, 5)],
      isClosed: true,
      updated_at: new Date("2025-01-01"),
    });
    store.save(updated);

    const result = store.get(id("d1"))!;
    expect(result.points).toEqual([pt(5, 5), pt(6, 6), pt(7, 5)]);
    expect(result.isClosed).toBe(true);
    expect(result.updated_at).toEqual(new Date("2025-01-01"));
  });

  it("upsert does not increase count when updating an existing draft", () => {
    const store = new DraftStore([makePersistedDraft("d1")]);
    store.save(makePersistedDraft("d1", { isClosed: true }));
    expect(store.getAll()).toHaveLength(1);
  });

  it("inserts multiple new drafts", () => {
    const store = new DraftStore([]);
    store.save(makePersistedDraft("d1"));
    store.save(makePersistedDraft("d2"));
    store.save(makePersistedDraft("d3"));
    expect(store.getAll()).toHaveLength(3);
  });

  it("saving does not affect other drafts in the store", () => {
    const d1 = makePersistedDraft("d1");
    const d2 = makePersistedDraft("d2");
    const store = new DraftStore([d1, d2]);

    store.save(makePersistedDraft("d2", { isClosed: true }));

    // d1 should be untouched
    const result1 = store.get(id("d1"))!;
    expect(result1.isClosed).toBe(false);
  });

  it("saving a draft does not mutate the original object", () => {
    const store = new DraftStore([]);
    const draft = makePersistedDraft("d1");
    const originalIsClosed = draft.isClosed;
    store.save(draft);
    expect(draft.isClosed).toBe(originalIsClosed);
  });
});

// ============================================================
// delete
// ============================================================

describe("DraftStore — delete(id)", () => {
  it("removes the draft with the given ID", () => {
    const store = new DraftStore([makePersistedDraft("d1")]);
    store.delete(id("d1"));
    expect(store.get(id("d1"))).toBeNull();
  });

  it("removes from getAll()", () => {
    const store = new DraftStore([
      makePersistedDraft("d1"),
      makePersistedDraft("d2"),
    ]);
    store.delete(id("d1"));
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toEqual(id("d2"));
  });

  it("is a no-op when the ID does not exist", () => {
    const store = new DraftStore([makePersistedDraft("d1")]);
    // Should not throw
    expect(() => store.delete(id("does-not-exist"))).not.toThrow();
    expect(store.getAll()).toHaveLength(1);
  });

  it("is a no-op on an empty store", () => {
    const store = new DraftStore([]);
    expect(() => store.delete(id("d1"))).not.toThrow();
    expect(store.getAll()).toHaveLength(0);
  });

  it("does not affect other drafts when deleting one", () => {
    const store = new DraftStore([
      makePersistedDraft("d1"),
      makePersistedDraft("d2"),
      makePersistedDraft("d3"),
    ]);
    store.delete(id("d2"));
    expect(store.get(id("d1"))).not.toBeNull();
    expect(store.get(id("d3"))).not.toBeNull();
  });

  it("allows re-saving a deleted draft", () => {
    const store = new DraftStore([makePersistedDraft("d1")]);
    store.delete(id("d1"));
    expect(store.get(id("d1"))).toBeNull();
    store.save(makePersistedDraft("d1"));
    expect(store.get(id("d1"))).not.toBeNull();
  });

  it("can delete all drafts one by one", () => {
    const store = new DraftStore([
      makePersistedDraft("d1"),
      makePersistedDraft("d2"),
    ]);
    store.delete(id("d1"));
    store.delete(id("d2"));
    expect(store.getAll()).toEqual([]);
  });
});

// ============================================================
// Edge cases / invariants
// ============================================================

describe("DraftStore — edge cases", () => {
  it("preserves draft ordering (insertion order) in getAll()", () => {
    const store = new DraftStore([]);
    store.save(makePersistedDraft("d3"));
    store.save(makePersistedDraft("d1"));
    store.save(makePersistedDraft("d2"));
    const ids = store.getAll().map((d) => d.id);
    expect(ids).toEqual([id("d3"), id("d1"), id("d2")]);
  });

  it("handles a draft with no points", () => {
    const store = new DraftStore([]);
    const empty = makePersistedDraft("d1", { points: [] });
    store.save(empty);
    expect(store.get(id("d1"))!.points).toEqual([]);
  });

  it("handles a draft with metadata", () => {
    const store = new DraftStore([]);
    const draft = makePersistedDraft("d1", {
      metadata: { note: "important", count: 42 },
    });
    store.save(draft);
    expect(store.get(id("d1"))!.metadata).toEqual({
      note: "important",
      count: 42,
    });
  });

  it("handles a draft without metadata (optional field)", () => {
    const store = new DraftStore([]);
    const draft = makePersistedDraft("d1");
    // No metadata property set
    delete (draft as Partial<PersistedDraft>).metadata;
    store.save(draft);
    expect(store.get(id("d1"))!.metadata).toBeUndefined();
  });
});
