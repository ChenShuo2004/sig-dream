const fs = require("fs");
const path = require("path");

/** 局域网多机通用：优先 UNC，避免仅某台机器存在的 Z: 盘符 */
const DEFAULT_MATERIAL_ASSETS_ROOT_WINDOWS = "\\\\192.168.1.2\\nas-file\\material-assets";
const DEFAULT_MATERIAL_ASSETS_ROOT_MACOS = "/Volumes/material-assets";

function defaultMaterialAssetsRootForPlatform(platform) {
  return platform === "darwin" ? DEFAULT_MATERIAL_ASSETS_ROOT_MACOS : DEFAULT_MATERIAL_ASSETS_ROOT_WINDOWS;
}

function pickRootFromJson(o) {
  if (!o || typeof o !== "object") return "";
  const primary = typeof o.material_assets_root === "string" ? o.material_assets_root.trim() : "";
  const secondary = typeof o.nasMountRoot === "string" ? o.nasMountRoot.trim() : "";
  if (primary && primary.startsWith("\\\\")) return primary;
  if (secondary && secondary.startsWith("\\\\")) return secondary;
  if (primary && !/^[a-zA-Z]:[\\/]/.test(primary)) return primary;
  if (secondary && !/^[a-zA-Z]:[\\/]/.test(secondary)) return secondary;
  return "";
}

/**
 * @param {string} desktopClientRoot
 * @param {string} platform
 */
function readMaterialAssetsRootFromBootFile(desktopClientRoot, platform) {
  const jsonPath = path.join(desktopClientRoot, "local.settings.json");
  let fromFile = "";
  if (fs.existsSync(jsonPath)) {
    try {
      fromFile = pickRootFromJson(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
    } catch {
      /* ignore */
    }
  }
  const fromEnv =
    String(process.env.LCP_MATERIAL_ASSETS_ROOT || "").trim() ||
    String(process.env.LCP_NAS_MOUNT_ROOT || "").trim();
  return fromEnv || fromFile || defaultMaterialAssetsRootForPlatform(platform);
}

/**
 * @param {string} userDataDir
 */
function readMaterialAssetsRootFromUserStore(userDataDir) {
  const fp = path.join(userDataDir, "desktop-user-settings.json");
  if (!fs.existsSync(fp)) return "";
  try {
    return pickRootFromJson(JSON.parse(fs.readFileSync(fp, "utf8")));
  } catch {
    return "";
  }
}

/**
 * @param {string} userDataDir
 * @param {{ material_assets_root?: string; nasMountRoot?: string }} patch
 */
function saveMaterialAssetsRootToUserStore(userDataDir, patch) {
  const fp = path.join(userDataDir, "desktop-user-settings.json");
  let prev = {};
  if (fs.existsSync(fp)) {
    try {
      prev = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      prev = {};
    }
  }
  const next = { ...prev };
  const root =
    (typeof patch.material_assets_root === "string" ? patch.material_assets_root : "") ||
    (typeof patch.nasMountRoot === "string" ? patch.nasMountRoot : "");
  if (root.trim()) {
    next.material_assets_root = root.trim();
    next.nasMountRoot = root.trim();
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = {
  readMaterialAssetsRootFromBootFile,
  readMaterialAssetsRootFromUserStore,
  saveMaterialAssetsRootToUserStore,
  defaultMaterialAssetsRootForPlatform,
  DEFAULT_MATERIAL_ASSETS_ROOT_WINDOWS,
  DEFAULT_MATERIAL_ASSETS_ROOT_MACOS,
  /** @deprecated */
  readNasMountRoot: readMaterialAssetsRootFromBootFile,
  readNasMountFromUserStore: readMaterialAssetsRootFromUserStore,
  saveNasMountToUserStore: saveMaterialAssetsRootToUserStore,
  defaultNasMountForPlatform: defaultMaterialAssetsRootForPlatform,
};
