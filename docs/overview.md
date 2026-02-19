# map-polygon-editor 仕様書

## プロジェクト概要

地図上でポリゴンの追加・編集を行うための**データ管理ライブラリ**。

エリアの階層管理・ジオメトリ演算・undo/redo・ストレージ抽象化を担う。
地図の描画・入力イベント処理はアプリ側（または地図ライブラリ）に委譲する。

### 主なユースケース

- 地域の個別訪問（ドアノック営業、布教活動など）
- チラシ配り
- 営業エリア管理
- ボランティア担当エリアの割り振り

上記のように、**人が地域をエリア分けして管理する**シナリオを主眼に置く。

---

## 技術選定（検討中）

| 層 | 候補 | 備考 |
|----|------|------|
| UI / クロスプラットフォーム | Flutter + flutter_map | Windows / Android / iOS 対応 |
| ポリゴン編集 UI | flutter_map_polygon_editor | ドラッグ・追加・削除 |
| Web 版 | Terra Draw | Mapbox / MapLibre / Google Maps / Leaflet 対応 |
| ビジネスロジック | Go または Dart | データ管理・GeoJSON 処理 |
| バックエンド API | Go | データ保存・同期 |

### ライブラリの責務範囲

このライブラリは**データ層のみ**を担う。レンダリング・入力処理は担わない。

```
┌─────────────────────────────────┐
│        map-polygon-editor        │
│                                  │
│  Area管理 / undo/redo / storage  │  ← このライブラリの範囲
│  geometry演算 / 共有境界連動     │
└──────────────┬───────────────────┘
               │ GeoJSON の入出力のみ
   ┌───────────┼────────────┐
   ↓           ↓            ↓
Terra Draw  flutter_map  Google Maps
（Web）      （Flutter）  （JS/Flutter）
```

- ライブラリは **GeoJSON を受け取り / GeoJSON を返す** だけ
- 地図プロバイダーはアプリが選択・統合する

### 対応を想定する地図プロバイダー（アプリ側で統合）

- Google Maps API
- OpenStreetMap（Leaflet / MapLibre 経由）
- 国土地理院地図（XYZ タイル形式）

---

## 関連ドキュメント

- [ポリゴン・エリアレベル仕様](./polygon-area-levels.md)
