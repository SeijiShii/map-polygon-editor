# ポリゴン・エリアレベル仕様

## 概要

地図上のポリゴンは「エリアレベル」を持つ。エリアレベルとは、そのポリゴンが表す地理的な粒度（広域〜細粒度）を示す概念であり、国・地域によって階層構造が異なる。

---

## エリアレベルの例

### 日本

| key | name | 例 |
|-----|------|----|
| `country` | 国 | 日本 |
| `prefecture` | 都道府県 | 東京都、大阪府 |
| `city` | 市区町村 | 渋谷区、横浜市 |
| `block` | 丁目 | 渋谷一丁目 |

### 米国

| key | name | 例 |
|-----|------|----|
| `country` | Country | United States |
| `state` | State | California |
| `county` | County | Los Angeles County |
| `city` | City | Los Angeles |

---

## データ設計

### AreaLevel（エリアレベル定義）

AreaLevel は**アプリ起動時に設定（config）として渡す静的データ**であり、ストレージへの永続化は行わない。

```
AreaLevel {
  key              : string          // スネークケース・一意識別子（例: "prefecture"）
  name             : string          // 表示名（例: "都道府県"）
  parent_level_key : string | null   // 親レベルの key（最上位レベルは null）
  description?     : string
}
```

- `key` はコード参照・国際化（i18n）用のスネークケース文字列。`Area.level_key` からの参照キーを兼ねる。
- `parent_level_key` によってレベル間の階層構造を木構造で定義する。数値の `rank` は持たない。
- ライブラリ初期化時に、循環参照・存在しない `parent_level_key` がないかを検証する。

#### 線形階層制約

**各レベルは高々1つの子レベルを持つ。**

```
NG: city と ward の両方が parent_level_key: "prefecture" を持つ（同じ親レベルを複数の子レベルが指す）
OK: 各レベルを指す parent_level_key は一意
```

この制約により、あるエリアレベルの「子レベル」は常に一意に決定できる。
`splitAsChildren` / `expandWithChild` / `carveInnerChild` で生成される子エリアの `level_key` は自動推定される（呼び出し元が指定する必要はない）。

`initialize()` 時に同じ `parent_level_key` を持つ AreaLevel が複数存在する場合は `InvalidAreaLevelConfigError` を投げる。

#### 設定例

```
// 日本
[
  { key: "country",    name: "国",      parent_level_key: null },
  { key: "prefecture", name: "都道府県", parent_level_key: "country" },
  { key: "city",       name: "市区町村", parent_level_key: "prefecture" },
  { key: "block",      name: "丁目",    parent_level_key: "city" },
]

// 米国
[
  { key: "country", name: "Country", parent_level_key: null },
  { key: "state",   name: "State",   parent_level_key: "country" },
  { key: "county",  name: "County",  parent_level_key: "state" },
  { key: "city",    name: "City",    parent_level_key: "county" },
]
```

### Area（エリア・ポリゴン実体）

```
Area {
  id            : AreaID            // 一意識別子（自動生成・変更不可）
  display_name  : string            // 表示名（任意・空可）
  level_key     : string            // AreaLevel.key への参照
  parent_id     : AreaID | null     // 親 Area の ID（子から親を参照）
  geometry      : GeoJSON Polygon / MultiPolygon
  metadata?     : { [key: string]: any }
  created_at    : datetime
  updated_at    : datetime
}
```

#### ID の仕様

- 生成時に自動付与されるハッシュ文字列（例：UUID v4）
- **変更不可**。システム全体でエリアを一意に識別する
- 外部データとの連携・インポート時も id は保持される

#### display_name の仕様

- **任意項目**。空でもよい
- ユーザーが自由に編集・変更できる
- 分割・生成直後はデフォルトで空または連番（例：`"エリア-1"`）
- 後からいつでも変更可能

---

## 親子関係

### 基本ルール

- **子から親を参照する**方向を基本とする（`parent_id` を子が持つ）
- 親から子の一覧を取得する場合は `parent_id` を検索する
- 階層は任意の深さを許容する

### レベル整合性制約

**Area の親子関係は AreaLevel の階層と一致しなければならない。**

```
area.level の parent_level_key  ===  parent_area.level_key
```

例：`city` エリアの親は `prefecture` エリアでなければならない。

| エリア | level_key | parent_id | 制約チェック |
|--------|-----------|-----------|-------------|
| 東京都 | `prefecture` | null | `prefecture.parent_level_key = "country"` → ルートでも可（国レベルが存在しない構成も許容） |
| 渋谷区 | `city` | 東京都 | `city.parent_level_key = "prefecture"` = 東京都.level_key ✓ |
| 渋谷一丁目 | `block` | 渋谷区 | `block.parent_level_key = "city"` = 渋谷区.level_key ✓ |

この制約は `saveAsArea` および `reparentArea` の実行時に検証される。
違反した場合は `LevelMismatchError` を投げる。

