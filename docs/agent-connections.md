# 外部 Agent 接入画布

sig-dream 为支持 MCP 的 Agent 提供本地 stdio 和带 Token 的 Streamable HTTP 两种入口。面板包括 Codex、Claude、Cursor、Grok、OpenCode（新旧配置）、Antigravity、Muse Code、Pi 和通用 MCP 配置。配置适配表示提供对应格式，不表示每个厂商客户端都已实机验收。

维护版 MCP Agent 的源代码在 `packages/canvas-agent/`，保留上游 MIT 许可证及来源说明。桌面/便携版打包同一版本 tarball，避免运行时拉取未经维护的旧上游包。发行后的公共包地址使用 GitHub Release asset；本地开发会使用随项目生成的归档。

## 本机 Agent（stdio）

1. 启动画布桌面版或本地服务，保持运行。
2. 打开右上角 **Agent → 连接**，选客户端并复制生成的 MCP 配置。MCP 子进程由客户端通过 `npx --package <归档或包名> -- canvas-agent mcp` 启动。
3. 如果客户端和画布不在同一台机器，stdio 不适用；使用下方远程 HTTP 接入。
4. 在客户端刷新 MCP 后，确认 `infinite-canvas` 工具可见。用面板里的只读提示检查项目 ID 和节点数量；需要验证写入时，只在临时测试画布操作文本节点。

客户端配置通常写入其用户级 JSON/TOML 或项目 MCP 配置。合并 `mcpServers` 等字段时保留既有配置，不要用片段覆盖整个文件。配置路径随客户端版本变化，请以面板说明和厂商文档为准。Claude Desktop、网页端 Grok 等远程/托管客户端不能直接运行本机 stdio 子进程。

## 远程 Agent（Streamable HTTP）

远程 MCP endpoint 为 `https://<你的域名>/mcp`，HTTP 客户端需在 Authorization header 发送 `Bearer <Connect token>`。先在服务端配置访问控制和 HTTPS，再把 Connect token 安全地提供给远程 Agent；Token 不应放入仓库、公开 URL、日志或截图。

公网监听要求至少 20 字符的 `SIG_DREAM_ACCESS_PASSWORD` 或密码文件。推荐本地生成配置：

```sh
npm run access:init
node --env-file=.env server/index.mjs
```

服务默认仅监听 `127.0.0.1`。反向代理终止 TLS 时设置 `SIG_DREAM_SECURE_COOKIE=1`，并只允许受信代理访问后端。Docker Compose 通过 `.env` 读取同一访问密码，默认只映射本机回环地址；生成 `.env` 后执行 `docker compose up -d`。健康检查 `/healthz` 不需要登录，其余站点和代理请求需要登录 Cookie。MCP Bearer Token 只用于 MCP endpoint，不替代站点登录。

Node 服务会拒绝私网/回环上游代理目标、校验每次重定向并限制请求/响应大小。不要为了方便把未经认证的服务直接暴露到公网，也不要将 Connect token 复用为模型 API Key。

## 客户端接入参考

- Codex：`codex mcp add` 或 `~/.codex/config.toml`；选择 Codex 后才启用画布内的 Codex 专属面板。
- Claude Code：`claude mcp add` 或 `.mcp.json`；Claude Desktop 在其 MCP 配置中合并服务器定义。
- Cursor：MCP Servers 设置或 `.cursor/mcp.json`。
- Grok：使用支持自定义 MCP 的 Build/桌面客户端配置；普通网页聊天不能运行本机进程。
- OpenCode：按其版本选择新版 servers 配置或旧版 MCP schema。
- Antigravity、Muse Code、Pi：在客户端 MCP 设置或其官方配置文件中合并生成的片段。
- 其他客户端：支持 MCP stdio 的使用本机配置；支持 Streamable HTTP 的可连接远端 endpoint。非 MCP Agent 需要自行提供协议适配层。

## 验证与维护

```sh
npm run typecheck
npm test
npm run build
npm run test:agent:ui
npm run test:agent:bridge
npm run test:portable
npm run test:public
```

更新客户端时只在 `src/lib/agent/agent-clients.ts` 注册对应配置格式，并补齐中英文说明和 `scripts/test-agent-connections.mjs` 覆盖。共享工具 schema 和实现集中在 `packages/canvas-agent/dist/`；修改工具时同步更新测试与 fork 的来源/许可证信息。发布前 `npm run verify:release` 校验版本和 workflow 配置。

目前自动化验证了协议级 MCP 客户端和实际打包归档，不等价于八个品牌应用的逐一实测。正式对外公布兼容清单前，应在每款目标客户端里记录版本、成功读取、临时文本节点读写及重启恢复。
