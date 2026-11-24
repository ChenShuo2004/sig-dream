# 上线检查：sig-dream v0.3.4 发布准备

检查日期：2026-11-24。目标版本：v0.3.4。此轮已完成本地版本号同步、四语 README 与使用手册更新、Web 便携包及 macOS (arm64/x64) 桌面安装包构建与核心验证；尚未自动提交、推送或打标签发布。

## 状态

本地代码、说明文档与候选产物已就绪：全仓版本同步至 `v0.3.4`，内置 34 个创作与动效 Skill（同步打包至桌面端、Web 便携包与 Docker 镜像），移除了旧版提示词中心入口并更新了四语 README、`CHANGELOG.md`、`docs/user-manual.md` 与 Release Notes 模板。核心本地检查全部通过。发布仍需推送代码并打 `v0.3.4` 标签触发远端 CI（Windows / Linux / macOS 四平台桌面包、Docker 鉴权门禁与草稿 Release）；不能据协议兼容测试宣称八个品牌客户端已经逐一实测。

## 本地已验证

- `npm run verify:release` 校验 `v0.3.4` 根/桌面/Agent 包、锁文件、VERSION、发布 URL 和 YAML 语法通过。
- `npm run typecheck`、`npm test`（13/13）、`npm run build`、`npm run build:portable` 全部通过。
- `npm run test:agent:ui` 覆盖 10 个配置入口、中英文、剪贴板和窄屏，无页面异常。
- `npm run test:agent:bridge` 使用隔离画布验证 stdio、Token 鉴权 HTTP MCP、34 个工具、输入上限和实际打包 `sig-dream-canvas-agent-0.3.4.tgz` 的 npx 执行。
- `npm run test:portable` 验证 `sig-dream-0.3.4-web-portable` 解压后独立运行、接入指南、配置入口和默认回环监听。
- `npm run test:public` 验证 Basic 登录、HttpOnly 会话 Cookie、Provider Bearer 兼容和私网代理目标拦截。
- Electron 45.4.1 的 `v0.3.4` macOS arm64 / x64 桌面安装包（`.dmg` / `.zip`）已构建，macOS arm64 目录包启动验收通过，且桌面包与便携包均已确认内置 34 个 `.agents/skills/` 技能。
- 本地候选产物校验清单已写入 `release/SHA256SUMS-v0.3.4-local.txt`。

测试结果不代表另外七款品牌应用已用真实账号逐一连接，也不代表 Windows、Linux 或 Intel Mac 安装器已在本地启动验收。具体单次报告在 `release/agent-connections/` 和 `release/smoke-test/`。

## 上线前剩余工作

| 阻塞 | 还需做什么 | 原因 |
| --- | --- | --- |
| 远端发布门禁 | 推送代码/标签后等待 GitHub Actions 的 Web、四平台桌面和 Docker 作业通过，再检查草稿 Release 与 SHA256。 | 当前环境没有运行远端 CI，也未推送。 |
| macOS 公证与 Windows 签名 | 配置 Developer ID / Windows 代码签名身份及 Apple 公证凭据后启用 `SIG_DREAM_REQUIRE_SIGNING=1`；验证最终签名安装包。 | 本机 Keychain 没有签名身份；无有效签名凭据。签名模式已设置为缺凭据即失败，不会静默降级未签名。 |
| 八款客户端实际验收 | Codex、Claude、Cursor、Grok、OpenCode、Antigravity、Muse Code、Pi 各自连到画布，记录客户端版本、工具清单、读写和重启恢复。 | 配置/UI 和真实 MCP 协议客户端测试已过，但本地没有全部客户端的可执行环境/账号会话。只应发布为“提供接入配置 / MCP 兼容”，不可表述成“八款均已官方实测”。 |
| Docker 实机 | 在 Docker CI runner 或安装 Docker 的机器上验证镜像启动、健康检查、未登录 401、登录后 200。 | 本机没有 Docker/Podman/Colima；workflow 已加为发布依赖门禁。 |
| 公网 TLS | 公网或局域网部署需 TLS 反向代理、强密码与安全 Cookie；执行 `npm run access:init` 生成本地 `.env`，不要提交该文件。 | 访问控制和代理防护已实现，但 TLS 证书与部署域名属于部署环境配置。Compose 默认只绑定 127.0.0.1。 |
| 人工体验验收 | 在目标设备检查首次登录、客户端配置信息是否易懂、签名警告和无障碍操作。 | 自动化通过不能代替真实发布候选包的人工验收。 |
| 前端性能优化 | 评估拆分约 3.3 MB（压缩约 1.07 MB）的最大 JS chunk，并在真实低端设备测首屏加载。 | 构建正常且路由已有懒加载，但 Vite 仍报告大 chunk 和一个混合静态/动态导入；不影响当前功能测试，值得在公开推广前优化。 |

## 可重复命令

```sh
npm ci
npm run verify:release
npm run typecheck
npm test
npm audit --audit-level=moderate
npm --prefix desktop ci
npm --prefix desktop audit --audit-level=moderate
npm run build
npx playwright install chromium
npm run test:smoke
npm run test:agent:ui
npm run test:agent:bridge
npm run test:portable
npm run test:public
npm run desktop:dir
npm run test:desktop
```

Docker Compose 首次使用：`npm run access:init`，然后 `docker compose up -d`。启用公网部署前先配置 HTTPS 反代，并将 `SIG_DREAM_SECURE_COOKIE=1`。发布安装包使用 `npm run desktop:release -- --mac --arm64` 等参数；正式签名发行需先配置签名凭据及 `SIG_DREAM_REQUIRE_SIGNING=1`。
