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
| ビルドターゲット | ESM / CJS 両対応（tsup 予定） |
| テスト | Vitest |
| カバレッジ | v8（閾値 80%） |
| ジオメトリ演算 | @turf/turf（導入済み）|

---

## テスト状況（最終）

```
Test Files  8 passed (8)
     Tests  478 passed (478)

File                  | % Stmts | % Branch | % Funcs | % Lines
----------------------|---------|----------|---------|--------
editor.ts             |   96.08 |   91.53  |   100   |   96.08
errors.ts             |   100   |   100    |   100   |   100
area-level-store.ts   |   100   |   100    |   100   |   100
area-level-validator  |   100   |   100    |   100   |   100
area-store.ts         |   100   |   91.22  |   100   |   100
draft-operations.ts   |   100   |   100    |   100   |   100
draft-store.ts        |   100   |   100    |   100   |   100
validate-draft.ts     |   100   |   100    |   100   |   100
All files             |   97.09 |   93.41  |   100   |   97.09
```

---

## 実装済みモジュール

### `src/types/index.ts` — コア型定義

| 型 | 内容 |
|----|------|
| `AreaID` | Branded string（型安全な ID）|
| `AreaGeometry` | `GeoJSONPolygon \| GeoJSONMultiPolygon` |
| `AreaLevel` | `key`, `name`, `parent_level_key`, `description` |
| `Area` | `id`, `display_name`, `level_key`, `parent_id`, `geometry`, `metadata`, `created_at`, `updated_at`, `is_implicit` |
| `Point` | `{ lat, lng }` |
| `DraftShape` | `{ points: Point[], isClosed: boolean }` |
| `DraftID` | Branded string（PersistedDraft の ID）|
| `PersistedDraft` | `id`, `points`, `isClosed`, `created_at`, `updated_at`, `metadata?` |
| `StorageAdapter` | `loadAll()`, `batchWrite()`, `saveDraft()`, `deleteDraft()` |
| `AreaInput` | `bulkCreate` 用入力型（id なし）|
| `ChangeSet` | `{ created: Area[], deleted: AreaID[], modified: Area[] }` |
| `HistoryEntry` | `{ created: Area[], deleted: Area[], modified: [{before,after}][] }` |
| `GeometryViolation` | `{ code: "TOO_FEW_VERTICES" \| "SELF_INTERSECTION" \| "ZERO_AREA" }` |

### `src/errors.ts` — エラークラス（14種）

各クラスは `Error` を継承し、`Object.setPrototypeOf(this, new.target.prototype)` で `instanceof` を保証。

| クラス | 発生条件 |
|--------|---------|
| `NotInitializedError` | `initialize()` 前に API を呼んだ |
| `InvalidAreaLevelConfigError` | areaLevels に循環参照・重複 key 等 |
| `DataIntegrityError` | `loadAll()` で読み込んだ Area に不整合 |
| `StorageError` | `batchWrite` / `loadAll` の失敗 |
| `AreaNotFoundError` | 指定 AreaID が存在しない |
| `AreaLevelNotFoundError` | 指定 level_key が areaLevels に存在しない |
| `LevelMismatchError` | Area の level と親 Area の level が不一致 |
| `AreaHasChildrenError` | 明示的な子を持つ Area を直接編集 |
| `ParentWouldBeEmptyError` | reparentArea の結果、旧親の明示的子が 0件に |
| `CircularReferenceError` | reparentArea で循環が生じる |
| `DraftNotClosedError` | open DraftShape を Area として保存しようとした |
| `InvalidGeometryError` | 自己交差・頂点不足・面積ゼロ |
| `NoChildLevelError` | 葉レベルへの子生成操作 |
| `DraftNotFoundError` | loadDraftFromStorage で ID が見つからない |

テスト：**76件 / カバレッジ 100%**

### `src/area-level/area-level-validator.ts`

`validateAreaLevels(levels: AreaLevel[]): void`

- 重複 key の検出
- 存在しない `parent_level_key` 参照の検出
- 循環参照の検出（DFS）
- 線形階層制約の検出（各親は子レベルを最大1つ）

