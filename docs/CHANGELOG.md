# Changelog

## [0.6.0] - 2026-04-22

### Added

- `PolygonManager.loadSnapshots(snapshots)` — ロード済みの polygon snapshots を内部マップに直接流し込む API。主に `NetworkPolygonEditor.init()` で `updateFromFaces` の前に `previousPolygons` を用意するために使われる。

### Fixed

- `NetworkPolygonEditor.init()` が呼び出されるたびに全 polygon の `id` が再採番されていた問題を修正。保存済みスナップショットを face 再導出より前に `PolygonManager` に流し込むことで、`matchIdentity` が edgeSet / vertexSet の重複から旧 ID を継承できるようになった。これにより polygon ID を外部参照する区域紐付け・P2P 同期・URL 共有などが安定して動作する。

### Changed

- `init()` 内の edgeKey 正規化による `locked` / `active` 再適用ループを削除。`matchIdentity` 側で status が継承されるため不要になった。

## [0.5.0] と過去のリリース

それ以前の履歴は git log を参照。
