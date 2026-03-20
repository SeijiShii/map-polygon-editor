import { describe, it, expect } from "vitest";
import { Network } from "./network";
import { enumerateFaces } from "./half-edge";
import type { Face } from "./types";

/**
 * Helper: build a network from coordinate pairs and edge definitions.
 * Returns the network and vertex IDs by index.
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

describe("enumerateFaces", () => {
  it("should return no faces for empty network", () => {
    const network = new Network();
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(0);
  });

  it("should return no faces for isolated vertices", () => {
    const network = new Network();
    network.addVertex(0, 0);
    network.addVertex(1, 1);
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(0);
  });

  it("should return no faces for an open polyline", () => {
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(0);
  });

  it("should find 1 face for a triangle", () => {
    // Counter-clockwise triangle
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
    expect(faces).toHaveLength(1);
    expect(faces[0]!.edgeIds).toHaveLength(3);
  });

  it("should find 2 faces for two adjacent triangles (shared edge)", () => {
    //   2
    //  / \
    // 0---1
    //  \ /
    //   3
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [0.5, 1],
        [0.5, -1],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [0, 3],
        [3, 1],
      ],
    );
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(2);
    // Each face should have 3 edges
    for (const face of faces) {
      expect(face.edgeIds).toHaveLength(3);
    }
  });

  it("should find 2 faces for a square with diagonal", () => {
    // 3---2
    // |  /|
    // | / |
    // 0---1
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [1, 1],
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
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(2);
  });

  it("should correctly exclude dangling edges (cherry branch)", () => {
    // Triangle 0-1-2 with a dangling edge from vertex 1 to vertex 3
    //   2
    //  / \
    // 0---1---3
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [0.5, 1],
        [2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [1, 3],
      ],
    );
    const faces = enumerateFaces(network);
    // Should still find exactly 1 face (the triangle)
    expect(faces).toHaveLength(1);
    expect(faces[0]!.edgeIds).toHaveLength(3);
  });

  it("should find 1 face when a line crosses a triangle edge into the interior (two dangling edges at intersection)", () => {
    // Triangle A-B-C with a line from E (outside) through F (on edge AC) to D (inside)
    // After intersection: edge AC is split into AF and FC
    // F also connects to D (inside) and E (outside) — both dangling
    //
    //     A
    //    /|\
    //   / | \        E is outside
    //  / D|  \      /
    // B---+---C----F is on edge AC... wait, let me redo
    //
    // Actually:
    //   A(1,2)
    //   /    \
    //  /  D   \     E
    // B(0,0)--C(2,0)
    //         |
    //         F is on segment AC (between A and C)
    //
    // Corrected topology:
    //   A(1,2)
    //   / \
    //  /   F(1.5,1)---E(2.5,1.5)   (F is on edge AC, E is outside)
    // /   /  \
    // B(0,0)--C(2,0)    D(1.2,0.6) is inside, connected to F
    //
    const { network } = buildNetwork(
      [
        /* 0: A */ [2, 1],
        /* 1: B */ [0, 0],
        /* 2: C */ [0, 2],
        /* 3: F */ [1, 1.5], // on edge AC (midpoint-ish)
        /* 4: D */ [0.6, 1.2], // inside triangle
        /* 5: E */ [1.5, 2.5], // outside triangle
      ],
      [
        [0, 1], // A-B (triangle edge)
        [1, 2], // B-C (triangle edge)
        [2, 3], // C-F (split of original AC)
        [3, 0], // F-A (split of original AC)
        [3, 4], // F-D (dangling, inside)
        [3, 5], // F-E (dangling, outside)
      ],
    );
    const faces = enumerateFaces(network);

    // Should find exactly 1 face: the quadrilateral A-B-C-F
    expect(faces).toHaveLength(1);
    expect(faces[0]!.edgeIds).toHaveLength(4); // AB, BC, CF, FA
  });

  it("should have positive area for CCW faces", () => {
    // CCW triangle
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
    expect(faces).toHaveLength(1);
    expect(faces[0]!.signedArea).toBeGreaterThan(0);
  });

  it("should find 1 face for a square (no diagonal)", () => {
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    );
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.edgeIds).toHaveLength(4);
  });

  it("should exclude zero-area faces (collinear points)", () => {
    // Three collinear points forming a degenerate triangle
    const { network } = buildNetwork(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    );
    const faces = enumerateFaces(network);
    expect(faces).toHaveLength(0);
  });
});
