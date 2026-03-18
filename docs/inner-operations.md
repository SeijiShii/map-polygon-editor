# 内側ループ操作 — carveInnerPolygon / punchHole / expandWithPolygon

## この機能群が解決する問題

地図上で区画を管理していると、ポリゴンの一部だけを別のポリゴンとして扱いたい場面がある。
3つの操作は、ポリゴンの内側や境界に対して異なるパターンの切り出し・追加を行う。

```
carveInnerPolygon        punchHole            expandWithPolygon
（境界からくり抜き）      （内部に穴を開ける）    （外側に拡張）

┌──────────┐          ┌──────────┐          ┌──────────┐
│    ┌──●  │          │  ┌────┐  │          │          ├──┐
│    │     │    →     │  │    │  │    →     │          │  │
│    └──●  │          │  └────┘  │          │          ├──┘
└──────────┘          └──────────┘          └──────────┘
 境界上の点から          境界に触れない          境界上の2点
 ループを描く            完全内側のループ        から外側へ描く
```

---

## 3つの操作の使い分け

| | `carveInnerPolygon` | `punchHole` | `expandWithPolygon` |
|---|---|---|---|
| **ループの位置** | 境界頂点から始まるループ | 境界に触れない完全内側 | 境界上の2点から外側 |
| **結果** | C字型 outer + inner | 穴あき donut + inner | original + added |
| **使う場面** | 端の一区画を分離 | 中の建物を分離 | 隣に新しい区画を追加 |
| **元ポリゴン** | 削除（新規ID） | 削除（新規ID） | 削除（新規ID） |

---

## <a id="carveInnerPolygon"></a>carveInnerPolygon — 境界からくり抜き

### 想定シーン

「この区画の右端だけを別のポリゴンにしたい」——ポリゴンの境界上の頂点を起点に、
内側にティアドロップ型のループを描いて一部を切り出す。

```
入力:                              結果:
┌────────────────┐                ┌─────────┬──────┐
│                │                │         │      │
│   ●───────●    │                │  outer  │inner │
│   │       │    │          →     │ (C字型) │(新規)│
│   ●───────●    │                │         │      │
│   ↑境界頂点    │                │         │      │
└────────────────┘                └─────────┴──────┘
```

### アプリ側の呼び出しフロー

```typescript
// ユーザが境界上の頂点をタップし、内側にループを描いて同じ頂点に戻った
const loopPath = [
  { lat: 1, lng: 4 },  // 始点 = 境界上の頂点
  { lat: 1, lng: 3 },  // 内側
  { lat: 3, lng: 3 },  // 内側
  { lat: 3, lng: 4 },  // 内側
  { lat: 1, lng: 4 },  // 終点 = 始点と同じ（閉じたループ）
];

const { outer, inner } = await editor.carveInnerPolygon(polygonId, loopPath);
// outer: 元ポリゴンからループ部分を除いた残り（C字型など）
// inner: ループ内側の新ポリゴン
```

### API

```
carveInnerPolygon(
  polygonId : PolygonID,
  loopPath  : Point[]        // 始点 = 終点 = 境界上の頂点
) → Promise<{ outer: MapPolygon, inner: MapPolygon }>
```

- 元のポリゴンは**削除**される
- `loopPath` の始点と終点は同じ境界頂点でなければならない

---

## <a id="punchHole"></a>punchHole — 内部に穴を開ける

### 想定シーン

「公園の中に建物があり、建物の輪郭を別のポリゴンにしたい」——ポリゴンの境界に
一切触れない完全内側のループで穴を開ける。

```
入力:                              結果:
┌────────────────┐                ┌────────────────┐
│                │                │   ┌────────┐   │
│   ┌────────┐   │                │   │ inner  │   │
│   │  hole  │   │          →     │   │ (新規) │   │
│   └────────┘   │                │   └────────┘   │
│                │                │  donut(穴あき)  │
└────────────────┘                └────────────────┘
```

結果は **2つのポリゴン**:
- **donut**: 元ポリゴンに穴（GeoJSON の hole リング）が追加されたもの
- **inner**: 穴の形の新しいポリゴン

これにより、donut と inner は**重複しない**が、donut の穴を inner がぴったり埋める関係になる。

### アプリ側の呼び出しフロー

```typescript
// ユーザがポリゴン内部で閉じたループを描いた
const holePath = [
  { lat: 1, lng: 1 },
  { lat: 1, lng: 3 },
  { lat: 3, lng: 3 },
  { lat: 3, lng: 1 },
  { lat: 1, lng: 1 },  // 閉じたループ
];

const { donut, inner } = await editor.punchHole(polygonId, holePath);
// donut: 穴あきポリゴン（元の外周 + 穴リング）
// inner: 穴を埋める新しいポリゴン
```

### API

```
punchHole(
  polygonId : PolygonID,
  holePath  : Point[]        // 境界に触れない完全内側の閉じたループ
) → Promise<{ donut: MapPolygon, inner: MapPolygon }>
```

- 元のポリゴンは**削除**される
- `holePath` はポリゴンの境界と接触してはならない

---

## <a id="expandWithPolygon"></a>expandWithPolygon — 外側にポリゴンを追加

### 想定シーン

「既存の区画に隣接する新しい区画を追加したい」——ポリゴンの境界上の2点を起点に、
外側にパスを描いて新しいポリゴンを作る。

```
入力:                                    結果:
       A●──── 外側パス ────●B            ┌──────┬─────┐
  ┌────┤                   ├───┐         │      │added│
  │    │                   │   │    →    │ orig │(新規)│
  │    A                   B   │         │      │     │
  │                            │         │      │     │
  └────────────────────────────┘         └──────┴─────┘
  A, B はポリゴン境界上の点
```

### アプリ側の呼び出しフロー

```typescript
// ユーザが境界上の点Aから外側を通って点Bまで線を描いた
const outerPath = [
  { lat: 4, lng: 1 },  // 点A（境界上）
  { lat: 5, lng: 1 },  // 外側
  { lat: 5, lng: 3 },  // 外側
  { lat: 4, lng: 3 },  // 点B（境界上）
];

const { original, added } = await editor.expandWithPolygon(
  polygonId, outerPath, "新しい区画"
);
// original: 元ポリゴン（新規ID）
// added:    外側の新しいポリゴン
```

### API

```
expandWithPolygon(
  polygonId  : PolygonID,
  outerPath  : Point[],      // 境界上の点A → 外側 → 境界上の点B
  childName  : string
) → Promise<{ original: MapPolygon, added: MapPolygon }>
```

- 元のポリゴンは**削除**される（新規 ID で再作成）
- `outerPath` の始点と終点はポリゴンの境界上でなければならない

---

## 共通の制約・注意事項

| 項目 | 内容 |
|------|------|
| **元ポリゴン** | 3操作とも削除される（ID は消滅） |
| **結果ポリゴン** | 全て新規 ID |
| **Undo** | 元ポリゴンを復元し、結果ポリゴンを削除 |
| **coordIndex** | 結果ポリゴンは自動的にインデックスされる |

---

## 関連 API

| API | 関係 |
|-----|------|
| [`splitPolygon`](split-polygon.md) | 外から外への切断線で分割（ループではなく直線） |
| [`bridgePolygons`](bridge-polygons.md) | 2つの既存ポリゴン間を接続（`expandWithPolygon` は1つのポリゴンに追加） |
| [操作ガイド](editing-operations-guide.md) | 全操作の一覧と使い分け |
