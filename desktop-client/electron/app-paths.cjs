const path = require("path");
const { app } = require("electron");

/** 开发：desktop-client/；打包：resources/（extraResources 同目录） */
function getDesktopClientRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.join(__dirname, "..");
}

function bundledSettingsExamplePath() {
  const root = getDesktopClientRoot();
  const inResources = path.join(root, "local.settings.example.json");
  if (require("fs").existsSync(inResources)) return inResources;
  return path.join(path.join(__dirname, ".."), "local.settings.example.json");
}

module.exports = { getDesktopClientRoot, bundledSettingsExamplePath };
