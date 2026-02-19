# ポリゴン編集 API 仕様

## 初期化

```
MapPolygonEditor(config: {
  storageAdapter : StorageAdapter
  areaLevels     : [AreaLevel]   // エリアレベル定義（静的設定）
  maxUndoSteps?  : number        // デフォルト: 100
  epsilon?       : number        // デフォルト: 1e-8（共有頂点判定の許容誤差、単位：度）
})

initialize(): Promise<void>
```

`initialize()` を呼ぶと以下を実行する：

1. `areaLevels` の整合性を検証（循環参照・存在しない `parent_level_key` がないか）
2. `storageAdapter.loadAll()` を呼び出し、全 Area をメモリに展開する

失敗した場合は例外を投げる（アプリ側でエラーハンドリングが必要）。

`initialize()` 完了前にクエリ・編集 API を呼び出した場合は例外（`NotInitializedError`）を投げる。

---

## 操作フロー

### ユースケース例：ある市全体を網羅するポリゴンを作る

```
1. 編集モードを開始
2. 地図上でタップ/クリック → 頂点（ポイント）を追加していく
3. 市の境界線に沿って頂点を拾い続ける
4. 終点を始点に接続 → ポリゴンを「閉じる」
5. エリアとして保存
```

---

## 基本概念

### 開いた形状と閉じた形状

| 状態 | 名称 | 説明 |
|------|------|------|
| 開いている（Open） | ポリライン | 始点と終点が未接続。面積を持たない |
| 閉じている（Closed） | ポリゴン | 始点と終点が接続。面積を持つ |

編集中は Open 状態（ポリライン）として頂点を追加していき、完成時に Close する。

### ワインディング方向（Winding Order）

| 方向 | 意味 |
|------|------|
| 反時計回り（CCW） | **外輪郭の標準**。GeoJSON RFC 7946 準拠 |
| 時計回り（CW） | 穴（ホール）の標準 |

> ライブラリは内部で方向を正規化し、ユーザーがどちら向きに頂点を入力しても正しく処理する。

---

## 編集中の形状（Draft Shape）

保存前の編集中状態を表すオブジェクト。`Area` とは別に管理する。

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
| `true` | 閉じたポリゴン → エリアとして保存 | `saveAsArea()` | DraftShape を Area に変換して保存 |
| `false` | 切断線 → 既存ポリゴンを分割 | `splitAsChildren()` / `splitReplace()` | ヒゲを自動除去してから分割実行 |

DraftShape はいずれかの確定 API を呼ぶまで**インメモリのみ**に存在する。
確定後は破棄される（ライブラリは保持しない）。

### validateDraft

`saveAsArea` / `updateAreaGeometry` と同じ検証ロジックを、例外を投げずに返す。
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

- `isClosed = false`（切断線）には面積・自己交差の概念がないためチェックしない
- `saveAsArea` / `updateAreaGeometry` の内部でも同じチェックが走る（二重実装なし）

### スナッピング（吸着）について

スナッピング（近接する頂点・辺への自動吸着）は**ライブラリの責務外**とする。

- 吸着範囲はマップのズームレベルに依存するため、ライブラリ側では判断できない
- アプリ側が `addPoint` / `movePoint` を呼ぶ前に座標を補正する形で実装する

```
// アプリ側の実装例
const snapped = snapToNearestVertex(rawLat, rawLng, zoomLevel, nearbyAreas)
draft.addPoint(snapped.lat, snapped.lng)
```

---

## API 一覧

### DraftShape 操作

| メソッド | 引数 | 説明 |
|----------|------|------|
| `createDraft()` | - | 空の編集中形状を生成 |
| `addPoint(lat, lng)` | 座標 | 末尾に頂点を追加 |
| `insertPoint(index, lat, lng)` | 挿入位置、座標 | 任意位置に頂点を挿入 |
| `movePoint(index, lat, lng)` | 頂点番号、新座標 | 頂点を移動 |
| `removePoint(index)` | 頂点番号 | 頂点を削除 |
| `close()` | - | ポリゴンを閉じる（始点と終点を接続） |
| `open()` | - | ポリゴンを開く（ポリライン状態に戻す） |
| `isClosed()` | - | 閉じているか確認 |
| `reverse()` | - | 頂点の順序を逆転（ワインディング方向を反転） |
| `normalize()` | - | ワインディング方向を GeoJSON 標準に正規化 |
| `toGeoJSON()` | - | GeoJSON Polygon / LineString に変換 |
| `validateDraft(draft)` | DraftShape | geometry を検証し、違反リストを返す（空 = 有効） |
| `undo()` | - | 直前の操作を取り消す |
| `redo()` | - | 取り消した操作をやり直す |

### クエリ（全てインメモリ・同期）

| メソッド | 引数 | 戻り値 | 説明 |
|----------|------|--------|------|
| `getArea(id)` | AreaID | `Area \| null` | ID で Area を取得 |
| `getChildren(parentId)` | AreaID | `[Area]` | 直接の子 Area を全て取得 |
| `getRoots()` | — | `[Area]` | `parent_id` が null の Area を全て取得 |
| `getAllAreas()` | — | `[Area]` | 全 Area を取得 |
| `getAreasByLevel(levelId)` | LevelID | `[Area]` | 指定レベルの Area を全て取得 |
| `getAllAreaLevels()` | — | `[AreaLevel]` | 全 AreaLevel を取得 |

