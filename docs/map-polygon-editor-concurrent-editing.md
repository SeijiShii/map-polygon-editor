# map-polygon-editor 同時編集対応の変更計画

## 現状

### StorageAdapter（現行）
```typescript
interface StorageAdapter {
  loadAll(): Promise<{ vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }>;
  saveAll(data: { vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }): Promise<void>;
}
```

- ネットワーク全体を1つのJSONとして読み書き
- 同時編集不可（後から保存した方が全上書き）

### ChangeSet（既存、活用可能）
```typescript
interface ChangeSet {
  vertices: {
    added: Vertex[];
    removed: VertexID[];
    moved: Array<{ id: VertexID; from: { lat; lng }; to: { lat; lng } }>;
  };
  edges: {
    added: Edge[];
    removed: EdgeID[];
  };
  polygons: {
    created: PolygonSnapshot[];
    modified: Array<{ id: PolygonID; before: PolygonSnapshot; after: PolygonSnapshot }>;
    removed: PolygonID[];
    statusChanged: PolygonStatusChange[];
  };
}
```

- 各操作（頂点追加、辺削除、ポリゴン作成等）が差分として返される
- **これを同期の単位として活用できる**

---

## 必要な変更

### 1. StorageAdapterをレコード単位に変更

```typescript
interface StorageAdapter {
  // --- 読み込み（初期ロード、既存と同じ） ---
  loadAll(): Promise<{ vertices: Vertex[]; edges: Edge[]; polygons: PolygonSnapshot[] }>;

  // --- レコード単位の書き込み（saveAllを置き換え） ---
  putVertex(vertex: Vertex): Promise<void>;
  deleteVertex(id: VertexID): Promise<void>;
  putEdge(edge: Edge): Promise<void>;
  deleteEdge(id: EdgeID): Promise<void>;
  putPolygon(polygon: PolygonSnapshot): Promise<void>;
  deletePolygon(id: PolygonID): Promise<void>;

  // --- 外部からの変更通知を受け取るコールバック ---
  onRemoteChange(handler: (change: ChangeSet) => void): void;
}
```

**変更点**:
- `saveAll()` を廃止し、エンティティ単位の `put/delete` に分割
- `onRemoteChange` で他ユーザーからの変更をリアルタイムに受信

### 2. NetworkPolygonEditorに外部変更の適用メソッドを追加

```typescript
class NetworkPolygonEditor {
  // --- 既存API（変更なし） ---
  init(): Promise<void>;
  placeVertex(...): ChangeSet;
  moveVertex(...): ChangeSet;
  // ...

  // --- 新規: 外部変更の適用 ---
  applyRemoteChange(change: ChangeSet): ChangeSet;
  // リモートから受信したChangeSetを内部状態に適用し、
  // UIに反映すべき差分をChangeSetとして返す

  // --- 変更: save()の挙動 ---
  // save()は不要になる（各操作時にput/deleteが即時呼ばれる）
  // もしくは明示的なflush用途として残す
}
```

### 3. 各操作メソッド内部の変更

現在:
```
ユーザー操作 → ChangeSet生成 → 内部状態更新 → (後で) save() → saveAll()
```

変更後:
```
ユーザー操作 → ChangeSet生成 → 内部状態更新 → put/delete即時呼び出し
                                                ↓
                                    StorageAdapter経由でGroupShareに伝播
                                                ↓
                                    他ユーザーのonRemoteChangeが発火
                                                ↓
                                    applyRemoteChange → UI更新
```

### 4. 競合解決の方針

LinkSelfはLast-Write-Wins（タイムスタンプ比較）。ポリゴン編集での競合パターン:

| 競合パターン | 発生頻度 | 解決方針 |
|---|---|---|
| 同じ頂点を同時に移動 | 低（異なる区域を編集するため） | LWW（後勝ち）で許容 |
| 同じ辺を一方が分割、他方が削除 | 極低 | LWWで片方が消える → orphan pruneで整合 |
| 同じポリゴンの属性を同時変更 | 低 | LWWで許容 |

**前提**: 編集スタッフは通常異なる領域・区域を担当するため、同一エンティティへの同時操作は稀。LWWで実用上問題ない。

---

## GroupShareチャネル設計

```
channel: map_vertices    topic: {regionId}    レコード: Vertex (id, lat, lng)
channel: map_edges       topic: {regionId}    レコード: Edge (id, v1, v2)
channel: map_polygons    topic: {regionId}    レコード: PolygonSnapshot (id, edgeIds, holes, ...)
```

- 現行の `map_networks` チャネル（JSON丸ごと）を3チャネルに分割
- topicはregionId単位。活動スタッフは自分の領域のみSubscribe

---

## Home Visit Suite側の変更

### WailsStorageAdapter → LinkSelfStorageAdapter

```typescript
class LinkSelfStorageAdapter implements StorageAdapter {
  constructor(
    private readonly groupShare: GroupShareBinding,
    private readonly regionId: string
  ) {}

  async loadAll() {
    const vertices = await this.groupShare.List("map_vertices", this.regionId);
    const edges = await this.groupShare.List("map_edges", this.regionId);
    const polygons = await this.groupShare.List("map_polygons", this.regionId);
    return { vertices, edges, polygons };
  }

  async putVertex(v: Vertex) {
    await this.groupShare.Put("map_vertices", this.regionId, v.id, JSON.stringify(v));
  }

  async deleteVertex(id: VertexID) {
    await this.groupShare.Delete("map_vertices", this.regionId, id);
  }

  // ... putEdge, deleteEdge, putPolygon, deletePolygon 同様

  onRemoteChange(handler: (change: ChangeSet) => void) {
    this.groupShare.Subscribe("map_vertices", [this.regionId]);
    this.groupShare.Subscribe("map_edges", [this.regionId]);
    this.groupShare.Subscribe("map_polygons", [this.regionId]);
    this.groupShare.OnChange((record) => {
      const change = this.recordToChangeSet(record);
      handler(change);
    });
  }
}
```

---

## 実装順序

| Step | 内容 | 影響範囲 |
|---|---|---|
| 1 | StorageAdapterにput/deleteメソッドを追加（loadAll/saveAllも残す） | ライブラリ（後方互換） |
| 2 | 各操作メソッド内でput/deleteを呼ぶよう変更 | ライブラリ内部 |
| 3 | `applyRemoteChange`メソッドを追加 | ライブラリ公開API |
| 4 | `onRemoteChange`コールバックをStorageAdapterに追加 | ライブラリ |
| 5 | Home Visit Suite側でLinkSelfStorageAdapterを実装 | アプリ側 |
| 6 | saveAll()をdeprecated化（移行完了後に削除） | ライブラリ |

---

## 注意事項

- **Undo/Redo**: ローカル操作のみ対象。リモートからの変更はUndo対象外とする
- **初期ロード**: loadAll()は引き続き必要（アプリ起動時の全データ取得）
- **オフライン対応**: LinkSelfのStore-and-Forwardにより、オフライン中の変更はオンライン復帰時に自動伝播
