const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopClient", {
  platform: process.platform,
  getBootConfig: () => ipcRenderer.invoke("lcp:get-boot-config"),
  saveServerOrigin: (origin) => ipcRenderer.invoke("lcp:save-server-origin", origin),
  probeHttpGet: (url, timeoutMs) => ipcRenderer.invoke("lcp:probe-http-get", { url, timeoutMs }),
  getDesktopLocalSettings: () => ipcRenderer.invoke("lcp:get-desktop-local-settings"),
  saveDesktopLocalSettings: (patch) => ipcRenderer.invoke("lcp:save-desktop-local-settings", patch),
  metadataSyncApply: (batch) => ipcRenderer.invoke("lcp:metadata-sync-apply", batch),
  metadataSyncStats: () => ipcRenderer.invoke("lcp:metadata-sync-stats"),
  resolveMaterialFile: (payload) => ipcRenderer.invoke("lcp:resolve-material-file", payload),
  /** @deprecated */
  resolveNasFile: (payload) => ipcRenderer.invoke("lcp:resolve-material-file", payload),
  showItemInFolder: (absolutePath) => ipcRenderer.invoke("lcp:show-item-in-folder", absolutePath),
  copyText: (text) => ipcRenderer.invoke("lcp:copy-text", text),
  copyFileForPaste: (absolutePath) => ipcRenderer.invoke("lcp:copy-file-for-paste", absolutePath),
  getAppVersion: () => ipcRenderer.invoke("lcp:get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("lcp:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("lcp:download-update"),
  quitAndInstall: () => ipcRenderer.invoke("lcp:quit-and-install"),
  onUpdateStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("lcp:update-status", listener);
    return () => ipcRenderer.removeListener("lcp:update-status", listener);
  },
  peekFileDragSync: (payload) => ipcRenderer.sendSync("lcp:peek-file-drag-sync", payload),
  /** dragstart 内同步：解析路径 + startDrag（Windows 更可靠） */
  startNativeFileDragSync: (payload) => ipcRenderer.sendSync("lcp:start-native-file-drag-sync", payload),
  startNativeFilesDragSync: (payload) => ipcRenderer.sendSync("lcp:start-native-files-drag-sync", payload),
  beginCachedFileDragSync: (payload) => ipcRenderer.sendSync("lcp:begin-cached-file-drag-sync", payload),
  startNativeFileDrag: (payload) => ipcRenderer.send("lcp:start-native-file-drag", payload),
  downloadToCache: (payload) => ipcRenderer.invoke("lcp:download-to-cache", payload),
});