### エリア保存・削除・移動

| メソッド | 引数 | 説明 |
|----------|------|------|
| `saveAsArea(draft, name, levelKey, parentId?)` | DraftShape、名称、レベルキー、親ID | DraftShape を Area として保存。レベル整合性を検証 |
| `bulkCreate(items)` | `[AreaInput]` | 複数の Area を一括作成。外部データのインポートに使用 |
| `updateAreaGeometry(areaId, draft)` | エリアID、DraftShape | 既存エリアの geometry を更新。明示的な子を持つエリアには適用不可（`AreaHasChildrenError`） |
| `deleteArea(areaId, options?)` | エリアID、`{ cascade?: bool }` | エリアを削除。`cascade: false`（デフォルト）は子を持つ場合 `AreaHasChildrenError`。`cascade: true` は子孫を再帰削除 |
| `reparentArea(areaId, newParentId?)` | エリアID、新しい親ID（null = ルート化） | `parent_id` を変更する。レベル整合性を検証 |
| `mergeArea(areaId, otherAreaId)` | 残すエリアID、吸収されるエリアID | 2つの兄弟エリアを1つに合体。`otherAreaId` の子を引き継ぎ削除 |

#### bulkCreate の挙動

外部データ（GeoJSON 等）のインポートに使用する。`saveAsArea` が DraftShape 経由の1件保存であるのに対し、
`bulkCreate` は geometry を直接受け取り、複数 Area を一括作成する。

```
AreaInput {
  display_name : string
  level_key    : string
  parent_id    : AreaID | null
  geometry     : GeoJSON Polygon または MultiPolygon
  metadata?    : { [key: string]: any }
}

bulkCreate(items: [AreaInput]) → [Area]
  // 返り値は入力と同じ順序。各 Area の id は自動生成
```

**検証（全 items に対して実行）：**

```
- level_key が areaLevels に存在するか          → AreaLevelNotFoundError
- parent_id が存在するか（null でない場合）      → AreaNotFoundError
- area の level と parent の level が一致するか  → LevelMismatchError
- geometry が有効か（自己交差・頂点数・面積）    → InvalidGeometryError
```

1件でもエラーがあればバッチ全体を中止する（部分適用なし）。

**処理後の親 geometry 自動更新：**

全 items 登録後、影響を受けた全祖先の geometry を再計算する（通常操作と同じ）。
インポートした Area が非最下層の場合、子データのインポート後に上書きされることに注意。

**HistoryEntry / ChangeSet：**

```
HistoryEntry : { created: [全Area], deleted: [], modified: [全祖先 {before, after}] }
ChangeSet    : { created: [全Area], deleted: [], modified: [全祖先（after）] }
```

バッチ全体が1つの HistoryEntry になる（`undo` で一括取り消し可能）。

**典型的な階層インポートフロー（国土数値情報 N03 の例）：**

```
// Step 1: 都道府県レベルを先にインポート
const prefs = editor.bulkCreate(
  prefData.map(p => ({ display_name: p.name, level_key: "prefecture", parent_id: null, geometry: p.geometry }))
)

// Step 2: 都道府県名→ID のマッピングを構築
const prefMap = Object.fromEntries(prefs.map(p => [p.display_name, p.id]))

// Step 3: 市区町村レベルをインポート（parent_id に都道府県 ID を指定）
editor.bulkCreate(
  features.map(f => ({
    display_name : f.properties.N03_004,
    level_key    : "city",
    parent_id    : prefMap[f.properties.N03_001],
    geometry     : f.geometry
  }))
)
// → 各都道府県の geometry が子 city の Union として自動再計算される
```

#### deleteArea の挙動

```
deleteArea(
  areaId   : AreaID,
  options? : { cascade?: bool }   // デフォルト: { cascade: false }
) → void
```

| オプション | 子を持つ場合 | 子を持たない場合 |
|-----------|------------|----------------|
| `cascade: false`（デフォルト） | `AreaHasChildrenError` | 削除 |
| `cascade: true` | 全子孫を再帰削除してから削除 | 削除 |

**HistoryEntry / ChangeSet（cascade: false、葉エリアのみ）：**

```
HistoryEntry : { created: [], deleted: [area（スナップショット）], modified: [祖先 {before,after} × N] }
ChangeSet    : { created: [], deleted: [areaId], modified: [全祖先（after）] }
```

**HistoryEntry / ChangeSet（cascade: true）：**

```
HistoryEntry : {
  created  : [],
  deleted  : [area（スナップショット）, 全子孫（スナップショット）×N],
  modified : [祖先 {before, after} × N]   // 親・祖先の geometry 再計算
}
ChangeSet : {
  created  : [],
  deleted  : [areaId, 全子孫のID × N],
  modified : [全祖先（after）]
}
```

undo 実行時は削除された全エリア（`HistoryEntry.deleted`）が一括で復元される。

#### reparentArea の挙動

```
reparentArea(
  areaId      : AreaID,
  newParentId : AreaID | null  // null = ルートエリアにする
) → Area
```

**検証ルール：**

```
// newParentId が指定された場合
areaId の level の parent_level_key  ===  newParent の level_key  →  LevelMismatchError

// newParentId が null の場合
areaId の level の parent_level_key  ===  null  →  LevelMismatchError（最上位レベルのみルート化可）

// 旧親が子なしになる場合
旧親の level_key に対する子レベルが存在する  →  ParentWouldBeEmptyError
// 2つの兄弟エリアを1つにまとめたい場合は mergeArea を使う
```

