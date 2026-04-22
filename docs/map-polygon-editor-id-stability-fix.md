# `map-polygon-editor`: polygon ID 永続化の修正提案

## 背景

`NetworkPolygonEditor.init()` が起動のたびに polygon ID を再生成するため、polygon ID を外部参照する利用側（区域↔多角形紐付け、P2P 同期、URL/共有データ等）が壊れる。

利用側 `home-visit-suite` では `RemapPolygonIds` IPC で都度書き換えて救済しているが、

- 競合バグ（区域ツリー読み込みが remap 完了より早いと旧 ID で参照して描画失敗）
- P2P 同期では端末ごとに ID が再採番→相互の remap が循環して ID が永続しない
- 同期遅延中は他端末の polygon ID と不整合

など、ライブラリ側で polygon ID を永続化すれば解消する問題が多い。

## 症状（利用側）

- アプリの初回ロード時に地図のマーカー・ポリゴンが描画されない（`buildAreaDetailViewModel` が `targetPolygonId` を見つけられず null を返す）
- 別ページに遷移して戻ると描画される（その間に `remapPolygonIds` が完了し binding が更新されているため）

## 根本原因

`src/network-polygon-editor.ts` の `init()` を擬似コードで示すと:

```ts
async init() {
  // 頂点・辺は ID 保存されている → そのまま復元（ID 安定）
  for (const v of data.vertices) this.network.addVertex(v.lat, v.lng, v.id);
  for (const e of data.edges)    this.network.addEdge(e.v1, e.v2, e.id);

  // 多角形は辺グラフから再導出 → updateFromFaces で全部「新規」扱い
  // previousPolygons (this.polygons) が空なので matchIdentity の
  // 旧 ID 継承ロジックが効かず、createPolygonID(generateId()) で新 ID 採番
  const faces = enumerateFaces(this.network);
  this.polygonManager.updateFromFaces(faces, this.network);

  // 保存ポリゴンからは locked / active 状態だけを edgeKey 照合で復元
  // ★ID は復元されない★
  if (data.polygons) {
    const loadedByEdgeKey = new Map();
    for (const p of data.polygons) {
      loadedByEdgeKey.set([...p.edgeIds].sort().join(","), p);
    }
    for (const poly of this.polygonManager.getAllPolygons()) {
      const loaded = loadedByEdgeKey.get([...poly.edgeIds].sort().join(","));
      if (loaded) {
        if (loaded.locked != null) this.polygonManager.setStatus(poly.id, "locked", loaded.locked);
        if (loaded.active != null) this.polygonManager.setStatus(poly.id, "active", loaded.active);
      }
    }
  }
}
```

`PolygonManager.matchIdentity` 自体は edgeSet 重複で旧 ID を継承する設計だが、`init()` での `updateFromFaces` 呼び出し時点では `previousPolygons`（= `this.polygons`）が空なので継承機構が一切働かない。

## 修正方針

辺グラフ再導出より **前** に保存ポリゴンを `polygonManager.polygons` に流し込めば、`updateFromFaces` 内の `matchIdentity` が edgeSet 重複で旧 ID を継承する。`createPolygonID(generateId())` の経路は「真に新しい多角形（保存に対応するエントリが無い）」のときだけ通る。

### コード修正案（`network-polygon-editor.ts`）

```ts
async init() {
  if (!this.adapter) return;
  const data = await this.adapter.loadAll();
  if (!data) return;

  // 1. 頂点・辺を ID ごと復元（既存のまま）
  for (const v of data.vertices) {
    this.network.addVertex(v.lat, v.lng, v.id);
  }
  for (const e of data.edges) {
    this.network.addEdge(e.v1, e.v2, e.id);
  }

  // 2. ★追加: 保存ポリゴンを polygonManager に直接ロードしておく
  //    こうすると次の updateFromFaces で previousPolygons が非空になり、
  //    matchIdentity が edgeSet 重複で旧 ID を継承できる。
  if (data.polygons) {
    this.polygonManager.loadSnapshots(data.polygons);
  }

  // 3. 辺グラフから faces 再導出 → updateFromFaces
  //    previousPolygons (= 直前にロードした保存ポリゴン) と edgeSet 重複で
  //    マッチした face は同じ ID を保持する。
  const faces = enumerateFaces(this.network);
  this.polygonManager.updateFromFaces(faces, this.network);

  // 4. ★削除可能: 旧 ID 復元ループはもはや不要
  //    matchIdentity は status (locked/active) も含めて旧スナップショットを継承する
  //    ようにする (下記 PolygonManager 側の修正参照)。
  //    後方互換のため当面残す場合は no-op として動く（ID が同じになるので
  //    setStatus を再度呼んでも結果は変わらない）。

  this.adapter?.onRemoteChange?.((change) => {
    const result = this.applyRemoteChange(change);
    this.onRemoteUpdate?.(result);
  });
}
```

