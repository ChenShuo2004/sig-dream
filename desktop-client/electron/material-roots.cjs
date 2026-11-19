const fs = require("fs");
const path = require("path");

const { readMaterialAssetsRootFromUserStore, DEFAULT_MATERIAL_ASSETS_ROOT_WINDOWS, DEFAULT_MATERIAL_ASSETS_ROOT_MACOS, DEFAULT_MATERIAL_ASSETS_ROOT_LINUX } = require("./desktop-local-settings.cjs");
const { getBootConfig } = require("./boot-config.cjs");
const { getDesktopClientRoot } = require("./app-paths.cjs");
const { resolveMaterialAssetsPath, checkFileExists, pickExistingAbsolutePath } = require("./material-path.cjs");

function isDriveLetterRoot(r) {
  return /^[a-zA-Z]:[\\/]/.test(String(r || "").trim());
}

function isUncRoot(r) {
  return String(r || "").trim().startsWith("\\\\");
}

function pickPreferredNasRootFromJson(o) {
  if (!o || typeof o !== "object") return "";
  const primary = String(o.material_assets_root || "").trim();
  const secondary = String(o.nasMountRoot || "").trim();
  if (primary && isUncRoot(primary)) return primary;
  if (secondary && isUncRoot(secondary)) return secondary;
  if (primary && !isDriveLetterRoot(primary)) return primary;
  if (secondary && !isDriveLetterRoot(secondary)) return secondary;
  return "";
}

function readBundledNasRoot() {
  const root = getDesktopClientRoot();
  for (const name of ["local.settings.json", "local.settings.example.json"]) {
    const fp = path.join(root, name);
    if (!fs.existsSync(fp)) continue;
    try {
      const picked = pickPreferredNasRootFromJson(JSON.parse(fs.readFileSync(fp, "utf8")));
      if (picked) return picked;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** @deprecated use readBundledNasRoot */
function readExampleNasRoot() {
  return readBundledNasRoot();
}

/**
 * Normalize file_relative_path; strip absolute Z:/UNC copied from another PC.
 * @param {string} rel
 */
function normalizeFileRelativePath(rel) {
  let s = String(rel || "").trim();
  if (!s) return "";
  const norm = s.replace(/\\/g, "/");
  if (!/^[a-zA-Z]:/.test(norm) && !norm.startsWith("//")) {
    return norm.replace(/^\/+/, "");
  }
  const lower = norm.toLowerCase();
  const matIdx = lower.indexOf("/material-assets/");
  if (matIdx >= 0) return norm.slice(matIdx + "/material-assets/".length).replace(/^\/+/, "");
  const origIdx = lower.indexOf("/originals/");
  if (origIdx >= 0) return norm.slice(origIdx + 1);
  return "";
}

/**
 * @param {string} userDataDir
 * @param {string} desktopClientRoot
 * @param {string} platform
 */
function listMaterialAssetsRootCandidates(userDataDir, desktopClientRoot, platform) {
  const out = [];
  const add = (r) => {
    const t = String(r || "").trim().replace(/[\\/]+$/, "");
    if (t && !out.includes(t)) out.push(t);
  };

  add(readMaterialAssetsRootFromUserStore(userDataDir));

  const boot = getBootConfig(desktopClientRoot);
  add(boot.material_assets_root);
  add(readBundledNasRoot());

  if (platform === "darwin") {
    add(DEFAULT_MATERIAL_ASSETS_ROOT_MACOS);
  } else if (platform === "linux") {
    add(DEFAULT_MATERIAL_ASSETS_ROOT_LINUX);
  } else {
    add(DEFAULT_MATERIAL_ASSETS_ROOT_WINDOWS);
  }

  const hasUnc = out.some(isUncRoot);
  if (hasUnc) {
    return out.filter((r) => !isDriveLetterRoot(r));
  }
  return out;
}

/**
 * @param {string} fileRelativePath
 * @param {string[]} roots
 */
function resolveAbsolutePathWithRoots(fileRelativePath, roots) {
  const rel = normalizeFileRelativePath(fileRelativePath);
  if (!rel) {
    const raw = String(fileRelativePath || "").trim();
    if (/^[a-zA-Z]:/.test(raw) || raw.startsWith("\\\\")) {
      return {
        ok: false,
        exists: false,
        absolutePath: raw,
        file_relative_path: raw,
        material_assets_root: roots[0] || "",
        error: "file_not_accessible",
        message:
          `NAS 文件在本机不可读。元数据里是绝对路径（如 Z:），其它电脑无法使用。\n` +
          `请在本机「本机连接与缓存」确认 material_assets_root 为 UNC，并重新「同步素材元数据」。\n` +
          `示例 UNC：\\\\YOUR_NAS_HOST\\nas-file\\material-assets`,
        triedRoots: roots,
      };
    }
    return { ok: false, error: "file_relative_path_not_found" };
  }

  const tried = [];
  for (const root of roots) {
    const absolutePath = resolveMaterialAssetsPath(root, rel);
    if (!absolutePath) continue;
    tried.push(absolutePath);
    const existingPath = pickExistingAbsolutePath(absolutePath);
    if (existingPath && checkFileExists(existingPath)) {
      return {
        ok: true,
        exists: true,
        absolutePath: existingPath,
        file_relative_path: rel,
        material_assets_root: root,
        error: null,
        message: null,
        triedRoots: roots,
      };
    }
  }

  const rootPreview = roots.slice(0, 3).join("\n");
  const pathPreview = tried.slice(0, 2).join("\n");
  return {
    ok: false,
    exists: false,
    absolutePath: tried[0] || "",
    file_relative_path: rel,
    material_assets_root: roots[0] || "",
    error: "file_not_accessible",
    message:
      `NAS 文件在本机不可读。请确认：\n` +
      `1) 「本机连接与缓存」中 material_assets_root 为本机可打开的 UNC（如 \\\\YOUR_NAS_HOST\\nas-file\\material-assets），勿用 Z: 盘符；\n` +
      `2) 已在资源管理器打开该 UNC 并完成 SMB 登录（如需账号密码）；\n` +
      `3) 已登录并执行「同步素材元数据」；\n` +
      `4) 当前尝试的根目录：\n${rootPreview || "（无）"}\n` +
      `5) 拼接示例：\n${pathPreview || rel}`,
    triedRoots: roots,
  };
}

module.exports = {
  listMaterialAssetsRootCandidates,
  resolveAbsolutePathWithRoots,
  readExampleNasRoot,
  readBundledNasRoot,
  normalizeFileRelativePath,
};