**HistoryEntry / ChangeSet：**

```
HistoryEntry : { created: [], deleted: [], modified: [{ before: area（旧parent_id）, after: area（新parent_id）}] }
ChangeSet    : { created: [], deleted: [], modified: [area（after）] }
```

旧親・新親の geometry キャッシュはともに再計算される。

#### mergeArea の挙動

```
mergeArea(
  areaId      : AreaID,   // 残るエリア（geometry を吸収する側）
  otherAreaId : AreaID    // 削除されるエリア
) → Area
```

**制約：**
- 両エリアは同じ `parent_id` を持つ（兄弟エリア）
- 両エリアは同じ `level_key` を持つ

**結果：**
- `areaId`.geometry = Union(areaId.geometry, otherAreaId.geometry)
- `otherAreaId` の全ての子エリアは `areaId` の子に再配置される（parent_id を更新）
- `otherAreaId` は削除される

**親・祖先の geometry は変化しない：**

```
// マージ前: 親.geometry = Union(areaId, otherAreaId, 他の兄弟...)
// マージ後: 親.geometry = Union(areaId_new, 他の兄弟...) = 同じ
// areaId_new.geometry = areaId_old.geometry ∪ otherAreaId.geometry であるため
```

∴ mergeArea は祖先 geometry の再計算を引き起こさない。

**HistoryEntry / ChangeSet：**

```
HistoryEntry : {
  created  : [],
  deleted  : [otherArea（スナップショット）],
  modified : [
    { before: areaId_before, after: areaId_after（合体後geometry） },
    // 再配置された子 × N: { before: child（parent_id=otherId）, after: child（parent_id=areaId）}
    // 祖先のgeometry変化なし → 含めない
  ]
}

ChangeSet : {
  created  : [],
  deleted  : [otherAreaId],
  modified : [areaId（after）, 再配置された各子（after）]  // 祖先は含めない
}
```

### エリア読み込み（編集再開）

| メソッド | 引数 | 説明 |
|----------|------|------|
| `loadAreaToDraft(areaId)` | エリアID | 保存済み Area を DraftShape に変換して編集再開 |

#### loadAreaToDraft の適用可否

`loadAreaToDraft` は**直接編集可能なエリア**（明示的な子を持たないエリア）にのみ適用できる。

| エリアの状態 | 適用可否 | 備考 |
|------------|---------|------|
| 最下層エリア（真の葉ノード） | ✅ 可 | geometry を直接所有。常に単一 Polygon |
| 暗黙の中間ノード（非最下層・明示的子なし） | ✅ 可 | geometry = 最下層暗黙子と同形。常に単一 Polygon |
| 明示的な中間ノード（明示的子あり） | ❌ `AreaHasChildrenError` | geometry は子の Union として自動計算。直接編集不可 |

暗黙の中間ノードは最下層エリアと同一の geometry を持ち、常に単一の `Polygon` であるため、
`DraftShape` への変換で `MultiPolygon` の問題は生じない。

### 表示名の編集

| メソッド | 引数 | 説明 |
|----------|------|------|
| `renameArea(areaId, displayName)` | エリアID、新しい表示名 | display_name を変更する。id は変わらない |

---

## 切断線（Cut Line）による操作

切断線は**ポリゴンの外側から引き、辺と交差させる**ことで操作を発動する。
交差点では辺上に新しい頂点が自動挿入される。

### ヒゲ（端部）の自動除去

ユーザーはポリゴンの外側から描画を始め、外側で描画を終えることができる。
ポリゴン境界の外側にある端部（ヒゲ）は、確定時にライブラリが自動的に除去する。

```
描画中:  外側 ─── I1 ─────────── I2 ─── 外側
              ↑ヒゲ    実際の切断線    ヒゲ↑

確定後:           I1 ─────────── I2
                  （ヒゲは破棄される）
```

- I1, I2 はポリゴン境界との交差点（辺上に自動挿入）
- ヒゲは DraftShape の `points` に含まれていてよい
- 確定 API（`splitAsChildren` / `splitReplace`）呼び出し時に除去が行われる

### 交差数による挙動の決定ルール

切断線とポリゴン境界の交差点数（N）によって挙動が決まる：

| 交差数 N | 挙動 |
|---------|------|
| 0 | 何もしない（ポリゴンと交差しない） |
| 1（奇数） | 頂点挿入 × 1（分割なし） |
| 2（偶数） | 分割 × 1 → ポリゴンが2つになる |
| 3（奇数） | 分割 × 1 + 頂点挿入 × 1 |
| 4（偶数） | 分割 × 2 → ポリゴンが3つになる |
| 2N（偶数） | 分割 × N → ポリゴンが N+1 個になる |
| 2N+1（奇数） | 分割 × N + 頂点挿入 × 1（最後の交差点） |

**原則：交差は「入る・出る」のペアで1分割を発生させる。端数（奇数交差の最後）は頂点挿入になる。**

```
交差点:   I1    I2    I3    I4    I5（奇数=5の例）
           ↓     ↓     ↓     ↓     ↓
処理:    [入り]–分割–[出]  [入り]–分割–[出]  [入り]→頂点挿入
```

### 操作パターン 1：1辺との交差 → 頂点挿入（N=1）

