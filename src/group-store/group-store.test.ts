import { describe, it, expect, beforeEach } from "vitest";
import { GroupStore } from "./group-store.js";
import type { Group } from "../types/index.js";
import { makeGroupID } from "../types/index.js";

function makeGroup(id: string, parentId: string | null = null, name = ""): Group {
  const now = new Date();
  return {
    id: makeGroupID(id),
    display_name: name,
    parent_id: parentId ? makeGroupID(parentId) : null,
    created_at: now,
    updated_at: now,
  };
}

describe("GroupStore", () => {
  let store: GroupStore;

  beforeEach(() => {
    store = new GroupStore();
  });

  describe("add and get", () => {
    it("adds and retrieves a group by ID", () => {
      const g = makeGroup("g-1", null, "Tokyo");
      store.add(g);
      expect(store.get(makeGroupID("g-1"))).toEqual(g);
    });

    it("returns null for non-existent ID", () => {
      expect(store.get(makeGroupID("nope"))).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all groups", () => {
      store.add(makeGroup("g-1"));
      store.add(makeGroup("g-2"));
      expect(store.getAll()).toHaveLength(2);
    });

    it("returns empty array when empty", () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe("getChildGroups", () => {
    it("returns child groups of a given parent", () => {
      store.add(makeGroup("g-1", null));
      store.add(makeGroup("g-2", "g-1"));
      store.add(makeGroup("g-3", "g-1"));
      store.add(makeGroup("g-4", "g-2"));
      const children = store.getChildGroups(makeGroupID("g-1"));
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(makeGroupID("g-2"));
      expect(children.map((c) => c.id)).toContain(makeGroupID("g-3"));
    });

    it("returns empty for group with no child groups", () => {
      store.add(makeGroup("g-1"));
      expect(store.getChildGroups(makeGroupID("g-1"))).toEqual([]);
    });
  });

  describe("getRoots", () => {
    it("returns groups with null parent_id", () => {
      store.add(makeGroup("g-1", null));
      store.add(makeGroup("g-2", "g-1"));
      store.add(makeGroup("g-3", null));
      const roots = store.getRoots();
      expect(roots).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates an existing group", () => {
      store.add(makeGroup("g-1", null, "old"));
      store.update({ ...makeGroup("g-1", null, "new") });
      expect(store.get(makeGroupID("g-1"))?.display_name).toBe("new");
    });

    it("updates parent index when parent_id changes", () => {
      store.add(makeGroup("g-parent"));
      store.add(makeGroup("g-1", "g-parent"));
      store.update({ ...makeGroup("g-1", null) });
      expect(store.getChildGroups(makeGroupID("g-parent"))).toHaveLength(0);
      expect(store.getRoots().map((g) => g.id)).toContain(makeGroupID("g-1"));
    });
  });

  describe("delete", () => {
    it("removes a group", () => {
      store.add(makeGroup("g-1"));
      store.delete(makeGroupID("g-1"));
      expect(store.get(makeGroupID("g-1"))).toBeNull();
    });

    it("removes from parent index", () => {
      store.add(makeGroup("g-1", "g-parent"));
      store.delete(makeGroupID("g-1"));
      expect(store.getChildGroups(makeGroupID("g-parent"))).toHaveLength(0);
    });

    it("is no-op for non-existent group", () => {
      expect(() => store.delete(makeGroupID("nope"))).not.toThrow();
    });
  });

  describe("count", () => {
    it("returns the number of groups", () => {
      expect(store.count()).toBe(0);
      store.add(makeGroup("g-1"));
      expect(store.count()).toBe(1);
      store.delete(makeGroupID("g-1"));
      expect(store.count()).toBe(0);
    });
  });
});
