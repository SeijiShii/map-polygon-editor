# ポリゴン編集 API 仕様

## 初期化

```
MapPolygonEditor(config: {
  storageAdapter : StorageAdapter
  maxUndoSteps?  : number        // デフォルト: 100
  epsilon?       : number        // デフォルト: 1e-8（共有頂点判定の許容誤差、単位：度）
})

initialize(): Promise<void>
```

`initialize()` を呼ぶと以下を実行する：

1. `storageAdapter.loadAll()` を呼び出し、全 Polygon・PersistedDraft をメモリに展開する
2. データ整合性を検証する

失敗した場合は例外を投げる（アプリ側でエラーハンドリングが必要）。

`initialize()` 完了前にクエリ・編集 API を呼び出した場合は例外（`NotInitializedError`）を投げる。

---

## 基本概念

### 開いた形状と閉じた形状

| 状態 | 名称 | 説明 |
|------|------|------|
| 開いている（Open） | ポリライン | 始点と終点が未接続。面積を持たない |
| 閉じている（Closed） | ポリゴン | 始点と終点が接続。面積を持つ |

編集中は Open 状態（ポリライン）として頂点を追加していき、完成時に Close する。

---

## 編集中の形状（Draft Shape）

保存前の編集中状態を表すオブジェクト。Polygon とは別に管理する。

```
DraftShape {
  points   : [Point]   // 頂点リスト（順序付き）
  isClosed : bool      // 閉じているか
}

Point {
  lat : float
  lng : float
}
```

### DraftShape の2つの用途と確定タイミング

| `isClosed` | 用途 | 確定 API | 確定時の処理 |
|-----------|------|---------|------------|
| `true` | 閉じたポリゴン → Polygon として保存 | `saveAsPolygon()` | DraftShape を Polygon に変換して保存 |
| `false` | 切断線 → 既存ポリゴンを分割 | `splitPolygon()` | ヒゲを自動除去してから分割実行 |

