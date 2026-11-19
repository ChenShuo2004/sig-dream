<div align="center">

# sig-dream · sig キャンバス

**データベース不要・ローカル完結のオープンソース AI 無限キャンバス＆動画制作スタジオ**

AI 画像生成、マルチリファレンス編集、動画生成、1,700+ プロンプト集、Canvas Agent を 1 つの無限キャンバスに統合し、**脚本 / リメイク / 差し替え**スタジオを内蔵しています。  
PostgreSQL やログイン設定なしで、API キーを入れるだけで 30 秒で始められます。

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)

[![GitHub Stars](https://img.shields.io/github/stars/ChenShuo2004/sig-dream?style=for-the-badge&color=bc7650)](https://github.com/ChenShuo2004/sig-dream/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

</div>

<br/>

<img src="docs/screenshots/canvas-board.png" alt="sig キャンバス" width="100%">

## 主な機能

- **無限キャンバス（`/canvas`）**：画像・動画・テキストノードの接続、グループ参照、マスク編集、Canvas Agent 連携。
- **3 つのスタジオ（`/studio/*`）**：脚本スタジオ（キャラ・背景・絵コンテ一括生成）、リメイクスタジオ、差し替えスタジオ。
- **1,700+ プロンプト集 & ローカルアセット（`/prompts`・`/assets`）**：すべてブラウザの IndexedDB / LocalStorage に保存され、エクスポート/インポートに対応。
- **内蔵ローカル CORS プロキシ（[`server/proxy.mjs`](server/proxy.mjs)）**：OpenAI / Gemini / DeepSeek / 火山エンジン / RunningHub などを追加バックエンドなしで利用可能。

## 30 秒クイックスタート

### Node.js（Node 20+）

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、右上の設定から Base URL と API Key を入力してご利用ください。

### Docker

```bash
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

## ライセンス

[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）をベースに開発しています。元ライセンスは [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas) に保持し、本プロジェクトは [MIT License](LICENSE) で公開しています。
