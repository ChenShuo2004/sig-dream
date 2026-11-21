<div align="center">

<img src="desktop/assets/icon.png" alt="sig-dream logo" width="84" height="84" />

# sig-dream · sig画布

**开源、零数据库、开箱即用的本地优先 AI 无限画布与视频创作工作室**

在一张无限画布上串起 **AI 生图、多图参考改图、视频生成、1700+ 开源提示词库与 Canvas Agent**，内置 **剧本 / 复刻 / 替换** 三大视频创作工作流。  
无需 PostgreSQL，无需注册登录 —— 下载独立桌面客户端或 Web 便携包，填入模型 API Key 即可在 30 秒内开始创作。

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-111111?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-27272a?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f4f4f5?style=for-the-badge&labelColor=f4f4f5&color=18181b)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f4f4f5?style=for-the-badge&labelColor=f4f4f5&color=18181b)](README.ko.md)

[![Latest Release](https://img.shields.io/github/v/release/ChenShuo2004/sig-dream?style=for-the-badge&color=111111&labelColor=e4e4e7&label=Release)](https://github.com/ChenShuo2004/sig-dream/releases/latest)
[![GitHub Stars](https://img.shields.io/github/stars/ChenShuo2004/sig-dream?style=for-the-badge&color=18181b&labelColor=f4f4f5)](https://github.com/ChenShuo2004/sig-dream/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-111111?style=for-the-badge&labelColor=f4f4f5&color=18181b)](LICENSE)
[![关注作者 X](https://img.shields.io/badge/%E5%85%B3%E6%B3%A8%E4%BD%9C%E8%80%85-%40ChenshuoAI-111111?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)

[快速安装](#开箱即用下载与快速启动) · [功能演示视频](#功能演示视频) · [核心工作区](#核心工作区) · [支持模型](#支持的模型与渠道) · [本地开发与打包](#本地开发测试与打包) · [企业版（闭源）](#企业版不开源) · [常见问题](#常见问题)

</div>

<br/>

<img src="docs/screenshots/canvas-board.png" alt="sig画布：按剧本、角色、场景、道具、关键帧与成片分组的无限画布工作流" width="100%">

## 核心亮点

- **真正开箱即用，零数据库运维**：不依赖 PostgreSQL、Redis 或账号后端。提供 **macOS / Windows / Linux 原生桌面安装包**、**免 `npm install` Web 便携包** 与 **Docker 一键启动**，打开填入 API Key 即可出图出片。
- **从灵感到成片的一体化工作台**：不止是自由节点画布，还内置 **剧本工作室、复刻工作室、替换工作室** 与 **1700+ 开源提示词中心**（内置 GitHub + jsDelivr 多源自动容灾缓存），覆盖角色设定、分镜拆解、多图改图到视频生成。
- **100% 本地优先与隐私可控**：所有画布工程、工作室文档、本地资产与 API Key 均保存在本机 IndexedDB / LocalStorage，支持一键导出/导入 JSON 与 `.zip` 项目包，可选配置 WebDAV 跨设备同步；内置零依赖本地 CORS 代理 [`server/proxy.mjs`](server/proxy.mjs)，不经过任何第三方账号服务器。

---

## 开箱即用下载与快速启动

### 方式一：独立桌面客户端（推荐 · 无需安装 Node.js）

前往 [**GitHub Releases 最新版本**](https://github.com/ChenShuo2004/sig-dream/releases/latest) 下载对应系统安装包（附 `SHA256SUMS.txt` 完整性校验）：

| 平台 | 推荐下载文件 | 说明 |
| --- | --- | --- |
| **macOS（Apple Silicon M1–M4）** | `sig-dream-*-mac-arm64.dmg` | 拖入「应用程序」打开即用；内置本地服务、CORS 代理与窗口状态记忆 |
| **macOS（Intel 芯片）** | `sig-dream-*-mac-x64.dmg` | 同上 |
| **Windows（x64）** | `sig-dream-*-win-x64-setup.exe` / `.zip` | 标准安装向导版（支持自定义目录）或解压即用绿色包 |
| **Linux（x64）** | `sig-dream-*-linux-x64.AppImage` / `.deb` | 赋予可执行权限直接运行，或使用 `apt` 安装 |

> [!TIP]
> 开源社区版安装包暂未配置付费商业代码签名证书，首次打开如遇系统安全提示：
> - **macOS**：右键应用图标选择「打开」，或在终端运行：`xattr -cr /Applications/sig-dream.app`
> - **Windows**：在 SmartScreen 弹窗中点击「更多信息」→「仍要运行」

### 方式二：Web 便携包（免 `npm install` · 仅需 Node.js 20+）

在 [**Releases**](https://github.com/ChenShuo2004/sig-dream/releases/latest) 下载 `sig-dream-*-web-portable.zip`（约 2.7 MB），解压后直接双击启动：

- **macOS**：双击 `启动-macOS.command`
- **Windows**：双击 `启动-Windows.bat`
- **Linux / 终端**：运行 `./start.sh`

本地服务将自动启动并在默认浏览器打开（默认 `http://localhost:3000`，端口占用时自动顺延）。

### 方式三：Docker Compose 一键部署

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
docker compose up -d
```

启动后访问 [http://localhost:3000](http://localhost:3000)（容器内置 `/healthz` 健康检查）。

### 方式四：源码运行（Node.js 22+ 推荐 / 20+ 兼容）

仓库已内置 `.npmrc`，克隆后即可直接启动：

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install
npm run dev
```

---

## 功能演示视频

以下 5 支模块短片均基于社区开源版真实运行界面自动实测渲染（页面内直接循环播放动图，点击任意画面或链接可查看 `1080p` 高清 MP4）：

| 01 · 零数据库启动与多渠道接入 | 02 · 无限画布多模态节点编排 |
| --- | --- |
| [![01 零数据库启动与多渠道接入](docs/demos/01-overview-and-config.gif)](docs/demos/01-overview-and-config.mp4)<br/><sub>无需登录注册，一键配置多模型渠道、本地代理与 WebDAV 同步 · [1080p MP4](docs/demos/01-overview-and-config.mp4)</sub> | [![02 无限画布多模态节点编排](docs/demos/02-infinite-canvas.gif)](docs/demos/02-infinite-canvas.mp4)<br/><sub>自由连线文本/图片/视频节点、分组管理、参考改图与本地 Agent 协同 · [1080p MP4](docs/demos/02-infinite-canvas.mp4)</sub> |

| 03 · 剧本工作室：统一画风与分镜拆解 | 04 · 复刻工作室与替换工作室 |
| --- | --- |
| [![03 剧本工作室](docs/demos/03-script-studio.gif)](docs/demos/03-script-studio.mp4)<br/><sub>支持上传剧本/改写/AI 创作，内置多分类风格库锁定全片角色与分镜画风 · [1080p MP4](docs/demos/03-script-studio.mp4)</sub> | [![04 复刻与替换工作室](docs/demos/04-replication-and-replacement.gif)](docs/demos/04-replication-and-replacement.mp4)<br/><sub>四步拆解对标原片逐段复刻，或一键替换视频人物主体与克隆音色 · [1080p MP4](docs/demos/04-replication-and-replacement.mp4)</sub> |

| 05 · 1700+ 开源提示词库与本地资产闭环 | 界面细节：选中图片直接参考改图 |
| --- | --- |
| [![05 1700+ 提示词库与本地资产](docs/demos/05-prompts-and-assets.gif)](docs/demos/05-prompts-and-assets.mp4)<br/><sub>聚合 1740+ 条高质量提示词，秒级筛选收藏至本地资产库并跨工作台复用 · [1080p MP4](docs/demos/05-prompts-and-assets.mp4)</sub> | ![](docs/screenshots/canvas-edit.png)<br/><sub>选中画布任意图片节点直接输入改图指令，新生成结果自动连线对比迭代</sub> |

---

## 核心工作区

| 工作区 | 路由 | 适用场景与核心能力 |
| --- | --- | --- |
| **无限画布** | `/canvas` | 图片、视频、音频、文本节点自由连线；支持打组、多图参考改图、局部遮罩标注、整组引用生成与 Canvas Agent 协同编排。 |
| **剧本工作室** | `/studio/script` | 粘贴或上传最高 10 万字剧本，选择统一视觉风格预设，自动拆分角色、场景、道具设定与逐集分镜脚本。 |
| **复刻工作室** | `/studio/replication` | 导入参考视频自动拆解镜头与提示词脚本，逐段复刻生成，支持按修改意见对单段重新生成。 |
| **替换工作室** | `/studio/replacement` | 支持「视频人物与声音替换」与「仅声音克隆」双模式，跨多模型渠道完成主体替换与成片合成。 |
| **生图 / 视频工作台** | `/image` · `/video` | 独立三栏快速生图与首尾帧 / 多参考视频创作台，刷新页面自动续查远端任务，支持视频首帧/尾帧/当前帧截取。 |
| **提示词中心** | `/prompts` | 实时聚合 7 大开源提示词源（1740+ 条），支持分类与标签过滤，一键复制或收藏至本地资产库。 |
| **本地资产库** | `/assets` | 在本机浏览器集中管理常用角色图、场景图、视频与提示词模板，支持打包导出与跨画布复用。 |

---

## 支持的模型与渠道

点击右上角 **⚙️ 模型渠道与设置**（或首页「配置模型渠道」），填入渠道地址（Base URL）与 API Key 即可自由组合文本、生图、视频与音频模型：

- **通用标准协议**：任意 OpenAI 兼容接口、Google Gemini、DeepSeek 官方、OpenRouter 等
- **视频与工作流生态**：火山引擎方舟（Seedance 2.0 系列）、RunningHub（ComfyUI 工作流与视频编辑）、MiniMax H3 及主流聚合中转渠道（OpenLux / AI007 / OnionCreate / Geeknow / APIMart 等）
- **零依赖本地 CORS 代理**：开发模式、生产服务、Web 便携包与桌面客户端均内置 [`server/proxy.mjs`](server/proxy.mjs)，自动转发存在浏览器跨域限制的上游接口，Key 仅随请求头透传、绝不落盘

---

## 本地开发、测试与打包

```bash
# 1. 类型检查与单元测试
npm run typecheck
npm test

# 2. 启动本地无 API Key 全流程端到端冒烟测试（需本机具备 Chromium / Chrome）
npm run test:smoke

# 3. 生产构建与本地预览托管
npm run build
npm run start:open

# 4. 构建免 npm install 的跨平台 Web 便携包（输出至 release/）
npm run build:portable

# 5. 启动或打包 Electron 桌面客户端（首次需先 cd desktop && npm install）
npm run desktop:dev     # 本地启动桌面客户端
npm run desktop:mac     # 打包 macOS dmg / zip (arm64 + x64)
npm run desktop:win     # 打包 Windows NSIS 安装包与便携 zip
npm run desktop:linux   # 打包 Linux AppImage / deb

# 6. 发版前一键同步根包、桌面包与 VERSION 版本号
npm run version:sync -- 0.3.2
```

推送与版本号一致的 `v*` Git 标签（如 `git tag v0.3.2 && git push origin main --tags`）即可触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)，自动完成类型检查、单测、Web 便携包与三端桌面安装包构建、SHA-256 校验生成并发布至 GitHub Releases。

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
├── src/                      # React 19 + TypeScript + Vite 7 前端（首页、无限画布、三大工作室、提示词库、资产库）
├── public/                   # 静态资源与品牌图标
├── server/
│   ├── proxy.mjs             # 零依赖本地 CORS 转发代理
│   └── index.mjs             # 生产静态托管 + 端口自动顺延 + /healthz 健康检查
├── desktop/                  # macOS / Windows / Linux 社区版 Electron 桌面客户端（带窗口记忆与菜单栏增强）
├── scripts/
│   ├── build-portable.mjs    # 打包免 npm install 的 Web 便携包
│   ├── sync-version.mjs      # 一键同步全仓版本号
│   ├── smoke-test.mjs        # Playwright 无 API Key 全模块端到端冒烟测试
│   └── render-demos.mjs      # Playwright + FFmpeg 模块化功能演示视频渲染脚本
├── tests/                    # Node 原生单元测试（node:test）
├── docs/
│   ├── screenshots/          # 界面截图与宣传动图
│   └── demos/                # 模块化 1080p 功能演示视频与封面帧
├── .github/workflows/
│   └── release.yml           # 自动检查、构建 Web 便携包 + 三端桌面安装包 + SHA256SUMS 并发布 Release
├── Dockerfile                # 多阶段生产容器镜像
├── docker-compose.yml        # 一键容器编排
└── package.json
```

---

## 常见问题

<details>
<summary><b>1. 我的 API Key 和画布数据存在哪里？安全吗？</b></summary>

所有画布节点、工作室项目、本地资产和 API Key 全部保存在你本机的 IndexedDB / LocalStorage 中，不会上传到任何第三方统计或账号服务器。内置的 `server/proxy.mjs` 只在你本机运行，仅用于在调用存在跨域限制的模型接口时转发请求，不做落盘存储。

</details>

<details>
<summary><b>2. 桌面版重启后，我保存在里面的画布、窗口尺寸和 API Key 会丢吗？</b></summary>

不会。桌面版默认固定绑定本机回环地址 `http://127.0.0.1:28430`，保证每次启动的存储源一致，同时自动记忆窗口位置与大小。若 `28430` 端口被其他进程占用，客户端启动时会主动弹窗提示端口顺延情况（释放原端口重启即可找回原端口下的本地数据）。建议重要工程定期通过 JSON / `.zip` 导出或 WebDAV 做额外备份。

</details>

<details>
<summary><b>3. 国内网络下打开「提示词中心」加载慢或连不上 GitHub Raw 怎么办？</b></summary>

内置提示词加载器已支持 `raw.githubusercontent.com` 失败时自动切换至 `cdn.jsdelivr.net` / `fastly.jsdelivr.net` 镜像源，并在本地 IndexedDB 持久化缓存成功拉取的词库。你也可以在「设置 → 提示词来源」中自定义或新增私有 JSON 源。

</details>

<details>
<summary><b>4. 之前下载过 v0.2.0 旧版本，需要升级吗？</b></summary>

强烈建议升级到 `v0.3.1+`。早期 `v0.2.0` 依赖旧版后端架构；从 `v0.3.0` 起社区开源版已重构为零数据库本地优先架构，真正做到下载即用。

</details>

---

## 致谢与许可证

- sig画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）二次开发，在其无限画布、生图、视频与 Agent 能力之上，扩展了剧本 / 复刻 / 替换三大工作室、多渠道视频模型适配与开箱即用桌面/便携打包方案。原项目许可证保留于 [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas)。
- 本项目采用 [MIT License](LICENSE) 开源，欢迎 Star、Fork、Issue 与 PR。

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=ChenShuo2004/sig-dream&type=Date)](https://star-history.com/#ChenShuo2004/sig-dream&Date)

</div>
