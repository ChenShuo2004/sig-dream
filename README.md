<div align="center">

<img src="desktop/assets/icon.png" alt="sig-dream logo" width="84" height="84" />

# sig-dream · sig画布

**开源、零数据库、开箱即用的本地优先 AI 无限画布与视频创作工作室**

在一张无限画布上串起 AI 生图、多图参考改图、视频生成、1700+ 开源提示词库与 Canvas Agent，内置 **剧本 / 复刻 / 替换** 三大创作工作室。  
无需 PostgreSQL，无需注册登录，下载桌面版或便携包，填上模型 API Key 即可在 30 秒内开始创作。

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)

[![Latest Release](https://img.shields.io/github/v/release/ChenShuo2004/sig-dream?style=for-the-badge&color=8d4d2e&label=Release)](https://github.com/ChenShuo2004/sig-dream/releases/latest)
[![GitHub Stars](https://img.shields.io/github/stars/ChenShuo2004/sig-dream?style=for-the-badge&color=bc7650)](https://github.com/ChenShuo2004/sig-dream/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)
[![关注作者 X](https://img.shields.io/badge/%E5%85%B3%E6%B3%A8%E4%BD%9C%E8%80%85-%40ChenshuoAI-bc7650?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)

[开箱即用下载](#开箱即用下载与快速启动) · [核心工作区](#核心工作区) · [界面预览](#界面预览) · [支持模型](#支持的模型与渠道) · [企业版（不开源）](#企业版不开源) · [常见问题](#常见问题)

</div>

<br/>

<img src="docs/screenshots/canvas-board.png" alt="sig画布：按剧本、角色、场景、道具、关键帧与成片分组的无限画布工作流" width="100%">

## 为什么选择 sig-dream？

- **真正开箱即用，零数据库运维**：不依赖 PostgreSQL、Redis 或账号后端。提供 **macOS / Windows / Linux 独立桌面安装包**、**免 `npm install` Web 便携包** 与 **Docker 一键启动**，打开填入 API Key 就能出图出片。
- **从灵感到成片的一体化工作室**：不只是节点画布，还内置 **剧本工作室、复刻工作室、替换工作室** 与 **1700+ 开源提示词库**，覆盖角色设定、分镜拆解、多图参考改图到视频生成。
- **数据与 Key 完全留在本地**：所有画布工程、工作室文档、本地资产与 API Key 均保存在本机 IndexedDB / LocalStorage，支持导出/导入 JSON 与项目包；内置零依赖本地 CORS 代理 [`server/proxy.mjs`](server/proxy.mjs)，不收集隐私、不经过第三方账号服务。

---

## 开箱即用下载与快速启动

### 方式一：下载独立桌面版（推荐 · 无需安装 Node.js）

前往 [**GitHub Releases 最新版本**](https://github.com/ChenShuo2004/sig-dream/releases/latest) 直接下载对应平台安装包：

| 平台 | 推荐安装包 | 说明 |
| --- | --- | --- |
| **macOS（Apple Silicon M1–M4）** | `sig-dream-*-mac-arm64.dmg` | 拖入「应用程序」打开即用，内置本地服务与 CORS 代理 |
| **macOS（Intel 芯片）** | `sig-dream-*-mac-x64.dmg` | 同上 |
| **Windows（x64）** | `sig-dream-*-win-x64-setup.exe` / `.zip` | 提供标准安装版与解压即用的便携压缩包 |
| **Linux（x64）** | `sig-dream-*-linux-x64.AppImage` / `.deb` | 赋予可执行权限或使用 `apt` 安装 |

> [!TIP]
> 开源社区版安装包未配置付费代码签名证书，首次启动如遇系统拦截：
> - **macOS**：右键应用选「打开」，或在终端运行 `xattr -cr /Applications/sig-dream.app`
> - **Windows**：在 SmartScreen 弹窗中点击「更多信息」→「仍要运行」

### 方式二：Web 便携包（免 `npm install` · 仅需 Node.js 20+）

在 [**Releases**](https://github.com/ChenShuo2004/sig-dream/releases/latest) 下载 `sig-dream-*-web-portable.zip`（约 2.7 MB），解压后直接双击运行：

- **macOS**：双击 `启动-macOS.command`
- **Windows**：双击 `启动-Windows.bat`
- **Linux / 终端**：运行 `./start.sh`

服务会自动启动并在默认浏览器打开（默认 `http://localhost:3000`，端口占用时自动顺延）。

### 方式三：Docker Compose 一键启动

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
docker compose up -d
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

### 方式四：源码开发模式（Node.js 20+）

仓库已内置 `.npmrc`，无需额外参数：

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install
npm run dev
```

生产构建与运行：

```bash
npm run build
npm run start:open
```

---

## 核心工作区

| 工作区 | 路由 | 适合做什么 |
| --- | --- | --- |
| **无限画布** | `/canvas` | 图片、视频、文本节点自由连线；支持打组、多图参考编辑、局部遮罩标注、引用整组生成与 Canvas Agent 协同编排。 |
| **剧本工作室** | `/studio/script` | 粘贴或上传剧本，统一视觉风格，自动拆分角色、场景、道具设定与逐集分镜。 |
| **复刻工作室** | `/studio/replication` | 上传参考视频拆解镜头与分镜脚本，逐段复刻并支持按修改意见单段重生成。 |
| **替换工作室** | `/studio/replacement` | 替换图片或视频中的主体人物与物体，支持多模型渠道自由切换。 |
| **快速生图 / 生视频** | `/image` · `/video` | 单页快速生图与首尾帧 / 全能参考视频生成，刷新页面后自动续查远端任务状态，支持截取视频首帧、尾帧与当前帧。 |
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

打开应用后点击右上角 **⚙️ 模型渠道与设置**，填入渠道地址（Base URL）与 API Key，即可自由组合文本、生图、视频与音频模型：

- **通用兼容协议**：任意 OpenAI 兼容接口、Google Gemini、DeepSeek 官方、OpenRouter 等
- **视频与工作流渠道**：火山引擎（Seedance 2.0 系列）、RunningHub（ComfyUI 工作流与视频编辑）、MiniMax H3 及主流聚合中转站
- **内置零依赖 CORS 代理**：开发模式、生产服务、Web 便携包与桌面客户端均内置 [`server/proxy.mjs`](server/proxy.mjs)，自动解决浏览器直连部分接口的跨域限制

---

## 三步上手

1. **配置模型渠道**：打开首页或任意页面，点击右上角 **⚙️ 设置** 图标（或首页「配置模型渠道」按钮），添加一个或多个模型渠道并填入 Base URL 与 API Key。
2. **进入工作区创作**：
   - 自由连线改图/生视频 → **无限画布**（`/canvas`）
   - 批量拆角色与分镜短片 → **剧本工作室**（`/studio/script`）
   - 拆解对标视频逐段复刻 → **复刻工作室**（`/studio/replication`）
   - 找参考与提示词灵感 → **提示词库**（`/prompts`）
3. **随时备份迁移**：支持一键导出/导入配置 JSON 与画布项目包，并可选配置 WebDAV 多设备同步。

---

## 企业版（不开源）

> [!IMPORTANT]
> **企业版为闭源商业版本，源码不开源。** 本仓库公开的为面向个人与单机创作的社区开源版（MIT License）；下方展示的团队局域网素材库、NAS 直传与剪辑软件直拖、多角色权限审计与声音克隆/翻唱工作台属于企业版能力，源码不对外开放。

**从剧本到成片，全在一张画布。**<br/>
无限画布 × 局域网素材库 × 团队桌面直拖 · `FROM SCRIPT TO FINAL CUT. ALL ON ONE CANVAS.`

<img src="docs/screenshots/enterprise-promo.gif" alt="sig-dream 企业版宣传片预览：从剧本到成片，全在一张画布" width="1000">

### 社区开源版 vs. 企业版（不开源）

| 能力维度 | 社区开源版（本仓库 · MIT） | 企业版（闭源 · 不开源） |
| --- | --- | --- |
| 源码与授权 | MIT 开源，单机开箱即用 | 闭源商业授权，源码不开源 |
| 无限画布与工作室 | 无限画布、生图/改图/视频、1700+ 提示词库、剧本/复刻/替换工作室 | 包含社区版全部能力 + 团队画布共享与全流程分组生产编排 |
| 运行与桌面端 | Web 便携包、Docker、macOS / Windows / Linux 单机桌面版 | 团队桌面客户端：直连局域网 NAS 素材库，原片直接拖进剪映/PR/达芬奇 |
| 局域网素材库与文件机 | 本地 IndexedDB 存储 + JSON/WebDAV 备份 | PostgreSQL 元数据 + 局域网文件机（NAS 直传、自动缩略图与 H.264 预览，原片不出内网） |
| 团队权限与审计 | 无需登录（单人使用） | 双素材库域隔离、4 种角色 / 30 项精细权限点、全量操作审计日志 |
| 声音克隆与改词翻唱 | — | 集成局域网 GPU 推理（Seed-VC 零样本换音色 + SVS 改词翻唱与 A/B 对比） |
| 部署与支持 | GitHub Issues 社区交流 | 企业内网私有化部署、多机节点接入与专属技术支持 |

如需企业版完整高清演示、内网私有化部署或商业授权咨询，请联系作者 [@ChenshuoAI](https://x.com/ChenshuoAI)。

---

## 项目结构

```text
sig-dream/
├── src/                      # React 19 + Vite 前端应用（首页、画布、三大工作室、提示词库、本地资产）
├── public/                   # 静态资源与品牌图标
├── server/
│   ├── proxy.mjs             # 零依赖本地 CORS 转发代理
│   └── index.mjs             # 生产托管 + 端口顺延 + 自动打开浏览器入口
├── desktop/                  # 社区版 macOS / Windows / Linux 轻量级 Electron 桌面壳
├── scripts/
│   └── build-portable.mjs    # 打包免 npm install 的 Web 便携压缩包
├── docs/screenshots/         # 界面预览图与宣传动图
├── .github/workflows/
│   └── release.yml           # 推送 v* 标签自动构建并发布 Web 便携包与三端桌面版
├── Dockerfile                # 多阶段构建镜像（带 /healthz 健康检查）
├── docker-compose.yml        # 一键容器编排
└── package.json
```

---

## 常见问题

<details>
<summary><b>1. 我的 API Key 和画布数据存在哪里？安全吗？</b></summary>

所有画布节点、工作室项目、本地资产和 API Key 全部保存在你本机的 IndexedDB / LocalStorage 中，不会上传到任何第三方服务器。内置的 `server/proxy.mjs` 只在你本机运行，仅用于在调用存在跨域限制的模型接口时转发请求，不做落盘存储。

</details>

<details>
<summary><b>2. 桌面版重启后，我保存在里面的画布和 API Key 会丢吗？</b></summary>

不会。桌面版默认固定绑定本机回环地址 `http://127.0.0.1:28430`，保证每次启动的存储源一致，你的画布工程、本地资产和 API Key 都会持续保留。建议重要项目定期通过导出功能做额外本地备份。

</details>

<details>
<summary><b>3. 之前下载过 v0.2.0 旧版本，需要升级吗？</b></summary>

强烈建议升级到 `v0.3.0+`。早期 `v0.2.0` 依赖旧版后端服务架构；从 `v0.3.0` 起，社区开源版已重构为零数据库本地优先架构，真正做到下载即用，不再需要搭建后端或数据库。

</details>

---

## 致谢与许可证

- sig画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）二次开发，在其无限画布、生图、视频与 Agent 能力之上，扩展了剧本 / 复刻 / 替换三大工作室、多渠道视频模型适配与开箱即用桌面/便携打包方案。原项目许可证保留于 [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas)。
- 本项目采用 [MIT License](LICENSE) 开源，欢迎 Star、Fork 与 PR。

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=ChenShuo2004/sig-dream&type=Date)](https://star-history.com/#ChenShuo2004/sig-dream&Date)

</div>
