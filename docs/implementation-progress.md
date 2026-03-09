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
Test Files  8 passed (8)
     Tests  299 passed (299)
```

---

## v2 実装状況

### 完了

| モジュール | テスト数 | 備考 |
|-----------|---------|------|
| `src/types/index.ts` | 14 | Polygon, Group, PolygonID, GroupID, ChangeSet, HistoryEntry 等 |
| `src/errors.ts` | 66 | 12 エラークラス |
| `src/polygon-store/` | 14 | PolygonStore（byId + byParent デュアルインデックス） |
| `src/group-store/` | 13 | GroupStore（同上） |
| `src/editor.ts` | 94 | MapPolygonEditor ファサード（全 API 実装済み） |
| `src/draft/draft-operations.ts` | 42 | v1 から流用 |
| `src/draft/validate-draft.ts` | 27 | v1 から流用 |
| `src/draft/draft-store.ts` | 29 | v1 から流用 |

### Editor API 実装状況

| API | 状態 | テスト数 |
|-----|------|---------|
| 初期化 + クエリ | ✅ 完了 | Phase 1 |
| Polygon CRUD | ✅ 完了 | Phase 2 |
| Group 管理 | ✅ 完了 | Phase 3 |
| Draft 永続化 + Undo/Redo | ✅ 完了 | Phase 4 |
| `getGroupPolygons` | ✅ 完了 | Phase 5 (6 tests) |
| `sharedEdgeMove` | ✅ 完了 | Phase 6 (8 tests) |
| `splitPolygon` | ✅ 完了 | Phase 7 (7 tests) |
| `carveInnerPolygon` | ✅ 完了 | Phase 8 (5 tests) |
| `punchHole` | ✅ 完了 | Phase 9 (5 tests) |
| `expandWithPolygon` | ✅ 完了 | Phase 10 (5 tests) |

### 削除済み（v1 モジュール）

| モジュール | 備考 |
|-----------|------|
| `src/area-level/` | AreaLevelStore, AreaLevelValidator — AreaLevel 概念廃止 |
| `src/area-store/` | AreaStore — Polygon+Group モデルに分離 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-20 | v1: 初期実装（478テスト） |
| 2026-03-09 | v2 仕様策定: Area+AreaLevel → Polygon+Group モデルへの移行を決定 |
| 2026-03-09 | v2 実装完了: 型・エラー・Store・Editor 全面書き換え（267テスト、カバレッジ93%） |
| 2026-03-09 | v2 ジオメトリ API 実装: getGroupPolygons, sharedEdgeMove, splitPolygon, carveInnerPolygon, punchHole, expandWithPolygon（299テスト） |
