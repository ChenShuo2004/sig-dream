[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

# sig-dream · sig キャンバス

**データベース不要・ローカル完結のオープンソース AI 無限キャンバス＆動画制作スタジオ。**

AI 画像生成、マルチリファレンス編集、動画生成、プロンプト集、Canvas Agent を 1 つの無限キャンバスに統合し、**脚本 / リメイク / 差し替え**の 3 つのスタジオを内蔵しています。データと API キーはすべてブラウザローカル（IndexedDB / LocalStorage）に保存され、PostgreSQL やログイン設定なしで 30 秒で始められます。

<img src="docs/screenshots/canvas-board.png" alt="sig キャンバス" width="1000">

## クイックスタート

### Node.js（Node 20+）

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、右上の設定からモデルプロバイダー（Base URL + API Key）を入力するだけで利用できます。

### Docker

```bash
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

## ライセンス

[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）をベースに開発しています。元ライセンスは [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas) に保持し、本リポジトリは [MIT License](LICENSE) で公開しています。
