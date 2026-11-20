# CHANGELOG

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
