const fs = require("fs");
const path = require("path");
const { app, nativeImage } = require("electron");

const { checkFileExists, pickExistingAbsolutePath, toWindowsLongPathIfNeeded } = require("./material-path.cjs");

/** 1×1 有效 PNG */
const FALLBACK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"]);

let dragIconNativeCache = null;

function loadImageFromBufferBase64(b64) {
  const buf = Buffer.from(b64, "base64");
  const attempts = [
    { scaleFactor: 1.0 },
    { scaleFactor: 1.25 },
    { scaleFactor: 1.5 },
    {},
  ];
  for (const opts of attempts) {
    try {
      const img = nativeImage.createFromBuffer(buf, opts);
      if (!img.isEmpty()) return img;
    } catch {
      /* next */
    }
  }
  return null;
}

function loadImageFromResolvedPath(iconPath) {
  if (!iconPath || !fs.existsSync(iconPath)) return null;
  let resolved = iconPath;
  try {
    resolved = fs.realpathSync.native(iconPath);
  } catch {
    resolved = path.resolve(iconPath);
  }
  try {
    const img = nativeImage.createFromPath(resolved);
    if (!img.isEmpty()) return img;
  } catch {
    /* ignore */
  }
  return null;
}

function ensureEmbeddedIconFile() {
  const embedded = path.join(__dirname, "drag-icon.png");
  try {
    if (!fs.existsSync(embedded) || fs.statSync(embedded).size < 8) {
      fs.writeFileSync(embedded, Buffer.from(FALLBACK_PNG_BASE64, "base64"));
    }
    return embedded;
  } catch {
    return "";
  }
}

/**
 * 通用拖放光标图标（与被拖文件无关）
 */
function getGenericDragIcon(desktopClientRoot) {
  if (dragIconNativeCache && !dragIconNativeCache.isEmpty()) {
    return dragIconNativeCache;
  }

  const fromBuffer = loadImageFromBufferBase64(FALLBACK_PNG_BASE64);
  if (fromBuffer) {
    dragIconNativeCache = fromBuffer.getSize().width < 16 ? fromBuffer.resize({ width: 32, height: 32 }) : fromBuffer;
    return dragIconNativeCache;
  }

  const iconCandidates = [
    ensureEmbeddedIconFile(),
    path.join(desktopClientRoot, "public", "file-icons", "drag-file.png"),
    path.join(app.getPath("userData"), "lcp-drag-icon.png"),
  ];

  for (const p of iconCandidates) {
    if (!p) continue;
    try {
      if (p.includes("lcp-drag-icon") && !fs.existsSync(p)) {
        fs.writeFileSync(p, Buffer.from(FALLBACK_PNG_BASE64, "base64"));
      }
    } catch {
      /* ignore */
    }
    const img = loadImageFromResolvedPath(p);
    if (img) {
      dragIconNativeCache = img.getSize().width < 16 ? img.resize({ width: 32, height: 32 }) : img;
      return dragIconNativeCache;
    }
  }

  return nativeImage.createEmpty();
}

/** 图片类素材优先用文件自身作拖放图标 */
function getDragIconForFile(filePath, desktopClientRoot) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    const fromFile = loadImageFromResolvedPath(filePath);
    if (fromFile) {
      const { width, height } = fromFile.getSize();
      if (width > 256 || height > 256) {
        return fromFile.resize({ width: 48, height: 48, quality: "good" });
      }
      if (width < 16 || height < 16) {
        return fromFile.resize({ width: 32, height: 32, quality: "good" });
      }
      return fromFile;
    }
  }
  return getGenericDragIcon(desktopClientRoot);
}

/** startDrag 使用常规路径（勿传 \\?\ 长路径前缀） */
function resolvePathForStartDrag(absPath) {
  const picked = pickExistingAbsolutePath(absPath);
  if (!picked || !checkFileExists(picked)) return "";
  let p = picked;
  if (p.startsWith("\\\\?\\")) {
    if (p.startsWith("\\\\?\\UNC\\")) p = `\\\\${p.slice("\\\\?\\UNC\\".length)}`;
    else if (/^\\\\\?\\[a-zA-Z]:/.test(p)) p = p.slice(4);
  }
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.normalize(p);
  }
}

function invokeStartDrag(webContents, filePath, icon) {
  invokeStartDragFiles(webContents, [filePath], icon);
}

