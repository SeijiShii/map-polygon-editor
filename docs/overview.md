# map-polygon-editor 仕様書

## プロジェクト概要

複数の地図プロバイダー（Google Maps API、OpenStreetMap、国土地理院地図など）を横断して抽象化し、地図上でポリゴンの追加・編集を行うためのライブラリ。

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

### 地図プロバイダー

以下を切り替え可能な抽象レイヤーを設ける：

- Google Maps API
- OpenStreetMap（Leaflet / MapLibre 経由）
- 国土地理院地図（XYZ タイル形式）

---

## 関連ドキュメント

- [ポリゴン・エリアレベル仕様](./polygon-area-levels.md)
