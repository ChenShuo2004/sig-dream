const fs = require("fs");
const path = require("path");

function toApiProxyBase(origin) {
  const o = String(origin || "").trim().replace(/\/+$/, "");
  return o ? `${o}/api-proxy` : "";
}

/**
 * @param {string} desktopClientRoot Absolute path to desktop-client/ (parent of electron/)
 */
function readLocalSettingsJson(desktopClientRoot) {
  const jsonPath = path.join(desktopClientRoot, "local.settings.json");
  const examplePath = path.join(desktopClientRoot, "local.settings.example.json");

  function parseFile(absPath) {
    const raw = fs.readFileSync(absPath, "utf8");
    const o = JSON.parse(raw);
    return {
      webOrigin: typeof o.webOrigin === "string" ? o.webOrigin.trim() : "",
      apiBaseUrl: typeof o.apiBaseUrl === "string" ? o.apiBaseUrl.trim() : "",
      cacheRoot: typeof o.cacheRoot === "string" ? o.cacheRoot.trim() : "",
      material_assets_root: typeof o.material_assets_root === "string" ? o.material_assets_root.trim() : "",
      nasMountRoot: typeof o.nasMountRoot === "string" ? o.nasMountRoot.trim() : "",
    };
  }

  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = parseFile(jsonPath);
      return { ...parsed, jsonPath, fileMissing: false };
    } catch {
      return { webOrigin: "", apiBaseUrl: "", cacheRoot: "", nasMountRoot: "", jsonPath, fileMissing: false };
    }
  }

  if (fs.existsSync(examplePath)) {
    try {
      const parsed = parseFile(examplePath);
      return { ...parsed, jsonPath, fileMissing: true };
    } catch {
      return { webOrigin: "", apiBaseUrl: "", cacheRoot: "", nasMountRoot: "", jsonPath, fileMissing: true };
    }
  }

  return { webOrigin: "", apiBaseUrl: "", cacheRoot: "", nasMountRoot: "", jsonPath, fileMissing: true };
}

function serverSettingsPath() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "server-settings.json");
  } catch {
    return "";
  }
}

/** 用户在登录页填写的服务器地址（站点根，如 https://example.com），保存在 userData */
function readUserServerOrigin() {
  const fp = serverSettingsPath();
  if (!fp || !fs.existsSync(fp)) return "";
  try {
    const o = JSON.parse(fs.readFileSync(fp, "utf8"));
    return typeof o.webOrigin === "string" ? o.webOrigin.trim().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function saveUserServerOrigin(origin) {
  const fp = serverSettingsPath();
  if (!fp) throw new Error("userData unavailable");
  const value = String(origin || "").trim().replace(/\/+$/, "");
  if (value && !/^https?:\/\/[^\s/]+/i.test(value)) {
    throw new Error("服务器地址需以 http:// 或 https:// 开头");
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify({ webOrigin: value, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  return value;
}

/**
 * @param {string} desktopClientRoot
 */
function getBootConfig(desktopClientRoot) {
  const file = readLocalSettingsJson(desktopClientRoot);
  const userOrigin = readUserServerOrigin();
  const envWeb = String(process.env.LCP_WEB_ORIGIN || "").trim();
  const envApi = String(process.env.LCP_API_BASE_URL || "").trim();
  const envCache = String(process.env.LCP_CACHE_ROOT || "").trim();
  const envNasMount =
    String(process.env.LCP_MATERIAL_ASSETS_ROOT || "").trim() ||
    String(process.env.LCP_NAS_MOUNT_ROOT || "").trim();

  const rootWeb = envWeb || userOrigin || file.webOrigin;
  let apiBaseUrl = "";
  if (rootWeb) {
    apiBaseUrl = toApiProxyBase(rootWeb);
  } else {
    apiBaseUrl = envApi || file.apiBaseUrl || "";
  }

  const fileNasUnc =
    (file.material_assets_root && file.material_assets_root.startsWith("\\\\") ? file.material_assets_root : "") ||
    (file.nasMountRoot && file.nasMountRoot.startsWith("\\\\") ? file.nasMountRoot : "") ||
    file.material_assets_root ||
    file.nasMountRoot ||
    "";
  const nasRoot = envNasMount || fileNasUnc;

  return {
    apiBaseUrl,
    cacheRoot: envCache || file.cacheRoot,
    nasMountRoot: nasRoot,
    material_assets_root: nasRoot,
    jsonPath: file.jsonPath,
    settingsFileMissing: Boolean(file.fileMissing),
    /** 与 Web 一致走 Next 的 /api-proxy 时为 true */
    usesNextApiProxy: Boolean(rootWeb),
    /** 登录页保存的服务器地址（无则为空） */
    serverOrigin: userOrigin,
  };
}

module.exports = { getBootConfig, readLocalSettingsJson, toApiProxyBase, saveUserServerOrigin };
