#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d node_modules ]]; then
  echo "[桌面素材助手] 未检测到 node_modules，正在执行 npm install …"
  npm install
fi

echo "[桌面素材助手] 正在启动 Electron + Vite …"
exec npm run electron:dev
