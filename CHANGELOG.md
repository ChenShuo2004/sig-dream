# CHANGELOG

## v0.3.4 - 2026-11-24

+ [新增] 内置技能中心（`/skills`）与 34 个创作/动效 Skill，覆盖 14 个视频与内容创作工作流、`anatomy` 人体解剖、`video-shotcraft` 电影分镜以及 Remotion / Motion Canvas / Manim / Three.js / Blender 等 18 大引擎，同步落盘 `.agents/skills/` 并打包进桌面端、Web 便携包与 Docker 镜像，供 MCP Agent 直接调用。
+ [新增] 新增完整中文使用手册（`docs/user-manual.md`），并在四语 README 首屏上线 30 秒 3D 高燃宣传片与剧本 / 复刻 / 替换三大工作室实拍成片演示。
+ [优化] 升级三大工作室浅色主题对比度、模型控制与分集设置体验；统一应用与页面品牌标题为 `sig-dream`，修复首屏标题裁切。
+ [变更] 移除旧版外部提示词中心入口，原 `#/prompts` 路径平滑跳转至内置技能中心 `#/skills`。

## v0.3.3 - 2026-11-21

+ [新增] Codex、Claude、Cursor、Grok Build、OpenCode、Antigravity、Muse Code、Pi 与通用 MCP 配置；保留 OpenCode 新旧版本差异和客户端测试入口。
+ [安全] Electron 45.4.1 / electron-builder 26.18.0；维护版 Canvas Agent 升级 Zod 4.6.7，增加输入边界与鉴权 Streamable HTTP MCP，随发布包分发。
+ [安全] 非本机监听强制访问密码；代理加入 DNS 固定、防私网/重定向 SSRF、跨站限制、请求/响应体和并发速率边界。
+ [修复] Token 首次连接提示、外部客户端自动触发 Codex、锁文件与版本同步、桌面隔离数据目录。
+ [验证] 加入真实双 MCP 客户端、HTTP MCP、安全测试、独立便携包和四平台桌面启动门禁；CI 构建 Docker 并验证鉴权，生成待审阅的草稿发布。


## v0.3.2 - 2026-11-21

+ [新增] 新增 5 支模块化 1080p 功能演示视频与循环动图预览（覆盖零配置启动、无限画布、剧本工作室、复刻与替换工作室、1700+ 提示词库与本地资产），同步更新中/英/日/韩四语 README。
+ [优化] 桌面端体验全面升级：新增窗口尺寸与位置记忆、启动防白屏闪烁（`ready-to-show`）、中英自适应菜单栏（快速打开本地数据目录 / 复制本地服务地址 / 检查更新）以及默认端口占用时的本地存储隔离提醒，补齐打包内窗口图标资源。
+ [优化] 升级 GitHub Actions 自动发版流水线：加入 `typecheck` 与原生 `node:test` 单测门禁，三端桌面构建复用同一份前端 `dist` 产物，自动生成 `SHA256SUMS.txt` 校验清单并提取版本更新日志。
+ [修复] 为内置开源提示词源增加 `jsDelivr` 多镜像自动回退与失败空缓存保护，修复国内或弱网环境下提示词中心偶发空白的问题；清理全部 15 处 TypeScript 类型错误。

## v0.3.1 - 2026-11-20

+ [优化] 全面更新品牌图标与桌面客户端图标、网页 Favicon 为黑白相间高对比极简风格。
+ [修复] 修复跨平台 CI（Linux / Windows / macOS）与 Docker 构建时原生依赖解析问题，确保三端桌面安装包与 Web 便携包正常自动构建发布。

## v0.3.0 - 2026-11-19

+ [新增] 全面重构为零数据库、本地优先架构：无需 PostgreSQL、Redis 或登录服务，数据与 API Key 全部保存在浏览器本地 IndexedDB / LocalStorage，支持 JSON 导入导出与 WebDAV 同步。
+ [新增] 新增开箱即用发布形态：提供 macOS / Windows / Linux 社区版独立桌面安装包（内置本地服务与 CORS 代理，固定本地端口持久化数据）、免 `npm install` 的 Web 便携包，以及 `docker compose up -d` 一键启动。
+ [新增] 升级应用首页：直接展示无限画布、快速生图/生视频、剧本/复刻/替换三大工作室入口、API 渠道就绪状态与一键配置引导，顶部导航新增模型设置入口与 GitHub 仓库链接。
+ [修复] 修复开源本地模式下无法打开模型配置弹窗及无法新增/编辑模型渠道的问题。
+ [优化] 新增 `.npmrc` 自动开启 `legacy-peer-deps`，直接 `npm install && npm run dev` 即可运行；本地服务支持端口占用自动顺延与 `--open` 自动打开浏览器。
+ [文档] 重构中/英/日/韩四语 README，修复目录锚点链接，补全 GitHub Release 开箱即用下载指南与社区版/企业版对比说明。

## v0.2.0 - 2026-11-17

+ [新增] 早期桌面客户端与自动化构建验证版本（依赖旧版后端架构，已由零数据库本地优先的 v0.3.0 全面替代）。

## v0.1.0 - 2026-11-16

+ [新增] 初始版本发布，基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（v0.19.0，MIT License）扩展剧本 / 复刻 / 替换三大工作室与多模型渠道适配。
