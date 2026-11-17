const fs = require("fs");
const path = require("path");

const { readMaterialAssetsRootFromUserStore, saveMaterialAssetsRootToUserStore } = require("./desktop-local-settings.cjs");
const { readBundledNasRoot } = require("./material-roots.cjs");
const { getBootConfig } = require("./boot-config.cjs");
const { bundledSettingsExamplePath } = require("./app-paths.cjs");

/**
 * 打包安装后首次运行：将 bundled 示例中的 UNC/API 写入 userData，避免默认 Z: 盘在其他电脑失效。
 */
function ensurePackagedFirstRunDefaults(userDataDir, desktopClientRoot) {
  const { app } = require("electron");
  if (!app.isPackaged) return { seeded: false };

  const existing = readMaterialAssetsRootFromUserStore(userDataDir);
  if (existing) return { seeded: false };

  const exampleRoot = readBundledNasRoot();
  const boot = getBootConfig(desktopClientRoot);
  const root = exampleRoot || boot.material_assets_root || boot.nasMountRoot;
  if (!root) return { seeded: false };

  saveMaterialAssetsRootToUserStore(userDataDir, { material_assets_root: root });

  const marker = path.join(userDataDir, "first-run-seeded.json");
  let apiHint = boot.apiBaseUrl || "";
  try {
    const exPath = bundledSettingsExamplePath();
    if (fs.existsSync(exPath)) {
      const ex = JSON.parse(fs.readFileSync(exPath, "utf8"));
      if (!apiHint && typeof ex.apiBaseUrl === "string") apiHint = ex.apiBaseUrl.trim();
    }
  } catch {
    /* ignore */
  }

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    marker,
    JSON.stringify({ material_assets_root: root, apiBaseUrl: apiHint, at: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return { seeded: true, material_assets_root: root, apiBaseUrl: apiHint };
}

module.exports = { ensurePackagedFirstRunDefaults };
