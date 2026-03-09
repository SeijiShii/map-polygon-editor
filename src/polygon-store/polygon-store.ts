import type { MapPolygon, PolygonID, GroupID } from "../types/index.js";

const ROOT_KEY = "__root__";

export class PolygonStore {
  private byId = new Map<PolygonID, MapPolygon>();
  private byParent = new Map<string, Set<PolygonID>>();

  private parentKey(parentId: GroupID | null): string {
    return parentId ?? ROOT_KEY;
  }

  add(polygon: MapPolygon): void {
    this.byId.set(polygon.id, polygon);
    const key = this.parentKey(polygon.parent_id);
    if (!this.byParent.has(key)) {
      this.byParent.set(key, new Set());
    }
    this.byParent.get(key)!.add(polygon.id);
  }

  get(id: PolygonID): MapPolygon | null {
    return this.byId.get(id) ?? null;
  }

  getAll(): MapPolygon[] {
    return [...this.byId.values()];
  }

  getByParent(groupId: GroupID): MapPolygon[] {
    const ids = this.byParent.get(this.parentKey(groupId));
    if (!ids) return [];
    return [...ids].map((id) => this.byId.get(id)!);
  }

  getRoots(): MapPolygon[] {
    const ids = this.byParent.get(ROOT_KEY);
    if (!ids) return [];
    return [...ids].map((id) => this.byId.get(id)!);
  }

  update(polygon: MapPolygon): void {
    const existing = this.byId.get(polygon.id);
    if (existing) {
      // Remove from old parent index
      const oldKey = this.parentKey(existing.parent_id);
      this.byParent.get(oldKey)?.delete(polygon.id);
    }
    this.byId.set(polygon.id, polygon);
    const newKey = this.parentKey(polygon.parent_id);
    if (!this.byParent.has(newKey)) {
      this.byParent.set(newKey, new Set());
    }
    this.byParent.get(newKey)!.add(polygon.id);
  }

  delete(id: PolygonID): void {
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
