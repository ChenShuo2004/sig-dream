<div align="center">

<img src="desktop/assets/icon.png" alt="sig-dream logo" width="84" height="84" />

# sig-dream

**データベース不要・ローカル完結・すぐ使えるオープンソース AI 無限キャンバス＆動画制作スタジオ**

AI 画像生成、マルチリファレンス編集、動画生成、1,700+ プロンプト集、Canvas Agent を 1 つの無限キャンバスに統合し、**脚本 / リメイク / 差し替え**の 3 つのスタジオを内蔵しています。  
PostgreSQL やログイン設定なしで、デスクトップ版またはポータブル版を起動し、API キーを入れるだけで 30 秒で始められます。

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-27272a?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-27272a?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-111111?style=for-the-badge)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f4f4f5?style=for-the-badge&labelColor=f4f4f5&color=18181b)](README.ko.md)

[![Latest Release](https://img.shields.io/github/v/release/ChenShuo2004/sig-dream?style=for-the-badge&color=111111&labelColor=e4e4e7&label=Release)](https://github.com/ChenShuo2004/sig-dream/releases/latest)
[![GitHub Stars](https://img.shields.io/github/stars/ChenShuo2004/sig-dream?style=for-the-badge&color=18181b&labelColor=f4f4f5)](https://github.com/ChenShuo2004/sig-dream/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-111111?style=for-the-badge&labelColor=f4f4f5&color=18181b)](LICENSE)

</div>

<br/>

| ⚡ 32秒 ハイライト版（3D 映像） | 🎥 68秒 全機能紹介版（01–07） |
| --- | --- |
| [![32秒ハイライト版](docs/screenshots/fast-hype-promo.gif)](docs/demos/00-fast-hype-promo.mp4)<br/><sub>[1080p 音声付き MP4](docs/demos/00-fast-hype-promo.mp4)</sub> | [![68秒全機能紹介版](docs/screenshots/full-overview-promo.gif)](docs/demos/00-full-overview-promo.mp4)<br/><sub>[1080p 音声付き MP4](docs/demos/00-full-overview-promo.mp4)</sub> |

### 3 つのスタジオ実測デモ（クリックで 1080p 音声付き MP4 を再生）

| 🎬 脚本スタジオ | ⚡ リメイクスタジオ | 🎭 差し替えスタジオ |
| --- | --- | --- |
| [![脚本スタジオ](docs/demos/03-script-studio.gif)](docs/demos/03-script-studio.mp4)<br/><sub>脚本 → 2K 設定画 → 16 コンテ＆実写生成 · [1080p MP4](docs/demos/03-script-studio.mp4)</sub> | [![リメイクスタジオ](docs/demos/04-replication-studio.gif)](docs/demos/04-replication-studio.mp4)<br/><sub>動き解析 → 新キャラ差し替え → 16:9 動画 · [1080p MP4](docs/demos/04-replication-studio.mp4)</sub> | [![差し替えスタジオ](docs/demos/06-replacement-studio.gif)](docs/demos/06-replacement-studio.mp4)<br/><sub>元動画 ⇄ 新人物＆吹き替え同時比較 · [1080p MP4](docs/demos/06-replacement-studio.mp4)</sub> |

## ダウンロード & クイックスタート

### 1. デスクトップアプリ（おすすめ・Node.js 不要）

[**GitHub Releases 最新版**](https://github.com/ChenShuo2004/sig-dream/releases/latest) から OS に合うインストーラーをダウンロードして起動するだけです：

- **macOS**：`sig-dream-*-mac-arm64.dmg`（Apple Silicon）/ `sig-dream-*-mac-x64.dmg`（Intel）
- **Windows**：`sig-dream-*-win-x64-setup.exe` / `sig-dream-*-win-x64.zip`
- **Linux**：`sig-dream-*-linux-x64.AppImage` / `.deb`

> [!TIP]
> コミュニティ版のインストーラーは未署名のため、初回起動時に警告が出た場合は macOS では `xattr -cr /Applications/sig-dream.app`、Windows では「詳細情報」→「実行」で起動できます。

### 2. Web ポータブル版（`npm install` 不要・Node.js 20+）

Releases から `sig-dream-*-web-portable.zip` をダウンロードして展開し、起動スクリプト（`启动-macOS.command` / `启动-Windows.bat` / `./start.sh`）を実行してください。

### 3. Docker Compose / ソースから起動

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream

# Docker Compose
docker compose up -d

# または Node.js 20+ で開発起動
npm install
npm run dev
```

起動後、[http://localhost:3000](http://localhost:3000) を開き、右上の **⚙️ 設定** からモデルチャネル（Base URL と API Key）を登録してご利用ください。

## 機能デモ動画

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/home-overview-dark.jpg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/home-overview-light.jpg" />
    <img src="docs/screenshots/home-overview-light.jpg" alt="sig-dream ホーム画面：脚本・キャンバス・完成映像をひとつの画面に" width="100%" />
  </picture>
  <p>
    <sub><b>sig-dream ホーム画面</b>：無限キャンバス、脚本 / リメイク / 差し替えスタジオ、1,700+ プロンプト集、ローカルアセットへすぐアクセス（ライト / ダーク対応）</sub>
  </p>
</div>

以下のデモはオープンソース版の実画面からレンダリングされています（クリックすると `1080p` MP4 を開きます）：

| 01 · 初期設定＆マルチプロバイダー | 02 · 無限キャンバス編成 |
| --- | --- |
| [![01](docs/demos/01-overview-and-config.gif)](docs/demos/01-overview-and-config.mp4) | [![02](docs/demos/02-infinite-canvas.gif)](docs/demos/02-infinite-canvas.mp4) |

| 03 · 脚本スタジオ | 04 · リメイク＆差し替えスタジオ |
| --- | --- |
| [![03](docs/demos/03-script-studio.gif)](docs/demos/03-script-studio.mp4) | [![04](docs/demos/04-replication-and-replacement.gif)](docs/demos/04-replication-and-replacement.mp4) |

| 05 · 34+ 内蔵クリエイティブ＆動画 Skill | ノード参照編集 |
| --- | --- |
| ![](docs/screenshots/skills-center-dark.jpg) | ![](docs/screenshots/canvas-edit-light.jpg) |

## 主な機能

- **無限キャンバス（`/canvas`）**：画像・動画・テキストノードの接続、グループ参照、マスク編集、Canvas Agent 連携。
- **3 つのスタジオ（`/studio/*`）**：脚本スタジオ（キャラ・背景・絵コンテ一括生成）、リメイクスタジオ、差し替えスタジオ。
- **34+ 内蔵 Skill センター & ローカルアセット（`/skills`・`/assets`）**：動画制作ワークフロー・解剖学/絵コンテ技法・18 の動画/3D エンジン Skill を `.agents/skills/` に標準搭載。すべてのデータと API キーはローカル IndexedDB に保存。
- **内蔵ローカル CORS プロキシ（[`server/proxy.mjs`](server/proxy.mjs)）**：OpenAI 互換 / Gemini / DeepSeek / 火山エンジン（Seedance 2.0） / RunningHub などを追加バックエンドなしで利用可能。

## エンタープライズ版（クローズドソース）

本リポジトリは個人・ローカル利用向けの MIT オープンソース版です。チーム向け LAN NAS アセットライブラリ、権限管理・監査ログ、音声クローン/カバー制作スタジオなどは商用エンタープライズ版（非公開ソース）の機能となります。詳細は [README.en.md](README.en.md) または [@ChenshuoAI](https://x.com/ChenshuoAI) をご確認ください。

## ライセンス

[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）をベースに開発しています。元ライセンスは [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas) に保持し、本プロジェクトは [MIT License](LICENSE) で公開しています。
