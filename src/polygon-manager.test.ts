import { describe, it, expect, beforeEach } from "vitest";
import { Network } from "./network";
import { PolygonManager } from "./polygon-manager";
import { enumerateFaces } from "./half-edge";
import { createPolygonID } from "./types";
import type { PolygonSnapshot, PolygonID, Face } from "./types";

/**
 * Helper: build a network from coordinate pairs and edge definitions.
 */
function buildNetwork(
  coords: Array<[number, number]>,
  edgePairs: Array<[number, number]>,
) {
  const network = new Network();
  const vertices = coords.map(([lat, lng]) => network.addVertex(lat, lng));
  for (const [i, j] of edgePairs) {
    network.addEdge(vertices[i]!.id, vertices[j]!.id);
  }
  return { network, vertices };
}

describe("PolygonManager", () => {
  let manager: PolygonManager;

  beforeEach(() => {
    manager = new PolygonManager();
  });

  describe("updateFromFaces", () => {
    it("should create a new polygon from a single face", () => {
      const { network } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      );
      const faces = enumerateFaces(network);
      const diff = manager.updateFromFaces(faces, network);

      expect(diff.created).toHaveLength(1);
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(manager.getAllPolygons()).toHaveLength(1);
    });

    it("should preserve polygon UUID when face is unchanged", () => {
      const { network } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      const firstId = manager.getAllPolygons()[0]!.id;

      // Update again with same faces → should preserve ID
      const diff = manager.updateFromFaces(faces, network);
      expect(diff.created).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(manager.getAllPolygons()[0]!.id).toBe(firstId);
    });

    it("should detect polygon split (larger area inherits UUID)", () => {
      // Start with a square (1 polygon)
      const { network, vertices } = buildNetwork(
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ],
      );
      let faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      const originalId = manager.getAllPolygons()[0]!.id;

      // Add diagonal → splits into 2 triangles
      network.addEdge(vertices[0]!.id, vertices[2]!.id);
      faces = enumerateFaces(network);
      const diff = manager.updateFromFaces(faces, network);

      expect(manager.getAllPolygons()).toHaveLength(2);
      // One of the new polygons should have the original ID (the larger one)
      const ids = manager.getAllPolygons().map((p) => p.id);
      expect(ids).toContain(originalId);
      // The diff should show 1 modified + 1 created (not 2 created)
      expect(diff.created).toHaveLength(1);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0]!.id).toBe(originalId);
    });

    it("should detect polygon merge (larger area UUID survives)", () => {
      // Start with a square split by diagonal (2 polygons)
      const { network, vertices } = buildNetwork(
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [0, 2],
        ],
      );
      let faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      expect(manager.getAllPolygons()).toHaveLength(2);

      // Find the larger polygon's ID
      const polygons = manager.getAllPolygons();
      const larger = polygons.reduce((a, b) => {
        const aFace = faces.find(
          (f) =>
            f.edgeIds.length === a.edgeIds.length &&
            f.edgeIds.every((id) => a.edgeIds.includes(id)),
        );
        const bFace = faces.find(
          (f) =>
            f.edgeIds.length === b.edgeIds.length &&
            f.edgeIds.every((id) => b.edgeIds.includes(id)),
        );
        return (aFace?.signedArea ?? 0) >= (bFace?.signedArea ?? 0) ? a : b;
      });
      const largerId = larger.id;

      // Remove diagonal → merge back into 1 polygon
      const diagonalEdgeId = network.getVertexPairEdge(
        vertices[0]!.id,
        vertices[2]!.id,
      )!;
      network.removeEdge(diagonalEdgeId);
      faces = enumerateFaces(network);
      const diff = manager.updateFromFaces(faces, network);

      expect(manager.getAllPolygons()).toHaveLength(1);
      // The surviving polygon should have the larger polygon's ID
      expect(manager.getAllPolygons()[0]!.id).toBe(largerId);
      expect(diff.removed).toHaveLength(1);
    });

    it("should remove polygon when face disappears", () => {
      const { network, vertices } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      );
      let faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      expect(manager.getAllPolygons()).toHaveLength(1);
      const removedId = manager.getAllPolygons()[0]!.id;

      // Remove an edge → polygon disappears
      const edgeId = network.getVertexPairEdge(
        vertices[0]!.id,
        vertices[1]!.id,
      )!;
      network.removeEdge(edgeId);
      faces = enumerateFaces(network);
      const diff = manager.updateFromFaces(faces, network);

      expect(manager.getAllPolygons()).toHaveLength(0);
      expect(diff.removed).toContain(removedId);
    });
  });

  describe("hole detection", () => {
    it("should detect inner polygon as hole of outer polygon", () => {
      // Outer square: (0,0)-(4,0)-(4,4)-(0,4)
      // Inner square: (1,1)-(3,1)-(3,3)-(1,3)
      const { network } = buildNetwork(
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
        [
          // Outer
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          // Inner
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);

      const polygons = manager.getAllPolygons();
      // Should have 1 polygon with 1 hole (not 2 separate polygons)
      expect(polygons).toHaveLength(1);
      expect(polygons[0]!.holes).toHaveLength(1);
    });
  });

  describe("GeoJSON export", () => {
    it("should export a simple polygon as GeoJSON", () => {
      const { network } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      const polygon = manager.getAllPolygons()[0]!;

      const geojson = manager.toGeoJSON(polygon.id, network);
      expect(geojson).not.toBeNull();
      expect(geojson!.type).toBe("Polygon");
      expect(geojson!.coordinates).toHaveLength(1); // 1 ring, no holes
      expect(geojson!.coordinates[0]!.length).toBe(4); // 3 vertices + closing
    });

    it("should export polygon with hole as GeoJSON with 2 rings", () => {
      const { network } = buildNetwork(
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      const polygon = manager.getAllPolygons()[0]!;

      const geojson = manager.toGeoJSON(polygon.id, network);
      expect(geojson).not.toBeNull();
      expect(geojson!.coordinates).toHaveLength(2); // outer ring + 1 hole
    });

    it("should produce a closed GeoJSON ring (first coord === last coord)", () => {
      const { network } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);
      const polygon = manager.getAllPolygons()[0]!;

      const geojson = manager.toGeoJSON(polygon.id, network);
      expect(geojson).not.toBeNull();
      const ring = geojson!.coordinates[0]!;
      // GeoJSON ring must be closed: first point === last point
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it("should produce a valid closed ring even when edgeIds are not in v1-chain order", () => {
      // Simulate the scenario from the user's bug:
      // edgeIds stored as [edge1, edge3, edge2] where the chain order differs
      // from the naive firstEdge.v1 starting point
      const network = new Network();
      const v1 = network.addVertex(35.7812, 140.33289);
      const v2 = network.addVertex(35.78034, 140.33065);
      const v3 = network.addVertex(35.77912, 140.33273);

      const e1 = network.addEdge(v1.id, v2.id); // v1↔v2
      const e2 = network.addEdge(v2.id, v3.id); // v2↔v3
      const e3 = network.addEdge(v3.id, v1.id); // v3↔v1

      // Manually create a polygon with edgeIds in non-sequential order: [e1, e3, e2]
      // This is the order the half-edge traversal can produce (cycle: v2→v1→v3→v2)
      const polygonId = createPolygonID("test-polygon");
      (manager as any).polygons.set(polygonId, {
        id: polygonId,
        edgeIds: [e1.id, e3.id, e2.id],
        holes: [],
      });

      const geojson = manager.toGeoJSON(polygonId, network);
      expect(geojson).not.toBeNull();
      const ring = geojson!.coordinates[0]!;

      // Ring must be closed
      expect(ring[0]).toEqual(ring[ring.length - 1]);

      // Ring must have 4 points (3 vertices + closing)
      expect(ring).toHaveLength(4);

      // All 3 vertices must appear in the ring (as [lng, lat])
      const ringWithoutClosing = ring.slice(0, 3);
      const expectedCoords = [
        [v1.lng, v1.lat],
        [v2.lng, v2.lat],
        [v3.lng, v3.lat],
      ];
      for (const coord of expectedCoords) {
        expect(ringWithoutClosing).toContainEqual(coord);
      }
    });

    it("should export FeatureCollection", () => {
      // Two separate triangles
      const { network } = buildNetwork(
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
          [3, 0],
          [4, 0],
          [3.5, 1],
        ],
        [
          [0, 1],
          [1, 2],
          [2, 0],
          [3, 4],
          [4, 5],
          [5, 3],
        ],
      );
      const faces = enumerateFaces(network);
      manager.updateFromFaces(faces, network);

      const fc = manager.toFeatureCollection(network);
      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features).toHaveLength(2);
    });
  });
});
