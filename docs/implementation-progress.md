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
| ジオメトリ演算 | 未導入（@turf/turf 予定） |

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
| `AreaInput` | `bulkCreate` 用入力型（id なし）|
| `ChangeSet` | StorageAdapter へ渡す書き込みデルタ |
| `HistoryEntry` | undo/redo 用の変更履歴エントリ |
| `GeometryViolation` | `validateDraft` の戻り値（`TOO_FEW_VERTICES` / `SELF_INTERSECTION` / `ZERO_AREA`）|

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

テスト：**38件 / カバレッジ 90.9%（branch）**

---

## テスト状況

```
Test Files  3 passed (3)
     Tests  74 passed (74)

File                 | % Stmts | % Branch | % Funcs | % Lines
---------------------|---------|----------|---------|--------
area-level-store.ts  |   100   |   100    |   100   |   100
area-level-validator |   100   |   100    |   100   |   100
area-store.ts        |   100   |   90.9   |   100   |   100
All files            |   100   |   94.89  |   100   |   100
```

---

## 未実装モジュール（実装予定順）

### 1. DraftShape 操作（`src/draft/`）

| メソッド | 説明 |
|---------|------|
| `createDraft()` | 空の DraftShape を作成 |
| `addPoint(draft, point)` | 末尾に点を追加 |
| `insertPoint(draft, index, point)` | 任意位置に点を挿入 |
| `movePoint(draft, index, point)` | 点を移動 |
| `removePoint(draft, index)` | 点を削除 |
| `closeDraft(draft)` | `isClosed = true` に |
| `openDraft(draft)` | `isClosed = false` に |
| `toGeoJSON(draft)` | GeoJSON Polygon に変換 |

### 2. validateDraft（`src/draft/validate-draft.ts`）

`validateDraft(draft: DraftShape): GeometryViolation[]`

- `TOO_FEW_VERTICES`：closed=3点未満 / open=2点未満
- `SELF_INTERSECTION`：辺の交差検出
- `ZERO_AREA`：全頂点が一直線

### 3. MapPolygonEditor ファサード（`src/editor.ts`）

メインの公開クラス。以下の責務を持つ：

- `initialize(config)` — `StorageAdapter.loadAll()` + バリデーション
- `NotInitializedError` ガード（`initialize()` 前に API 呼び出し不可）
- 全クエリ API の委譲（`getArea`, `getChildren` 等）
- `saveAsArea` / `updateAreaGeometry` / `deleteArea` / `bulkCreate`
- undo/redo スタック管理

### 4. 編集 API

| API | 概要 |
|-----|------|
| `saveAsArea(draft, name, levelKey, parentId?)` | DraftShape → Area 変換・保存 |
| `bulkCreate(items)` | 一括インポート |
| `updateAreaGeometry(areaId, draft)` | geometry 更新（子あり不可）|
| `deleteArea(areaId, options?)` | 削除（cascade オプション）|
| `renameArea(areaId, name)` | 名前変更 |
| `reparentArea(areaId, newParentId)` | 親変更 |
| `mergeArea(areaIds)` | 複数エリアを1つに統合 |

### 5. 切断・形状操作 API

| API | 概要 |
|-----|------|
| `loadAreaToDraft(areaId)` | Area → DraftShape |
| `splitAsChildren(areaId, draft)` | 切断線で子に分割 |
| `splitReplace(areaId, draft)` | 切断線で兄弟2件に置き換え |
| `carveInnerChild(areaId, points)` | 内側ループで子を切り出し |
| `punchHole(areaId, points)` | 内側ループで穴を開ける |
| `expandWithChild(parentAreaId, points)` | 外側ループで子を追加 |
| `sharedEdgeMove(areaId, index, lat, lng)` | 共有辺の頂点移動 |

### 6. StorageAdapter インターフェース

```typescript
interface StorageAdapter {
  loadAll(): Promise<Area[]>
  batchWrite(changeSet: ChangeSet): Promise<void>
}
```

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-20 | 初期実装：types, AreaLevelStore, AreaLevelValidator, AreaStore（74テスト、94.89%カバレッジ） |
