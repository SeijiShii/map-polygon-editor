# 実装進捗

## 概要

このドキュメントは `map-polygon-editor` ライブラリの実装状況を追跡するものです。
実装言語：**TypeScript**（npm パッケージ）
テスト方針：**TDD**（Vitest、カバレッジ閾値 80%）

---

## !! 仕様変更（2026-03-09）!!

### v2: ポリゴンデータ中心志向への移行

**Area + AreaLevel モデルを廃止し、Polygon + Group モデルに移行する。**

#### 廃止される概念

- AreaLevel（エリアレベル定義）全体
- Area（Polygon + Group に分離）
- 暗黙の子（Implicit Children）
- is_implicit フラグ
- level_key / parent_level_key
- 線形階層制約

#### 新概念

- **Polygon**: geometry を直接保有する葉ノード（旧 Area の最下層に相当）
- **Group**: 子を束ねる論理コンテナ（geometry を保存しない）
- 木構造（自由なネスト、レベル制約なし）
- 空グループ不許可

#### 実装への影響

| モジュール | 影響 |
|-----------|------|
| `src/types/index.ts` | **大幅変更** — Area → Polygon + Group、AreaLevel 関連型削除、ChangeSet/HistoryEntry 再構成 |
| `src/area-level/` | **全削除** — AreaLevelStore, AreaLevelValidator |
| `src/area-store/` | **全削除** → `polygon-store/` + `group-store/` に分離 |
| `src/errors.ts` | **大幅変更** — Level 系エラー削除、Group 系エラー追加 |
| `src/editor.ts` | **大幅変更** — 全 API のシグネチャ変更 |
| `src/draft/` | **軽微** — DraftShape 操作・validateDraft はそのまま維持 |

---

## 技術構成

| 項目 | 採用技術 |
|------|---------|
| 言語 | TypeScript（strict モード） |
| ビルドターゲット | ESM / CJS 両対応（tsup） |
| テスト | Vitest |
| カバレッジ | v8（閾値 80%） |
| ジオメトリ演算 | @turf/turf |

---

## v1 テスト状況（仕様変更前・参考）

```
Test Files  8 passed (8)
     Tests  478 passed (478)
```

v2 移行に伴い、大部分のテストは書き直しが必要。
DraftShape 関連テスト（draft-operations, validate-draft, draft-store）はそのまま流用可能。

---

## v2 実装状況

### 流用可能（変更不要 or 軽微）

| モジュール | テスト数 | 備考 |
|-----------|---------|------|
| `src/draft/draft-operations.ts` | 42 | そのまま流用 |
| `src/draft/validate-draft.ts` | 27 | そのまま流用 |
| `src/draft/draft-store.ts` | 29 | そのまま流用 |

### 新規実装が必要

| モジュール | 状態 | 備考 |
|-----------|------|------|
| `src/types/index.ts` | 未着手 | Polygon, Group, PolygonID, GroupID, 新 ChangeSet/HistoryEntry |
| `src/polygon-store/` | 未着手 | PolygonStore（旧 AreaStore から派生） |
| `src/group-store/` | 未着手 | GroupStore（新規） |
| `src/errors.ts` | 未着手 | エラー体系の再構成 |
| `src/editor.ts` | 未着手 | MapPolygonEditor ファサード全面改修 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-20 | v1: 初期実装（478テスト） |
| 2026-03-09 | v2 仕様策定: Area+AreaLevel → Polygon+Group モデルへの移行を決定 |
