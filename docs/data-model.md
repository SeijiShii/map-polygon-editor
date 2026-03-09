# データモデル仕様

## 概要

ライブラリは2種類のデータを管理する: **Polygon**（ジオメトリを持つ葉ノード）と **Group**（子を束ねる論理コンテナ）。
両者は木構造を形成し、ルートにはどちらも配置できる。

---

## Polygon（ポリゴン）

地図上の1つの閉じた領域を表す。ジオメトリを直接所有する第一級オブジェクト。

```
Polygon {
  id           : PolygonID          // 一意識別子（自動生成・変更不可）
  geometry     : GeoJSON Polygon    // 単一ポリゴン（interior ring によるドーナツ形を含む）
  display_name : string             // 表示名（任意・空可）
  parent_id    : GroupID | null     // 所属グループ（null = ルート）
  metadata?    : { [key: string]: any }
  created_at   : datetime
  updated_at   : datetime
}
```

### ID の仕様

- 生成時に自動付与されるハッシュ文字列（例：UUID v4）
- **変更不可**。システム全体でポリゴンを一意に識別する
- 外部データのインポート時も ID はライブラリが採番する（元データの ID は `metadata` に格納して保持する）

### display_name の仕様

- **任意項目**。空でもよい
- ユーザーが自由に編集・変更できる
- 分割・生成直後はデフォルトで空
- 後からいつでも変更可能

### geometry の仕様

- 型は常に **GeoJSON Polygon**（`MultiPolygon` は使用しない）
- 飛び地は同一グループ内の複数 Polygon で表現する
- ドーナツ形（穴あき）は GeoJSON の interior ring で表現する

---

## Group（グループ）

複数の Polygon やサブ Group をまとめる論理コンテナ。geometry を保存しない。

```
Group {
  id           : GroupID            // 一意識別子（自動生成・変更不可）
  display_name : string             // 表示名（任意・空可）
  parent_id    : GroupID | null     // 親グループ（null = ルート）
  metadata?    : { [key: string]: any }
  created_at   : datetime
  updated_at   : datetime
}
```

### Group の子

Group の子になれるのは **Polygon** または **Group**（サブグループ）。

```
GroupA
  ├── PolygonX
  ├── PolygonY
  └── GroupB（サブグループ）
        ├── PolygonZ1
        └── PolygonZ2
```

### 不変条件

**Group は常に1つ以上の子を持つ。空グループは存在できない。**

- Group の最後の子を削除しようとすると `GroupWouldBeEmptyError`
- Group を作成する API は必ず子と同時に作成する（空の Group を単独作成する API は提供しない）

---

## 木構造

### 基本ルール

- Polygon と Group は**木構造**を形成する
- 各ノード（Polygon / Group）は**1つの親 Group にのみ所属**できる（または null = ルート）
- ルートノードはどちらの型でも配置できる
- 循環参照は許容しない

### ノードの種類

| ノード | geometry | 子を持つか | parent_id |
|--------|----------|-----------|-----------|
| Polygon | GeoJSON Polygon を直接保有 | 持たない（常に葉ノード） | GroupID \| null |
| Group | 保存しない（子から動的に導出可能） | 1つ以上の Polygon / Group | GroupID \| null |

### 例：日本の行政区域（アプリ側の解釈）

```
Group "東京都"                    ← アプリが「都道府県エリア」と解釈
  ├── Group "渋谷区"              ← アプリが「市区町村エリア」と解釈
  │     ├── Polygon "渋谷一丁目"
  │     ├── Polygon "渋谷二丁目"
  │     └── Polygon "渋谷三丁目"
  └── Group "新宿区"
        ├── Polygon "新宿一丁目"
        └── Polygon "新宿二丁目"
```

ライブラリにとっては単なる Group のネストと Polygon の集合であり、
「都道府県」「市区町村」「丁目」という意味付けはアプリ層の責務。

### 例：飛び地

