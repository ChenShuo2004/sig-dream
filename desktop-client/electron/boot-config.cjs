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

/**
 * @param {string} desktopClientRoot
 */
function getBootConfig(desktopClientRoot) {
  const file = readLocalSettingsJson(desktopClientRoot);
  const envWeb = String(process.env.LCP_WEB_ORIGIN || "").trim();
  const envApi = String(process.env.LCP_API_BASE_URL || "").trim();
  const envCache = String(process.env.LCP_CACHE_ROOT || "").trim();
  const envNasMount =
    String(process.env.LCP_MATERIAL_ASSETS_ROOT || "").trim() ||
    String(process.env.LCP_NAS_MOUNT_ROOT || "").trim();

  const rootWeb = envWeb || file.webOrigin;
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
  };
}

module.exports = { getBootConfig, readLocalSettingsJson, toApiProxyBase };