切断線がポリゴンの**1辺だけと交差**する場合、その交差点に頂点を挿入する（分割なし）。

```
before:  ─────────────
         辺 Va──────Vb
                ↑
         切断線が1辺に交差

after:   辺 Va──I──Vb   ← I が新規挿入された頂点
```

---

### 操作パターン 2：2辺を通過 → ポリゴン分割（N=偶数）

切断線がポリゴンの**外から入って、内部を通り、別の辺から外に出る**場合、
ポリゴンを分割する。

```
N=2（単純分割）:
  ┌──────────┐
  │          │
  │  ────────┼──  ← 切断線
  │          │
  └──────────┘
  → 2つのポリゴンに分割

N=4（凹型ポリゴンへの分割）:
  ■■■   ■■■
  ■■■   ■■■   ← 切断線（水平）が4辺と交差
  ■■■■■■■■■
  → 3つのポリゴンに分割
```

分割の挙動は**対象エリアの種別**によって異なる：

#### 2-A：親エリアを分割 → 子エリアを2つ作成

親エリアポリゴンに対して切断を実行した場合：
- **親ポリゴンは保持される**（形状・データ変更なし）
- **子ポリゴンが2つ新規生成**される
- 子の Union = 親

```
before:
  親 ■■■■■■

after:
  親 ■■■■■■  （保持）
  子1 ■■■      （新規）
  子2    ■■■   （新規）
```

```
splitAsChildren(
  parentAreaId : AreaID,
  draft        : DraftShape   // isClosed = false。ヒゲ込みで渡してよい
) → [Area]   // 生成された子エリアのリスト（2個以上）
              // 各 Area の id は自動生成、display_name は空
              // level_key は parentAreaId の子レベルから自動推定
              // 子レベルが存在しない場合は NoChildLevelError
              //
              // 対象が「暗黙の中間ノード」の場合：
              //   暗黙の単一子が初めて明示的な2子に分割される（暗黙→明示への移行）
```

#### 2-B：直接編集可能なエリアを分割 → 元エリアを置き換え

明示的な子を持たないエリア（最下層エリア・暗黙の中間ノード）を分割した場合：
- **元のポリゴンは削除される**
- **2つの新ポリゴンが生成**され、元の `parent_id` を引き継ぐ

```
before:
  子A ■■■■■■

after:
  子A （削除）
  子A-1 ■■■   （新規・同じ parent_id）
  子A-2    ■■■ （新規・同じ parent_id）
```

```
splitReplace(
  areaId  : AreaID,
  draft   : DraftShape   // isClosed = false。ヒゲ込みで渡してよい
) → [Area]   // 生成されたエリアのリスト（元エリアは削除済み）
              // 各 Area の id は自動生成、display_name は空
```

---

### 3分割以上への拡張

分割操作を繰り返すことで子を増やせる。

```
初回：親 → 子1 + 子2
2回目：子1.splitReplace() → 子1a + 子1b
結果：子1a ∪ 子1b ∪ 子2 = 親
```

---

## 操作パターン 3：頂点起点のループ描画 → 内側子ポリゴン生成

### 広幅の幹を持つ「6」字型（特殊ケースではない）

幹に幅がある「6」字は、始点 V と終点 V'（互いに異なる境界上の2点）を持つ。
これは **通常の2交差分割（操作パターン2）と同じ操作**であり、特殊扱い不要。
切断ラインがたまたまループ形状を含んでいるだけ。

```
V と V' は異なる境界点 → splitAsChildren / splitReplace（N=2）として処理
```

### ティアドロップ型・ゼロ幅ループ（真の特殊ケース）

始点と終点が**同じ境界頂点 V**に戻るケースのみ、特殊操作 `carveInnerChild` となる。

```
   V  ← 始点かつ終点（同一点）
  ╱ ╲
 │ 新子│   ← ループ内側が子ポリゴン
  ╲ ╱
```

| 形状 | 始点 | 終点 | 操作 |
|------|------|------|------|
| 幅あり「6」 | V | V'（別の境界点） | `splitAsChildren` / `splitReplace` |
| ティアドロップ | V | **V（同じ境界点）** | `carveInnerChild`（特殊） |
| 純粋内側ループ | 境界に触れない | 境界に触れない | `punchHole`（特殊） |

### `carveInnerChild` の挙動

- 外側子と内側子は **V の1点のみで接する**（タッチングポリゴン）
- `Union` の計算上は面積として成立する
- 頂点連動編集（sharedEdgeMove）は接続点 V にも適用される

```
carveInnerChild(
  parentAreaId : AreaID,
  loopPath     : [Point]  // 始点 = 終点 = V（親境界頂点）となる閉じた点列
) → { outer: Area, inner: Area }
  // outer = 親からループを除いた残り（C字型など）
  // inner = ループ内側の新子
  // 両者の parent_id = parentAreaId、outer ∪ inner = 親
  // level_key は parentAreaId の子レベルから自動推定
  // 子レベルが存在しない場合は NoChildLevelError
```

### 純粋内側ループ → ドーナツ＋兄弟（バチカン型）

境界に一切触れない完全内側のループを描いた場合、
対象エリアは**ドーナツ形（穴あき）** と**内側エリア**の2つの兄弟に置き換えられる。

