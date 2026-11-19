[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)
[![关注作者 X](https://img.shields.io/badge/%E5%85%B3%E6%B3%A8%E4%BD%9C%E8%80%85-%40ChenshuoAI-bc7650?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

# sig-dream · sig画布

**零数据库、开箱即用的开源 AI 无限画布与视频创作工作室。**

在一张无限画布上串起 AI 生图、多图参考改图、视频生成、提示词库与 Canvas Agent，并内置 **剧本 / 复刻 / 替换** 三大创作工作室。所有画布项目、工作室数据与 API Key 均保存在你的浏览器本地（IndexedDB / LocalStorage，支持导出备份），不需要安装 PostgreSQL、不需要配置登录账号，填上模型 API Key 即可开始创作。

<img src="docs/screenshots/canvas-board.png" alt="sig画布：按剧本、角色、场景、道具、关键帧与成片分组的无限画布工作流" width="1000">

## 核心能力

| 工作区 | 入口 | 说明 |
| --- | --- | --- |
| **无限画布** | `/canvas` | 图片、视频、文本节点自由连线；支持打组、多图参考编辑、局部遮罩、引用整组生成与 Canvas Agent 编排。 |
| **快速生图 / 生视频** | `/image` · `/video` | 单页快速生图与首尾帧/全能参考生视频，支持刷新后续查远端任务状态。 |
| **剧本工作室** | `/studio/script` | 粘贴或上传剧本，统一视觉风格，拆分角色、场景、道具与逐集分镜。 |
| **复刻工作室** | `/studio/replication` | 按参考视频拆解镜头与分镜脚本，逐段复刻并支持按意见修补重生成。 |
| **替换工作室** | `/studio/replacement` | 替换图片或视频中的人物与物体，支持多模型渠道切换。 |
| **提示词库** | `/prompts` | 内置多个开源提示词源（1700+ 条），支持搜索筛选、一键复制或加入本地资产。 |
| **本地资产库** | `/assets` | 浏览器本地管理图片、视频与文本资产，随时拖入画布复用。 |

## 界面预览

### 选中图片即可改图

选中任意节点，在下方输入修改要求，选择模型与张数后直接生成；生成结果会作为新节点连回原图。

<img src="docs/screenshots/canvas-edit.png" alt="选中图片即可改图" width="1000">

### 提示词库与剧本工作室

<details>
<summary>展开查看：提示词库、剧本工作室截图</summary>

<img src="docs/screenshots/prompt-library.png" alt="提示词库" width="1000">

<img src="docs/screenshots/studio-script.png" alt="剧本工作室" width="1000">

</details>

## 30 秒快速启动

### 方式一：本地 Node.js 启动（推荐）

环境要求：Node.js 20+

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，点击右上角设置图标填入你的模型渠道（Base URL + API Key）即可开始使用。

> `npm run dev` 与生产模式 `npm run build && npm start` 均内置了轻量级本地 CORS 代理（[`server/proxy.mjs`](server/proxy.mjs)），用于解决火山引擎、RunningHub、DeepSeek 等接口的浏览器跨域问题，无需额外搭建后端或数据库。

### 方式二：Docker 一行启动

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

## 数据存储与隐私说明

- **完全本地化**：画布节点、工作室项目与本地资产存储在当前浏览器的 IndexedDB / LocalStorage 中，API Key 仅保存在本机，不会上传到任何第三方统计或账号服务器。
- **内置轻量代理**：仅在你调用需要跨域转发的接口时，通过本机 Node 服务把请求和你的 API Key 转发给对应模型提供商，不做持久化存储。
- **备份与迁移**：可在画布内直接导出/导入项目文件与模型配置 JSON，方便跨设备迁移。

## 致谢与许可证

- sig画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）二次开发，在其无限画布、生图、视频与 Agent 能力之上，扩展了剧本/复刻/替换工作室与多渠道视频模型适配。原项目许可证完整保留在 [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas)。
- 本项目采用 [MIT License](LICENSE) 开源。