テスト：**14件 / カバレッジ 100%**

### `src/area-level/area-level-store.ts`

`AreaLevelStore` クラス

| メソッド | 説明 |
|---------|------|
| `getAllAreaLevels()` | 全 AreaLevel を取得 |
| `getAreaLevel(key)` | key で取得（なければ `null`）|
| `getChildLevel(key)` | 子レベルを取得（なければ `null`）|
| `isLeafLevel(key)` | 葉レベルか判定 |
| `getRootLevel()` | `parent_level_key === null` のレベル |

テスト：**22件 / カバレッジ 100%**

### `src/area-store/area-store.ts`

`AreaStore` クラス（インメモリ、デュアルインデックス：親→子、レベル→エリア）

| メソッド | 説明 |
|---------|------|
| `getArea(id)` | 明示的 ID・暗黙の子仮想 ID 両対応 |
| `getChildren(parentId)` | 明示的子を返す。なければ暗黙の子（`is_implicit: true`）を生成 |
| `getRoots()` | `parent_id === null` の Area 一覧 |
| `getAllAreas()` | 明示的 Area 全件（暗黙の子は含まない）|
| `getAreasByLevel(levelKey)` | 指定レベルの明示的 Area 一覧 |
| `addArea(area)` | Area を追加 |
| `updateArea(area)` | 既存 Area を更新 |
| `deleteArea(id)` | Area を削除 |

暗黙の子 ID の形式：`__implicit__<parentId>__<levelKey>`

テスト：**38件 / カバレッジ 91.37%（branch）**

### `src/draft/draft-operations.ts`

純粋関数群（すべてイミュータブル）

| 関数 | 説明 |
|------|------|
| `createDraft()` | 空の DraftShape を作成 |
| `addPoint(draft, point)` | 末尾に点を追加 |
| `insertPoint(draft, index, point)` | 任意位置に点を挿入 |
| `movePoint(draft, index, point)` | 指定インデックスの点を移動 |
| `removePoint(draft, index)` | 指定インデックスの点を削除 |
| `closeDraft(draft)` | `isClosed = true` |
| `openDraft(draft)` | `isClosed = false` |
| `draftToGeoJSON(draft)` | GeoJSON Polygon に変換（CCW 正規化・Shoelace 法）|

テスト：**42件 / カバレッジ 100%**

### `src/draft/validate-draft.ts`

`validateDraft(draft: DraftShape): GeometryViolation[]`

| コード | 条件 | closed のみ |
|--------|------|------------|
| `TOO_FEW_VERTICES` | closed: 3点未満 / open: 2点未満 | — |
| `SELF_INTERSECTION` | 非隣接辺の交差（外積符号法） | ✓ |
| `ZERO_AREA` | Shoelace 面積 < 1e-14 | ✓ |

テスト：**27件 / カバレッジ 100%**

### `src/draft/draft-store.ts`

`DraftStore` クラス（`Map<DraftID, PersistedDraft>` ベース、O(1) 参照）

| メソッド | 説明 |
|---------|------|
| `getAll()` | 全 PersistedDraft 一覧 |
| `get(id)` | ID で取得（なければ `null`）|
| `save(draft)` | upsert（新規・更新どちらも）|
| `delete(id)` | 削除（存在しない場合は no-op）|

テスト：**29件 / カバレッジ 100%**

### `src/editor.ts` — MapPolygonEditor ファサード

メインの公開クラス。全5フェーズ実装済み。

**フェーズ1 — 初期化・ガード**

```typescript
constructor({ storageAdapter, areaLevels, maxUndoSteps?, epsilon? })
initialize(): Promise<void>
// initialize() 前に呼ぶと NotInitializedError
```

- `initialize()` で `validateAreaLevels()` → `storageAdapter.loadAll()` → AreaLevelStore + AreaStore + DraftStore 構築
- 全メソッドに `NotInitializedError` ガード

**フェーズ2 — クエリ API（同期）**

