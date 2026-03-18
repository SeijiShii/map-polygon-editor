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
| `false` | ブリッジ失敗時の保存 | `bridgePolygons()` | 共有辺なしの場合、ドラフトとして自動保存 |

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

スナップ判定のしきい値はズームレベルに依存するため、**スナップするかどうかの判定はアプリ側の責務**とする。
ライブラリは「何にスナップすべきか」を検索するクエリ API を提供する（→ [スナップ補助クエリ](#スナップ補助クエリ)）。

典型的なアプリ側のフロー：

```
// 1. スナップ半径をズームレベルから計算（アプリ側）
const snapRadius = pixelToDegreesAtZoom(20, zoomLevel);

// 2. ライブラリに最近傍頂点を問い合わせ
const nearest = editor.findNearestVertex(tapPoint, snapRadius);
const snappedPoint = nearest ?? tapPoint;

// 3. 前の頂点との間に交差点があれば自動挿入
if (draft.points.length > 0) {
  const prev = draft.points[draft.points.length - 1];
  const intersections = editor.findEdgeIntersections(prev, snappedPoint);
  for (const ip of intersections) {
    draft = addPoint(draft, ip);
  }
}
draft = addPoint(draft, snappedPoint);
```

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
| `bridgePolygons` | 任意の2つの Polygon。元ポリゴンは変更されない |
| `sharedEdgeMove` | 任意の Polygon。影響は全ポリゴンに及ぶ |
| `resolveOverlaps` | 2つ以上の Polygon。元ポリゴンは縮小（ID維持）、交差部は新規 |
| `resolveOverlapsWithDraft` | 任意の Polygon + 未確定ドラフト。交錯部を閉領域として切り出し |
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

全ポリゴン検索の効率化のため、ライブラリ内部で2種類の座標ハッシュインデックスを保持する。

**ポリゴン頂点インデックス（coordIndex）：**

- `initialize()` 時に全頂点から構築（O(全頂点数)）
- `sharedEdgeMove` 時の共有頂点検索は O(1)（ハッシュルックアップ）
- ポリゴンの追加・削除・更新時に増分更新

**ドラフト端点インデックス（draftEndpointIndex）：**

- `initialize()` 時に全ドラフトの始点・終点から構築
- `saveDraftToStorage` / `deleteDraftFromStorage` で増分更新
- `bridgePolygons` の閉回路検出で使用
- 量子化グリッドは coordIndex と同一（epsilon = 1e-8 度）

対象規模（数千ポリゴン × 数十頂点 + 数十ドラフト）では十分な性能。

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
| `findNearestVertex(point, radius)` | Point, number（度） | `Point \| null` | 半径内の最近傍ポリゴン頂点を返す |
| `findEdgeIntersections(p1, p2)` | Point, Point | `Point[]` | セグメントと全ポリゴン辺の交差点を p1 からの距離順で返す |

### スナップ補助クエリ

下書き線の描画中に既存ポリゴンの頂点・辺との関係を検索する。
副作用なし（ポリゴンやドラフトを変更しない）。

#### findNearestVertex

```
findNearestVertex(
  point  : Point,    // 検索中心座標
  radius : number    // 検索半径（度単位）
) → Point | null
```

全ポリゴンの全頂点を走査し、`radius` 内で最も近い頂点を返す。
該当なしの場合は `null`。距離は度単位の二乗距離で比較する（`Math.sqrt` 不要）。

- `radius` はアプリ側がズームレベルに応じて算出する
- 閉リングの重複頂点（先頭 = 末尾）も走査対象だが、結果に影響しない
- 複数ポリゴンにまたがるグローバル検索

#### findEdgeIntersections

```
findEdgeIntersections(
  p1 : Point,    // セグメント始点
  p2 : Point     // セグメント終点
) → Point[]
```

セグメント `p1→p2` と全ポリゴンの全辺の交差点を検出し、`p1` からの距離が近い順に返す。
交差なしの場合は空配列。内部では `@turf/line-intersect` を使用（`splitPolygon` と同じ）。

- 下書き線に新しい頂点を追加する直前に、前の頂点との間でこの API を呼び出し、
  返された交差点を先に `addPoint` することで辺との交差点を自動挿入できる
- 複数ポリゴンの辺と交差する場合も全て返す

### Polygon 保存・編集

| メソッド | 引数 | 説明 |
|----------|------|------|
| `saveAsPolygon(draft, name)` | DraftShape、名称 | DraftShape をルートポリゴンとして保存 |
| `updatePolygonGeometry(polygonId, draft)` | PolygonID、DraftShape | 既存ポリゴンの geometry を更新 |
| `renamePolygon(polygonId, name)` | PolygonID、新しい名前 | display_name を変更 |
| `deletePolygon(polygonId)` | PolygonID | Polygon を削除 |
| `loadPolygonToDraft(polygonId)` | PolygonID | 保存済みポリゴンを DraftShape に変換して編集再開 |

### 切断線（Cut Line）による分割

> 詳細な図解・ユースケースは [splitPolygon 詳細ドキュメント](split-polygon.md) を参照。

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

> 詳細な図解・ユースケース・3操作の使い分けは [内側ループ操作 詳細ドキュメント](inner-operations.md) を参照。

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

### 2ポリゴン間ブリッジ → 隙間ポリゴン生成

> 詳細な図解・ユースケース・3段階判定の説明は [bridgePolygons 詳細ドキュメント](bridge-polygons.md) を参照。

2つの既存ポリゴンの頂点間にポリラインを描画し、
共有辺または既存ドラフトを介して閉じたポリゴンを自動生成する。

```
BridgeResult =
  | { ok: true,  polygon: Polygon }       // ポリゴン生成成功
  | { ok: false, draft:   PersistedDraft } // 閉じられず → ドラフト保存

bridgePolygons(
  polygonAId   : PolygonID,   // 開始側ポリゴン
  aVertexIndex : int,         // A 上の開始頂点インデックス
  polygonBId   : PolygonID,   // 着地側ポリゴン
  bVertexIndex : int,         // B 上の着地頂点インデックス
  bridgePath   : [Point],     // a1 → 外部 → b1 のポリライン
  name         : string       // 新ポリゴンの名称
) → BridgeResult
  // 元の Polygon A, B は変更しない（新ポリゴンのみ追加）
```

#### 3段階の判定フロー

`bridgePolygons` は以下の順序で判定し、最初に成功した段階で結果を返す。

| 段階 | 条件 | 結果 |
|------|------|------|
| **1. 直接ブリッジ** | A と B が共有辺を持つ | ブリッジパス + 共有辺 + 各ポリゴン境界 → 新ポリゴン |
| **2. 閉回路検出** | 既存ドラフト + ポリゴン境界で閉ループが成立 | 新線 + ドラフト群 + ポリゴン境界群 → 新ポリゴン + 消費ドラフト削除 |
| **3. ドラフト保存** | 閉じられない | ブリッジパスを `PersistedDraft` として保存 |

---

#### 段階1: 直接ブリッジ（共有辺あり）

A と B の外周リングから共有頂点（epsilon 以内）を検出し、共有辺セグメント（SharedRun）を構築する。

**アルゴリズム:**

1. **共有頂点検出** — A と B の全頂点を O(N×M) で比較し、epsilon 以内のペアを列挙
2. **共有ラン構築** — 連続する共有頂点をグループ化（隣接ポリゴンは逆方向走査に対応）
3. **ラン選択** — 複数の共有ランが存在する場合、ブリッジパス中点に最も近いランを選択
4. **リング組み立て** — ブリッジパス + B 境界ウォーク + 共有辺パス + A 境界ウォーク
5. **正規化** — CCW ワインディングに正規化し、閉じた GeoJSON リングとして出力

**境界ウォーク:**
ポリゴンの外周リング上で2頂点間を歩く際、前方（インデックス増加）と後方（インデックス減少）のうち
中間頂点数が少ない方を選択する。

**具体例:**

```
A = [0,0]-[1,0]-[1,1]-[0,1]  （単位正方形）
B = [1,0]-[2,0]-[2,1]-[1,1]  （隣の正方形、辺 [1,0]-[1,1] を共有）

ブリッジ: A[3]=[0,1] → [0,2] → [2,2] → B[2]=[2,1]

結果: [0,1]-[0,2]-[2,2]-[2,1]-[1,1]-[0,1]
      （ブリッジ + B境界 + 共有辺 + A境界 で閉合）
```

---

#### 段階2: 閉回路検出（ドラフト経由）

A と B が共有辺を持たない場合、既存の PersistedDraft とポリゴン境界を介して
間接的に閉じたループが形成されるかどうかを検査する。

**接続グラフモデル:**

| 要素 | グラフ上の表現 |
|------|--------------|
| ドラフト端点の座標 | ノード（量子化キーで識別） |
| ドラフト（始点↔終点） | ドラフトエッジ |
| 同一ポリゴン上にある2ノード | ポリゴンエッジ（境界ウォークで接続） |
| 新しいブリッジパスの両端点 | 追加ノード（検索の始点・終点） |

**アルゴリズム:**

1. **グラフ構築** — 全ドラフトの端点 + 新線の端点をノードとして登録し、
   ドラフトエッジとポリゴンエッジを生成
2. **BFS** — 新線の端点 Y（開始側）から端点 X（着地側）への最短経路を探索
3. **リング組み立て** — 新線 + 経路上のドラフト点列 + ポリゴン境界ウォークを順に接続
4. **消費ドラフト削除** — ループに含まれたドラフトをストレージから自動削除

**ドラフト端点インデックス:**

閉回路検出のため、ライブラリ内部でドラフト端点の空間インデックスを保持する。
ポリゴンの `coordIndex` と同じ量子化グリッド（epsilon = 1e-8 度）を使用する。

- `initialize()` 時に全ドラフトから構築
- `saveDraftToStorage()` / `deleteDraftFromStorage()` で増分更新
- ドラフト端点がポリゴン頂点と同じグリッドキーに該当するかで接続判定

**具体例:**

```
ポリゴン A, B, C が互いに隣接していないケース：

1回目: bridgePolygons(A, a1, B, b1, path1, "D1")
       → A-B 共有辺なし → ドラフト D1 保存
       → { ok: false, draft: D1 }

2回目: bridgePolygons(B, b2, C, c1, path2, "D2")
       → B-C 共有辺なし → ドラフト D2 保存
       → { ok: false, draft: D2 }

3回目: bridgePolygons(C, c2, A, a3, path3, "Loop")
       → C-A 共有辺なし → 閉回路検出を実行
       → グラフ: c2 -(polyC)- c1 -(D2)- b2 -(polyB)- b1 -(D1)- a1 -(polyA)- a3
       → BFS で c2 → a3 の経路発見
       → リング組み立て: path3 + A境界 + D1 + B境界 + D2 + C境界
       → D1, D2 削除
       → { ok: true, polygon: Loop }
```

---

#### 段階3: ドラフト保存

共有辺もなく閉回路も検出されなかった場合、ブリッジパスを
`PersistedDraft`（`isClosed: false`）としてストレージに保存する。
以降の `bridgePolygons` 呼び出しで閉回路検出の入力データとして使用される。

---

#### 副作用・制約・注意事項

| 項目 | 内容 |
|------|------|
| **元ポリゴンの不変性** | A, B は一切変更されない（`expandWithPolygon` と異なる） |
| **coordIndex 登録** | 新ポリゴンの頂点は `coordIndex` に登録され、`sharedEdgeMove` で連動する |
| **ドラフト消費** | 閉回路検出で使用されたドラフトは `draftStore` と `storageAdapter` の両方から削除される |
| **Undo** | 新ポリゴンのみ削除される。消費済みドラフトの復元は Undo 対象外 |
| **同一ポリゴン端点** | 新線の両端が同一ポリゴン上の場合、`expandWithPolygon` 等を使用すること |
| **自己ループドラフト** | 始点 = 終点のドラフトは閉回路検出グラフから除外される |
| **複数ループ** | BFS で最短（エッジ数最小）のループが選択される |
| **ワインディング** | 結果リングは CCW に正規化される |

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

### オーバーラップ解決

> 詳細な図解・ユースケースは [resolveOverlaps 詳細ドキュメント](resolve-overlaps.md) を参照。

重複する複数のポリゴンを、非重複な複数のポリゴンに分解する。

```
resolveOverlaps(
  polygonIds : PolygonID[]   // 2つ以上のポリゴンID
) → Promise<{
  modified : MapPolygon[],   // 縮小された元ポリゴン（ID保持）
  created  : MapPolygon[],   // 新規作成された交差領域ポリゴン
}>
```

**動作:**

1. 各ポリゴンの排他領域（他のポリゴンと重複しない部分）を計算し、元ポリゴンの geometry を更新（ID 維持）
2. 全ての交差領域（2つ以上のポリゴンが重複する部分）を新規ポリゴンとして生成

**例: 2ポリゴンの場合**

```
入力: A（面積4）, B（面積4）, 重複領域（面積2）

結果:
  modified: [A-only（面積2, ID=A）, B-only（面積2, ID=B）]
  created:  [交差部（面積2, 新規ID）]
```

**N ポリゴン対応:**

3つ以上のポリゴンにも対応する。べき集合分解により、全ての重複パターン（ペア、トリプル…）を正確に分離する。
実用上は 2〜5 ポリゴンを想定。

**重複なしの場合:**

ポリゴン間に重複がなければ `{ modified: [], created: [] }` を返し、何も変更しない。

**制約・注意事項:**

| 項目 | 内容 |
|------|------|
| **元ポリゴンの ID** | 維持される（geometry のみ更新） |
| **交差ポリゴン** | display_name は空文字、ID は自動生成 |
| **微小スライバー** | 面積が極小（< 1e-12）の結果は自動破棄 |
| **Undo** | 元ポリゴンの geometry を復元し、交差ポリゴンを削除 |
| **coordIndex** | 更新されたポリゴンは再インデックスされる |

### ドラフトとのオーバーラップ解決

> 詳細な図解・ユースケースは [resolveOverlapsWithDraft 詳細ドキュメント](resolve-overlaps-with-draft.md) を参照。

描画中のドラフト線（未確定ポリライン）が既存ポリゴンと交錯した場合に、
交差部分を個別のポリゴンとして切り出し、残りをドラフト断片として返す。

```
DraftOverlapResult {
  modified        : MapPolygon,     // 縮小された元ポリゴン（ID保持）
  created         : MapPolygon[],   // ドラフト+ポリゴン辺で囲まれた新ポリゴン群
  remainingDrafts : DraftShape[],   // 閉じなかった残りのドラフト断片
}

resolveOverlapsWithDraft(
  polygonId : PolygonID,
  draft     : DraftShape       // isClosed = false（ポリライン）、2点以上
) → Promise<DraftOverlapResult>
```

**動作:**

1. ドラフト線と対象ポリゴンの全辺の交差点を検出し、ドラフト上のパラメータ順でソートする
2. 連続する交差点ペアごとに、ドラフトセグメントがポリゴン内部にあるか判定する
3. 内部セグメントに対して、ドラフト経路 + ポリゴン境界ウォーク（短い方向）で閉じたリングを構築し、新ポリゴンとして生成する
4. 元ポリゴンから生成した閉領域を polyclip-ts の difference で除去し、geometry を更新する（ID 維持）
5. ポリゴン外部のドラフト断片を `DraftShape[]` として返す

**例: 水平ドラフトが矩形ポリゴンを横断**

```
入力:
  polygon: [0,0]-[4,0]-[4,4]-[0,4]（面積16）
  draft:   (-1,2) → (5,2)  ← 左辺と右辺で交差

結果:
  modified:        元ポリゴンの上半分または下半分（面積8, ID維持）
  created:         [もう片方の半分（面積8, 新規ID）]
  remainingDrafts: [(-1,2)→(0,2), (4,2)→(5,2)]  ← 外側の断片2本
```

**交差なし・交差点不足の場合:**

交差点が2個未満の場合は何も変更せず、ドラフト全体を `remainingDrafts` として返す。

**制約・注意事項:**

| 項目 | 内容 |
|------|------|
| **元ポリゴンの ID** | 維持される（geometry のみ更新） |
| **閉領域ポリゴン** | display_name は空文字、ID は自動生成 |
| **微小スライバー** | 面積が極小（< 1e-12）の結果は自動破棄 |
| **Undo** | 元ポリゴンの geometry を復元し、閉領域ポリゴンを削除 |
| **coordIndex** | 更新されたポリゴンは再インデックスされる |
| **同一辺上の2交差点** | ドラフトが同じ辺から出入りするケースにも対応 |
| **複数回横断** | 4交差点なら2閉領域、2N交差点ならN閉領域を生成 |

### 外輪郭キャッシュ（Union Cache）

> 詳細な図解・ユースケース・階層キャッシュの説明は [Union Cache 詳細ドキュメント](union-cache.md) を参照。

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
- 多段階の階層に対応（例: リーフ → 区キャッシュ → 市区全体）
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
| `NoSharedEdgeError` | 2ポリゴンが共有頂点を持たない | `bridgePolygons`（内部使用、外部にはドラフトとして返す） |

---

## 未決事項

（現在なし）
