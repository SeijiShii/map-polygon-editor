# map-polygon-editor API Reference

## Core Concepts

### Network Model

データの中心概念は**ネットワーク**（頂点と線分の集合）。ポリゴンはネットワーク内の閉回路から自動導出されるスナップショットである。

```
Vertex (頂点)          ─ 緯度経度 + UUID
  ↕ Edge (線分)で接続
Vertex (頂点)          ─ 2頂点の無向ペア + UUID
  ↓ 閉回路を検出
PolygonSnapshot        ─ 線分の順序付きリスト + UUID
```

- 頂点と線分を自由に追加/削除する → ライブラリが閉回路を自動検出してポリゴンを生成・更新・削除する
- アプリ層は「ポリゴンを作る」のではなく「線分を引く」。ポリゴンは結果として現れる
- ポリゴンUUIDはアプリ層のデータ（名称、メタデータ等）と紐づけるための識別子。メタデータ管理はアプリ層の責任

### ChangeSet駆動

全操作メソッドは `ChangeSet` を同期的に返す。これはネットワークとポリゴンの差分情報で、アプリ層はこれを使って地図レイヤーを差分更新する。

```
アプリ層                      ライブラリ
  │                              │
  │── placeVertex(lat, lng) ────→│
  │                              │── ネットワーク更新
  │                              │── 交差検出・分割
  │                              │── 閉回路検出
  │                              │── ポリゴンスナップショット更新
  │←── ChangeSet ────────────────│
  │                              │
  │── ChangeSetを使って          │
  │   Leafletレイヤーを差分更新  │
```

1つのユーザー操作で交差分割やポリゴン生成が連鎖しても、すべて1つのChangeSetにまとまって返る。Undoもこの単位で巻き戻す。

### 描画モードと編集モード

2つのモードは排他的。

- **描画モード** (`startDrawing` → 描画開始 → `placeVertex`... → 描画終了): 線分を順次追加する
- **編集モード** (idle状態で `moveVertex`, `removeVertex` 等): 既存の頂点・線分を操作する

スナップ判定（クリック位置に最も近い頂点/線分を見つける）はライブラリの `findNearestVertex` / `findNearestEdge` を呼び、ピクセル→度数の変換はアプリ層が行う。

## Install & Import

```ts
import {
  NetworkPolygonEditor,
  type Vertex, type Edge, type PolygonSnapshot,
  type ChangeSet, type VertexID, type EdgeID, type PolygonID,
  type StorageAdapter,
} from "map-polygon-editor";
```

## Types

```ts
type VertexID = string & { __brand: "VertexID" }
type EdgeID   = string & { __brand: "EdgeID" }
type PolygonID = string & { __brand: "PolygonID" }

interface Vertex { id: VertexID; lat: number; lng: number }
interface Edge   { id: EdgeID; v1: VertexID; v2: VertexID }  // unordered pair
interface PolygonSnapshot {
  id: PolygonID
  edgeIds: EdgeID[]    // outer ring (ordered cycle)
  holes: EdgeID[][]    // inner rings
}
```

## ChangeSet

Every mutating method returns a `ChangeSet` describing what changed:

```ts
interface ChangeSet {
  vertices: {
    added: Vertex[]
    removed: VertexID[]
    moved: Array<{ id: VertexID; from: {lat,lng}; to: {lat,lng} }>
  }
  edges:    { added: Edge[]; removed: EdgeID[] }
  polygons: {
    created: PolygonSnapshot[]
    modified: Array<{ id: PolygonID; before: PolygonSnapshot; after: PolygonSnapshot }>
    removed: PolygonID[]
  }
}
```

Use this to sync Leaflet layers: added → create layer, removed → remove layer, moved/modified → update layer.

## NetworkPolygonEditor

### Constructor

```ts
const editor = new NetworkPolygonEditor(adapter?: StorageAdapter);
```

### Lifecycle

| Method | Returns | Description |
|--------|---------|-------------|
| `init()` | `Promise<void>` | Load data from StorageAdapter |
| `save()` | `Promise<void>` | Save data to StorageAdapter |

### Mode

