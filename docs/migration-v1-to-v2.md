# v1 → v2 移行ガイド

## 概要

v2 では **Area + AreaLevel モデル**を廃止し、**フラットな Polygon モデル**に移行した。
グループ・階層の概念はアプリ層に委譲し、ライブラリはジオメトリ操作に徹する。

---

## 廃止された概念

| 概念 | v1 | v2 |
|------|----|----|
| AreaLevel | 固定階層定義（country → prefecture → city → block） | **廃止** — アプリ層に委譲 |
| Area | ポリゴン + 階層ノードを兼ねる | **廃止** → Polygon に統合 |
| Group | 複数ポリゴンの論理コンテナ | **廃止** — アプリ層に委譲 |
| level_key | Area がどのレベルに属するか | **廃止** |
| parent_level_key | レベル間の親子関係 | **廃止** |
| parent_id | ポリゴンの親グループ | **廃止** |
| 線形階層制約 | 各レベルは子レベルを最大1つ | **廃止** |
| 暗黙の子（Implicit Children） | 非最下層エリアが自動的に持つ仮想子 | **廃止** |
| is_implicit フラグ | 暗黙の子かどうか | **廃止** |

---

## 型の対応表

| v1 | v2 | 備考 |
|----|----|------|
| `Area` | `Polygon` | 全てフラットな Polygon |
| `AreaID` | `PolygonID` | 型を統合 |
| `AreaLevel` | — | 廃止 |
| `AreaInput` | — | bulkCreate は廃止（個別 saveAsPolygon で代替） |
| `Group` / `GroupID` | — | 廃止（アプリ層に委譲） |

---

## API の対応表

### 廃止された API

| v1 API | 理由 |
|--------|------|
| `getAllAreaLevels()` | AreaLevel 廃止 |
| `getAreaLevel(key)` | AreaLevel 廃止 |
| `getAreasByLevel(levelKey)` | AreaLevel 廃止 |
| `bulkCreate(items)` | AreaLevel 依存のバッチ作成。個別 API で代替 |
| `splitAsChildren(parentAreaId, draft)` | AreaLevel の親子関係前提。`splitPolygon` に統合 |
| `splitReplace(areaId, draft)` | `splitPolygon` に統合 |
| `mergeArea(areaId, otherAreaId)` | 現時点では未提供（将来検討） |
| `getGroup(id)` | Group 廃止 |
| `getAllGroups()` | Group 廃止 |
| `getGroupPolygons(groupId)` | Group 廃止（`computeUnion` で代替） |
| `getDescendantPolygons(groupId)` | Group 廃止 |
| `createGroup(name, childIds)` | Group 廃止 |
| `ungroupChildren(groupId)` | Group 廃止 |
| `moveToGroup(nodeId, newParentId?)` | Group 廃止 |
| `deleteGroup(id, options?)` | Group 廃止 |
| `renameGroup(id, name)` | Group 廃止 |

### 名称変更された API

| v1 API | v2 API | 備考 |
|--------|--------|------|
| `getArea(id)` | `getPolygon(id)` | |
| `getAllAreas()` | `getAllPolygons()` | |
| `saveAsArea(draft, name, levelKey, parentId?)` | `saveAsPolygon(draft, name)` | levelKey・parentId 廃止 |
| `updateAreaGeometry(areaId, draft)` | `updatePolygonGeometry(polygonId, draft)` | 任意のポリゴン |
| `renameArea(areaId, name)` | `renamePolygon(id, name)` | |
| `deleteArea(areaId, options?)` | `deletePolygon(id)` | |
| `loadAreaToDraft(areaId)` | `loadPolygonToDraft(polygonId)` | 任意のポリゴン |

### 新設 API

| v2 API | 説明 |
|--------|------|
| `splitPolygon(polygonId, draft)` | v1 の splitAsChildren + splitReplace を統合 |
| `computeUnion(polygonIds)` | ポリゴン群の外輪郭を計算・キャッシュ |
| `computeUnionFromCaches(cacheIds)` | キャッシュ同士を組み合わせた階層キャッシュ |
| `getCachedUnion(cacheId)` | キャッシュされた外輪郭を取得 |
| `deleteCachedUnion(cacheId)` | キャッシュを削除 |

---

## エラーの対応表

### 廃止されたエラー

| v1 エラー | 理由 |
|----------|------|
| `InvalidAreaLevelConfigError` | AreaLevel 廃止 |
| `AreaLevelNotFoundError` | AreaLevel 廃止 |
| `LevelMismatchError` | AreaLevel 廃止 |
| `NoChildLevelError` | AreaLevel 廃止 |
| `AreaHasChildrenError` | 不要（Polygon は常に葉ノード） |
| `GroupNotFoundError` | Group 廃止 |
| `GroupWouldBeEmptyError` | Group 廃止 |
| `CircularReferenceError` | Group 廃止 |
| `SelfReferenceError` | Group 廃止 |
| `MixedParentError` | Group 廃止 |

### 名称変更されたエラー

| v1 エラー | v2 エラー |
|----------|----------|
| `AreaNotFoundError` | `PolygonNotFoundError` |

### v2 エラー一覧

| v2 エラー | 説明 |
|----------|------|
| `NotInitializedError` | `initialize()` 完了前に API を呼んだ |
| `DataIntegrityError` | データ不整合 |
| `StorageError` | ストレージ操作失敗 |
| `PolygonNotFoundError` | 指定した PolygonID が存在しない |
| `DraftNotClosedError` | open DraftShape を Polygon として保存しようとした |
| `InvalidGeometryError` | 自己交差・頂点不足・面積ゼロ |
| `DraftNotFoundError` | 指定した DraftID が見つからない |

---

## ストレージの変更

### v1 StorageAdapter

```
loadAll(): Promise<{ areas: Area[], drafts: PersistedDraft[] }>
batchWrite(changes: ChangeSet): Promise<void>
```

### v2 StorageAdapter

```
loadAll(): Promise<{ polygons: Polygon[], drafts: PersistedDraft[] }>
batchWrite(changes: ChangeSet): Promise<void>
```

ChangeSet は Polygon のみのフィールドに簡素化された（Group フィールドは廃止）。
