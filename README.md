> **English:** A self-hosted AI creation canvas and asset workspace for content teams — image, video, voice and song generation on an infinite canvas, backed by a shared material library with LAN-first file transfer.

[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![关注作者 X](https://img.shields.io/badge/%E5%85%B3%E6%B3%A8%E4%BD%9C%E8%80%85-%40ChenshuoAI-bc7650?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ChenshuoAI)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

🚀 **[从部署一套团队画布开始](#安装)**

# sig-dream · sig画布

**把团队的素材、模型和创意，放进同一张画布。** 在无限画布上串起 AI 生图、参考图编辑、视频生成、配音与翻唱；画布用到的每一份素材，都来自团队共用、可检索、有权限管理的素材库。

这是一个可自行部署的内容团队工作台：浏览器负责创作，FastAPI 后端负责鉴权、元数据和任务编排，局域网里的文件机负责大文件存储、缩略图与预览转码。素材原件不经云端中转，团队在办公室内以局域网速度上传和下载。

```mermaid
flowchart LR
    A[浏览器<br/>Next.js 工作台 + sig画布] -->|鉴权 / 元数据 / 票据| B[FastAPI 后端<br/>PostgreSQL]
    A -->|大文件直传| C[局域网文件机<br/>nas-client]
    B -->|任务队列| C
    C -->|缩略图 · H.264 预览 · 入库| D[(NAS 存储)]
    A -->|歌声转换 / 改词翻唱| E[GPU 服务<br/>Seed-VC · SVS]
    D[(NAS 存储)] -.->|桌面素材助手| F[Electron 客户端]
```

| 工作区 | 入口 | 适合做什么 |
| --- | --- | --- |
| **sig画布** | `/canvas` | 在无限画布上生图、改图、生视频，用 Agent 编排创作流程。 |
| **工作室** | 剧本 / 复刻 / 替换 | 从剧本到分镜、按参考视频逐段复刻、替换画面中的人物与物体。 |
| **声音与歌曲** | 配音 / 歌曲 / 翻唱助手 | 录制或上传音频生成配音，分离人声伴奏，改词翻唱并换成指定音色。 |
| **素材库** | `/materials` | 上传、打标签、整理、检索和下载团队素材，按素材库域隔离。 |

## 安装

### 环境要求

- Python 3.11+
- Node.js 20+
- PostgreSQL（本地或云数据库均可）
- FFmpeg 与 FFprobe，且已加入系统 `PATH`（文件机生成缩略图与预览需要）
- 可选：一台带 NVIDIA GPU 的 Windows 机器，用于 Seed-VC 歌声转换与 SVS 改词翻唱服务
- 可选：一台局域网文件机或 NAS，用于存放素材原件

先取得项目代码，后续命令均在仓库根目录运行：

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
```

### 1. 后端

macOS/Linux：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # 修改数据库连接与三个密钥
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Windows PowerShell：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env   # 修改数据库连接与三个密钥
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`.env` 中至少需要改掉 `DATABASE_URL`、`TOKEN_SECRET`、`NAS_CLIENT_TOKEN` 和 `DOWNLOAD_TICKET_SECRET`。启动后访问 `http://127.0.0.1:8000/health` 确认服务正常。

### 2. 构建 sig画布

画布是独立的 Vite 应用，构建产物会直接输出到 `frontend/public/canvas-app`，由前端以 iframe 方式加载：

```bash
cd canvas-app/web
npm ci
npm run build
```

### 3. 前端工作台

```bash
cd frontend
npm ci
npm run dev
```

打开 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)。前端会通过同源的 `/api-proxy` 转发到后端，默认后端地址为 `http://127.0.0.1:8000`；如需修改，参考 `frontend/.env.local.example` 设置 `NEXT_PUBLIC_API_BASE_URL`。

生产环境使用 `npm run build && npm run start`，再用 Nginx 反向代理到 `3000` 端口。完整的服务器部署步骤见 [后端部署指南](后端部署指南_V1_Ubuntu22.04.md) 与 [部署与环境变量](docs/PROJECT_CONTEXT/07_部署与环境变量.md)。

### 4. 文件机（可选）

素材原件、缩略图与预览视频由局域网文件机上的 `nas-client` 处理。在文件机上：

```powershell
cd nas-client
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item nas-client-token.txt.example nas-client-token.txt   # 填入与后端相同的 NAS_CLIENT_TOKEN
Copy-Item ecs-api-url.txt.example ecs-api-url.txt             # 填入后端地址
```

然后在仓库根目录运行 `start-nas-direct-services.bat`，会同时启动下载服务与任务 Worker。没有文件机时，平台仍可登录、使用画布和管理元数据，但上传入库与预览生成不会执行。

### 5. GPU 服务（可选）

翻唱助手依赖两项本地 GPU 服务，复制到 GPU 机器后双击 `start.bat` 即可：

| 服务 | 目录 | 端口 | 作用 |
| --- | --- | --- | --- |
| Seed-VC | `seed-vc-service/` | `7865` | 零样本歌声 / 语音音色转换，无需训练 |
| SVS | `svs-service/` | `7866` | 按新歌词生成导唱，并贴合原曲旋律 |

### 首次登录

数据库迁移会创建一个初始超级管理员：账号 `admin`，密码 `admin123`。

> ⚠️ **登录后请立即在「系统设置 → 用户」中修改密码**，或新建自己的管理员后停用该账号。公网部署时不要保留默认密码。

画布仅对「素材管理员」和「超级管理员」角色开放；其他成员可在系统设置中按权限点授权。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 无限画布 | 图片、视频、文本、音频节点自由连线；支持打组、多选、引用整组内容作为生成输入。 |
| AI 生图与改图 | 兼容 OpenAI / Gemini 接口生态，支持多参考图编辑、局部遮罩标注、1K / 2K / 4K 尺寸。 |
| 视频生成 | 首尾帧与全能参考模式；刷新页面后自动续查远端任务状态，可从视频截取首帧、尾帧、当前帧。 |
| Canvas Agent | 由 Agent 直接读写画布节点，可接入 Codex 等外部 Agent 协同创作。 |
| 剧本工作室 | 统一视觉风格，规划角色、场景、道具与分镜画面。 |
| 复刻工作室 | 按参考视频逐段生成分镜，支持审核、按意见修补与单段重新生成。 |
| 替换工作室 | 替换图片或视频中的人物与物体，可分别选择图像与视频替换模型。 |
| 配音与翻唱 | 录音或上传参考音频生成配音；分离人声与伴奏，按句改词翻唱，与原声 A/B 对比。 |
| 提示词库 | 内置多个开源提示词来源，可一键加入资产并在画布中复用。 |
| 双素材库域 | 同一平台内两套独立素材库，列表、标签、未整理、上传与集合互不串库。 |
| 标签与整理 | 动态标签分类、标签替换与审核；无标签或「未整理」标签的素材集中待处理。 |
| 素材集合 | 以引用方式组织素材，不复制文件，不改变原件存储位置。 |
| 局域网优先传输 | 下载顺序为 LAN 文件机 → WAN 文件机 → 服务器缓存兜底；大文件分片上传并校验。 |
| 缩略图与预览 | 文件机异步生成缩略图与 H.264 预览 MP4，服务器不承担转码压力。 |
| 角色与权限 | 角色-权限点矩阵统一管理，所有写操作记录操作日志，可按用户审计。 |
| 新手教程 | 页面内交互式引导，记录每位成员的教程进度。 |
| 桌面素材助手 | Electron 客户端，映射 NAS 盘符，支持 GitHub Releases 自动更新。 |

## 使用建议

### 从画布开始

先在画布右上角的配置中添加模型渠道（Base URL + API Key），测试连接后即可生图。密钥只保存在当前浏览器本地，也可以导出配置文件在团队内分发。

### 从素材开始

在 `/materials/upload` 上传素材，入库后到「未整理」页批量打标签。整理好的素材可以加入集合，或在画布中作为参考图直接引用。

### 从一首歌开始

打开「翻唱助手」，上传原曲后自动分离人声与伴奏；逐句填写新歌词，再选择一段参考音色，生成的导唱会经 Seed-VC 换成目标音色，每句都可以和原声对比试听。

## 运行与数据

| 数据 | 位置 |
| --- | --- |
| 用户、权限、素材元数据、任务与日志 | PostgreSQL |
| 素材原件、缩略图、预览视频 | 文件机 / NAS（`NAS_MOUNT_ROOT`） |
| 画布项目、生成图片、模型配置 | 浏览器本地 IndexedDB，可选 WebDAV 同步 |

`.env*`、文件机令牌、NAS 凭据、虚拟环境、`node_modules` 与本地数据库备份都已被 Git 忽略，仓库中只保留 `*.example` 模板。不要在 Issue、日志、截图或提交记录中公开 API Key、数据库连接串和内网地址。

## 开发验证

```bash
# sig画布：类型检查与单元测试
(cd canvas-app/web && npm run typecheck && npm test)

# 前端工作台：生产构建
(cd frontend && npm run build)

# 文件机：缩略图与人物识别流水线测试
(cd nas-client && python test_studio_media.py && python test_person_pipeline.py)
```

数据库结构变更请新增 Alembic 迁移，不要直接修改已有迁移文件。

## 项目结构

```text
├── backend/              # FastAPI 后端：鉴权、素材、标签、集合、画布与工作室接口
├── frontend/             # Next.js 工作台：素材库、系统设置、教程，内嵌 sig画布
├── canvas-app/           # sig画布（基于 infinite-canvas 二次开发的 Vite 应用）
├── desktop-client/       # Electron 桌面素材助手
├── nas-client/           # 文件机：下载服务、任务 Worker、缩略图与预览转码
├── seed-vc-service/      # Seed-VC 歌声转换服务
├── svs-service/          # SVS 改词翻唱导唱服务
├── docs/PROJECT_CONTEXT/ # 架构、模块、数据库、API 与部署文档
├── scripts/ · tools/     # 数据库备份、预览回填等运维脚本
└── deploy.sh             # 服务器端一键发布脚本
```

想深入了解实现，建议从 [项目总览](docs/PROJECT_CONTEXT/00_项目总览.md) 和 [系统架构](docs/PROJECT_CONTEXT/01_系统架构.md) 开始阅读。

## 致谢

sig画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT License）二次开发，在其无限画布、生图、视频与 Agent 能力之上，增加了工作室、配音、歌曲与翻唱助手，并接入团队素材库与账号权限。原项目的许可证保留在 [canvas-app/LICENSE](canvas-app/LICENSE)。

同样感谢 [ComfyUI](https://github.com/comfyanonymous/ComfyUI)、[Seed-VC](https://github.com/Plachtaa/seed-vc)、[Bootstrap Icons](https://github.com/twbs/icons) 以及所有开源提示词库的作者。

## Star 趋势

[![sig-dream Star 趋势](https://api.star-history.com/svg?repos=ChenShuo2004/sig-dream&type=Date)](https://star-history.com/#ChenShuo2004/sig-dream&Date)

## 贡献

欢迎提交 Issue 或 Pull Request。修改前请先阅读 [关键设计决策](docs/PROJECT_CONTEXT/09_关键设计决策.md)：素材库域隔离、集合的引用语义、局域网优先传输和权限点校验都有明确约束。涉及写操作的接口，请同时补上操作日志。

## 许可证

本项目采用 [MIT License](LICENSE)。`canvas-app/` 中源自 infinite-canvas 的代码同时遵循其原始 [MIT License](canvas-app/LICENSE)。