function invokeStartDragFiles(webContents, filePaths, icon) {
  const files = (filePaths || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (!files.length) {
    throw new Error("no_files");
  }
  if (process.platform === "win32") {
    if (icon && !icon.isEmpty()) {
      webContents.startDrag({ files, icon });
    } else {
      webContents.startDrag({ files });
    }
    return;
  }
  if (!icon || icon.isEmpty()) {
    throw new Error("drag_icon_missing");
  }
  if (files.length === 1) {
    webContents.startDrag({ file: files[0], icon });
    return;
  }
  webContents.startDrag({ files, icon });
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {string} absolutePath
 * @param {string} desktopClientRoot
 */
function startNativeFileDrag(webContents, absolutePath, desktopClientRoot) {
  const rawPath = String(absolutePath || "").trim();
  if (!rawPath) {
    return { ok: false, error: "path_missing", absolutePath: rawPath };
  }
  const filePath = resolvePathForStartDrag(rawPath);
  if (!filePath || !checkFileExists(filePath)) {
    const longProbe = toWindowsLongPathIfNeeded(rawPath);
    const msg =
      longProbe && longProbe !== rawPath
        ? `文件不存在或 SMB 不可读：${rawPath}（已尝试长路径）`
        : `文件不存在或 SMB 不可读：${rawPath}`;
    return {
      ok: false,
      error: "file_not_accessible",
      absolutePath: rawPath,
      message: msg,
    };
  }

  const icon = getDragIconForFile(filePath, desktopClientRoot);

  try {
    invokeStartDrag(webContents, filePath, icon);
    return { ok: true, absolutePath: filePath, usedGenericIcon: icon.isEmpty() };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (process.platform === "win32" && icon && !icon.isEmpty()) {
      try {
        invokeStartDrag(webContents, filePath, null);
        return { ok: true, absolutePath: filePath, usedGenericIcon: true };
      } catch (e2) {
        return {
          ok: false,
          error: "start_drag_failed",
          absolutePath: filePath,
          message: String(e2 && e2.message ? e2.message : e2) || msg,
        };
      }
    }
    return {
      ok: false,
      error: "start_drag_failed",
      absolutePath: filePath,
      message: msg,
    };
  }
}

const MAX_BULK_DRAG_FILES = 40;

/**
 * @param {import('electron').WebContents} webContents
 * @param {string[]} absolutePaths
 * @param {string} desktopClientRoot
 */
function startNativeFilesDrag(webContents, absolutePaths, desktopClientRoot) {
  const rawList = Array.isArray(absolutePaths) ? absolutePaths : [];
  const files = [];
  const missing = [];
  for (const raw of rawList) {
    const filePath = resolvePathForStartDrag(raw);
    if (filePath && checkFileExists(filePath)) files.push(filePath);
    else missing.push(String(raw || ""));
  }
  if (!files.length) {
    return {
      ok: false,
      error: "file_not_accessible",
      message: "没有可拖出的可读文件路径。",
      files: [],
      missing,
    };
  }
  const icon = getDragIconForFile(files[0], desktopClientRoot);
  try {
    invokeStartDragFiles(webContents, files, icon);
    return {
      ok: true,
      files,
      fileCount: files.length,
      missingCount: missing.length,
      missing,
    };
  } catch (e) {
    if (process.platform === "win32" && icon && !icon.isEmpty()) {
      try {
        invokeStartDragFiles(webContents, files, null);
        return { ok: true, files, fileCount: files.length, missingCount: missing.length, missing };
      } catch (e2) {
        return {
          ok: false,
          error: "start_drag_failed",
          message: String(e2 && e2.message ? e2.message : e2),
          files,
          missing,
        };
      }
    }
    return {
      ok: false,
      error: "start_drag_failed",
      message: String(e && e.message ? e.message : e),
      files,
      missing,
    };
  }
}

/**
 * @param {Array<{ materialId?: string; fileId?: string; fileRelativePath?: string; file_relative_path?: string; cachedAbsolutePath?: string; absolutePath?: string; path?: string }>} items
 * @param {(payload: object) => object} resolvePayloadToAbsolutePath
 */
function resolveManyDragPaths(items, resolvePayloadToAbsolutePath) {
  const paths = [];
  const skipped = [];
  const list = Array.isArray(items) ? items.slice(0, MAX_BULK_DRAG_FILES) : [];
  for (const item of list) {
    const cached = String(item.cachedAbsolutePath || item.absolutePath || item.path || "").trim();
    if (cached) {
      const p = resolvePathForStartDrag(cached);
      if (p && checkFileExists(p)) {
        paths.push(p);
        continue;
      }
    }
    let resolved = { ok: false, error: "file_not_accessible" };
    try {
      resolved = resolvePayloadToAbsolutePath(item);
    } catch (e) {
      resolved = { ok: false, error: "resolve_failed", message: String(e && e.message ? e.message : e) };
    }
    if (resolved.ok && resolved.absolutePath) {
      const p = resolvePathForStartDrag(resolved.absolutePath);
      if (p && checkFileExists(p)) {
        paths.push(p);
        continue;
      }
    }
    skipped.push({
      materialId: item.materialId,
      error: resolved.error || "file_not_accessible",
      message: resolved.message,
    });
  }
  return { paths, skipped, truncated: Array.isArray(items) && items.length > MAX_BULK_DRAG_FILES };
}

module.exports = {
  startNativeFileDrag,
  startNativeFilesDrag,
  resolveManyDragPaths,
  getDragIconForFile,
  resolvePathForStartDrag,
  MAX_BULK_DRAG_FILES,
};
