# map-polygon-editor

地図上のポリゴン編集に特化した**データ管理ライブラリ**。

ポリゴンのグループ管理・ジオメトリ演算・undo/redo・ストレージ抽象化を担う。
地図の描画・入力処理はアプリ側に委譲する設計で、Google Maps・Leaflet・flutter_map など任意の地図ライブラリと組み合わせて使用できる。

## 主なユースケース

- 地域の個別訪問（ドアノック営業、布教活動など）
- チラシ配り・営業エリア管理
- ボランティア担当エリアの割り振り

人が地域をエリア分けして管理するシナリオを主眼に置く。

## 主な機能

- **ポリゴン描画・編集**：頂点の追加・移動・削除、切断線による分割
- **グループ管理**：ポリゴンやグループの木構造によるネスト管理
- **共有境界の連動編集**：隣接ポリゴンの境界頂点を同時更新
- **Undo / Redo**：ドラフト内・コミット済みの2レイヤー
- **ストレージ抽象化**：`StorageAdapter` インターフェースによる永続化層の委譲

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [概要](docs/overview.md) | プロジェクト概要・設計思想 |
| [データモデル](docs/data-model.md) | Polygon・Group の型定義・木構造・制約 |
| [ポリゴン編集 API](docs/polygon-editing-api.md) | 全 API 仕様・操作パターン・Undo/Redo・ストレージ抽象化 |
| [v1→v2 移行ガイド](docs/migration-v1-to-v2.md) | Area+AreaLevel → Polygon+Group への移行対応表 |

## アーキテクチャ

このライブラリは地図描画を行わない。GeoJSON の入出力インターフェースを通じて任意の地図ライブラリと連携する。

```
┌─────────────────────────────────┐
│        map-polygon-editor        │
│                                  │
│  Polygon/Group管理 / undo/redo   │
│  geometry演算 / 共有境界連動     │
└──────────────┬───────────────────┘
               │ GeoJSON の入出力のみ
   ┌───────────┼────────────┐
   ↓           ↓            ↓
Terra Draw  flutter_map  Google Maps
（Web）      （Flutter）  （JS/Flutter）
```

## ステータス

v2 コア実装完了。267 テスト通過、カバレッジ 93%。

### 実装済み

- 型システム（PolygonID / GroupID / DraftID ブランド型）
- PolygonStore / GroupStore（デュアルインデックス）
- MapPolygonEditor ファサード（初期化・クエリ・CRUD・グループ管理・Undo/Redo・ドラフト永続化）
- DraftShape 操作（描画・検証・GeoJSON 変換）
- エラー体系（13 エラークラス）

### 未実装（仕様策定済み）

- ジオメトリ演算: `splitPolygon`, `carveInnerPolygon`, `punchHole`, `expandWithPolygon`
- 共有境界連動: `sharedEdgeMove`（座標ハッシュインデックス含む）
- グループ外周取得: `getGroupPolygons`（Union 計算）
