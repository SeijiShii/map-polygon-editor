import type { Group, GroupID } from "../types/index.js";

const ROOT_KEY = "__root__";

export class GroupStore {
  private byId = new Map<GroupID, Group>();
  private byParent = new Map<string, Set<GroupID>>();

  private parentKey(parentId: GroupID | null): string {
    return parentId ?? ROOT_KEY;
  }

  add(group: Group): void {
    this.byId.set(group.id, group);
    const key = this.parentKey(group.parent_id);
    if (!this.byParent.has(key)) {
      this.byParent.set(key, new Set());
    }
    this.byParent.get(key)!.add(group.id);
  }

  get(id: GroupID): Group | null {
    return this.byId.get(id) ?? null;
  }

  getAll(): Group[] {
    return [...this.byId.values()];
  }

  getChildGroups(parentId: GroupID): Group[] {
    const ids = this.byParent.get(this.parentKey(parentId));
    if (!ids) return [];
    return [...ids].map((id) => this.byId.get(id)!);
  }

  getRoots(): Group[] {
    const ids = this.byParent.get(ROOT_KEY);
    if (!ids) return [];
    return [...ids].map((id) => this.byId.get(id)!);
  }

  update(group: Group): void {
    const existing = this.byId.get(group.id);
    if (existing) {
      const oldKey = this.parentKey(existing.parent_id);
      this.byParent.get(oldKey)?.delete(group.id);
    }
    this.byId.set(group.id, group);
    const newKey = this.parentKey(group.parent_id);
    if (!this.byParent.has(newKey)) {
      this.byParent.set(newKey, new Set());
    }
    this.byParent.get(newKey)!.add(group.id);
  }

  delete(id: GroupID): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    const key = this.parentKey(existing.parent_id);
    this.byParent.get(key)?.delete(id);
    this.byId.delete(id);
  }

  count(): number {
    return this.byId.size;
  }
}
