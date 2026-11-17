# 桌面素材助手（`desktop-client`）

Electron + Vite + React 19 + TypeScript + Tailwind，**HashRouter**（生产 `loadFile` 可用）。API 请求与 Web 一致时可配置 **`LCP_WEB_ORIGIN`** → **`{origin}/api-proxy/*`**；或直连 FastAPI（**`LCP_API_BASE_URL`** / **`local.settings.json`**），**不使用** Web 页内的同源路径，但转发目标与 **`next.config.ts`** 一致。

**怎么运行**：优先 **`一键运行.bat`**（内部调用 **`run-desktop.ps1`**，文件名全 ASCII，避免 cmd 编码与 `-File` 乱码）；详见 **`2026年5月14日桌面素材助手运行说明.md`** § 二。亦可在本目录执行 **`npm start`**（等同 `npm run electron:dev`，需已安装依赖）。

开发与约束见：

- **`desktop-client/桌面素材助手开发技术文档V1..md`**
- **`.cursor/rules/desktop_client_integration.mdc`**（与 Web 冲突时以 Web 与后端为准；界面中文为主）

## 环境要求

- Node.js 20+
- Windows：Electron 自带 Chromium；若遇 Electron 安装失败可参考根目录 `.npmrc` 镜像

## 开发

```bash
cd desktop-client
npm install
npm run electron:dev
```

先起 Vite（`http://127.0.0.1:5173`），再开 Electron。默认**不会**自动打开开发者工具；开发调试时可按 **F12** 或 **Ctrl+Shift+I** 开关，或在启动前设置环境变量 **`LCP_OPEN_DEVTOOLS=1`** 以首次自动打开。

仅浏览器调试（无 Electron）：`npm run dev`，地址如 `http://127.0.0.1:5173/#/login`。

## 构建

```bash
npm run build
npm run electron:pack
```

## 主要源码

| 路径 | 说明 |
|------|------|
| `electron/main.cjs` | 主进程窗口与加载策略 |
| `electron/preload.cjs` | `contextBridge` 暴露 `desktopClient`（配置、元数据同步、NAS 路径、资源管理器、原生拖拽） |
| `src/components/AppHeader.tsx` | 顶栏：与 `frontend/components/AppHeader.tsx` 同结构（HashRouter） |
| `src/pages/HomePage.tsx` | 首页：与 `frontend/app/page.tsx` 同布局 |
| `src/pages/WebParityPending.tsx` | 待迁移页占位（路由与 Web 一致） |
| `src/pages/LoginPage.tsx` | 登录（用户名密码；API 来自本机配置文件） |
| `src/pages/ChangePasswordPage.tsx` | `#/account/change-password`：改密（与 Web `app/login` 已登录态逻辑一致） |
| `src/pages/DesktopSettingsPage.tsx` | `#/desktop/app-config`：NAS 挂载根、元数据同步、HTTP 缓存目录 |
| `src/pages/MaterialsPage.tsx` | 素材库：请求与筛选语义对齐 Web `app/materials/page.tsx` |
| `src/pages/CollectionsPage.tsx` | 素材集合浏览（需 `collection.view`） |
| `src/lib/apiClient.ts` | 鉴权头与 `apiJson`/`apiFetch` |
| `src/lib/settingsStore.ts` | 缓存根目录等本机持久化（旧版曾存 `apiBaseUrl`，仍作兜底） |

## CORS

桌面壳从 `http://127.0.0.1:5173` 访问后端时，须在 FastAPI 放行该 origin（与 Web 分离配置）。