| メソッド | 戻り値 |
|---------|--------|
| `getArea(id)` | `Area \| null` |
| `getChildren(parentId)` | `Area[]` |
| `getRoots()` | `Area[]` |
| `getAllAreas()` | `Area[]` |
| `getAreasByLevel(levelKey)` | `Area[]` |
| `getAllAreaLevels()` | `AreaLevel[]` |
| `getAreaLevel(key)` | `AreaLevel \| null` |
| `validateDraft(draft)` | `GeometryViolation[]` |

**フェーズ3 — ドラフト永続化 API**

| メソッド | 説明 |
|---------|------|
| `saveDraftToStorage(draft, metadata?)` | 新規/更新保存 → `Promise<PersistedDraft>` |
| `loadDraftFromStorage(id)` | DraftStore から DraftShape に変換（同期）|
| `listPersistedDrafts()` | メモリ内一覧（同期）|
| `deleteDraftFromStorage(id)` | 削除 → `Promise<void>` |

**フェーズ4 — 編集 API**

| メソッド | 説明 |
|---------|------|
| `renameArea(areaId, name)` | 名前変更、HistoryEntry + batchWrite |
| `loadAreaToDraft(areaId)` | Area → open DraftShape（子ありは AreaHasChildrenError）|
| `saveAsArea(draft, name, levelKey, parentId?)` | DraftShape → Area 保存、レベル整合性検証、祖先 geometry 自動更新 |
| `deleteArea(areaId, options?)` | 削除（cascade: true で子孫も再帰削除）|
| `bulkCreate(items)` | AreaInput[] から一括作成、ID 自動採番、fail-fast バリデーション |
| `updateAreaGeometry(areaId, draft)` | geometry 更新（明示的子ありは AreaHasChildrenError）、祖先 geometry 伝播 |
| `reparentArea(areaId, newParentId)` | 親変更、LevelMismatch / ParentWouldBeEmpty / CircularReference 検証 |
| `mergeArea(areaId, otherAreaId)` | 兄弟2件を統合、geometry マージ（Polygon/MultiPolygon 両対応）|
| `splitAsChildren(areaId, draft)` | 切断線（open DraftShape）で子エリアに分割、ヒゲ除去付き |
| `splitReplace(areaId, draft)` | 切断線でエリアを兄弟2件に置き換え、元エリア削除 |
| `carveInnerChild(areaId, points)` | 内側ポリゴンで子2件（外枠・内側）を生成 |
| `punchHole(areaId, points)` | 内側ポリゴンで穴あき geometry を作成（difference 演算）|
| `expandWithChild(parentAreaId, points)` | 外側ポリゴンで子2件生成、親 geometry を拡張 |
| `sharedEdgeMove(areaId, index, lat, lng)` | 共有頂点を全兄弟エリアに伝播して移動 |

祖先 geometry 更新：子の geometry を MultiPolygon として Union し、親→祖父→... と伝播
ポリゴン演算：@turf/turf（`lineSplit`, `difference`, `union`, `booleanValid`）を使用

**フェーズ5 — Undo/Redo**

| メソッド | 説明 |
|---------|------|
| `undo()` | → `Area[]`（変更された全エリア）|
| `redo()` | → `Area[]` |
| `canUndo()` | → `boolean` |
| `canRedo()` | → `boolean` |

- UndoStack / RedoStack（`maxUndoSteps` 上限あり、デフォルト 100）
- 新規操作時に RedoStack をクリア

テスト：**230件 / カバレッジ 91.53%（branch）**

---

## 未実装 API

現在、仕様に定義された全 API が実装済みです。

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-20 | 初期実装：types, AreaLevelStore, AreaLevelValidator, AreaStore（74テスト）|
| 2026-02-20 | 仕様変更：ドラフト永続化（PersistedDraft, StorageAdapter 拡張）|
| 2026-02-20 | DraftShape 操作・validateDraft・DraftStore 実装（172テスト）|
| 2026-02-20 | errors.ts（14エラークラス）+ MapPolygonEditor 全5フェーズ実装（361テスト）|
| 2026-02-20 | bulkCreate / updateAreaGeometry / reparentArea / mergeArea 実装（424テスト）|
| 2026-02-20 | @turf/turf 導入、切断・形状操作 API 全6件実装（478テスト）|
