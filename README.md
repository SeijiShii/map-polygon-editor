# map-polygon-editor

地図上のポリゴン編集に特化した**ネットワークベースのデータ管理ライブラリ**。

頂点と線分のネットワークを中心概念とし、閉回路を自動的にポリゴンとして検出する。地図の描画・入力処理はアプリ側に委譲する設計で、Leaflet・Google Maps など任意の地図ライブラリと組み合わせて使用できる。

## 主なユースケース

- 地域の個別訪問（ドアノック営業、布教活動など）
- チラシ配り・営業エリア管理
- ボランティア担当エリアの割り振り

人が地域をエリア分けして管理するシナリオを主眼に置く。

## 主な機能

- **ネットワークモデル**: 頂点＋線分が中心。閉回路は自動的にポリゴンになる
- **交差自動解決**: 線分が交差すると交点に頂点を挿入し両線分を分割
- **穴の自動検出**: 外側の閉回路に内包される閉回路はGeoJSONのinner ringになる
- **描画/編集モード**: 排他的なモード管理。描画中は線分を順次追加、編集では頂点の移動・削除
- **Undo/Redo**: ユーザー操作単位。自動分割も含めて1回で巻き戻し
- **ChangeSet**: 全操作が変更差分を返す。Leafletレイヤーの同期に使用
- **GeoJSON出力**: 個別ポリゴンまたはFeatureCollectionとして出力
- **ストレージ抽象化**: `StorageAdapter`インターフェースによる永続化

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [API リファレンス](docs/api.md) | 全メソッド仕様・型定義・Leaflet連携例 |
| [v3 仕様](docs/experimental-v3.md) | 設計思想・データ概念・設計判断 |
| [実装計画](docs/v3-implementation-plan.md) | フェーズ別実装計画 |
| [リリース手順](docs/releasing.md) | npm公開・バージョン管理 |

## アーキテクチャ

```
┌──────────────────────────────────┐
│       map-polygon-editor          │
│                                   │
│  Network (頂点+線分)              │
│  Half-edge面列挙 → ポリゴン検出   │
│  交差解決 / Undo/Redo / 永続化    │
└───────────────┬──────────────────┘
                │ ChangeSet + GeoJSON
    ┌───────────┼────────────┐
    ↓           ↓            ↓
 Leaflet    Google Maps   その他
```

## インストール

```bash
npm install map-polygon-editor
```

## クイックスタート

```ts
import { NetworkPolygonEditor } from "map-polygon-editor";

const editor = new NetworkPolygonEditor();

// 三角形を描画
editor.startDrawing();
editor.placeVertex(35.68, 139.76);
editor.placeVertex(35.69, 139.76);
editor.placeVertex(35.685, 139.77);

// 始点にスナップ → ポリゴン自動生成
const first = editor.getVertices()[0]!;
const cs = editor.snapToVertex(first.id);
// cs.polygons.created[0] にポリゴンが入る

// GeoJSON出力
const geojson = editor.getAllGeoJSON();
```

## ステータス

v3 実装完了。128テスト通過。

[![npm version](https://img.shields.io/npm/v/map-polygon-editor.svg)](https://www.npmjs.com/package/map-polygon-editor)
[![license](https://img.shields.io/npm/l/map-polygon-editor.svg)](https://github.com/SeijiShii/map-polygon-editor/blob/main/LICENSE)
