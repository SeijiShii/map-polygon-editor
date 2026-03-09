# v1 → v2 移行ガイド

## 概要

v2 では **Area + AreaLevel モデル**を廃止し、**Polygon + Group モデル**に移行した。

---

## 廃止された概念

| 概念 | v1 | v2 |
|------|----|----|
| AreaLevel | 固定階層定義（country → prefecture → city → block） | **廃止** — アプリ層に委譲 |
| Area | ポリゴン + 階層ノードを兼ねる | **廃止** → Polygon + Group に分離 |
| level_key | Area がどのレベルに属するか | **廃止** |
| parent_level_key | レベル間の親子関係 | **廃止** |
| 線形階層制約 | 各レベルは子レベルを最大1つ | **廃止** |
| 暗黙の子（Implicit Children） | 非最下層エリアが自動的に持つ仮想子 | **廃止** |
| is_implicit フラグ | 暗黙の子かどうか | **廃止** |

---

## 型の対応表

| v1 | v2 | 備考 |
|----|----|------|
| `Area` | `Polygon` + `Group` | 葉ノード → Polygon、コンテナ → Group |
| `AreaID` | `PolygonID` + `GroupID` | 型を分離 |
| `AreaLevel` | — | 廃止 |
| `AreaInput` | — | bulkCreate は廃止（個別 saveAsPolygon + createGroup で代替） |

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

### 名称変更された API

| v1 API | v2 API | 備考 |
|--------|--------|------|
| `getArea(id)` | `getPolygon(id)` / `getGroup(id)` | 型ごとに分離 |
| `getChildren(parentId)` | `getChildren(groupId)` | Group 専用 |
| `getRoots()` | `getRoots()` | Polygon と Group の混合を返す |
| `getAllAreas()` | `getAllPolygons()` / `getAllGroups()` | 型ごとに分離 |
| `saveAsArea(draft, name, levelKey, parentId?)` | `saveAsPolygon(draft, name)` | levelKey・parentId 廃止 |
| `updateAreaGeometry(areaId, draft)` | `updatePolygonGeometry(polygonId, draft)` | 任意のポリゴン |
| `renameArea(areaId, name)` | `renamePolygon(id, name)` / `renameGroup(id, name)` | 型ごとに分離 |
| `deleteArea(areaId, options?)` | `deletePolygon(id)` / `deleteGroup(id, options?)` | 型ごとに分離 |
| `loadAreaToDraft(areaId)` | `loadPolygonToDraft(polygonId)` | 任意のポリゴン |
| `reparentArea(areaId, newParentId?)` | `moveToGroup(nodeId, newParentId?)` | Polygon/Group 両対応 |

### 新設 API

| v2 API | 説明 |
|--------|------|
| `getGroup(id)` | Group 専用の取得 |
| `getAllGroups()` | 全 Group 取得 |
| `getGroupPolygons(groupId)` | グループの外周ポリゴンをリストで取得 |
| `getDescendantPolygons(groupId)` | グループ配下の全 Polygon を再帰取得 |
| `createGroup(name, childIds)` | 既存ノードをまとめてグループ化 |
| `ungroupChildren(groupId)` | グループを解消し子を昇格 |
| `splitPolygon(polygonId, draft)` | v1 の splitAsChildren + splitReplace を統合 |

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

### 名称変更されたエラー

| v1 エラー | v2 エラー |
|----------|----------|
| `AreaNotFoundError` | `PolygonNotFoundError` + `GroupNotFoundError` |
| `ParentWouldBeEmptyError` | `GroupWouldBeEmptyError` |

### 新設エラー

| v2 エラー | 説明 |
|----------|------|
| `GroupWouldBeEmptyError` | 操作の結果、グループの子が0件になる |
| `GroupNotFoundError` | 指定した GroupID が存在しない |
| `SelfReferenceError` | 自身を自分の親に設定しようとした |
| `MixedParentError` | createGroup の子ノードの親が統一されていない |

---

## ストレージの変更

### v1 StorageAdapter

```
loadAll(): Promise<{ areas: Area[], drafts: PersistedDraft[] }>
batchWrite(changes: ChangeSet): Promise<void>
```

### v2 StorageAdapter

```
loadAll(): Promise<{ polygons: Polygon[], groups: Group[], drafts: PersistedDraft[] }>
batchWrite(changes: ChangeSet): Promise<void>
```

ChangeSet も Polygon / Group 別のフィールドに分離された。
