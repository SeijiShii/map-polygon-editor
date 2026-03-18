# ポリゴン編集操作ガイド

このドキュメントは `map-polygon-editor` が提供する全ての編集操作を、
**地図エディタでの実際の操作シーン**に基づいて説明する。

API シグネチャの詳細は [ポリゴン編集 API 仕様](polygon-editing-api.md) を参照。

---

## 全体像: 操作の分類

```
┌─────────────────────────────────────────────────────────┐
│                    ポリゴン編集操作                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  基本操作     │  │  分割・切出  │  │   結合・接続  │  │
│  │              │  │              │  │              │  │
│  │ saveAsPolygon│  │ splitPolygon │  │bridgePolygons│  │
│  │ updateGeo... │  │ carveInner.. │  │resolveOverl..│  │
│  │ rename/delete│  │ punchHole    │  │resolveOver.. │  │
│  │ loadToDraft  │  │ expandWith.. │  │  WithDraft   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │  連動編集     │  │  キャッシュ  │                    │
│  │              │  │              │                    │
│  │sharedEdgeMove│  │ Union Cache  │                    │
│  └──────────────┘  └──────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

---

## どの操作を使えばよいか

### やりたいこと → API の対応表

| やりたいこと | 使う API | 詳細 |
|-------------|---------|------|
| 新しいポリゴンを描いて保存する | `saveAsPolygon` | [API仕様](polygon-editing-api.md#新規描画) |
| ポリゴンを線で二分する | `splitPolygon` | [詳細](split-polygon.md) |
| ポリゴンの内側に小さいポリゴンを切り出す | `carveInnerPolygon` | [詳細](inner-operations.md#carveInnerPolygon) |
| ポリゴンの中に穴を開ける（ドーナツ型） | `punchHole` | [詳細](inner-operations.md#punchHole) |
| ポリゴンの外側に隣接ポリゴンを追加する | `expandWithPolygon` | [詳細](inner-operations.md#expandWithPolygon) |
| 2つのポリゴンの隙間を埋める | `bridgePolygons` | [詳細](bridge-polygons.md) |
| 重複するポリゴンを重複なしに整理する | `resolveOverlaps` | [詳細](resolve-overlaps.md) |
| 描画中のドラフトがポリゴンに交錯した部分を分離する | `resolveOverlapsWithDraft` | [詳細](resolve-overlaps-with-draft.md) |
| 隣接するポリゴンの共有辺を一緒に動かす | `sharedEdgeMove` | [API仕様](polygon-editing-api.md#共有境界の連動編集) |
| 複数ポリゴンの外輪郭を高速に取得する | Union Cache | [詳細](union-cache.md) |

---

## 操作の図解一覧

### 1. splitPolygon — ポリゴンを線で分割する

[詳細ドキュメント →](split-polygon.md)

```
  切断線
    ↓
────╲────────────
│    ╲    B     │
│     ╲        │       1つのポリゴンを
│  A   ╲       │  →    2つ以上に分割
│       ╲      │
│        ╲     │
────────── ╲────
             ╲
```

**使う場面**: 「この道路を境に区画を分けたい」

---

### 2. carveInnerPolygon — 境界から内側をくり抜く

[詳細ドキュメント →](inner-operations.md#carveInnerPolygon)

```
  ┌────────────────┐        ┌────────┐────────┐
  │                │        │        │ inner  │
  │   ●───loop──●  │   →    │ outer  │(新規)  │
  │   │         │  │        │(C字型) │        │
  │   ●─────────●  │        │        │        │
  │       ↑境界頂点 │        └────────┘────────┘
  └────────────────┘
```

**使う場面**: 「ポリゴンの端から一部を切り取って別のポリゴンにしたい」

---

### 3. punchHole — 内側に穴を開ける

[詳細ドキュメント →](inner-operations.md#punchHole)

```
  ┌────────────────┐        ┌────────────────┐
  │                │        │   ┌────────┐   │
  │   ┌────────┐   │        │   │ inner  │   │
  │   │  hole  │   │   →    │   │ (新規) │   │
  │   └────────┘   │        │   └────────┘   │
  │                │        │  donut(穴あき)  │
  └────────────────┘        └────────────────┘
```

**使う場面**: 「公園の中に建物があり、建物部分を別ポリゴンにしたい」

---

### 4. expandWithPolygon — 外側に拡張する

[詳細ドキュメント →](inner-operations.md#expandWithPolygon)

```
              ┌─────┐
              │added│
  ┌───────────┤     │
  │           │(新規)│
  │ original  └─────┘       境界上の2点を起点に
  │                │   →    外側にポリゴンを追加
  │                │
  └────────────────┘
