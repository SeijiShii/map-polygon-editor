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

**一度でも子を持ったエリア（中間ノード）は、子を0件にできない。**

- `deleteArea`：子を持つエリアに対して呼ぶと `AreaHasChildrenError`
- `reparentArea`：移動によって旧親の子が0件になる場合は `ParentWouldBeEmptyError`

2つの兄弟エリアを1つにまとめたい場合は `mergeArea(areaId, otherAreaId)` を使う。
`mergeArea` は `otherAreaId` を `areaId` に吸収合体させ、子も引き継ぐため不変条件は維持される。

### 例

```
Area { id: "tokyo",    display_name: "東京都",     level_key: "prefecture", parent_id: null }
Area { id: "shibuya",  display_name: "渋谷区",     level_key: "city",       parent_id: "tokyo" }
Area { id: "shibuya1", display_name: "渋谷一丁目", level_key: "block",      parent_id: "shibuya" }
```

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
| 葉ノード（子を持たないエリア） | Polygon または MultiPolygon | 直接定義・直接編集 |
| 中間ノード（子を持つエリア） | Polygon または MultiPolygon | 子 geometry の Union から自動計算 |
| ルートノード（国など） | 同上 | 同上 |

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

### 葉ノードから中間ノードへの昇格

子を持たない葉ノードに初めて子追加操作（`splitAsChildren` / `expandWithChild`）を行うと、
そのノードは**中間ノードに昇格**する。

- 元の geometry は**子1として新規 Area に移譲**される
- 親自身の geometry は以降、子の Union として管理される
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

- [ ] 既存の行政区画データ（GeoJSON）のインポート仕様
