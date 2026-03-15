# 実装進捗

## 概要

このドキュメントは `map-polygon-editor` ライブラリの実装状況を追跡するものです。
実装言語：**TypeScript**（npm パッケージ）
テスト方針：**TDD**（Vitest、カバレッジ閾値 80%）

---

## 技術構成

| 項目 | 採用技術 |
|------|---------|
| 言語 | TypeScript（strict モード） |
| ビルドターゲット | ESM / CJS 両対応（tsup） |
| テスト | Vitest |
| カバレッジ | v8（閾値 80%） |
| ジオメトリ演算 | @turf/turf + polyclip-ts |

---

## テスト状況

```
Test Files  9 passed (9)
     Tests  256 passed (256)
```

---

## v2 実装状況

### 完了

| モジュール | テスト数 | 備考 |
|-----------|---------|------|
| `src/types/index.ts` | 13 | Polygon, PolygonID, UnionCacheID, ChangeSet, HistoryEntry 等 |
| `src/errors.ts` | 38 | 8 エラークラス（NoSharedEdgeError 追加） |
| `src/polygon-store/` | 8 | PolygonStore（byId インデックス） |
| `src/geometry/compute-union.ts` | — | 純粋関数（Editor テストでカバー） |
| `src/geometry/bridge-polygon.ts` | 13 | 2ポリゴン間ブリッジのジオメトリ演算 |
| `src/geometry/detect-loop.ts` | 8 | ドラフト＋ポリゴン境界の閉回路検出 |
| `src/editor.ts` | 78 | MapPolygonEditor ファサード（全 API 実装済み） |
| `src/draft/draft-operations.ts` | 42 | v1 から流用 |
| `src/draft/validate-draft.ts` | 27 | v1 から流用 |
| `src/draft/draft-store.ts` | 29 | v1 から流用 |

### Editor API 実装状況

| API | 状態 | 備考 |
|-----|------|------|
| 初期化 + クエリ | ✅ 完了 | |
| Polygon CRUD | ✅ 完了 | |
| Draft 永続化 + Undo/Redo | ✅ 完了 | |
| `sharedEdgeMove` | ✅ 完了 | |
| `splitPolygon` | ✅ 完了 | |
| `carveInnerPolygon` | ✅ 完了 | |
| `punchHole` | ✅ 完了 | |
| `expandWithPolygon` | ✅ 完了 | |
| `bridgePolygons` | ✅ 完了 | 3段階判定: 直接ブリッジ → 閉回路検出 → ドラフト保存 |
| Union Cache（基本） | ✅ 完了 | computeUnion, getCachedUnion, deleteCachedUnion |
| Union Cache（階層） | ✅ 完了 | computeUnionFromCaches, カスケーディング dirty 伝播 |

### 削除済みモジュール

| モジュール | 備考 |
|-----------|------|
| `src/area-level/` | AreaLevelStore, AreaLevelValidator — AreaLevel 概念廃止 |
| `src/area-store/` | AreaStore — Polygon モデルに統合 |
| `src/group-store/` | GroupStore — Group 概念廃止（アプリ層に委譲） |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-20 | v1: 初期実装（478テスト） |
| 2026-03-09 | v2 仕様策定: Area+AreaLevel → Polygon モデルへの移行を決定 |
| 2026-03-09 | v2 実装完了: 型・エラー・Store・Editor 全面書き換え |
| 2026-03-09 | v2 ジオメトリ API 実装: sharedEdgeMove, splitPolygon, carveInnerPolygon, punchHole, expandWithPolygon |
| 2026-03-09 | splitPolygon 強化: ヒゲ自動除去、1交差頂点挿入、2N交差マルチセグメント分割。sharedEdgeMove epsilon比較 |
| 2026-03-14 | Group 概念廃止: アプリ層に委譲。Union Cache API 追加（基本＋階層キャッシュ、カスケーディング dirty 伝播）。220テスト |
| 2026-03-15 | `bridgePolygons` 追加（3段階判定）: (1) 共有辺による直接ブリッジ (2) ドラフト＋ポリゴン境界の閉回路 BFS 検出 (3) ドラフト保存。`NoSharedEdgeError` 追加。ドラフト端点インデックス導入。256テスト |
