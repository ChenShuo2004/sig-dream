const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");

const { checkFileExists } = require("./material-path.cjs");

function sanitizeFilename(name) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return cleaned || "download.bin";
}

/**
 * 与 V1 技术文档一致：{material_id}_{file_id}_{safe_original_filename}
 */
function buildCacheFilePath(cacheRoot, materialId, fileId, originalFilename) {
  const safe = sanitizeFilename(originalFilename);
  const base = `${materialId}_${fileId}_${safe}`;
  const dir = path.join(String(cacheRoot || "").trim(), "files");
  return path.join(dir, base.slice(0, 240));
}

function getValidCachePath(cacheRoot, materialId, fileId, originalFilename, expectedSize) {
  const dest = buildCacheFilePath(cacheRoot, materialId, fileId, originalFilename);
  if (!checkFileExists(dest)) return null;
  if (expectedSize != null && expectedSize > 0) {
    try {
      if (fs.statSync(dest).size !== expectedSize) return null;
    } catch {
      return null;
    }
  }
  return dest;
}

async function downloadUrlToFile(url, destPath, headers) {
  const urlStr = String(url || "").trim();
  if (!urlStr) throw new Error("download_url_missing");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;
  const resp = await fetch(urlStr, {
    method: "GET",
    headers: headers && typeof headers === "object" ? headers : {},
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  if (!resp.body) throw new Error("empty_body");
  await pipeline(resp.body, createWriteStream(tmp));
  fs.renameSync(tmp, destPath);
  return destPath;
}

module.exports = {
  sanitizeFilename,
  buildCacheFilePath,
  getValidCachePath,
  downloadUrlToFile,
};
