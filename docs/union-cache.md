# Union Cache — 外輪郭の高速計算とキャッシュ

## この機能が解決する問題

地図上で複数のポリゴン（区画）をまとめて「地区」や「エリア」として表示したいとき、
それらのポリゴンの**外輪郭（union）**を計算する必要がある。

```
  個々の区画:                 外輪郭:
  ┌──┐ ┌──┐ ┌──┐            ┌─────────────┐
  │A │ │B │ │C │     →      │             │
  │  ├─┤  ├─┤  │   union    │  外輪郭     │
  └──┘ └──┘ └──┘            └─────────────┘
```

union 計算はコストが高い。ポリゴンが変更されるたびに毎回再計算すると遅い。
Union Cache は計算結果をキャッシュし、変更があったポリゴンに関連する
キャッシュだけを無効化して遅延再計算する。

---

## ユースケース

### 階層的な外輪郭表示

```
  アプリ側のデータ構造:               Union Cache の構成:

  市全体                              cache3 (市全体の外輪郭)
   ├── 北地区                            ├── cache1 (北地区の union)
   │    ├── 区画A                        │    ├── polygonA
   │    └── 区画B                        │    └── polygonB
   └── 南地区                            └── cache2 (南地区の union)
        ├── 区画C                             ├── polygonC
        └── 区画D                             └── polygonD
```

- ズームアウト時: cache3 の結果を表示（市全体の外輪郭）
- 中間ズーム: cache1, cache2 の結果を表示（各地区の外輪郭）
- ズームイン: 個々のポリゴンを表示

### 自動無効化

区画A のジオメトリを編集すると:

```
  polygonA 変更
      ↓ dirty 伝播
  cache1 (北地区) → dirty
      ↓ カスケーディング
  cache3 (市全体) → dirty

  次に cache3 を参照した時に自動再計算
```

---

## アプリ側の呼び出しフロー

```typescript
// 1. 初期構築: 地区ごとに union をキャッシュ
const northCacheId = editor.computeUnion([polygonAId, polygonBId]);
const southCacheId = editor.computeUnion([polygonCId, polygonDId]);

// 2. 階層キャッシュ: 地区キャッシュから市全体を構築
const cityCacheId = editor.computeUnionFromCaches([northCacheId, southCacheId]);

// 3. 外輪郭を取得（キャッシュヒット時は即座に返る）
const cityOutline = editor.getCachedUnion(cityCacheId);
// → GeoJSONPolygon[] | null

// 4. ポリゴン編集後、次回の getCachedUnion 時に自動再計算
await editor.sharedEdgeMove(polygonAId, 0, newLat, newLng);
// → cache1 と cityCacheId が自動で dirty 化
const updatedOutline = editor.getCachedUnion(cityCacheId);
// → 自動再計算された結果
```

---

## API

```typescript
// ポリゴン群から union を計算してキャッシュ
computeUnion(polygonIds: PolygonID[]): UnionCacheID

// 既存キャッシュを組み合わせて階層キャッシュを構築
computeUnionFromCaches(cacheIds: UnionCacheID[]): UnionCacheID

// キャッシュされた結果を取得（dirty なら自動再計算）
getCachedUnion(cacheId: UnionCacheID): GeoJSONPolygon[] | null

// キャッシュを削除
deleteCachedUnion(cacheId: UnionCacheID): void
```

---

## キャッシュの動作

### dirty 伝播（カスケーディング）

```
ポリゴン変更 → 関連するリーフキャッシュが dirty
           → その親キャッシュも dirty（カスケーディング）
           → getCachedUnion 呼び出し時に再計算（遅延評価）
```

| トリガー | 影響 |
|---------|------|
| `sharedEdgeMove` | 移動した頂点を持つポリゴンの関連キャッシュ |
| `splitPolygon` | 元ポリゴンの関連キャッシュ |
| `deletePolygon` | 削除ポリゴンの関連キャッシュ |
| `resolveOverlaps` | 対象全ポリゴンの関連キャッシュ |
| その他の編集操作 | 変更されたポリゴンの関連キャッシュ |

### インメモリのみ

Union Cache はメモリ内のみで動作し、`StorageAdapter` には影響しない。
アプリ再起動時にはキャッシュは消え、必要に応じて再構築する。

---

## エッジケースと挙動

| ケース | 挙動 |
|--------|------|
| 存在しない cacheId | `getCachedUnion` は `null` を返す |
| dirty なキャッシュ | `getCachedUnion` 時に自動再計算 |
| 子キャッシュが dirty な階層キャッシュ | 子を先に再計算してから親を再計算 |
| キャッシュ削除 | 子キャッシュは残る。親のみ削除 |
| 空のポリゴンリスト | 空の結果がキャッシュされる |

---

## 制約・注意事項

| 項目 | 内容 |
|------|------|
| **永続化** | なし（インメモリのみ） |
| **パフォーマンス** | キャッシュヒット時は O(1)。再計算時は union 演算のコスト |
| **メモリ** | キャッシュは明示的に `deleteCachedUnion` で解放 |
| **純粋関数版** | `computeUnion(geometries)` もエクスポートされている（キャッシュなし） |

---

## 関連 API

| API | 関係 |
|-----|------|
| [`computeUnion`（純粋関数）](polygon-editing-api.md#draftshape-操作純粋関数mappolygoneditor-のメソッドではない) | キャッシュなしの単発 union 計算 |
| [操作ガイド](editing-operations-guide.md) | 全操作の一覧 |
