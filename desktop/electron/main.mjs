import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, Menu, screen, shell } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Honor an explicit profile directory before acquiring the instance lock or opening storage.
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) {
    const absoluteProfileDirectory = resolve(profileDirectory);
    mkdirSync(absoluteProfileDirectory, { recursive: true });
    app.setPath("userData", absoluteProfileDirectory);
}

const PREFERRED_PORT = Number(process.env.SIG_DREAM_PORT || 28430);
const REPO_URL = "https://github.com/ChenShuo2004/sig-dream";
const RELEASES_URL = `${REPO_URL}/releases/latest`;

let mainWindow = null;
let localServer = null;
let appUrl = "";
let shuttingDown = false;

function windowStatePath() {
    return join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
    const defaults = { width: 1440, height: 900, isMaximized: false };
    try {
        const file = windowStatePath();
        if (!existsSync(file)) return defaults;
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        const width = Number.isFinite(parsed.width) && parsed.width >= 1024 ? parsed.width : defaults.width;
        const height = Number.isFinite(parsed.height) && parsed.height >= 680 ? parsed.height : defaults.height;
        const state = { width, height, isMaximized: Boolean(parsed.isMaximized) };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
            const visible = screen.getAllDisplays().some((display) => {
                const area = display.workArea;
                return (
                    parsed.x >= area.x - width + 120 &&
                    parsed.x <= area.x + area.width - 120 &&
                    parsed.y >= area.y - 40 &&
                    parsed.y <= area.y + area.height - 80
                );
            });
            if (visible) {
                state.x = parsed.x;
                state.y = parsed.y;
            }
        }
        return state;
    } catch {
        return defaults;
    }
}

function saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
        const isMaximized = win.isMaximized();
        const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
        const dir = dirname(windowStatePath());
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            windowStatePath(),
            JSON.stringify({ ...bounds, isMaximized }, null, 2),
            "utf8",
        );
    } catch {
        // Ignore non-critical window state write errors.
    }
}

function resolveRuntimePaths() {
    if (app.isPackaged) {
        const runtimeRoot = join(process.resourcesPath, "app-runtime");
        return {
            distDir: join(runtimeRoot, "dist"),
            serverEntry: join(runtimeRoot, "server", "index.mjs"),
        };
    }
    const repoRoot = resolve(__dirname, "../..");
    return {
        distDir: join(repoRoot, "dist"),
        serverEntry: join(repoRoot, "server", "index.mjs"),
    };
}

function isLocalOrigin(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        const current = new URL(appUrl);
        return parsed.origin === current.origin;
    } catch {
        return false;
    }
}

function isZhLocale() {
    try {
        return (app.getLocale() || "").toLowerCase().startsWith("zh");
    } catch {
        return true;
    }
}