### 不変条件（Invariant）

**非最下層エリアは、明示的・暗黙的を問わず常に少なくとも1つの子を持つ。**

- 暗黙の子（後述）により、非最下層エリアは明示的な子がなくても最下層まで子を持つ。この性質は自動的に保証される。
- `deleteArea`：明示的な子を持つエリアに対して呼ぶと `AreaHasChildrenError`
  （`cascade: true` を指定した場合は全子孫を再帰削除）
- `reparentArea`：移動によって旧親の明示的子が0件になる場合は `ParentWouldBeEmptyError`

2つの兄弟エリアを1つにまとめたい場合は `mergeArea(areaId, otherAreaId)` を使う。
`mergeArea` は `otherAreaId` を `areaId` に吸収合体させ、子も引き継ぐため不変条件は維持される。

### 例

```
Area { id: "tokyo",    display_name: "東京都",     level_key: "prefecture", parent_id: null }
Area { id: "shibuya",  display_name: "渋谷区",     level_key: "city",       parent_id: "tokyo" }
Area { id: "shibuya1", display_name: "渋谷一丁目", level_key: "block",      parent_id: "shibuya" }
```

### 暗黙の子（Implicit Children）

> **非最下層エリアは、明示的な子を持たない場合でも、最下層まで暗黙の子を持つ。**

暗黙の子とは：
- 親 Area と**同一の geometry**（頂点を独立保持せず、親の頂点を参照する）
- ストレージに別の Area レコードとして保存**されない**（仮想的な存在）
- 「明示的な子が存在しない非最下層エリア」という条件からフラグ管理により導出される

```
例：country → prefecture → city → block の4階層構成

  東京都（prefecture）を新規作成した時点で：
    東京都.暗黙の city 子 × 1（東京都と同形）
      └─ その暗黙 city の暗黙の block 子 × 1（同形）
  → 最下層（block）まで暗黙の子が連鎖する
```

#### 葉ノードの再定義

暗黙の子モデルにより、**「葉ノード」はすべて最下層（AreaLevel の末端レベル）に存在する**。

| 状態 | 定義 |
|------|------|
| **真の葉ノード** | 最下層 AreaLevel のエリア。geometry を直接所有し、直接描画・直接編集が可能 |
| **暗黙の中間ノード** | 非最下層かつ明示的な子を持たないエリア。geometry は最下層暗黙子と同形（頂点共有） |
| **明示的な中間ノード** | 1つ以上の明示的な子 Area を持つエリア。geometry = 子の Union |

最下層エリアには子レベルが存在しないため（`NoChildLevelError`）、
子追加操作は適用できず、常に葉ノードのままである。

#### 最下層エリアは常に単一 Polygon

最下層エリアは直接描画または分割によってのみ生成されるため、
その geometry は常に**単一の `Polygon`** である（`MultiPolygon` は生じない）。

| 生成方法 | geometry |
|---------|---------|
| `saveAsArea`（直接描画） | DraftShape を閉じた単一 Polygon |
| `splitReplace`（切断） | 1 Polygon を切断 → 複数の単一 Polygon |
| `punchHole` | ドーナツ Polygon + 内側 Polygon（ともに単一 Polygon 型） |

`MultiPolygon` は非最下層エリアが飛び地を持つ複数の明示的子を持つ場合のみ、
Union 計算の結果として自動生成される。直接描画では生じない。

---

## 親ポリゴンの形状導出ルール

### 基本原則

> **親エリアのポリゴンは、子エリアポリゴン群の和集合（Union）の外輪郭として定義される。**

親ポリゴンは子から**自動的に導出**されるものであり、独立して定義・編集するものではない。

### 連続エリアの場合（Polygon）

子ポリゴンが互いに隣接・連続している場合、親ポリゴンは単一の `Polygon` になる。

```
子: 渋谷一丁目 ■ 渋谷二丁目 ■ 渋谷三丁目
         ↓ Union
親: 渋谷区 ■■■  （単一 Polygon）
```

### 飛び地がある場合（MultiPolygon）

子ポリゴンが空間的に不連続（飛び地）の場合、親ポリゴンは `MultiPolygon` になる。

```
子: エリアA ■   ■ エリアB（飛び地）
         ↓ Union
親: 親エリア ■   ■  （MultiPolygon）
```

**MultiPolygon は必須要件である。** 以下のような実在ケースが日常的に存在する：

| ケース | 例 |
|--------|----|
| 離島 | 東京都（本土 + 伊豆諸島 + 小笠原諸島） |
| 埋め立て地 | 大阪市此花区（陸地部 + 夢洲・舞洲） |
| 飛び地行政区 | 一部の市町村が他の市町村に囲まれた区域を持つ場合 |

これらは例外的なケースではなく、**地図ライブラリとして当然サポートすべき通常ケース**として扱う。

