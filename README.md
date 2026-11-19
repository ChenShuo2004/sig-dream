<div align="center">

# sig-dream · sig画布

**开源、零数据库、本地优先的 AI 无限画布与视频创作工作室**

在一张无限画布上串起 AI 生图、多图参考改图、视频生成、1700+ 提示词库与 Canvas Agent，并内置 **剧本 / 复刻 / 替换** 三大创作工作室。  
无需 PostgreSQL，无需注册登录，填上你的模型 API Key，30 秒即可开始创作。

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)

[![关注作者 X](https://img.shields.io/badge/%E5%85%B3%E6%B3%A8%E4%BD%9C%E8%80%85-%40ChenshuoAI-bc7650?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)
[![GitHub Stars](https://img.shields.io/github/stars/ChenShuo2004/sig-dream?style=for-the-badge&color=bc7650)](https://github.com/ChenShuo2004/sig-dream/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

[快速开始](#-30-秒快速开始) · [核心功能](#-核心工作区) · [支持模型](#-支持的模型与渠道) · [Docker 部署](#方式二docker-一行启动) · [常见问题](#-常见问题)

</div>

<br/>

<img src="docs/screenshots/canvas-board.png" alt="sig画布：按剧本、角色、场景、道具、关键帧与成片分组的无限画布工作流" width="100%">

## 为什么选择 sig-dream？

- **30 秒即开即用，零运维负担**：不依赖 PostgreSQL、Redis 或复杂后端配置，`npm run dev` 或一行 `docker run` 即可启动，打开浏览器填入 API Key 就能出图出片。
- **从灵感到成片的一体化工作流**：不只是节点画布，还内置 **剧本工作室、复刻工作室、替换工作室** 与 **1700+ 开源提示词库**，覆盖角色设定、分镜拆解、参考改图到视频生成。
- **数据完全留在本地**：所有画布项目、工作室工程、本地资产与 API Key 均保存在当前浏览器的 IndexedDB / LocalStorage，支持导出/导入项目文件与配置 JSON；内置轻量级本地 CORS 代理，不收集隐私、不经过第三方账号服务。

---

## 核心工作区

| 工作区 | 路由 | 适合做什么 |
| --- | --- | --- |
| **无限画布** | `/canvas` | 图片、视频、文本节点自由连线；支持打组、多图参考编辑、局部遮罩标注、引用整组生成与 Canvas Agent 协同编排。 |
| **快速生图 / 生视频** | `/image` · `/video` | 单页快速生图与首尾帧 / 全能参考视频生成，刷新页面后自动续查远端任务状态，支持截取视频首帧、尾帧与当前帧。 |
| **剧本工作室** | `/studio/script` | 粘贴或上传剧本，统一视觉风格，自动拆分角色、场景、道具设定与逐集分镜。 |
| **复刻工作室** | `/studio/replication` | 上传参考视频拆解镜头与分镜脚本，逐段复刻并支持按修改意见单段重生成。 |
| **替换工作室** | `/studio/replacement` | 替换图片或视频中的主体人物与物体，支持多模型渠道自由切换。 |
| **提示词库** | `/prompts` | 聚合多个开源提示词源（1700+ 条），按来源与标签搜索筛选，一键复制或加入本地资产复用。 |
| **本地资产库** | `/assets` | 在浏览器本地统一管理常用角色图、场景图、视频与文本片段，随时拖入画布。 |

---

## 界面预览

### 选中任意节点即可参考改图

选中画布中的任意图片节点，在下方直接输入修改要求、选择模型与生成张数，结果会自动作为新节点连回原图，方便对比与迭代。

<img src="docs/screenshots/canvas-edit.png" alt="选中图片即可改图" width="100%">

### 剧本工作室：统一画风，批量拆解角色、场景与分镜

<img src="docs/screenshots/studio-script.png" alt="剧本工作室" width="100%">

### 内置 1700+ 开源提示词库

<img src="docs/screenshots/prompt-library.png" alt="提示词库" width="100%">

---

## 支持的模型与渠道

只需在右上角 **模型配置** 中添加你的渠道（Base URL + API Key），即可自由组合文本、生图与视频模型：

- **通用兼容协议**：任意 OpenAI 兼容接口、Google Gemini、DeepSeek 官方、OpenRouter 等
- **视频与工作流渠道**：火山引擎（Seedance 2.0 系列）、RunningHub（ComfyUI 工作流与视频编辑）、MiniMax H3 及主流聚合中转站
- **内置跨域代理**：`npm run dev` 与生产服务 `npm start` 均内置了零依赖本地代理 [`server/proxy.mjs`](server/proxy.mjs)，自动解决部分视频/中转接口的浏览器 CORS 限制

---

## 30 秒快速开始

### 方式一：本地 Node.js 启动（推荐）

环境要求：**Node.js 20+**

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

如需生产模式运行：

```bash
npm run build
npm start
```

### 方式二：Docker 一行启动

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

---

## 三步上手

1. **配置模型渠道**：打开页面后点击右上角设置图标，添加一个或多个模型渠道（填入 Base URL 与 API Key），点击测试连接确认可用。
2. **开始创作**：
   - 想自由连线做图/做视频 → 进入 **无限画布**（`/canvas`），新建项目后拖入图片或直接生成节点。
   - 想批量做分镜短片 → 进入 **剧本工作室**（`/studio/script`），粘贴文本后按步骤生成角色、场景与分镜。
   - 缺灵感 → 进入 **提示词库**（`/prompts`），一键复制到画布或收藏到 **本地资产库**。
3. **随时备份**：所有项目与配置均支持导出 JSON / 项目文件，更换浏览器或设备时可直接导入恢复。

---

## 项目结构

```text
sig-dream/
├── src/                # React + Vite 前端应用（画布、工作室、提示词库、本地资产）
├── public/             # 静态资源与图标
├── server/
│   ├── proxy.mjs       # 零依赖本地 CORS 转发代理
│   └── index.mjs       # 生产环境静态托管 + 代理入口
├── docs/screenshots/   # README 界面预览图
├── Dockerfile          # 多阶段构建极简镜像
├── vite.config.ts      # Vite 配置（开发模式自动挂载本地代理）
└── package.json
```

---

## 常见问题

<details>
<summary><b>1. 我的 API Key 和画布数据存在哪里？安全吗？</b></summary>

所有画布节点、工作室项目、本地资产和 API Key 全部保存在你当前浏览器的 IndexedDB / LocalStorage 中，不会上传到任何第三方服务器。内置的 `server/proxy.mjs` 只在你本机运行，仅用于在调用存在跨域限制的模型接口时转发请求，不做落盘存储。

</details>

<details>
<summary><b>2. 为什么安装依赖需要加 <code>--legacy-peer-deps</code>？</b></summary>

项目使用 React 19，部分 UI 依赖包的 peerDependencies 声明仍停留在 React 18，使用 `npm install --legacy-peer-deps` 可顺利完成安装并正常构建运行。

</details>

<details>
<summary><b>3. 清理浏览器缓存或换电脑后数据会丢吗？</b></summary>

由于数据默认存在浏览器本地存储，清理站点数据或切换浏览器不会自动同步。建议重要项目定期在画布内使用「导出」功能备份到本地磁盘，需要时一键导入即可。

</details>

---

## 致谢与许可证

- sig画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）二次开发，在其无限画布、生图、视频与 Agent 能力之上，扩展了剧本/复刻/替换工作室与多渠道视频模型适配。原项目许可证保留于 [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas)。
- 本项目采用 [MIT License](LICENSE) 开源，欢迎 Star、Fork 与 PR。

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=ChenShuo2004/sig-dream&type=Date)](https://star-history.com/#ChenShuo2004/sig-dream&Date)

</div>
