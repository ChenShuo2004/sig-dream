const fs = require("fs");
const path = require("path");

/**
 * 拼接 material_assets_root + file_relative_path（支持 UNC 与盘符映射）。
 * @param {string} materialAssetsRoot 如 \\192.168.1.66\nas-file\material-assets 或 Z:\material-assets
 * @param {string} fileRelativePath 如 originals/2026/05/xxx.mp4
 */
function resolveMaterialAssetsPath(materialAssetsRoot, fileRelativePath) {
  const root = String(materialAssetsRoot || "").trim().replace(/[\\/]+$/, "");
  let rel = String(fileRelativePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!root || !rel) return "";

  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith("//")) {
    const winRel = rel.replace(/\//g, path.sep);
    return path.normalize(winRel.startsWith("//") ? `\\\\${winRel.slice(2)}` : winRel);
  }

  if (root.startsWith("\\\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }

  return path.join(root, rel.replace(/\//g, path.sep));
}

function toWindowsLongPathIfNeeded(absPath) {
  const p = String(absPath || "").trim();
  if (process.platform !== "win32" || !p) return p;
  if (p.startsWith("\\\\?\\")) return p;
  if (p.startsWith("\\\\")) {
    return `\\\\?\\UNC\\${p.replace(/^\\\\+/, "")}`;
  }
  if (p.length >= 240 && /^[a-zA-Z]:/.test(p)) {
    return `\\\\?\\${p}`;
  }
  return p;
}

function checkFileExists(absPath) {
  const candidates = [String(absPath || "").trim()];
  const longP = toWindowsLongPathIfNeeded(candidates[0]);
  if (longP && longP !== candidates[0]) candidates.push(longP);
  for (const p of candidates) {
    if (!p) continue;
    try {
      const st = fs.statSync(p);
      if (st.isFile()) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function pickExistingAbsolutePath(absPath) {
  const p = String(absPath || "").trim();
  if (!p) return "";
  if (checkFileExists(p)) return p;
  const longP = toWindowsLongPathIfNeeded(p);
  if (longP && checkFileExists(longP)) return longP;
  return p;
}

/** @deprecated 别名 */
const resolveNasAbsolutePath = resolveMaterialAssetsPath;

module.exports = {
  resolveMaterialAssetsPath,
  resolveNasAbsolutePath,
  checkFileExists,
  pickExistingAbsolutePath,
  toWindowsLongPathIfNeeded,
};
