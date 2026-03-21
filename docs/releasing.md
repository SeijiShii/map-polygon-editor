# リリース手順

npm パッケージ `map-polygon-editor` のリリース手順。

## 前提

- npm アカウント: `seijishii`
- レジストリ: https://www.npmjs.com/package/map-polygon-editor
- WSL 環境では `npm login` がブラウザを開けないため、アクセストークンで認証する

## npm 認証（初回 or トークン失効時）

1. https://www.npmjs.com/settings/seijishii/tokens にアクセス
2. 「Generate New Token」→「Classic Token」→ タイプ **Publish** を選択
3. 生成されたトークンをコピーし、WSL で実行:

```bash
npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE
```

認証状態の確認:

```bash
npm whoami
# → seijishii と表示されれば OK
```

## リリース手順

### 1. テスト・ビルド確認

```bash
npm test
npm run build
```

### 2. バージョン更新

[semver](https://semver.org/) に従う:

| 変更内容 | コマンド | 例 |
|---------|---------|-----|
| バグ修正 | `npm version patch` | 0.1.0 → 0.1.1 |
| 機能追加（後方互換） | `npm version minor` | 0.1.0 → 0.2.0 |
| 破壊的変更 | `npm version major` | 0.1.0 → 1.0.0 |

`npm version` は自動で git tag を作成する。

### 3. 公開

```bash
npm publish
```

### 4. git push

```bash
git push origin main --tags
```

## パッケージ構成

```
公開されるファイル (files: ["dist"]):
  dist/index.js       ESM バンドル
  dist/index.cjs      CJS バンドル
  dist/index.d.ts     型定義 (ESM)
  dist/index.d.cts    型定義 (CJS)
  dist/*.map          ソースマップ
  package.json
  README.md
  LICENSE
```

## 利用側のインストール

```bash
npm install map-polygon-editor
```

```ts
// ESM
import { NetworkPolygonEditor } from "map-polygon-editor";

// CJS
const { NetworkPolygonEditor } = require("map-polygon-editor");
```

## トラブルシューティング

### `ENEEDAUTH` エラー

トークンが未設定または失効している。「npm 認証」セクションの手順でトークンを再設定する。

### `npm login` が WSL で失敗する

`ERR_INVALID_ARG_TYPE` エラーが出る場合、WSL からブラウザを開けないことが原因。トークン方式で認証する。

### バージョンが既に存在する

`npm version patch/minor/major` でバージョンを上げてから再度 `npm publish`。
