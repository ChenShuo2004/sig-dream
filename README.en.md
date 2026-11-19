[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)
[![Follow @ChenshuoAI](https://img.shields.io/badge/Follow-%40ChenshuoAI-bc7650?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

# sig-dream · sig Canvas

**A zero-database, local-first open-source AI infinite canvas and creative video studio.**

Chain AI image generation, multi-reference image editing, video generation, prompt libraries, and Canvas Agent on one infinite canvas — alongside built-in **Script**, **Replication**, and **Replacement** studios. All projects, assets, and API keys stay locally in your browser (IndexedDB / LocalStorage with export/import backup). No PostgreSQL, no login server, no complex setup — add your API key and start creating in 30 seconds.

<img src="docs/screenshots/canvas-board.png" alt="sig Canvas infinite workflow" width="1000">

## Features

| Workspace | Route | Highlights |
| --- | --- | --- |
| **Infinite Canvas** | `/canvas` | Connect image, video, and text nodes; group references, mask editing, and Canvas Agent orchestration. |
| **Image & Video** | `/image` · `/video` | Dedicated image and video generation pages with first/last-frame & multi-reference modes. |
| **Script Studio** | `/studio/script` | Turn scripts into consistent character, scene, prop sheets, and episode storyboards. |
| **Replication Studio** | `/studio/replication` | Break down reference videos into shot-by-shot prompts and regenerate segments. |
| **Replacement Studio** | `/studio/replacement` | Swap subjects or objects in images and videos across supported model providers. |
| **Prompt Library** | `/prompts` | 1,700+ curated open-source prompts ready to search, copy, or save to local assets. |
| **Local Assets** | `/assets` | Manage reusable local images, videos, and text snippets directly in your browser. |

## Preview

<img src="docs/screenshots/canvas-edit.png" alt="Select any image node to edit" width="1000">

<details>
<summary>More screenshots: Prompt Library & Script Studio</summary>

<img src="docs/screenshots/prompt-library.png" alt="Prompt Library" width="1000">

<img src="docs/screenshots/studio-script.png" alt="Script Studio" width="1000">

</details>

## Quick Start

### Option 1: Local Node.js (Recommended)

Requires Node.js 20+:

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click the settings icon, and add your model provider (Base URL + API Key).

> Both `npm run dev` and `npm run build && npm start` include a lightweight built-in CORS proxy ([`server/proxy.mjs`](server/proxy.mjs)) for providers that block direct browser requests. No database or separate backend is needed.

### Option 2: Docker

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

Then open [http://localhost:3000](http://localhost:3000).

## Credits & License

- Built on [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) (MIT License), extended with Script / Replication / Replacement studios and multi-provider video adapters. The original license is preserved in [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas).
- Licensed under the [MIT License](LICENSE).
