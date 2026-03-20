# Implementation Plan: v3 Network-based Polygon Editor

## Overview

Rebuild the map-polygon-editor from a GeoJSON-centric model to a network-centric model (vertices + edges → polygon snapshots). The old implementation under `src/` will be backed up and replaced.

## Architecture

```
src/
  types.ts                  # Core types (Vertex, Edge, PolygonSnapshot, ChangeSet, etc.)
  network.ts                # Network store (vertices + edges CRUD, duplicate edge guard)
  half-edge.ts              # Half-edge face enumeration algorithm
  polygon-manager.ts        # Polygon snapshot lifecycle (detect, create, update, identity)
  intersection.ts           # Edge-edge intersection detection & vertex insertion
  operations.ts             # High-level edit operations (returns ChangeSet)
  drawing-mode.ts           # Drawing mode state machine
  undo-redo.ts              # Command-based undo/redo (user-operation granularity)
  storage-adapter.ts        # StorageAdapter interface + serialization
  geojson-export.ts         # GeoJSON output (individual + FeatureCollection)
  editor.ts                 # Public API facade
  index.ts                  # Re-exports
```

## Phases

### Phase 1: Core Data Layer (types + network)

**Goal**: Define all types and implement the in-memory network store.

#### Step 1.1: Types (`src/types.ts`)

```ts
// Branded IDs
type VertexID = string & { readonly __brand: "VertexID" }
type EdgeID = string & { readonly __brand: "EdgeID" }
type PolygonID = string & { readonly __brand: "PolygonID" }

interface Vertex {
  id: VertexID
  lat: number
  lng: number
}

interface Edge {
  id: EdgeID
  v1: VertexID  // unordered pair
  v2: VertexID
}

interface PolygonSnapshot {
  id: PolygonID
  edgeIds: EdgeID[]       // ordered cycle
  holes: EdgeID[][]       // ordered cycles of inner rings
}

// ChangeSet returned by every operation
interface ChangeSet {
  vertices: {
    added: Vertex[]
    removed: VertexID[]
    moved: Array<{ id: VertexID; from: { lat: number; lng: number }; to: { lat: number; lng: number } }>
  }
  edges: {
    added: Edge[]
    removed: EdgeID[]
  }
  polygons: {
    created: PolygonSnapshot[]
    modified: Array<{ id: PolygonID; before: PolygonSnapshot; after: PolygonSnapshot }>
    removed: PolygonID[]
  }
}

type EditorMode = "idle" | "drawing" | "editing"

// StorageAdapter
interface StorageAdapter {
  loadAll(): Promise<{ vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }>
  saveAll(data: { vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }): Promise<void>
}
```

#### Step 1.2: Network Store (`src/network.ts`)

- `Map<VertexID, Vertex>` and `Map<EdgeID, Edge>`
- Adjacency index: `Map<VertexID, Set<EdgeID>>` for fast neighbor lookup
- Duplicate edge guard: check before adding (same v1-v2 pair, order-independent)
- CRUD methods: `addVertex`, `removeVertex`, `addEdge`, `removeEdge`, `moveVertex`
- `getEdgesOfVertex(id)`, `getNeighborVertices(id)`
- `getVertexPairEdge(v1, v2)` → EdgeID | undefined

**Tests**: CRUD operations, duplicate edge rejection, adjacency consistency.

---

### Phase 2: Half-edge Face Enumeration

**Goal**: Given a network, enumerate all minimal faces (= polygon candidates).

#### Step 2.1: Half-edge Algorithm (`src/half-edge.ts`)

1. Build half-edge pairs from each Edge (forward: v1→v2, backward: v2→v1)
2. For each vertex, sort outgoing half-edges by angle (using `Math.atan2`)
3. Build "next" mapping: for half-edge arriving at vertex V, the next half-edge is the one leaving V at the next angle counter-clockwise
4. Traverse all unvisited half-edges to collect faces
5. Identify and exclude the unbounded (outer) face: the face with the largest absolute signed area (or negative signed area if using CCW convention)
6. Exclude zero-area faces

**Input**: Network (vertices + edges)
**Output**: `Face[]` where `Face = { halfEdges: [VertexID, VertexID][], signedArea: number }`

