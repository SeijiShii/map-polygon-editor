import type { MapPolygon, PolygonID } from "../types/index.js";

export class PolygonStore {
  private byId = new Map<PolygonID, MapPolygon>();

  add(polygon: MapPolygon): void {
    this.byId.set(polygon.id, polygon);
  }

  get(id: PolygonID): MapPolygon | null {
    return this.byId.get(id) ?? null;
  }

  getAll(): MapPolygon[] {
    return [...this.byId.values()];
  }

  update(polygon: MapPolygon): void {
    this.byId.set(polygon.id, polygon);
  }

  delete(id: PolygonID): void {
    this.byId.delete(id);
  }

  count(): number {
    return this.byId.size;
  }
}