```

**使う場面**: 「既存の区画に隣接する新しい区画を追加したい」

---

### 5. bridgePolygons — 2つのポリゴンの隙間を埋める

[詳細ドキュメント →](bridge-polygons.md)

```
  ┌────┐         ┌────┐       ┌────┐─────────┌────┐
  │    │         │    │       │    │  bridge  │    │
  │ A  │         │ B  │  →    │ A  │ (新規)   │ B  │
  │    │         │    │       │    │          │    │
  └────┘         └────┘       └────┘─────────└────┘
       ╲ ─ ─ ─ ╱
       ユーザが描いた線
```

**使う場面**: 「離れた2つの区画の間を新しいポリゴンで埋めたい」

---

### 6. resolveOverlaps — 重複ポリゴンの整理

[詳細ドキュメント →](resolve-overlaps.md)

```
  ┌──────────┐                ┌──────┬───┬──────┐
  │    A     │                │      │   │      │
  │     ┌────┼────┐      →   │ A残  │ AB│ B残  │
  │     │ 重複│    │          │      │   │      │
  └─────┼────┘    │          └──────┴───┴──────┘
        │    B    │             3つの非重複ポリゴン
        └─────────┘
```

**使う場面**: 「重複して描いてしまった区画を、重複なしに整理したい」

---

### 7. resolveOverlapsWithDraft — ドラフト線による交錯分離

[詳細ドキュメント →](resolve-overlaps-with-draft.md)

```
  P1         P2                      P1   P2
───●───I1────●───I2───●───     →    ──●──  ──●──
       │ created │                 残りドラフト
  ┌────┤         ├────┐          ┌────┬────────┬────┐
  │    │         │    │          │    │created │    │
  │    │         │    │     →    │    │(新規)  │    │
  │    modified       │          │   modified  │    │
  └───────────────────┘          └────┴────────┴────┘
```

**使う場面**: 「描画中の線がポリゴンを横切ったので、交錯部を即座に分離したい」

---

### 8. sharedEdgeMove — 共有辺の連動移動

```
  ┌────┬────┐              ┌────┬──────┐
  │    │    │     頂点Pを  │    │      │
  │ X  P  Y │  →  移動  →  │ X  P'   Y │  X, Y 両方が連動
  │    │    │              │    │      │
  └────┴────┘              └────┴──────┘
```

**使う場面**: 「隣接する2つの区画の境界線を一緒に動かしたい」

---

### 9. Union Cache — 外輪郭の高速計算

[詳細ドキュメント →](union-cache.md)

```
  ┌──┐ ┌──┐ ┌──┐          ┌─────────────┐
  │A │ │B │ │C │    →     │             │
  │  ├─┤  ├─┤  │  union   │  外輪郭     │
  └──┘ └──┘ └──┘          └─────────────┘

  キャッシュ階層:
  A,B → cache1 ─┐
                 ├→ cache3 (全体の外輪郭)
  C   → cache2 ─┘
```

**使う場面**: 「複数の区画をまとめた "地区" の外輪郭を地図に表示したい」

---

## 操作の副作用比較

| API | 元ポリゴン | ID | 新ポリゴン | Undo |
|-----|----------|-----|----------|------|
| `splitPolygon` | **削除** | 全て新規 | 分割ピース群 | 元を復元 |
| `carveInnerPolygon` | **削除** | 全て新規 | outer + inner | 元を復元 |
| `punchHole` | **削除** | 全て新規 | donut + inner | 元を復元 |
| `expandWithPolygon` | **削除** | 全て新規 | original + added | 元を復元 |
| `bridgePolygons` | **不変** | 維持 | bridge のみ追加 | bridge を削除 |
| `resolveOverlaps` | **縮小** | 維持 | 交差領域を追加 | 元を復元 |
| `resolveOverlapsWithDraft` | **縮小** | 維持 | 閉領域を追加 | 元を復元 |
| `sharedEdgeMove` | **変形** | 維持 | なし | 元を復元 |

---

## 関連ドキュメント

- [プロジェクト概要](overview.md) — ライブラリの責務範囲と設計思想
- [データモデル仕様](data-model.md) — Polygon, DraftShape, GeoJSON の型定義
- [ポリゴン編集 API 仕様](polygon-editing-api.md) — 全 API のシグネチャと制約
- [実装進捗](implementation-progress.md) — テスト状況と変更履歴
