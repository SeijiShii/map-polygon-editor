import { describe, it, expect } from "vitest";
import { NetworkPolygonEditor } from "./editor";

describe("overlapping polygons", () => {
  it("rectangle + overlapping triangle (interior crossings) → 3 polygons", () => {
    const editor = new NetworkPolygonEditor();

    // Rectangle: (0,0)-(0,4)-(3,4)-(3,0)
    editor.startDrawing();
    editor.placeVertex(0, 0);
    editor.placeVertex(0, 4);
    editor.placeVertex(3, 4);
    editor.placeVertex(3, 0);
    const rectFirst = editor.getVertices().find(
      (v) => v.lat === 0 && v.lng === 0,
    )!;
    editor.snapToVertex(rectFirst.id);
    expect(editor.getPolygons()).toHaveLength(1);

    // Triangle: (1,2) inside rect, (5,5) outside, (5,-1) outside
    // Edge (1,2)→(5,5) crosses right edge (3,4)→(3,0) at (3, 3.5) — both params interior
    // Edge (5,-1)→(1,2) crosses right edge (3,4)→(3,0) at (3, 0.5) — both params interior
    editor.startDrawing();
    editor.placeVertex(1, 2);
    editor.placeVertex(5, 5);
    editor.placeVertex(5, -1);
    const triFirst = editor.getVertices().find(
      (v) => v.lat === 1 && v.lng === 2,
    )!;
    editor.snapToVertex(triFirst.id);

    // 3 polygons: rect-only, overlap, triangle-only
    expect(editor.getPolygons()).toHaveLength(3);
  });

  it("new edge passing through existing vertex should split correctly", () => {
    const editor = new NetworkPolygonEditor();

    // Rectangle
    editor.startDrawing();
    editor.placeVertex(0, 0);
    editor.placeVertex(0, 4);
    editor.placeVertex(3, 4);
    editor.placeVertex(3, 0);
    const rectFirst = editor.getVertices().find(
      (v) => v.lat === 0 && v.lng === 0,
    )!;
    editor.snapToVertex(rectFirst.id);
    expect(editor.getPolygons()).toHaveLength(1);

    // Triangle whose edge passes through rectangle's corner vertex (3,4)
    // (1,3) → (5,5) passes through (3,4)
    editor.startDrawing();
    editor.placeVertex(1, 3);
    editor.placeVertex(5, 5);
    editor.placeVertex(5, 1);
    const triFirst = editor.getVertices().find(
      (v) => v.lat === 1 && v.lng === 3,
    )!;
    editor.snapToVertex(triFirst.id);

    // Should still produce 3 polygons
    expect(editor.getPolygons()).toHaveLength(3);
  });
});