```
before:
  エリアA ■■■■■
          ■■■■■
          ■■■■■

after:
  エリアA' ■■■■■   ← ドーナツ形（GeoJSON interior ring で穴を表現）
           ■□□□■
           ■■■■■
  エリアB    □□□    ← 穴を埋める内側エリア（兄弟）
```

**バチカン市国とイタリアの関係**がこの構造に相当する。
- イタリア（ドーナツ）とバチカン（内側）は同レベルの兄弟エリア
- `Union(イタリア, バチカン)` = 親エリアの形状 ✓

#### データ表現

```
// ドーナツエリアの geometry（GeoJSON）
{
  "type": "Polygon",
  "coordinates": [
    [[外輪郭（CCW）]],   // エリアの外境界
    [[穴の輪郭（CW）]]   // 内側エリアと共有する境界
  ]
}

// 内側エリアの geometry（GeoJSON）
{
  "type": "Polygon",
  "coordinates": [
    [[外輪郭（CCW）]]    // ドーナツの穴と同一座標
  ]
}
```

- ドーナツの穴リングと内側エリアの外輪郭は**同一座標を共有**する
- `sharedEdgeMove` によりこの共有境界の連動編集が適用される

#### API

```
punchHole(
  areaId   : AreaID,
  holePath : [Point]  // 境界に触れない完全内側の閉じたループ
) → { donut: Area, inner: Area }
  // donut = 元エリアにholeを追加したもの（id は元エリアを引き継ぐ）
  // inner = 穴を埋める新規エリア（新 id、同じ parent_id）
  // donut ∪ inner = 元エリアの geometry ✓
```

---

## 操作パターン 4：外側描画 → 子追加 + 親拡張

分割（内側）の逆方向操作。親の境界から**外側に向かって描画**し、
親の別の境界点に戻ってくることで、新エリアを子として追加しつつ親を拡張する。

### 操作フロー

```
1. 親ポリゴンの頂点または辺上の点 A を起点として選択
2. 親ポリゴンの外側に向かって頂点を追加していく
3. 親ポリゴンの別の頂点または辺上の点 B に戻ってくる
4. 確定 → 子ポリゴン生成 + 親ポリゴン拡張
```

### 結果

```
before:
  ┌──────────┐
  │          │
  │  親      │  A・B は親の境界上の点
  │          │
  └──────────┘
        A  B

after:
  ┌──────────┬──────┐
  │          │ 子   │  ← 外側に描画した範囲が子ポリゴン
  │  親(拡張)│      │
  │          │      │
  └──────────┴──────┘
             A  B
```

- 新しい子ポリゴン = 外側描画パス（A→外部点列→B）+ 親境界（B→A）で囲まれた面積
- 親ポリゴン = 旧親 ∪ 新子（拡張される）
- **親保持の原則**に従い、親の形状は更新されるが親エリアの identity は保たれる

### 暗黙の子のみを持つ親への適用

親が暗黙の子のみを持つ状態（明示的な子を持たない非最下層エリア）の場合、`expandWithChild` は以下のように動作する：

```
before:
  親 ■■■■■■  （子なし・葉ノード）

after:
  親 ■■■■■■┬──────┐  （子2つを持つ中間ノードに昇格）
  子1 ■■■■■■│      │  ← 元の親の geometry がそのまま子1になる
  子2        │ ■■■■ │  ← 外側描画した新エリアが子2
             └──────┘
```

- **元の親の geometry → 子1** として新規 Area を生成（同じ `parent_id`）
- **外側描画の新エリア → 子2** として新規 Area を生成
- **親** は葉ノードから中間ノードに昇格し、geometry = 子1 ∪ 子2 に更新される

これにより「親 geometry = 全子の Union」という不変条件が常に保たれる。

### API

```
expandWithChild(
  parentAreaId : AreaID,
  outerPath    : [Point],  // 親境界上の点A から外側を経由して点B までのパス
  childName    : string
) → { parent: Area, child: Area }
  // 更新された親 + 新規子
  // child の level_key は parentAreaId の子レベルから自動推定
  // 子レベルが存在しない場合は NoChildLevelError
```

### 内側分割との対称性

| 操作 | 描画方向 | 親/元エリア | 生成されるエリア |
|------|---------|------------|----------------|
| `splitAsChildren` | 内側（2点貫通） | 形状変わらず保持 | 子2つ（面積を2分割） |
| `carveInnerChild` | 内側（境界頂点ループ） | 形状変わらず保持 | 子2つ（C字 + ティアドロップ、タッチング） |
| `punchHole` | 内側（純粋内側ループ） | ドーナツ形に変形（id 維持） | 兄弟1つ（穴を埋める内側エリア） |
| `expandWithChild` | 外側 | 面積が拡張される | 兄弟1つ（新外側面積） |

---

## 共有境界（Shared Edge）の連動編集

### 概念

隣接する兄弟エリアが共有する境界線上の頂点を移動すると、
**両方のポリゴンが同時に更新される**。

```
子1: A → B → C → D → A  （CCW）
              ↑ 共有頂点
子2: B → E → F → C → B  （CCW）
```

頂点 C を移動 → 子1・子2 両方の C が同座標に更新される。

### データ設計方針：重複方式（各ポリゴン独立保持）

各 Area は**完全な自己完結型 GeoJSON geometry** を持つ。
共有頂点は各ポリゴンが独立して保持し、「同座標である」という事実によって共有を表現する。

