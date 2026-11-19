const { app, BrowserWindow, shell, Menu, ipcMain, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const { getBootConfig, saveUserServerOrigin } = require("./boot-config.cjs");
const { getDesktopClientRoot } = require("./app-paths.cjs");
const { listMaterialAssetsRootCandidates, resolveAbsolutePathWithRoots, normalizeFileRelativePath } = require("./material-roots.cjs");
const { ensurePackagedFirstRunDefaults } = require("./first-run-settings.cjs");
const { setupAutoUpdater } = require("./auto-updater.cjs");
const { checkFileExists, pickExistingAbsolutePath } = require("./material-path.cjs");
const {
  loadMetadataStore,
  saveMetadataStore,
  applyMetadataSyncBatch,
  getFileRecord,
  getMaterialPrimaryFile,
  metadataStats,
} = require("./metadata-store.cjs");
const {
  readMaterialAssetsRootFromBootFile,
  readMaterialAssetsRootFromUserStore,
  saveMaterialAssetsRootToUserStore,
  defaultMaterialAssetsRootForPlatform,
} = require("./desktop-local-settings.cjs");
const { buildCacheFilePath, getValidCachePath, downloadUrlToFile } = require("./material-cache.cjs");
const { startNativeFileDrag, startNativeFilesDrag, resolveManyDragPaths, MAX_BULK_DRAG_FILES } = require("./file-drag.cjs");
const { copyFileToClipboardForPaste } = require("./file-clipboard.cjs");

const isDev = !app.isPackaged;

function desktopClientRoot() {
  return getDesktopClientRoot();
}

function userDataDir() {
  return app.getPath("userData");
}

/** Packaged app: login SMB before file access (reads resources/nas-smb-credentials.json). */
function tryEnsureNasSmbLogin() {
  if (process.platform !== "win32") return;
  const ps1 = path.join(process.resourcesPath, "ensure-nas-smb.ps1");
  const creds = path.join(process.resourcesPath, "nas-smb-credentials.json");
  if (!fs.existsSync(ps1) || !fs.existsSync(creds)) return;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    {
      env: { ...process.env, RESOURCES_PATH: process.resourcesPath },
      windowsHide: true,
      timeout: 60000,
    }
  );
  if (r.status !== 0) {
    console.warn("[LCP] NAS SMB login script exit", r.status, r.stderr?.toString?.() || "");
  }
}

function effectiveMaterialAssetsRoot() {
  const roots = listMaterialAssetsRootCandidates(userDataDir(), desktopClientRoot(), process.platform);
  return roots[0] || "";
}

function effectiveCacheRoot() {
  const boot = getBootConfig(desktopClientRoot());
  const fromEnv = String(process.env.LCP_CACHE_ROOT || "").trim();
  return fromEnv || boot.cacheRoot || "";
}

function pickFileRelativePath(obj, store) {
  const direct = String(
    obj.fileRelativePath || obj.file_relative_path || obj.filePath || obj.file_path || ""
  ).trim();
  if (direct) return normalizeFileRelativePath(direct) || direct;
  const materialId = String(obj.materialId || obj.material_id || "").trim();
  const fileId = String(obj.fileId || obj.file_id || "").trim();
  const rec = fileId ? getFileRecord(store, fileId) : getMaterialPrimaryFile(store, materialId);
  if (!rec) return "";
  return normalizeFileRelativePath(String(rec.file_relative_path || rec.file_path || "").trim()) || "";
}

function resolvePayloadToAbsolutePath(payload) {
  const obj = payload && typeof payload === "object" ? payload : {};
  const store = loadMetadataStore(userDataDir());
  const rel = pickFileRelativePath(obj, store);
  const roots = listMaterialAssetsRootCandidates(userDataDir(), desktopClientRoot(), process.platform);
  if (!roots.length) {
    return {
      ok: false,
      error: "material_assets_root_not_configured",
      message:
        "未配置 material_assets_root。请在「本机连接与缓存」填写本机可访问的 UNC，例如 \\\\YOUR_NAS_HOST\\nas-file\\material-assets",
      material_assets_root: "",
      file_relative_path: rel,
    };
  }
  if (!rel) {
    return {
      ok: false,
      error: "file_relative_path_not_found",
      message:
        "未找到 file_relative_path。请在本机登录后打开「本机连接与缓存」→「同步素材元数据」，或先点开素材加载详情后再拖。",
      material_assets_root: roots[0],
      file_relative_path: "",
    };
  }
  return resolveAbsolutePathWithRoots(rel, roots);
}

