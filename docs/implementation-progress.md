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
| ジオメトリ演算 | @turf/turf（未導入・ジオメトリ演算実装時に追加予定） |

---

## テスト状況

```
Test Files  8 passed (8)
     Tests  267 passed (267)
Coverage:   93.69% statements, 89.91% branches, 98.87% functions
```

---

## v2 実装状況

### 完了

| モジュール | テスト数 | 備考 |
|-----------|---------|------|
| `src/types/index.ts` | 14 | Polygon, Group, PolygonID, GroupID, ChangeSet, HistoryEntry 等 |
| `src/errors.ts` | 71 | 13 エラークラス |
| `src/polygon-store/` | 14 | PolygonStore（byId + byParent デュアルインデックス） |
| `src/group-store/` | 13 | GroupStore（同上） |
| `src/editor.ts` | 57 | MapPolygonEditor ファサード（初期化・クエリ・CRUD・グループ管理・Undo/Redo・ドラフト永続化） |
| `src/draft/draft-operations.ts` | 42 | v1 から流用 |
| `src/draft/validate-draft.ts` | 27 | v1 から流用 |
| `src/draft/draft-store.ts` | 29 | v1 から流用 |

### 未実装（仕様策定済み）

| 機能 | 備考 |
|------|------|
| `splitPolygon` | 切断線による分割。ルートポリゴンのみ |
| `carveInnerPolygon` | ティアドロップ型ループによる切り出し |
| `punchHole` | 内側ループによるドーナツ作成 |
| `expandWithPolygon` | 外側描画によるポリゴン追加 + グループ化 |
| `sharedEdgeMove` | 共有境界の連動頂点編集。座標ハッシュインデックス含む |
| `getGroupPolygons` | グループ外周の Union 計算。@turf/turf 導入が必要 |

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