```
// 共有辺 C-D を持つ2ポリゴン
子1.geometry.coordinates = [[A, B, C, D, A]]   // C と D を独自に保持
子2.geometry.coordinates = [[D, C, E, F, D]]   // C と D を独自に保持（逆順）

// 向きの逆転は各ポリゴンの巡回順（CCW）に自然に現れる
// 子1では B→C→D、子2では D→C→E と逆順になる
```

**この方式を選択した理由：**
- GeoJSON をそのまま格納でき、インポート/エクスポートが変換なしに行える
- 実装がシンプル（DCEL等のトポロジモデルは不要）
- API 経由でのみ geometry を変更する原則を守れば整合性は保たれる

> **原則：geometry を直接書き換えない。全ての編集を API 経由で行う。**

### `sharedEdgeMove` の動作

```
sharedEdgeMove(
  areaId  : AreaID,
  index   : int,    // 移動する頂点のインデックス（areaId のポリゴン内）
  lat     : float,
  lng     : float
) → [Area]  // 更新された全エリア（連動したエリアを含む）
```

**処理フロー：**

```
1. areaId の頂点[index] の現在座標 P を取得
2. areaId と同じ parent_id を持つ兄弟エリアを列挙
3. 各兄弟の全頂点（exterior ring + interior rings）から
   P と epsilon 以内の座標を持つ頂点を収集
4. 対象頂点全てを新座標 (lat, lng) に更新
5. 更新された全エリアを返す
```

### 共有頂点の判定

2頂点が同座標（epsilon 以内）にある場合、共有頂点とみなす。
epsilon は設定可能とする（デフォルト: 1e-8 度 ≒ 1mm 精度）。

### 連動対象の範囲

| ケース | 連動するエリア |
|--------|-------------|
| 通常の隣接境界 | 同じ `parent_id` を持つ兄弟エリア |
| ドーナツ＋内側（バチカン型） | 同じ `parent_id` を持つ兄弟エリア（穴リングも検索対象） |
| タッチングポリゴン（`carveInnerChild`） | 同じ `parent_id` を持つ兄弟エリア（接続点 V を含む） |
| 3エリアが1点で接する角 | 同じ `parent_id` を持つ全兄弟エリア |

**検索は `parent_id` が同じ兄弟に限定する。** 階層をまたいで伝播させると、
上位の親 geometry キャッシュ再計算とは別問題になるため、
頂点連動は同一親のスコープで完結させる。

---

## 頂点操作の詳細

### addPoint の挙動

- 末尾（終点の直前）に追加する
- ポリゴンが Closed の場合も末尾頂点として追加し、閉じた状態を維持する

### 辺の中間点（ミッドポイント）

UI 上では各辺の中間にゴーストポイントを表示し、ドラッグすることで新しい頂点を挿入できる。
これは `insertPoint` に相当する。

### 最小頂点数

| 状態 | 最小頂点数 |
|------|-----------|
| ポリライン（Open） | 2点 |
| ポリゴン（Closed） | 3点（三角形） |

---

## Undo / Redo

### 2つの独立したレイヤー

| レイヤー | 対象 | 典型的な操作 |
|---------|------|------------|
| **ドラフト内 undo** | DraftShape 編集中の点操作 | 描画中に直前の1点を取り消す |
| **コミット済み undo** | 確定した Area 操作全体 | splitAsChildren / sharedEdgeMove などを取り消す |

### レイヤー1：ドラフト内 undo

DraftShape は独自の undo スタックを持ち、コミット済みの履歴とは独立して管理する。

```
undoPoint(draft: DraftShape) → DraftShape  // 最後に追加した点を削除
redoPoint(draft: DraftShape) → DraftShape  // undoPoint で消した点を復元
```

### レイヤー2：コミット済み undo

#### HistoryEntry（差分ベース）

各 API 呼び出しは完了時に HistoryEntry を生成してスタックに積む。

```
HistoryEntry {
  created  : [Area]                            // 新規作成された Area
  deleted  : [Area]                            // 削除された Area（完全なスナップショット）
  modified : [{ before: Area, after: Area }]   // 変更された Area
}
```

#### 各操作の HistoryEntry

geometry が変化する操作では、**更新された全祖先の `{before, after}`** が `modified` に自動追加される。

| 操作 | created | deleted | modified（直接操作対象） | 自動追加（祖先） |
|------|---------|---------|------------------------|----------------|
| `saveAsArea` | [新Area] | — | — | 全祖先 |
| `splitAsChildren(parent, cut)` | [子1, 子2] | — | — | 全祖先（parentより上） |
| `splitReplace(area, cut)` | [新1, 新2] | [元area] | — | 全祖先 |
| `carveInnerChild(parent, loop)` | [outer, inner] | — | — | 全祖先（parentより上） |
| `punchHole(area, hole)` | [inner] | — | [{before:area, after:donut}] | 全祖先 |
| `expandWithChild(parent, path)` | [child] | — | [{before:parent, after:拡張parent}] | 全祖先（parentより上） |
| `sharedEdgeMove(area, i, …)` | — | — | [影響を受けた全兄弟Area] | 全祖先 |
| `renameArea(area, name)` | — | — | [{before, after}] | なし（geometry 変化なし） |
| `updateAreaGeometry(area, draft)` | — | — | [{before, after}] | 全祖先 |
| `deleteArea(areaId)` | — | [area] | — | 全祖先 |
| `deleteArea(areaId, {cascade:true})` | — | [area＋全子孫] | — | 全祖先 |
| `reparentArea(areaId, newParentId?)` | — | — | [{before, after}] | 旧親・新親の全祖先 |
| `mergeArea(areaId, otherAreaId)` | — | [otherArea] | [{before:areaId, after:merged}, 再配置された子×N] | なし（Union 保存） |