function buildMenu() {
    const isMac = process.platform === "darwin";
    const zh = isZhLocale();
    const template = [
        ...(isMac
            ? [
                  {
                      label: app.name,
                      submenu: [
                          { role: "about", label: zh ? `关于 ${app.name}` : `About ${app.name}` },
                          {
                              label: zh ? "检查最新版本…" : "Check for Updates…",
                              click: () => void shell.openExternal(RELEASES_URL),
                          },
                          { type: "separator" },
                          { role: "services" },
                          { type: "separator" },
                          { role: "hide" },
                          { role: "hideOthers" },
                          { role: "unhide" },
                          { type: "separator" },
                          { role: "quit", label: zh ? `退出 ${app.name}` : `Quit ${app.name}` },
                      ],
                  },
              ]
            : []),
        {
            label: zh ? "文件" : "File",
            submenu: [
                {
                    label: zh ? "在系统浏览器中打开" : "Open in System Browser",
                    accelerator: "CmdOrCtrl+Shift+O",
                    click: () => {
                        if (appUrl) void shell.openExternal(appUrl);
                    },
                },
                {
                    label: zh ? "复制本地服务地址" : "Copy Local Server URL",
                    click: () => {
                        if (appUrl) clipboard.writeText(appUrl);
                    },
                },
                {
                    label: zh ? "打开本地数据目录" : "Open App Data Folder",
                    click: () => void shell.openPath(app.getPath("userData")),
                },
                { type: "separator" },
                isMac ? { role: "close", label: zh ? "关闭窗口" : "Close Window" } : { role: "quit", label: zh ? "退出" : "Quit" },
            ],
        },
        {
            label: zh ? "编辑" : "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "pasteAndMatchStyle" },
                { role: "delete" },
                { role: "selectAll" },
            ],
        },
        {
            label: zh ? "视图" : "View",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            label: zh ? "窗口" : "Window",
            submenu: isMac
                ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
                : [{ role: "minimize" }, { role: "close" }],
        },
        {
            label: zh ? "帮助" : "Help",
            submenu: [
                {
                    label: zh ? "GitHub 开源仓库" : "sig-dream on GitHub",
                    click: () => void shell.openExternal(REPO_URL),
                },
                {
                    label: zh ? "下载最新版本 (Releases)" : "Latest Releases",
                    click: () => void shell.openExternal(RELEASES_URL),
                },
                {
                    label: zh ? "反馈问题 (Issues)" : "Report an Issue",
                    click: () => void shell.openExternal(`${REPO_URL}/issues`),
                },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const iconPath = resolve(__dirname, "../assets/icon.png");
    const saved = loadWindowState();

    if (process.platform === "darwin" && existsSync(iconPath) && app.dock) {
        try {
            app.dock.setIcon(iconPath);
        } catch {
            // Ignore dock icon errors in headless/CI environments.
        }
    }

    mainWindow = new BrowserWindow({
        width: saved.width,
        height: saved.height,
        ...(Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : {}),
        minWidth: 1024,
        minHeight: 680,
        show: false,
        title: "sig-dream",
        backgroundColor: "#0c0a09",
        icon: existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    if (saved.isMaximized) {
        mainWindow.maximize();
    }

    let shown = false;
    const revealWindow = () => {
        if (shown || !mainWindow || mainWindow.isDestroyed()) return;
        shown = true;
        mainWindow.show();
    };
    mainWindow.once("ready-to-show", revealWindow);
    setTimeout(revealWindow, 2500);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isLocalOrigin(url)) {
            return { action: "allow" };
        }
        if (/^https?:\/\//i.test(url)) {
            void shell.openExternal(url);
        }
        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!isLocalOrigin(url) && /^https?:\/\//i.test(url)) {
            event.preventDefault();
            void shell.openExternal(url);
        }
    });

    mainWindow.on("close", () => {
        saveWindowState(mainWindow);
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    void mainWindow.loadURL(appUrl);
}

async function shutdownServer() {
    if (shuttingDown || !localServer) return;
    shuttingDown = true;
    const srv = localServer;
    localServer = null;
    try {
        await srv.close();
    } catch {
        // Ignore shutdown errors.
    }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady()
        .then(async () => {
            const { distDir, serverEntry } = resolveRuntimePaths();
            if (!existsSync(join(distDir, "index.html")) || !existsSync(serverEntry)) {
                dialog.showErrorBox(
                    "sig-dream startup error",
                    `Missing built application files.\nExpected:\n- ${join(distDir, "index.html")}\n- ${serverEntry}\n\nRun "npm run build" in the repository root first.`,
                );
                app.quit();
                return;
            }

            const { startServer } = await import(pathToFileURL(serverEntry).href);
            localServer = await startServer({
                host: "127.0.0.1",
                port: PREFERRED_PORT,
                distDir,
                maxPortFallback: 20,
            });
            appUrl = localServer.url;

            buildMenu();
            createWindow();

            if (localServer.port !== PREFERRED_PORT && mainWindow) {
                const zh = isZhLocale();
                void dialog.showMessageBox(mainWindow, {
                    type: "warning",
                    title: zh ? "端口被占用提示" : "Port Fallback Notice",
                    message: zh
                        ? `默认固定端口 ${PREFERRED_PORT} 已被占用，本次临时切换至 ${localServer.port}。`
                        : `Default port ${PREFERRED_PORT} is in use; switched to ${localServer.port} for this session.`,
                    detail: zh
                        ? `由于浏览器本地存储（IndexedDB / LocalStorage）按端口隔离，临时端口下不会显示原 ${PREFERRED_PORT} 端口保存的画布和 API Key。释放 ${PREFERRED_PORT} 端口后重启即可恢复原有数据。`
                        : `Browser storage is isolated by port. Close the process using port ${PREFERRED_PORT} and restart sig-dream to access your saved canvases and API keys.`,
                });
            }

            app.on("activate", () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    createWindow();
                }
            });
        })
        .catch((error) => {
            dialog.showErrorBox("sig-dream failed to start", error instanceof Error ? error.message : String(error));
            app.quit();
        });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("before-quit", () => {
        void shutdownServer();
    });

    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            void shutdownServer().finally(() => app.quit());
        });
    }
}