### `PolygonManager` 側に追加する API

```ts
class PolygonManager {
  /**
   * 永続化されたポリゴンスナップショットを内部 Map に直接ロードする。
   * 次回の updateFromFaces で previousPolygons として参照され、
   * matchIdentity が edgeSet 重複で ID と status を継承する。
   * 通常は NetworkPolygonEditor.init() からのみ呼ばれる。
   */
  loadSnapshots(snapshots: readonly PolygonSnapshot[]): void {
    this.polygons.clear();
    for (const snap of snapshots) {
      this.polygons.set(snap.id, snap);
    }
  }
}
```

### `matchIdentity` の status 継承（既存ロジックの確認）

現状 `matchIdentity` で「単一マッチ」分岐に入った場合は旧 snap の `locked` / `active` を継承するように。既に継承していれば変更不要。継承していなければ:

```ts
} else if (overlapping.length === 1) {
  const prev = overlapping[0];
  usedPrevIds.add(prev.id);
  const snap: PolygonSnapshot = {
    id: prev.id,                 // ★ ID 継承
    edgeIds: newFace.edgeIds,
    holes: newFace.holes,
    vertexIds: collectVertexIds(newFace.edgeIds, network),
    ...(prev.snap.locked != null && { locked: prev.snap.locked }),  // ★
    ...(prev.snap.active != null && { active: prev.snap.active }),  // ★
  };
  newPolygons.set(snap.id, snap);
  // 形状が変わった場合は modified、同じなら省略
  if (!isEdgeSetEqual(prev.edgeSet, new Set(newFace.edgeIds))) {
    diff.modified.push({ before: prev.snap, after: snap });
  }
}
```

## テスト追加案（ライブラリ側）

```ts
describe("NetworkPolygonEditor.init() polygon ID 永続性", () => {
  it("init を 2 回呼んでも polygon ID が変わらない", async () => {
    const adapter = new InMemoryStorageAdapter();
    const editor1 = new NetworkPolygonEditor(adapter);
    await editor1.init();
    // 多角形を作る (e.g. 4 頂点で四角形)
    editor1.startDrawing();
    editor1.placeVertex(0, 0);
    editor1.placeVertex(0, 1);
    editor1.placeVertex(1, 1);
    editor1.placeVertex(1, 0);
    editor1.snapToVertex(/* 始点 */);
    await editor1.save();
    const id1 = editor1.getPolygons()[0].id;

    const editor2 = new NetworkPolygonEditor(adapter);
    await editor2.init();
    const id2 = editor2.getPolygons()[0].id;

    expect(id2).toBe(id1);  // ★ ID 継承
  });

  it("locked/active 状態も継承される", async () => {
    /* 上と同様、saveStatus 後に再 init して locked/active が一致すること */
  });

  it("頂点を移動しても polygon ID は維持される (matchIdentity 経由)", async () => {
    /* edgeSet が変わらない移動なら ID 継承 */
  });

  it("辺集合が完全に変わった場合は新 ID になる", async () => {
    /* 既存の matchIdentity 仕様の確認 */
  });
});
```

## 影響範囲（利用側 `home-visit-suite`）

修正がリリースされたら以下を撤去できる:

- `desktop/frontend/src/hooks/usePolygonEditor.ts` の `remapPolygonIds` 関数まるごと
- それを呼んでいる `init()` 内の旧 polygon 取得 (`adapter.loadAll()`) と remap 処理
- `desktop/frontend/src/services/polygon-service.ts` の `RemapPolygonIds` API
- Go 側 `desktop/internal/binding/region.go` の `RemapPolygonIds` ハンドラ
- 今回の修正 `VisitPageContainer.tsx` / `AreaDetailEditPageContainer.tsx` の「`loadTree` を `ready && editor` 後に gate」も不要（competition の前提自体が消える）

## P2P 同期上のメリット（LinkSelf 文脈）

- 端末 A で作成した polygon ID が **そのまま全端末で同一**
- 紐付けレコード (`area.polygonId`) が同期されるだけで OK、追加の remap 通信不要
- 各端末で独立に init → remap → 他端末へ伝播 → 再 remap の循環が消える
- 既存の永続データ（保存済み `area.polygonId`）はそのまま有効
