import type { GeoJSONPolygon } from "../types/index.js";
import { union } from "@turf/union";
import { polygon as turfPolygon, featureCollection } from "@turf/helpers";

export function computeUnion(geometries: GeoJSONPolygon[]): GeoJSONPolygon[] {
  if (geometries.length === 0) return [];
  if (geometries.length === 1) return [geometries[0]];

  const features = geometries.map((g) => turfPolygon(g.coordinates));
  const merged = union(featureCollection(features));
  if (!merged) return [];

  if (merged.geometry.type === "MultiPolygon") {
    return merged.geometry.coordinates.map(
      (coords): GeoJSONPolygon => ({
        type: "Polygon",
        coordinates: coords,
      }),
    );
  }

  return [
    {
      type: "Polygon",
      coordinates: merged.geometry.coordinates as number[][][],
    },
  ];
}
