# resolveOverlapsWithDraft — ドラフト交錯時のリアルタイム分割

## この機能が解決する問題

地図エディタでユーザがポリライン（ドラフト線）を描画しているとき、
その線が既存のポリゴンを横切ることがある。

```
         ドラフト線
            ↓
    ─ ─ ─ ─╱─ ─ ─ ─ ─
   │       ╱           │
   │      ╱  ここが     │   ← 既存ポリゴン
   │     ╱   閉領域     │
   │    ╱               │
    ─ ─╱─ ─ ─ ─ ─ ─ ─ ─
      ╱
```

このとき、**ドラフト線と既存ポリゴンの辺で囲まれた領域**を
独立したポリゴンとして即座に切り出したい。
ドラフトが確定（`saveAsPolygon`）するのを待たずに、
描画中のタイミングでポリゴン分割を行える。

### `splitPolygon` との違い

| | `splitPolygon` | `resolveOverlapsWithDraft` |
|---|---|---|
| **入力** | ポリゴンを**貫通する**切断線 | ポリゴンを**横切る**ドラフト線 |
| **目的** | 1つのポリゴンを2つ以上に**完全分割** | ドラフト線側の閉領域だけを**切り出す** |
| **元ポリゴン** | **削除**され、全ピースが新規ID | **縮小**されるがID維持 |
| **ドラフトの外側部分** | 使わない（ヒゲとして自動除去） | `remainingDrafts` として返す |
| **典型的な用途** | 「この境界線でポリゴンを二分したい」 | 「描画中の線がポリゴンを横切ったので、交錯部を分離したい」 |

---

## ユースケースとアプリ側の呼び出しフロー

### 想定シーン

ユーザが新しいポリゴンを描画中に、既存ポリゴンの領域内を通過する線を引いた場合。
たとえば道路を挟んで区画を描いているとき、隣の区画に食い込むケース。

### 典型的な呼び出しタイミング

```typescript
// ユーザがドラフトに新しい頂点を追加するたびに
function onDraftPointAdded(editor, draft, targetPolygonId) {
  // 1. ドラフト線が既存ポリゴンと2回以上交差しているか確認
  const allPoints = draft.points;
  if (allPoints.length < 2) return;

  const prev = allPoints[allPoints.length - 2];
  const curr = allPoints[allPoints.length - 1];
  const intersections = editor.findEdgeIntersections(prev, curr);

  if (intersections.length > 0) {
    // 2. 交差が検出されたら分割を実行
    const result = await editor.resolveOverlapsWithDraft(
      targetPolygonId,
      draft,
    );

    // 3. 結果を反映
    // result.created   → 新ポリゴンとして地図に表示
    // result.modified  → 元ポリゴンの更新された形状を地図に反映
    // result.remainingDrafts → ドラフト線を残りの断片で置き換え
  }
}
```

---

## API

```typescript
interface DraftOverlapResult {
  modified: MapPolygon;          // 縮小された元ポリゴン（ID保持）
  created: MapPolygon[];         // ドラフト+ポリゴン辺で囲まれた新ポリゴン群
  remainingDrafts: DraftShape[]; // 閉じなかった残りのドラフト断片
}

async resolveOverlapsWithDraft(
  polygonId: PolygonID,          // 対象の既存ポリゴン
  draft: DraftShape              // isClosed = false（ポリライン）、2点以上
): Promise<DraftOverlapResult>
```

---

## 動作の図解

### 基本ケース: ドラフトがポリゴンを横断

```
入力:
  ポリゴン (ID="area-1")        ドラフト線
  ┌──────────────┐
  │              │              P1
  │              │             ╱
  │    元の      │   I1 ──── ╱  (I1: 左辺との交差点)
  │    領域      │  ╱       ╱
  │              │ ╱       ╱
  │              │╱  閉   ╱
  │              ╳  領域 ╱
  │             ╱│      ╱
  │            ╱ │     ╱
  │           ╱  │  I2╱     (I2: 底辺との交差点)
  └──────────╱───┘──╱──
            ╱      ╱
           P2    P3

出力:
  modified:        ポリゴン "area-1"（閉領域の分だけ縮小、ID維持）
  created:         [閉領域（I1→...→I2 + ポリゴン境界ウォーク I2→I1）]
  remainingDrafts: [P1→I1, I2→P2→P3]  ← ポリゴン外部の断片
```