**Tests**:
- Single triangle → 1 face
- Two adjacent triangles sharing an edge → 2 faces
- Square with diagonal → 2 faces
- Dangling edge (cherry branch) → correctly excluded
- No edges → no faces
- Open polyline → no faces

---

### Phase 3: Polygon Snapshot Manager

**Goal**: Maintain polygon snapshots, detect holes, handle identity.

#### Step 3.1: Polygon Manager (`src/polygon-manager.ts`)

- `Map<PolygonID, PolygonSnapshot>` storage
- `rebuildFromFaces(faces: Face[], previousPolygons: Map<PolygonID, PolygonSnapshot>)`:
  1. Convert faces to coordinate arrays
  2. Detect containment (face B inside face A → B is a hole of A) using Turf `booleanContains`
  3. Assemble PolygonSnapshots with holes
  4. Match against previous polygons by edge set overlap → identity resolution
  5. Apply identity rules: split → larger area inherits; merge → larger area inherits
  6. Return new polygon map + changeset diff

- `toGeoJSON(polygon: PolygonSnapshot, network: Network)` → GeoJSON Polygon
- `toFeatureCollection(polygons, network)` → GeoJSON FeatureCollection
- Winding order: ensure outer ring is CCW, holes are CW

**Identity matching algorithm**:
1. For each new face, compute the set of EdgeIDs
2. Find previous polygons whose EdgeID sets intersect
3. If exact match (same edge set) → same polygon, UUID preserved
4. If one previous polygon's edges split into two new faces → split (larger inherits UUID)
5. If two previous polygons' edges merge into one new face → merge (larger area's UUID)
6. No match → new polygon

**Tests**:
- Polygon survives unchanged → same UUID
- Edge added splits polygon → larger face gets old UUID
- Edge removed merges polygons → larger area's UUID survives
- Hole detection: inner face becomes hole of outer face
- Zero-area face excluded

---

### Phase 4: Intersection Detection

**Goal**: Detect and resolve edge crossings.

#### Step 4.1: Intersection (`src/intersection.ts`)

- `findIntersections(edge: Edge, network: Network)`: find all edges that intersect with the given edge
- `resolveIntersections(newEdge, intersectingEdges, network)`: insert vertices at intersection points, split edges
- Line-segment intersection math (existing in Turf or implement)
- Collinear/T-junction edge cases

**Tests**:
- Two crossing edges → intersection point found
- Parallel edges → no intersection
- T-junction → handled correctly
- Multiple intersections on one edge

---

### Phase 5: High-level Operations

**Goal**: Operations that compose network mutations + intersection resolution + polygon rebuild.

#### Step 5.1: Operations (`src/operations.ts`)

Each returns `ChangeSet`:

- `addVertex(lat, lng)` → add isolated vertex
- `addConnectedVertex(fromVertexId, lat, lng)` → add vertex + edge, detect intersections
- `snapToVertex(fromVertexId, toVertexId)` → add edge between existing vertices, detect intersections
- `snapToEdge(fromVertexId, edgeId, point)` → split edge at point, add edge from fromVertex
- `moveVertex(vertexId, lat, lng)` → update position, detect new intersections
- `removeVertex(vertexId)` → remove vertex + connected edges
- `removeEdge(edgeId)` → remove edge only
- `splitEdgeAtPoint(edgeId, lat, lng)` → insert vertex on edge (context menu "add vertex")

Internal flow for each operation:
1. Mutate network
2. Detect & resolve intersections (if applicable)
3. Run half-edge face enumeration
4. Update polygon snapshots (identity resolution)
5. Build & return ChangeSet

---

### Phase 6: Drawing Mode

**Goal**: State machine for drawing mode.

#### Step 6.1: Drawing Mode (`src/drawing-mode.ts`)

- State: `{ active: boolean, currentVertexId: VertexID | null, sessionVertices: VertexID[], sessionEdges: EdgeID[] }`
- `startDrawing()` → set active, clear session
- `placeVertex(lat, lng)` → addVertex + addEdge from current, update current
- `snapToExistingVertex(vertexId)` → addEdge from current to existing → end drawing
- `snapToExistingEdge(edgeId, point)` → splitEdge + addEdge → end drawing
- `endDrawing()` → deactivate (vertices/edges remain)
- `undoLastVertex()` → remove last session vertex+edge (for right-click undo during drawing)