| Method | Returns | Description |
|--------|---------|-------------|
| `getMode()` | `"idle" \| "drawing"` | Current mode |
| `startDrawing()` | `void` | Enter drawing mode |
| `endDrawing()` | `ChangeSet` | Exit drawing mode (vertices/edges remain) |

### Drawing Mode Operations

Call these between `startDrawing()` and drawing end.

`snapToVertex` / `snapToEdge` は描画の**開始時と終了時で挙動が異なる**。最初の頂点がまだ置かれていない場合は描画開始（描画継続）、既に頂点がある場合は描画終了となる。

#### 描画開始（最初の1点を決める）

3通りの方法で描画の始点を指定できる。いずれも描画は**継続**する。

| Method | Returns | Description |
|--------|---------|-------------|
| `placeVertex(lat, lng)` | `ChangeSet` | 自由座標に新規頂点を作成して描画開始 |
| `snapToVertex(vertexId)` | `ChangeSet` | 既存頂点を始点として描画開始（頂点作成なし） |
| `snapToEdge(edgeId, lat, lng)` | `ChangeSet` | 既存線分上に頂点を追加（辺分割）して描画開始 |

#### 描画中（中間頂点の追加）

| Method | Returns | Description |
|--------|---------|-------------|
| `placeVertex(lat, lng)` | `ChangeSet` | 自由座標に頂点を追加し、前の頂点と接続 |

#### 描画終了

3通りの方法で描画を終了できる。`snapToVertex` / `snapToEdge` は自動的に描画を終了する。

| Method | Returns | Description |
|--------|---------|-------------|
| `snapToVertex(vertexId)` | `ChangeSet` | 既存頂点に接続して描画終了。閉回路ならポリゴン生成 |
| `snapToEdge(edgeId, lat, lng)` | `ChangeSet` | 既存線分上に頂点を追加し接続して描画終了 |
| `endDrawing()` | `ChangeSet` | 描画終了（頂点・線分はそのまま残る。自由端） |

### Edit Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `moveVertex(vertexId, lat, lng)` | `ChangeSet` | Move vertex. Auto-detects new edge crossings |
| `removeVertex(vertexId)` | `ChangeSet` | Delete vertex + all connected edges |
| `removeEdge(edgeId)` | `ChangeSet` | Delete edge only (vertices remain) |
| `removePolygon(polygonId)` | `ChangeSet` | Delete polygon + cleanup unused edges/vertices (see below) |
| `splitEdge(edgeId, lat, lng)` | `ChangeSet` | Insert vertex on edge (splits into 2 edges) |
| `pruneOrphans()` | `ChangeSet` | Remove all vertices and edges not belonging to any polygon |

### Drag Operations

頂点ドラッグ中にポリゴンをリアルタイム追従させつつ、undoは1ステップにまとめるためのAPI。

| Method | Returns | Description |
|--------|---------|-------------|
| `beginDrag(vertexId)` | `void` | ドラッグ開始。元座標を保存 |
| `dragTo(lat, lng)` | `ChangeSet` | ドラッグ中の移動。座標更新+ポリゴン再構築のみ（undo記録なし、交差解決なし） |
| `endDrag()` | `ChangeSet` | ドラッグ終了。交差解決+undo記録（元座標→最終座標の1ステップ） |
| `cancelDrag()` | `void` | ドラッグキャンセル。元座標に復元 |

```ts
// Usage example
marker.on("mousedown", () => editor.beginDrag(vertexId));
map.on("mousemove", (e) => {
  const cs = editor.dragTo(e.latlng.lat, e.latlng.lng);
  applyChangeSet(cs, layers, map);  // polygons follow in real-time
});
map.on("mouseup", () => {
  const cs = editor.endDrag();
  applyChangeSet(cs, layers, map);
  // undo() will revert the entire drag as one step
});
```

### Undo/Redo

| Method | Returns | Description |
|--------|---------|-------------|
| `canUndo()` | `boolean` | Whether undo stack is non-empty |
| `canRedo()` | `boolean` | Whether redo stack is non-empty |
| `undo()` | `ChangeSet \| null` | Undo last user operation (including auto-splits) |
| `redo()` | `ChangeSet \| null` | Redo |