#### Undo / Redo スタック

```
UndoStack : [HistoryEntry]  // 最新が末尾
RedoStack : [HistoryEntry]

undo():
  entry = UndoStack.pop()
  entry.created  を全削除
  entry.deleted  を全復元
  entry.modified の before を全適用
  RedoStack.push(entry)
  → 変更された全 Area を返す（UI 再描画用）

redo():
  entry = RedoStack.pop()
  entry.created  を全復元
  entry.deleted  を全削除
  entry.modified の after を全適用
  UndoStack.push(entry)
  → 変更された全 Area を返す

新規操作実行時: RedoStack をクリア
```

#### API

```
undo()     → [Area]   // 変更された全エリア
redo()     → [Area]   // 変更された全エリア
canUndo()  → bool
canRedo()  → bool
```

#### 履歴の保持

- 最大件数は設定可能（デフォルト: 100 ステップ）
- 履歴はメモリ内のみ保持し、**永続化・セッション跨ぎは行わない**
- アプリ再起動・ページリロード後は履歴がリセットされる

---

## ストレージ抽象化（Storage Layer）

データの永続化・読み込みはライブラリ内に実装せず、**外部の `StorageAdapter` に委譲する**。
ライブラリはインメモリで全データを保持し、変更発生時に `StorageAdapter` を呼び出す。

### 設計方針

| 方針 | 内容 |
|------|------|
| **全件インメモリロード** | 起動時に `loadAll()` で全 Area・AreaLevel を取得してメモリに展開する |
| **バッチ書き込み** | 操作ごとに `batchWrite(ChangeSet)` を呼び出す（1操作 = 1回の呼び出し） |
| **メモリ内クエリ** | `findByParentId` 等の検索はメモリ内で完結。ストレージへのクエリは不要 |
| **楽観的書き込み** | メモリを先に更新し、`batchWrite` 失敗時はエラーを呼び出し元に伝播する |

**全件インメモリロード採用の根拠：** 対象規模は最大数千ポリゴン。この規模ではインメモリロードが
パフォーマンス上問題なく、実装をシンプルに保てる。

### StorageAdapter インターフェース

AreaLevel は静的な config としてアプリ側が管理するため、StorageAdapter は **Area データのみを扱う**。

```
interface StorageAdapter {
  loadAll(): Promise<{ areas: Area[] }>
  batchWrite(changes: ChangeSet): Promise<void>
}

ChangeSet {
  created  : [Area]       // 新規作成された Area
  deleted  : [AreaID]     // 削除された Area の ID のみ
  modified : [Area]       // 変更後の Area（after のみ、before は含まない）
}
```

#### HistoryEntry との違い

| フィールド | HistoryEntry（undo 用） | ChangeSet（storage 用） |
|-----------|------------------------|------------------------|
| `deleted` | `[Area]`（完全スナップショット） | `[AreaID]`（ID のみ） |
| `modified` | `[{ before, after }]` | `[Area]`（after のみ） |

ストレージ側は before を必要としないため、転送データ量を最小化する。

### 楽観的書き込み失敗時の動作

```
1. API 操作（例：splitAsChildren）をメモリに適用
2. HistoryEntry を UndoStack に積む
3. batchWrite(ChangeSet) を非同期で呼び出す
4. 成功 → 何もしない
5. 失敗 → エラーを呼び出し元に伝播する
           ライブラリ内メモリは更新済みのまま（自動ロールバックなし）
           呼び出し元が必要に応じて undo() を呼ぶ選択肢を持つ
```

**ロールバックを自動化しない理由：**
- undo() は HistoryEntry ベースで整合性を保つ既存の仕組みを再利用できる
- 自動ロールバック実装はエラーケースの複雑さを倍増させる
- 呼び出し元（アプリ側）が UI フロー込みで対処方針を決定するほうが適切

### ChangeSet の組み立て

各 API は HistoryEntry と同時に ChangeSet も組み立て、`batchWrite` に渡す。
geometry が変化する操作では、**更新された全祖先** が `ChangeSet.modified` に自動追加される。

| 操作 | ChangeSet.created | ChangeSet.deleted | ChangeSet.modified（直接＋祖先） |
|------|-----------------|-----------------|--------------------------------|
| `saveAsArea` | [新Area] | — | [全祖先（after）] |
| `splitAsChildren(parent, cut)` | [子1, 子2] | — | [parentより上の全祖先（after）] |
| `splitReplace(area, cut)` | [新1, 新2] | [元area.id] | [全祖先（after）] |
| `carveInnerChild(parent, loop)` | [outer, inner] | — | [parentより上の全祖先（after）] |
| `punchHole(area, hole)` | [inner] | — | [donut（after）＋全祖先（after）] |
| `expandWithChild(parent, path)` | [child] | — | [拡張parent（after）＋parentより上の全祖先（after）] |
| `sharedEdgeMove(area, i, …)` | — | — | [影響を受けた全兄弟Area（after）＋全祖先（after）] |
| `renameArea(area, name)` | — | — | [area（after）] ※祖先更新なし |
| `updateAreaGeometry(area, draft)` | — | — | [area（after）＋全祖先（after）] |
| `deleteArea(areaId)` | — | [areaId] | [全祖先（after）] |
| `deleteArea(areaId, {cascade:true})` | — | [areaId＋全子孫ID] | [全祖先（after）] |
| `reparentArea(areaId, newParentId?)` | — | — | [area（after）＋旧親・新親の全祖先（after）] |
| `mergeArea(areaId, otherAreaId)` | — | [otherAreaId] | [areaId（after）＋再配置された各子（after）] ※祖先更新なし |

