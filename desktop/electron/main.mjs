import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREFERRED_PORT = Number(process.env.SIG_DREAM_PORT || 28430);

let mainWindow = null;
let localServer = null;
let appUrl = "";

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

function buildMenu() {
    const isMac = process.platform === "darwin";
    const template = [
        ...(isMac
            ? [
                  {
                      label: app.name,
                      submenu: [
                          { role: "about" },
                          { type: "separator" },
                          { role: "services" },
                          { type: "separator" },
                          { role: "hide" },
                          { role: "hideOthers" },
                          { role: "unhide" },
                          { type: "separator" },
                          { role: "quit" },
                      ],
                  },
              ]
            : []),
        {
            label: "File",
            submenu: [
                {
                    label: "Open in System Browser",
                    click: () => {
                        if (appUrl) void shell.openExternal(appUrl);
                    },
                },
                { type: "separator" },
                isMac ? { role: "close" } : { role: "quit" },
            ],
        },
        {
            label: "Edit",
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
            label: "View",
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
            label: "Window",
            submenu: isMac
                ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
                : [{ role: "minimize" }, { role: "close" }],
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "sig-dream on GitHub",
                    click: () => void shell.openExternal("https://github.com/ChenShuo2004/sig-dream"),
                },
                {
                    label: "Releases",
                    click: () => void shell.openExternal("https://github.com/ChenShuo2004/sig-dream/releases"),
                },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const iconPath = resolve(__dirname, "../assets/icon.png");
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 680,
        title: "sig-dream · sig画布",
        backgroundColor: "#0c0a09",
        icon: existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

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

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    void mainWindow.loadURL(appUrl);
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
        if (localServer) {
            void localServer.close();
            localServer = null;
        }
    });
}
