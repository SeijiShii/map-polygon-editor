#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}=== map-polygon-editor publish ===${NC}"
echo ""

# Show current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "現在のバージョン: ${GREEN}${CURRENT_VERSION}${NC}"
echo ""

# Check npm auth
if ! npm whoami &>/dev/null; then
  echo -e "${YELLOW}npmにログインしていません${NC}"
  echo ""
  echo "アクセストークンを入力してください"
  echo "(https://www.npmjs.com/settings/seijishii/tokens で生成)"
  echo ""
  read -rp "トークン: " NPM_TOKEN
  if [ -z "$NPM_TOKEN" ]; then
    echo -e "${RED}トークンが入力されませんでした。中止します。${NC}"
    exit 1
  fi
  npm config set "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"
  echo ""
  if npm whoami &>/dev/null; then
    echo -e "${GREEN}認証成功: $(npm whoami)${NC}"
  else
    echo -e "${RED}認証失敗。トークンを確認してください。${NC}"
    exit 1
  fi
else
  echo -e "npmアカウント: ${GREEN}$(npm whoami)${NC}"
fi
echo ""

# Ask what was updated
echo "今回の更新内容を入力してください:"
read -rp "> " UPDATE_DESCRIPTION
if [ -z "$UPDATE_DESCRIPTION" ]; then
  echo -e "${RED}更新内容が入力されませんでした。中止します。${NC}"
  exit 1
fi
echo ""

# Ask version bump type
echo "バージョンの種類を選択してください:"
echo ""
echo -e "  ${CYAN}1${NC}) patch  (バグ修正)           → $(node -p "
  const v = '${CURRENT_VERSION}'.split('.');
  v[2] = Number(v[2]) + 1;
  v.join('.')
")"
echo -e "  ${CYAN}2${NC}) minor  (機能追加・後方互換)  → $(node -p "
  const v = '${CURRENT_VERSION}'.split('.');
  v[1] = Number(v[1]) + 1;
  v[2] = 0;
  v.join('.')
")"
echo -e "  ${CYAN}3${NC}) major  (破壊的変更)          → $(node -p "
  const v = '${CURRENT_VERSION}'.split('.');
  v[0] = Number(v[0]) + 1;
  v[1] = 0;
  v[2] = 0;
  v.join('.')
")"
echo ""
read -rp "選択 [1/2/3]: " VERSION_CHOICE

case "$VERSION_CHOICE" in
  1) BUMP="patch" ;;
  2) BUMP="minor" ;;
  3) BUMP="major" ;;
  *)
    echo -e "${RED}無効な選択です。中止します。${NC}"
    exit 1
    ;;
esac
echo ""

# Run tests
echo -e "${CYAN}テスト実行中...${NC}"
npm test
echo ""

# Run build
echo -e "${CYAN}ビルド中...${NC}"
npm run build
echo ""

# Version bump
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
echo -e "バージョン更新: ${YELLOW}${CURRENT_VERSION}${NC} → ${GREEN}${NEW_VERSION}${NC}"
echo ""

# Confirm
echo "以下の内容で公開します:"
echo ""
echo -e "  パッケージ: ${CYAN}map-polygon-editor${NC}"
echo -e "  バージョン: ${GREEN}${NEW_VERSION}${NC}"
echo -e "  更新内容:   ${UPDATE_DESCRIPTION}"
echo ""
read -rp "公開しますか？ [y/N]: " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  # Revert version
  npm version "$CURRENT_VERSION" --no-git-tag-version &>/dev/null
  echo -e "${YELLOW}中止しました。バージョンを元に戻しました。${NC}"
  exit 0
fi
echo ""

# Publish
echo -e "${CYAN}npmに公開中...${NC}"
npm publish
echo ""

# Git commit and tag
git add package.json package-lock.json
git commit -m "release: ${NEW_VERSION}

${UPDATE_DESCRIPTION}"
git tag "$NEW_VERSION"
echo ""

echo -e "${GREEN}=== 公開完了 ===${NC}"
echo ""
echo -e "  npm: https://www.npmjs.com/package/map-polygon-editor"
echo -e "  バージョン: ${GREEN}${NEW_VERSION}${NC}"
echo ""
echo -e "${YELLOW}リモートにpushする場合:${NC}"
echo "  git push origin main --tags"
echo ""