DraftShape は確定 API を呼ぶまでインメモリで管理される。複雑な作業を中断・再開できるよう、
明示的な API でストレージに保存することも可能（→ [ドラフト永続化](#ドラフト永続化-draft-persistence)）。
確定後はメモリ・ストレージの両方から自動削除される。

### validateDraft

`saveAsPolygon` / `updatePolygonGeometry` と同じ検証ロジックを、例外を投げずに返す。
アプリがリアルタイムで UI フィードバック（保存ボタン無効化・警告表示）を実装するために使う。

```
validateDraft(draft: DraftShape) → [GeometryViolation]

GeometryViolation {
  code : "TOO_FEW_VERTICES" | "SELF_INTERSECTION" | "ZERO_AREA"
}
// 空配列 = 有効
```

**チェック内容（`isClosed` によって異なる）：**

| コード | 条件 | isClosed=true | isClosed=false |
|--------|------|:---:|:---:|
| `TOO_FEW_VERTICES` | true: 3点未満 / false: 2点未満 | ✓ | ✓ |
| `SELF_INTERSECTION` | 辺が他の辺と交差している | ✓ | — |
| `ZERO_AREA` | 全頂点が1直線上にある | ✓ | — |

### ドラフト永続化（Draft Persistence）

作業中の DraftShape をストレージに保存し、後でリロード・再開できる仕組み。

#### PersistedDraft 型

```
DraftID : string  // ライブラリが自動生成するユニーク ID

PersistedDraft {
  id         : DraftID
  points     : [Point]
  isClosed   : bool
  created_at : datetime
  updated_at : datetime
  metadata?  : { [key: string]: any }  // アプリ側が任意のラベル等を付与可
}
```

- 確定 API（`saveAsPolygon` / `splitPolygon` 等）の呼び出しが成功した際、
  使用した PersistedDraft は**自動削除**される

#### ドラフト永続化 API

```
saveDraftToStorage(draft: DraftShape, metadata?: Record<string, any>)
  → Promise<PersistedDraft>

loadDraftFromStorage(id: DraftID) → DraftShape

listPersistedDrafts() → [PersistedDraft]

deleteDraftFromStorage(id: DraftID) → Promise<void>
```

### スナッピング（吸着）について

スナッピングは**ライブラリの責務外**とする。アプリ側で座標を補正する。

---

## 編集権限ルール

### Polygon の編集制約

**PolygonID を持つ個々の Polygon は全て編集可能。**

| 操作 | 制約 |
|------|------|
| 新規描画 → `saveAsPolygon` | 常にルートとして作成 |
| `loadPolygonToDraft` | 任意の Polygon |
| `updatePolygonGeometry` | 任意の Polygon |
| `splitPolygon` | 任意の Polygon |
| `carveInnerPolygon` | 任意の Polygon |
| `punchHole` | 任意の Polygon |
| `expandWithPolygon` | 任意の Polygon |
| `sharedEdgeMove` | 任意の Polygon。影響は全ポリゴンに及ぶ |
| `renamePolygon` | 任意の Polygon |
| `deletePolygon` | 任意の Polygon |

### 新規描画

```
saveAsPolygon(draft: DraftShape, name: string) → Polygon
  // ルートポリゴンとして保存
```

### 頂点削除時の挙動

頂点を削除すると、削除された頂点の両隣の頂点が直結される。

```
before:  A ── B ── C     B を削除
after:   A ──────── C    A と C が直結
```

### sharedEdgeMove の影響範囲

sharedEdgeMove は任意のポリゴンに対して呼び出せる。影響は**全ポリゴン**に及ぶ。
同座標（epsilon 以内）の頂点を持つ全ポリゴンが連動更新される。

```
Polygon X (頂点 P を持つ)  ← sharedEdgeMove で P を移動
Polygon Y (頂点 P を持つ)
Polygon Z (頂点 P を持つ)

→ X, Y, Z 全てで頂点 P が連動更新される
```

#### パフォーマンス実装方針

全ポリゴン検索の効率化のため、ライブラリ内部で座標ハッシュインデックスを保持する。

- `initialize()` 時に全頂点から構築（O(全頂点数)）
- `sharedEdgeMove` 時の共有頂点検索は O(1)（ハッシュルックアップ）
- ポリゴンの追加・削除・更新時に増分更新

対象規模（数千ポリゴン × 数十頂点 = 数万〜十数万エントリ）では十分な性能。

### 削除の注意

ポリゴンは削除可能。有用なデータの喪失を防ぐため、
**アプリ層で削除確認 UI を実装する**ことを推奨する。ライブラリ側では確認を行わない。

---

## API 一覧

### DraftShape 操作（純粋関数・MapPolygonEditor のメソッドではない）

DraftShape はイミュータブルなデータ構造で、以下の純粋関数で操作する。
これらは `map-polygon-editor` パッケージから直接エクスポートされる。

| 関数 | 引数 | 説明 |
|------|------|------|
| `createDraft()` | - | 空の DraftShape を生成 |
| `addPoint(draft, lat, lng)` | DraftShape、座標 | 末尾に頂点を追加した新 DraftShape を返す |
| `insertPoint(draft, index, lat, lng)` | DraftShape、挿入位置、座標 | 任意位置に頂点を挿入 |
| `movePoint(draft, index, lat, lng)` | DraftShape、頂点番号、新座標 | 頂点を移動 |
| `removePoint(draft, index)` | DraftShape、頂点番号 | 頂点を削除 |
| `closeDraft(draft)` | DraftShape | ポリゴンを閉じる |
| `openDraft(draft)` | DraftShape | ポリラインに戻す |
| `draftToGeoJSON(draft)` | DraftShape | GeoJSON Polygon / LineString に変換 |
| `validateDraft(draft)` | DraftShape | geometry を検証し、違反リストを返す |
| `computeUnion(polygons)` | GeoJSON Polygon[] | ポリゴン群の union を計算し GeoJSON Polygon[] を返す |

### クエリ（全てインメモリ・同期）

| メソッド | 引数 | 戻り値 | 説明 |
|----------|------|--------|------|
| `getPolygon(id)` | PolygonID | `Polygon \| null` | ID で Polygon を取得 |
| `getAllPolygons()` | — | `Polygon[]` | 全 Polygon を取得 |

### Polygon 保存・編集

| メソッド | 引数 | 説明 |
|----------|------|------|
| `saveAsPolygon(draft, name)` | DraftShape、名称 | DraftShape をルートポリゴンとして保存 |
| `updatePolygonGeometry(polygonId, draft)` | PolygonID、DraftShape | 既存ポリゴンの geometry を更新 |
| `renamePolygon(polygonId, name)` | PolygonID、新しい名前 | display_name を変更 |
| `deletePolygon(polygonId)` | PolygonID | Polygon を削除 |
| `loadPolygonToDraft(polygonId)` | PolygonID | 保存済みポリゴンを DraftShape に変換して編集再開 |

### 切断線（Cut Line）による分割

切断線は**ポリゴンの外側から引き、辺と交差させる**ことで分割を発動する。

#### ヒゲ（端部）の自動除去

ポリゴン境界の外側にある端部（ヒゲ）は、確定時にライブラリが自動的に除去する。

```
描画中:  外側 ─── I1 ─────────── I2 ─── 外側
              ↑ヒゲ    実際の切断線    ヒゲ↑

確定後:           I1 ─────────── I2
```

#### 交差数による挙動の決定ルール

| 交差数 N | 挙動 |
|---------|------|
| 0 | 何もしない |
| 1（奇数） | 頂点挿入 × 1（分割なし） |
| 2（偶数） | 分割 × 1 → ポリゴンが2つになる |
| 2N（偶数） | 分割 × N → ポリゴンが N+1 個になる |
| 2N+1（奇数） | 分割 × N + 頂点挿入 × 1 |

#### splitPolygon

```
splitPolygon(
  polygonId : PolygonID,     // 任意のポリゴン
  draft     : DraftShape     // isClosed = false。ヒゲ込みで渡してよい
) → MapPolygon[]
  // 元の Polygon は削除される
  // 各 Polygon の id は自動生成、display_name は空
```

### 内側ループによる操作

#### carveInnerPolygon（境界頂点からのティアドロップ型ループ）

```
carveInnerPolygon(
  polygonId : PolygonID,     // 任意のポリゴン
  loopPath  : [Point]        // 始点 = 終点 = 境界頂点
) → { outer: Polygon, inner: Polygon }
  // 元の Polygon は削除される
  // outer = 元ポリゴンからループを除いた残り（C字型など）
  // inner = ループ内側の新ポリゴン
```

#### punchHole（純粋内側ループ → ドーナツ＋兄弟）

```
punchHole(
  polygonId : PolygonID,     // 任意のポリゴン
  holePath  : [Point]        // 境界に触れない完全内側の閉じたループ
) → { donut: Polygon, inner: Polygon }
  // 元の Polygon は削除される
  // donut = 元ポリゴンに hole を追加したもの（新 id）
  // inner = 穴を埋める新規ポリゴン（新 id）
```

### 外側描画 → ポリゴン追加

```
expandWithPolygon(
  polygonId  : PolygonID,    // 任意のポリゴン
  outerPath  : [Point],      // 境界上の点A から外側を経由して点B までのパス
  childName  : string
) → { original: Polygon, added: Polygon }
  // 元の Polygon は削除される
  // original = 元ポリゴン（id は新規）
  // added = 外側描画した新ポリゴン
```

### 共有境界の連動編集

```
sharedEdgeMove(
  polygonId : PolygonID,     // 任意のポリゴン
  index     : int,           // 移動する頂点のインデックス
  lat       : float,
  lng       : float
) → Polygon[]  // 更新された全ポリゴン（連動したものを含む）
```

指定ポリゴンの頂点を移動し、**全ポリゴン**から
同座標（epsilon 以内）の頂点を検索して連動更新する。

### 外輪郭キャッシュ（Union Cache）

指定したポリゴン群の外輪郭（union）を計算し、結果をキャッシュする仕組み。
インメモリのみで動作し、StorageAdapter には影響しない。

```
computeUnion(polygonIds: PolygonID[]) → UnionCacheID
  // 指定ポリゴン群の外輪郭（union）を計算し、キャッシュに登録
  // 戻り値の UnionCacheID でキャッシュを参照する

computeUnionFromCaches(cacheIds: UnionCacheID[]) → UnionCacheID
  // 既存キャッシュの結果を組み合わせて外輪郭を算出し、新しいキャッシュとして登録
  // ソースキャッシュが dirty なら先に再計算してから union を算出
  // カスケーディング dirty 伝播: ソースポリゴン変更 → リーフキャッシュ dirty → 親キャッシュも dirty

getCachedUnion(cacheId: UnionCacheID) → GeoJSONPolygon[] | null
  // キャッシュされた union 結果を取得
  // dirty な場合は自動再計算（リーフ: ポリゴンから、複合: 子キャッシュから）
  // 存在しない cacheId の場合は null

deleteCachedUnion(cacheId: UnionCacheID) → void
  // キャッシュを削除（子キャッシュは残る）
```

**設計方針：**

- インメモリのみ（StorageAdapter に影響なし）
- ポリゴン変更・削除時に関連キャッシュを自動 dirty 化
- dirty 伝播はカスケーディング: リーフ → 中間 → トップへと伝播
- `getCachedUnion` 呼び出し時に dirty なら再計算（遅延再計算）
- 多段階の階層に対応（例: リーフ → エリアグループ → 市区全体）
- 純粋関数 `computeUnion` (from `geometry/compute-union`) も別途エクスポートされる（上記 DraftShape 操作テーブル参照）

### Undo / Redo

#### 2つの独立したレイヤー

| レイヤー | 対象 | 典型的な操作 |
|---------|------|------------|
| **ドラフト内 undo** | DraftShape 編集中の点操作 | 描画中に直前の1点を取り消す |
| **コミット済み undo** | 確定した操作全体 | splitPolygon / sharedEdgeMove などを取り消す |

#### HistoryEntry（差分ベース）

```
HistoryEntry {
  createdPolygons : [Polygon]
  deletedPolygons : [Polygon]                          // 完全なスナップショット
  modifiedPolygons: [{ before: Polygon, after: Polygon }]
}
```

#### API

```
undo()     → Promise<void>
redo()     → Promise<void>
canUndo()  → bool
canRedo()  → bool
```

- 最大件数は設定可能（デフォルト: 100 ステップ）
- 履歴はメモリ内のみ保持し、**永続化・セッション跨ぎは行わない**

---

## ストレージ抽象化（Storage Layer）

### StorageAdapter インターフェース

```
interface StorageAdapter {
  loadAll(): Promise<{ polygons: Polygon[], drafts: PersistedDraft[] }>
  batchWrite(changes: ChangeSet): Promise<void>
  saveDraft(draft: PersistedDraft): Promise<void>
  deleteDraft(id: DraftID): Promise<void>
}

ChangeSet {
  createdPolygons  : [Polygon]
  deletedPolygonIds: [PolygonID]
  modifiedPolygons : [Polygon]        // after のみ
}
```

### 設計方針

| 方針 | 内容 |
|------|------|
| **全件インメモリロード** | 起動時に `loadAll()` で全データを取得してメモリに展開 |
| **バッチ書き込み** | 操作ごとに `batchWrite(ChangeSet)` を呼び出す |
| **メモリ内クエリ** | 検索はメモリ内で完結 |
| **楽観的書き込み** | メモリを先に更新し、失敗時はエラーを伝播 |

---

## エラー一覧

| エラー型 | 発生条件 | 主な発生 API |
|---------|---------|------------|
| `NotInitializedError` | `initialize()` 完了前に API を呼んだ | 全 API |
| `DataIntegrityError` | `loadAll()` で読み込んだデータに不整合 | `initialize()` |
| `StorageError` | `batchWrite` / `loadAll` の失敗 | `initialize()`、各編集 API |
| `PolygonNotFoundError` | 指定した PolygonID が存在しない | 参照型 API |
| `DraftNotClosedError` | open DraftShape を Polygon として保存しようとした | `saveAsPolygon`、`updatePolygonGeometry` |
| `InvalidGeometryError` | 自己交差・頂点不足・面積ゼロ | `saveAsPolygon`、`updatePolygonGeometry`、切断系 API |
| `DraftNotFoundError` | `loadDraftFromStorage` で ID が見つからない | `loadDraftFromStorage` |

---

## 未決事項

（現在なし）