---

## エラー一覧

### エラー型カタログ

| エラー型 | 発生条件 | 主な発生 API |
|---------|---------|------------|
| `NotInitializedError` | `initialize()` 完了前に API を呼んだ | 全 API |
| `InvalidAreaLevelConfigError` | `areaLevels` に循環参照・重複 key・存在しない `parent_level_key` がある | `initialize()` |
| `DataIntegrityError` | `loadAll()` で読み込んだ Area に不整合がある（詳細は下記） | `initialize()` |
| `StorageError` | `batchWrite` / `loadAll` の呼び出しが失敗した | `initialize()`、各編集 API |
| `AreaNotFoundError` | 指定した `AreaID` が存在しない | 参照型 API 全般 |
| `AreaLevelNotFoundError` | 指定した `level_key` が `areaLevels` に存在しない | `saveAsArea` |
| `LevelMismatchError` | Area の level と親 Area の level の関係が `AreaLevel` 定義と不一致 | `saveAsArea`、`reparentArea`、`mergeArea` |
| `AreaHasChildrenError` | 明示的な子を持つ Area を削除または直接編集しようとした | `deleteArea`、`loadAreaToDraft`、`updateAreaGeometry` |
| `ParentWouldBeEmptyError` | `reparentArea` の結果、旧親の子が 0 件になる | `reparentArea` |
| `CircularReferenceError` | `reparentArea` の結果、Area が自身の子孫を親に持つ循環が生じる | `reparentArea` |
| `DraftNotClosedError` | `isClosed = false` の `DraftShape` を Area として保存しようとした | `saveAsArea`、`updateAreaGeometry` |
| `InvalidGeometryError` | 自己交差・頂点数不足（3点未満）・面積ゼロなどの不正 geometry | `saveAsArea`、`updateAreaGeometry`、切断系 API |
| `NoChildLevelError` | 操作対象エリアのレベルに子レベルが定義されていない（葉レベルへの子生成操作） | `splitAsChildren`、`expandWithChild`、`carveInnerChild` |

### 各エラーの詳細

#### `InvalidAreaLevelConfigError`

`initialize()` 時に `areaLevels` を検証し、以下のいずれかに該当する場合に投げる：

```
- key が重複している
- parent_level_key が存在しない key を指している
- parent_level_key の参照を辿ると循環する（例: A→B→A）
- 同じ parent_level_key を持つ AreaLevel が2つ以上存在する（線形階層制約違反）
```

#### `DataIntegrityError`

`initialize()` 時に `loadAll()` で取得した Area を検証し、以下のいずれかに該当する場合に投げる：

```
- area.parent_id が指定されているが、その AreaID が存在しない
- area.level_key が areaLevels に存在しない
- area と parent の level_key が AreaLevel の親子関係と一致しない
  （area.level.parent_level_key !== parent.level_key）
```

ストレージ側のデータが壊れている場合はアプリ側でリカバリを行う。ライブラリは自動修復しない。

#### `LevelMismatchError`

以下の状況で投げる：

```
// saveAsArea: parentId 指定あり
area.level.parent_level_key  !=  parent.level_key

// saveAsArea: parentId = null（ルートエリアとして作成）
area.level.parent_level_key  !=  null

// reparentArea: newParentId 指定あり
area.level.parent_level_key  !=  newParent.level_key

// reparentArea: newParentId = null（ルートエリアに昇格）
area.level.parent_level_key  !=  null

// mergeArea: 2エリアの level_key が異なる
areaId.level_key  !=  otherAreaId.level_key
```

#### `CircularReferenceError`

`reparentArea(areaId, newParentId)` 実行時に `newParentId` が `areaId` の子孫である場合に投げる。

```
// 例：A → B → C という親子関係のとき
reparentArea(A, C)  →  CircularReferenceError
// C を A の親にすると A→C→...→A という循環が生じる
```

#### `InvalidGeometryError`

以下を不正 geometry と判定する：

```
- 頂点数が 3 未満（isClosed = true の場合）
- 自己交差している（辺が他の辺と交差する）
- 面積がゼロ（すべての頂点が1直線上にある）
```

> 切断系 API（`splitAsChildren`、`splitReplace` など）で切断線がポリゴンと交差しない場合は
> エラーを投げず、変更なしの状態を返す（no-op）。

### クエリ API の「見つからない」挙動

編集 API（書き込み系）と異なり、クエリ API は `null` / 空配列を返す：

| メソッド | 対象未存在時の戻り値 |
|---------|------------------|
| `getArea(id)` | `null` |
| `getChildren(parentId)` | `[]`（空配列） |
| `getAreasByLevel(levelKey)` | `[]`（空配列） |
| `getAllAreaLevels()` | `[]`（ areaLevels が空の場合） |
| `getAreaLevel(key)` | `null` |

---

## 未決事項

（現在なし）