/** 仅允许探测内网/本机文件机，避免渲染进程滥用主进程代发请求。 */
function isPrivateOrLocalHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((x) => x > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function removeDefaultMenu() {
  Menu.setApplicationMenu(null);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "轻量内容流程平台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void win.loadURL("http://127.0.0.1:5173/");
    if (process.env.LCP_OPEN_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
    win.webContents.on("before-input-event", (event, input) => {
      const key = String(input.key || "");
      const openKeys = key === "F12" || (input.control && input.shift && key.toLowerCase() === "i");
      if (!openKeys) return;
      event.preventDefault();
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: "detach" });
    });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    tryEnsureNasSmbLogin();
  }
  ensurePackagedFirstRunDefaults(userDataDir(), desktopClientRoot());

  ipcMain.handle("lcp:get-boot-config", () => getBootConfig(desktopClientRoot()));

  ipcMain.handle("lcp:save-server-origin", (_event, origin) => {
    try {
      saveUserServerOrigin(origin);
      return { ok: true, boot: getBootConfig(desktopClientRoot()) };
    } catch (e) {
      return { ok: false, message: String(e?.message || e) };
    }
  });

  ipcMain.handle("lcp:get-desktop-local-settings", () => ({
    material_assets_root: effectiveMaterialAssetsRoot(),
    nasMountRoot: effectiveMaterialAssetsRoot(),
    defaultMaterialAssetsRoot: defaultMaterialAssetsRootForPlatform(process.platform),
    defaultNasMountRoot: defaultMaterialAssetsRootForPlatform(process.platform),
    cacheRoot: effectiveCacheRoot(),
    metadata: metadataStats(loadMetadataStore(userDataDir())),
  }));

  ipcMain.handle("lcp:save-desktop-local-settings", (_event, payload) => {
    const obj = payload && typeof payload === "object" ? payload : {};
    const root =
      (typeof obj.material_assets_root === "string" ? obj.material_assets_root : "") ||
      (typeof obj.nasMountRoot === "string" ? obj.nasMountRoot : "");
    if (root.trim()) {
      saveMaterialAssetsRootToUserStore(userDataDir(), { material_assets_root: root.trim() });
    }
    return {
      material_assets_root: effectiveMaterialAssetsRoot(),
      nasMountRoot: effectiveMaterialAssetsRoot(),
    };
  });

  ipcMain.handle("lcp:metadata-sync-apply", (_event, batch) => {
    const dir = userDataDir();
    const prev = loadMetadataStore(dir);
    const next = applyMetadataSyncBatch(prev, batch && typeof batch === "object" ? batch : {});
    saveMetadataStore(dir, next);
    return metadataStats(next);
  });

  ipcMain.handle("lcp:metadata-sync-stats", () => metadataStats(loadMetadataStore(userDataDir())));

  /** 解析 material_assets_root + file_relative_path，检查 fs 可读 */
  ipcMain.handle("lcp:resolve-material-file", (_event, payload) => resolvePayloadToAbsolutePath(payload));

  /** @deprecated 别名 */
  ipcMain.handle("lcp:resolve-nas-file", (_event, payload) => resolvePayloadToAbsolutePath(payload));

  /** 仅解析路径，不调用 startDrag */
  ipcMain.on("lcp:peek-file-drag-sync", (event, payload) => {
    try {
      event.returnValue = resolvePayloadToAbsolutePath(payload);
    } catch (e) {
      event.returnValue = {
        ok: false,
        error: "peek_failed",
        message: String(e && e.message ? e.message : e),
      };
    }
  });

  ipcMain.on("lcp:start-native-file-drag", (event, payload) => {
    const obj = payload && typeof payload === "object" ? payload : {};
    const filePath = String(obj.path || obj.absolutePath || "").trim();
    if (!filePath) return;
    startNativeFileDrag(event.sender, filePath, desktopClientRoot);
  });

  /** dragstart 同步：解析 NAS/缓存路径并立即 startDrag */
  ipcMain.on("lcp:start-native-file-drag-sync", (event, payload) => {
    try {
      const obj = payload && typeof payload === "object" ? payload : {};
      let filePath = String(obj.absolutePath || obj.path || "").trim();
      if (filePath) {
        const picked = pickExistingAbsolutePath(filePath);
        if (!picked || !checkFileExists(picked)) {
          event.returnValue = {
            ok: false,
            error: "file_not_accessible",
            absolutePath: filePath,
            message: `本地文件不可读：${filePath}`,
          };
          return;
        }
        filePath = picked;
      } else {
        const resolved = resolvePayloadToAbsolutePath(payload);
        if (!resolved.ok || !resolved.absolutePath) {
          event.returnValue = resolved;
          return;
        }
        filePath = resolved.absolutePath;
      }
      const dragResult = startNativeFileDrag(event.sender, filePath, desktopClientRoot());
      event.returnValue = {
        ...dragResult,
        mode: "nas_smb",
        absolutePath: dragResult.absolutePath || filePath,
        material_assets_root: obj.material_assets_root,
      };
    } catch (e) {
      event.returnValue = {
        ok: false,
        error: "drag_failed",
        message: String(e && e.message ? e.message : e),
      };
    }
  });

  /** 批量 dragstart 同步：解析多条 NAS 路径并 startDrag({ files }) */
  ipcMain.on("lcp:start-native-files-drag-sync", (event, payload) => {
    try {
      const obj = payload && typeof payload === "object" ? payload : {};
      const items = Array.isArray(obj.items) ? obj.items : [];
      if (!items.length) {
        event.returnValue = { ok: false, error: "items_empty", message: "未选择可拖出的素材。" };
        return;
      }
      const { paths, skipped, truncated } = resolveManyDragPaths(items, resolvePayloadToAbsolutePath);
      if (!paths.length) {
        event.returnValue = {
          ok: false,
          error: "file_not_accessible",
          message: "所选素材均无法解析为可读 NAS 路径，请先同步元数据或检查 material_assets_root。",
          skipped,
          truncated,
        };
        return;
      }
      const dragResult = startNativeFilesDrag(event.sender, paths, desktopClientRoot());
      event.returnValue = {
        ...dragResult,
        mode: "nas_smb",
        skipped,
        truncated,
        maxBulk: MAX_BULK_DRAG_FILES,
      };
    } catch (e) {
      event.returnValue = {
        ok: false,
        error: "drag_failed",
        message: String(e && e.message ? e.message : e),
      };
    }
  });

  ipcMain.handle("lcp:download-to-cache", async (_event, payload) => {
    const obj = payload && typeof payload === "object" ? payload : {};
    const url = String(obj.url || "").trim();
    const materialId = String(obj.materialId || obj.material_id || "").trim();
    const fileId = String(obj.fileId || obj.file_id || "").trim();
    const originalFilename = String(obj.originalFilename || obj.filename || "download.bin").trim();
    const expectedSize = obj.expectedSize != null ? Number(obj.expectedSize) : null;
    const cacheRoot = String(obj.cacheRoot || effectiveCacheRoot() || "").trim();
    if (!cacheRoot) {
      return { ok: false, error: "cache_root_not_configured", message: "未配置本地缓存目录。" };
    }
    if (!url) return { ok: false, error: "url_missing" };

    const existing = getValidCachePath(cacheRoot, materialId, fileId, originalFilename, expectedSize);
    if (existing) {
      return { ok: true, absolutePath: existing, fromCache: true };
    }

    const dest = buildCacheFilePath(cacheRoot, materialId, fileId, originalFilename);
    try {
      const headers = obj.headers && typeof obj.headers === "object" ? obj.headers : {};
      await downloadUrlToFile(url, dest, headers);
      return { ok: true, absolutePath: dest, fromCache: false };
    } catch (e) {
      return {
        ok: false,
        error: "download_failed",
        message: String(e && e.message ? e.message : e),
      };
    }
  });

  ipcMain.on("lcp:begin-cached-file-drag-sync", (event, payload) => {
    try {
      const obj = payload && typeof payload === "object" ? payload : {};
      const filePath = String(obj.absolutePath || obj.path || "").trim();
      if (!filePath) {
        event.returnValue = { ok: false, error: "path_missing" };
        return;
      }
      event.returnValue = { ok: checkFileExists(filePath), absolutePath: filePath, exists: checkFileExists(filePath) };
    } catch (e) {
      event.returnValue = { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle("lcp:show-item-in-folder", (_event, payload) => {
    const abs =
      typeof payload === "string"
        ? String(payload).trim()
        : String((payload && payload.absolutePath) || "").trim();
    if (!abs) return { ok: false, error: "bad_path" };
    if (!checkFileExists(abs)) return { ok: false, error: "file_not_on_disk", absolutePath: abs };
    shell.showItemInFolder(abs);
    return { ok: true, absolutePath: abs };
  });

  ipcMain.handle("lcp:copy-text", (_event, text) => {
    const t = String(text || "");
    if (!t) return { ok: false };
    clipboard.writeText(t);
    return { ok: true };
  });

  ipcMain.handle("lcp:copy-file-for-paste", async (_event, payload) => {
    const abs =
      typeof payload === "string"
        ? String(payload).trim()
        : String((payload && (payload.absolutePath || payload.path)) || "").trim();
    if (!abs) return { ok: false, error: "bad_path" };
    return copyFileToClipboardForPaste(abs);
  });

  ipcMain.handle("lcp:probe-http-get", async (_event, payload) => {
    const obj = typeof payload === "object" && payload ? payload : {};
    const urlStr = typeof payload === "string" ? String(payload).trim() : String(obj.url || "").trim();
    const timeoutMs = Math.min(30_000, Math.max(200, Number(obj.timeoutMs) || 2800));
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return { ok: false, status: 0, error: "bad_url" };
    }
    if (u.username || u.password) return { ok: false, status: 0, error: "credentials_not_allowed" };
    if (!/^https?:$/i.test(u.protocol)) return { ok: false, status: 0, error: "bad_protocol" };
    if (!isPrivateOrLocalHostname(u.hostname)) return { ok: false, status: 0, error: "host_not_allowed" };
    const p = u.pathname || "";
    if (p !== "/health" && !p.endsWith("/health")) {
      return { ok: false, status: 0, error: "path_not_health" };
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(u.toString(), { method: "GET", redirect: "manual", signal: ac.signal });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
    } finally {
      clearTimeout(t);
    }
  });

  removeDefaultMenu();
  createWindow();
  setupAutoUpdater(() => BrowserWindow.getAllWindows()[0] || null);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