**Tests**:
- Draw 3 points → 3 vertices, 2 edges
- Snap to existing vertex → drawing ends, edge created
- Snap to existing edge → edge split + connection
- End drawing → state reset, network unchanged

---

### Phase 7: Undo/Redo

**Goal**: Command-pattern undo/redo at user-operation granularity.

#### Step 7.1: Undo/Redo (`src/undo-redo.ts`)

- Each operation records a `Command` containing a forward ChangeSet and an inverse ChangeSet
- `undo()` → apply inverse ChangeSet, rebuild polygon snapshots
- `redo()` → apply forward ChangeSet, rebuild polygon snapshots
- Stack-based: undo stack + redo stack (redo cleared on new operation)
- Operations during drawing mode: each vertex placement = 1 command

**Tests**:
- Add vertex → undo → vertex gone
- Add edge causing polygon → undo → polygon gone
- Multiple undo/redo cycles
- New operation clears redo stack

---

### Phase 8: Storage & GeoJSON Export

#### Step 8.1: StorageAdapter (`src/storage-adapter.ts`)

- Interface definition (already in types)
- Serialization: network → plain JSON (vertices array + edges array + polygons array)
- Deserialization: JSON → rebuild internal maps and indices

#### Step 8.2: GeoJSON Export (`src/geojson-export.ts`)

- `getPolygonGeoJSON(polygonId)` → GeoJSON Polygon (with holes as inner rings)
- `getAllGeoJSON()` → GeoJSON FeatureCollection
- Winding order enforcement (Turf `rewind`)

---

### Phase 9: Public API Facade

#### Step 9.1: Editor (`src/editor.ts`)

Old `editor.ts` will be deleted in Phase 10

```ts
class NetworkPolygonEditor {
  // Lifecycle
  constructor(adapter?: StorageAdapter)
  async init(): Promise<void>
  async save(): Promise<void>

  // Mode
  getMode(): EditorMode
  startDrawing(): void
  endDrawing(): ChangeSet

  // Drawing operations
  placeVertex(lat: number, lng: number): ChangeSet
  snapToVertex(vertexId: VertexID): ChangeSet
  snapToEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet

  // Edit operations
  moveVertex(vertexId: VertexID, lat: number, lng: number): ChangeSet
  removeVertex(vertexId: VertexID): ChangeSet
  removeEdge(edgeId: EdgeID): ChangeSet
  splitEdge(edgeId: EdgeID, lat: number, lng: number): ChangeSet

  // Undo/Redo
  undo(): ChangeSet | null
  redo(): ChangeSet | null

  // Query
  getVertices(): Vertex[]
  getEdges(): Edge[]
  getPolygons(): PolygonSnapshot[]
  getPolygonGeoJSON(id: PolygonID): GeoJSON.Polygon | null
  getAllGeoJSON(): GeoJSON.FeatureCollection

  // Network queries (for app-layer snap detection)
  getVertex(id: VertexID): Vertex | null
  getEdge(id: EdgeID): Edge | null
}
```

---

### Phase 10: Old Code Cleanup

- Delete all old source files (`editor.ts`, `errors.ts`, `types/`, `draft/`, `polygon-store/`, `geometry/`)
- Delete all old test files
- Update `src/index.ts` to export new API

---

## Implementation Order

| Phase | Dependency | Description |
|-------|-----------|-------------|
| 1. Types + Network | None | Foundation |
| 2. Half-edge | Phase 1 | Core algorithm |
| 3. Polygon Manager | Phase 1, 2 | Core logic |
| 4. Intersection | Phase 1 | Geometry |
| 5. Operations | Phase 1-4 | Integration |
| 6. Drawing Mode | Phase 5 | State machine |
| 7. Undo/Redo | Phase 5 | History |
| 8. Storage + GeoJSON | Phase 1, 3 | IO |
| 9. Public API | Phase 1-8 | Facade |
| 10. Cleanup | Phase 9 | Migration |

## Notes

- TDD approach: write tests first for each phase
- Each phase should be independently testable
- Turf.js is available for geometry operations (booleanContains, area, rewind, etc.)
- Old implementation is reference only — new code is a clean rewrite
- Old code will be deleted entirely in Phase 10 (no backup needed, git history is sufficient)
