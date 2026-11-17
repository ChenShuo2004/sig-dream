#!/usr/bin/env bash
# macOS 上打包桌面素材助手（DMG + ZIP，x64 / arm64）。须在 Mac 上执行。
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f package.json ]]; then
  echo "[LCP Pack] ERROR: package.json not found. Run from desktop-client folder."
  exit 1
fi

echo "[LCP Pack] Desktop Material Assistant - macOS build"
echo "[LCP Pack] Output: ./release/"
echo ""

if [[ ! -d node_modules ]]; then
  echo "[LCP Pack] npm install ..."
  npm install
fi

echo "[LCP Pack] vite build ..."
npm run build

echo "[LCP Pack] electron-builder --mac (x64 + arm64) ..."
npx electron-builder --config electron-builder.yml --mac --x64 --arm64

echo ""
echo "[LCP Pack] Done. Artifacts:"
ls -la release/ 2>/dev/null || true
