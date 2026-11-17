const fs = require("fs");
const path = require("path");
const { app, ipcMain, BrowserWindow } = require("electron");

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (err) {
  console.warn("[LCP] electron-updater not available:", err?.message || err);
}

const GITHUB_OWNER = "ChenShuo2004";
const GITHUB_REPO = "sig-dream";

let mainWindowRef = null;

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function loadUpdaterGithubToken() {
  const fp = path.join(process.resourcesPath, "github-updater-token.txt");
  if (!fs.existsSync(fp)) return "";
  try {
    return fs.readFileSync(fp, "utf8").trim();
  } catch {
    return "";
  }
}

function formatUpdateError(err) {
  const msg = String(err?.message || err);
  if (msg.includes("404") && msg.includes("releases")) {
    return "检查更新失败（404）：请确认 GitHub 上已发布新版本 Release。";
  }
  return msg;
}

/**
 * Public repo: no token needed. A token file is only used by self-hosted builds
 * that point the updater at a private fork; never ship one in public installers.
 */
function configureGithubUpdateFeed() {
  if (!autoUpdater) return { ok: false, reason: "updater_module_missing" };
  const token = loadUpdaterGithubToken();
  autoUpdater.setFeedURL({
    provider: "github",
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    ...(token ? { private: true, token } : {}),
  });
  return { ok: true };
}

function setupAutoUpdater(getMainWindow) {
  if (!app.isPackaged) {
    return { enabled: false, reason: "dev_mode" };
  }
  if (!autoUpdater) {
    return { enabled: false, reason: "updater_module_missing" };
  }

  const feed = configureGithubUpdateFeed();
  if (!feed.ok) {
    console.warn("[LCP] GitHub auto-update feed not configured:", feed.reason);
  }

  mainWindowRef = getMainWindow;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    broadcast("lcp:update-status", { phase: "checking", message: "正在检查更新…" });
  });

  autoUpdater.on("update-available", (info) => {
    broadcast("lcp:update-status", {
      phase: "available",
      message: `发现新版本 ${info.version}`,
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    broadcast("lcp:update-status", {
      phase: "not-available",
      message: "当前已是最新版本",
      version: info?.version,
    });
  });

  autoUpdater.on("error", (err) => {
    broadcast("lcp:update-status", {
      phase: "error",
      message: formatUpdateError(err),
    });
  });

  autoUpdater.on("download-progress", (p) => {
    broadcast("lcp:update-status", {
      phase: "downloading",
      message: `下载中 ${Math.round(p.percent || 0)}%`,
      percent: p.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    broadcast("lcp:update-status", {
      phase: "downloaded",
      message: `新版本 ${info.version} 已下载，可重启安装`,
      version: info.version,
    });
  });

  ipcMain.handle("lcp:get-app-version", () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));

  ipcMain.handle("lcp:check-for-updates", async () => {
    if (!app.isPackaged) {
      return { ok: false, message: "开发模式不检查自动更新" };
    }
    if (!autoUpdater) {
      return { ok: false, message: "自动更新模块未打包，请安装新版本安装包" };
    }
    configureGithubUpdateFeed();
    try {
      const r = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateInfo: r?.updateInfo ? { version: r.updateInfo.version } : null,
      };
    } catch (e) {
      return { ok: false, message: formatUpdateError(e) };
    }
  });

  ipcMain.handle("lcp:download-update", async () => {
    if (!app.isPackaged) return { ok: false, message: "开发模式不可用" };
    if (!autoUpdater) return { ok: false, message: "自动更新模块未打包" };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: formatUpdateError(e) };
    }
  });

  ipcMain.handle("lcp:quit-and-install", () => {
    if (!app.isPackaged || !autoUpdater) return { ok: false };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  setTimeout(() => {
    if (!app.isPackaged || !autoUpdater) return;
    configureGithubUpdateFeed();
    void autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);

  return { enabled: true, feedConfigured: feed.ok };
}

module.exports = { setupAutoUpdater };