### geometry フィールドの扱い

| 状況 | geometry の型 | 定義方法 |
|------|--------------|---------|
| 最下層エリア（真の葉ノード） | **Polygon**（単一のみ） | 直接描画・直接編集 |
| 暗黙の中間ノード（非最下層・明示的子なし） | Polygon（最下層暗黙子と同形） | 最下層暗黙子から継承（頂点共有） |
| 明示的な中間ノード（明示的子あり） | Polygon または MultiPolygon | 子 geometry の Union から自動計算 |

### 親 geometry の自動更新

葉ノードまたは中間ノードの geometry が変化する全 API は、**完了と同時に（同期・即時）** ルートまでの全祖先の geometry を再計算して更新する。

```
再計算アルゴリズム（API 完了後に自動実行）：
  1. 変更されたエリアの parent_id を辿る
  2. 直接の親の geometry = Union(getChildren(親.id).map(c => c.geometry))
  3. 更新した親の parent_id を辿り、同様にルートに達するまで繰り返す
```

**採用方針：即時 + 全祖先 + ストレージ保存**

| 方針 | 内容 |
|------|------|
| **即時（同期）** | API 完了時点でメモリ内の全祖先 geometry を更新する。遅延・非同期なし |
| **全祖先** | ルートまで遡って全て再計算する（直接の親のみでは止めない） |
| **ストレージ保存** | 更新された祖先を ChangeSet.modified に含めて `batchWrite` に渡す |

**根拠：**
- 対象規模は最大数千ポリゴン・4〜5階層。Union 計算コストは許容範囲内
- `getArea(parentId)` が常に最新 geometry を返すため、アプリ側に再計算の責務が不要
- `loadAll()` 時にも再計算不要（ストレージから geometry が揃った状態で読み込める）

**更新された祖先の HistoryEntry / ChangeSet への反映：**

```
// 例：丁目（葉）を saveAsArea した場合（市区町村 → 都道府県 → 国 が更新される）

HistoryEntry.modified += [
  { before: city_before,    after: city_after    },
  { before: pref_before,    after: pref_after    },
  { before: country_before, after: country_after },
]

ChangeSet.modified += [city_after, pref_after, country_after]
```

undo 実行時に祖先の geometry も元に戻る。

### 暗黙の子から明示的な子への移行

暗黙の中間ノード（明示的な子を持たない非最下層エリア）に対して初めて子追加操作
（`splitAsChildren` / `expandWithChild`）を行うと、そのエリアは
**明示的な子を持つ中間ノードへ移行**する。

- 元の geometry は**子1として新規 Area に移譲**される（暗黙の単一子が明示的エリアとして具現化）
- 親自身の geometry は以降、明示的子の Union として管理される
- 親エリアの identity（id・display_name・level_key・parent_id 等）はそのまま保たれる

### 境界の共有

隣接する兄弟エリア（同じ親を持つエリア）は**境界線を共有する**。
重複・オーバーラップは許容しない。Union 計算により内部境界は消去される。

#### ドーナツ形エリアと内側エリアの共有境界

一方の兄弟エリアが穴あきポリゴン（ドーナツ形）で、
他方がその穴を埋める内側ポリゴンである場合も、境界線を共有する兄弟として扱う。

```
例：イタリア（ドーナツ）とバチカン市国（内側）
  ┌───────────────────────┐
  │      Italy            │
  │    ┌────────┐         │
  │    │Vatican │  ← 兄弟エリア（Italy の穴 = Vatican の外輪郭）
  │    └────────┘         │
  └───────────────────────┘

Italy.geometry   = Polygon（外輪郭 + 穴リング）
Vatican.geometry = Polygon（外輪郭 = Italy の穴と同一座標）

Union(Italy, Vatican) = 親エリアの geometry ✓
```

- イタリアの穴リング（interior ring）とバチカンの外輪郭は同一座標を共有
- `sharedEdgeMove` によりこの共有境界の連動編集が適用される
- `Union` 計算でイタリアの穴はバチカンで埋まり、内部境界が消去される

---

## エリアレベル設定（config）

AreaLevel は CRUD API を持たず、**アプリ側が起動時に設定として渡す**。

```
MapPolygonEditor(config: {
  storageAdapter : StorageAdapter
  areaLevels     : [AreaLevel]   // 起動時に確定。実行中の追加・変更・削除は不可
  ...
})
```

### AreaLevel クエリ

```
getAllAreaLevels() → [AreaLevel]   // 同期・インメモリ
getAreaLevel(key: string) → AreaLevel | null
```

### 設計方針

- AreaLevel はビジネスロジック（国・サービス種別）によって決まる静的な定義
- 運用中にレベル体系を変えるケースはほぼない（変える場合はアプリの再設定）
- ストレージに永続化しないため、`StorageAdapter` は `Area` データのみを扱う

---

## 未決事項

（現在なし）