```
Group "○○市"
  ├── Polygon "本土部分"
  └── Polygon "離島部分"     ← 空間的に不連続な2つの Polygon
```

### 例：ドーナツ型

```
Group "欧州エリア"
  ├── Polygon "イタリア"     ← interior ring（穴）を持つドーナツ形ポリゴン
  └── Polygon "バチカン"     ← イタリアの穴を埋めるポリゴン
```

イタリアの穴リング（interior ring）とバチカンの外輪郭は同一座標を共有する。

---

## グループの外周ポリゴン取得

Group は geometry を保存しないが、子ポリゴンから動的に外周を計算して取得できる。

```
getGroupPolygons(groupId: GroupID) → GeoJSON Polygon[]
```

- 子 Polygon を再帰的に収集し、Union を計算して外周ポリゴンのリストを返す
- 飛び地がある場合は複数の Polygon が返る
- ドーナツ形の場合は穴付き Polygon が返る

```
例：飛び地を持つグループ
  Group "○○市"
    ├── Polygon A（本土）
    └── Polygon B（離島）

  getGroupPolygons("○○市") → [Polygon(本土外周), Polygon(離島外周)]
```

---

## 分割とグループ化

### 基本ルール

**1つのポリゴンを分割すると、そのポリゴンは削除され、分割結果のポリゴン群を含む新しいグループに置き換わる。**

### ルートポリゴンの分割

```
分割前:
  Polygon P（ルート）

分割後:
  Group G（新規ルートグループ）
    ├── Polygon P1
    └── Polygon P2
```

### グループ内ポリゴンの分割

```
分割前:
  Group A
    ├── Polygon X   ← 分割対象
    └── Polygon Y

分割後:
  Group A
    ├── Group B（新規サブグループ、Polygon X を置き換え）
    │     ├── Polygon X1
    │     └── Polygon X2
    └── Polygon Y
```

- 元の Polygon X は削除される
- 新しい Group B が Polygon X の位置（同じ parent_id）に挿入される
- Group B の display_name は Polygon X の display_name を引き継ぐ

---

## 共有境界（Shared Edge）

### 概念

同じグループ内の兄弟ポリゴンが共有する境界線上の頂点を移動すると、
**両方のポリゴンが同時に更新される**。

### データ設計方針：重複方式（各ポリゴン独立保持）

各 Polygon は**完全な自己完結型 GeoJSON geometry** を持つ。
共有頂点は各ポリゴンが独立して保持し、「同座標である」という事実によって共有を表現する。

```
// 共有辺 C-D を持つ2ポリゴン
Polygon1.geometry.coordinates = [[A, B, C, D, A]]   // C と D を独自に保持
Polygon2.geometry.coordinates = [[D, C, E, F, D]]   // C と D を独自に保持（逆順）
```

### 連動対象の範囲

| ケース | 連動するポリゴン |
|--------|----------------|
| 通常の隣接境界 | 同じ `parent_id` を持つ兄弟ポリゴン |
| ドーナツ＋内側（バチカン型） | 同じ `parent_id` を持つ兄弟ポリゴン（穴リングも検索対象） |
| 3ポリゴンが1点で接する角 | 同じ `parent_id` を持つ全兄弟ポリゴン |

**検索は同一グループ内の兄弟に限定する。**

### 共有頂点の判定

2頂点が同座標（epsilon 以内）にある場合、共有頂点とみなす。
epsilon は設定可能とする（デフォルト: 1e-8 度 ≒ 1mm 精度）。

---

## ワインディング方向（Winding Order）

| 方向 | 意味 |
|------|------|
| 反時計回り（CCW） | **外輪郭の標準**。GeoJSON RFC 7946 準拠 |
| 時計回り（CW） | 穴（ホール）の標準 |

ライブラリは内部で方向を正規化し、ユーザーがどちら向きに頂点を入力しても正しく処理する。

---

## 未決事項

（現在なし）