### Query

| Method | Returns | Description |
|--------|---------|-------------|
| `getVertices()` | `Vertex[]` | All vertices |
| `getEdges()` | `Edge[]` | All edges |
| `getPolygons()` | `PolygonSnapshot[]` | All polygons |
| `getVertex(id)` | `Vertex \| null` | Single vertex |
| `getEdge(id)` | `Edge \| null` | Single edge |
| `findNearestVertex(lat, lng, radius)` | `Vertex \| null` | Nearest vertex within radius (degree units) |
| `findNearestEdge(lat, lng, radius)` | `{edge, point, distance} \| null` | Nearest edge within radius. `point` = closest point on edge |
| `getPolygonGeoJSON(id)` | `GeoJSON.Polygon \| null` | Polygon as GeoJSON (with holes) |
| `getAllGeoJSON()` | `GeoJSON.FeatureCollection` | All polygons as FeatureCollection |

## StorageAdapter

Implement this interface for persistence:

```ts
interface StorageAdapter {
  loadAll(): Promise<{ vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }>
  saveAll(data: { vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }): Promise<void>
}
```

## removePolygon vs pruneOrphans

両者は異なる責務を持つ。

| | `removePolygon(id)` | `pruneOrphans()` |
|---|---|---|
| **目的** | 特定のポリゴンをUX的に「削除」する | ポリゴンに属さない孤立要素を一括清掃する |
| **対象** | 指定ポリゴンの構成要素のみ | ネットワーク全体の孤立要素 |
| **エッジ削除** | 他のポリゴンと共有されていないエッジのみ | どのポリゴンにも属さないエッジすべて |
| **頂点削除** | エッジ削除後にdegree=0になった頂点のみ | どのポリゴンにも属さない頂点すべて |
| **ダングリング要素** | 残す（削除したポリゴンの関連に絞ったクリーンアップ） | 削除する |

```ts
// ポリゴン削除: 共有エッジは保護される
editor.removePolygon(polygonId);

// その後、残った半端な線分も消したい場合は:
editor.pruneOrphans();
```

## Key Behaviors

- **Auto polygon detection**: Adding an edge that closes a cycle automatically creates a polygon.
- **Auto intersection resolution**: New edges crossing existing edges insert vertices at intersections and split both edges.
- **Polygon identity**: On split → larger area inherits UUID. On merge → larger area's UUID survives.
- **Holes**: Inner cycles contained within an outer cycle become GeoJSON inner rings.
- **Duplicate edge guard**: Same vertex pair cannot have multiple edges.
- **Undo granularity**: One undo reverses one user action, including all auto-generated splits.

## Typical Leaflet Integration

```ts
function applyChangeSet(cs: ChangeSet, layers: Map<string, L.Layer>, map: L.Map) {
  // Vertices
  for (const v of cs.vertices.added)
    layers.set(v.id, L.circleMarker([v.lat, v.lng]).addTo(map));
  for (const id of cs.vertices.removed)
    layers.get(id)?.remove(), layers.delete(id);
  for (const m of cs.vertices.moved)
    (layers.get(m.id) as L.CircleMarker)?.setLatLng([m.to.lat, m.to.lng]);

  // Edges
  for (const e of cs.edges.added) {
    const v1 = editor.getVertex(e.v1)!, v2 = editor.getVertex(e.v2)!;
    layers.set(e.id, L.polyline([[v1.lat,v1.lng],[v2.lat,v2.lng]]).addTo(map));
  }
  for (const id of cs.edges.removed)
    layers.get(id)?.remove(), layers.delete(id);

  // Polygons
  for (const p of cs.polygons.created) {
    const geo = editor.getPolygonGeoJSON(p.id);
    if (geo) layers.set(p.id, L.geoJSON(geo).addTo(map));
  }
  for (const p of cs.polygons.modified) {
    layers.get(p.id)?.remove();
    const geo = editor.getPolygonGeoJSON(p.id);
    if (geo) layers.set(p.id, L.geoJSON(geo).addTo(map));
  }
  for (const id of cs.polygons.removed)
    layers.get(id)?.remove(), layers.delete(id);
}
```