### 水平ドラフトが矩形を二分

```
  P1                    P2
───●────I1──────────I2────●───   ← ドラフト線
        │  created  │
        │ (面積 8)  │
   ┌────┤           ├────┐
   │    │           │    │
   │    │  modified │    │      ← 元のポリゴン [0,0]-[4,0]-[4,4]-[0,4]
   │    │ (面積 8)  │    │
   └────┴───────────┴────┘

  modified:        下半分（面積8, ID維持）
  created:         [上半分（面積8, 新規ID）]
  remainingDrafts: [P1→I1, I2→P2]
```

---

## アルゴリズム詳細

### 1. 交差点検出

`lineIntersect(polygon, draftLine)` で全交差点を取得し、ドラフト上のパラメータ順でソートする。

### 2. セグメント分類

連続する交差点ペアごとに、ドラフトセグメントがポリゴン内部か外部か判定する。

- **通常ケース**: セグメント中点で `booleanPointInPolygon(mid, polygon, { ignoreBoundary: true })` を使用
- **同一辺上の交差点ペア**: 直線中点が境界上になるため、ドラフト経路上の中間頂点を内部判定に使用

### 3. 閉領域構築

内部セグメントごとに：

```
ドラフト経路:    iPt ──→ (中間頂点) ──→ jPt
                                          │
境界ウォーク:    iPt ←── (ポリゴン頂点) ←─ jPt  (短い方向)
```

1. ドラフト経路（iPt → 中間ドラフト頂点 → jPt）を収集
2. ポリゴン境界を jPt → iPt に向かって歩く（前方/後方の短い方を選択）
3. 合成して CCW 閉リングとし、面積 < 1e-12 はスライバーとして破棄

### 4. 元ポリゴン更新

`polyclip-ts.difference(polygon, closedRegion)` で閉領域を除去。

### 5. 残りドラフト生成

ポリゴン外部のドラフト断片を `DraftShape[]` として収集する。

---

## エッジケースと挙動

| ケース | 挙動 |
|--------|------|
| 交差なし / 交差1点 | 何も変更せず、ドラフト全体を `remainingDrafts` として返す |
| ドラフト全体がポリゴン内部 | 辺との交差なし → 同上 |
| 同一辺への出入り | 底辺から入って底辺から出るケースにも対応 |
| 4交差点（2回横断） | 2つの閉領域を個別に生成 |
| 2N交差点 | N個の閉領域を生成 |
| 微小スライバー | 面積 < 1e-12 で自動破棄 |

---

## 制約・注意事項

| 項目 | 内容 |
|------|------|
| **元ポリゴンの ID** | 維持される（geometry のみ更新） |
| **閉領域ポリゴン** | display_name は空文字、ID は自動生成 |
| **Undo** | 元ポリゴンの geometry を復元し、閉領域ポリゴンを削除 |
| **coordIndex** | 更新されたポリゴンは再インデックスされる |
| **Union Cache** | 対象ポリゴンの関連キャッシュが自動で dirty 化される |

---

## 関連 API

| API | 関係 |
|-----|------|
| [`resolveOverlaps`](polygon-editing-api.md#オーバーラップ解決) | 確定済みポリゴン同士の重複解決（事後的） |
| [`splitPolygon`](polygon-editing-api.md#splitpolygon) | 切断線でポリゴンを完全分割（元ポリゴンは削除） |
| [`findEdgeIntersections`](polygon-editing-api.md#findedgeintersections) | ドラフト線と全ポリゴン辺の交差点検出（本APIの前段で使用） |
