const { execFile } = require("child_process");

const { checkFileExists, pickExistingAbsolutePath } = require("./material-path.cjs");

/**
 * Windows：将本地/NAS 文件放入剪贴板，可在资源管理器目标文件夹 Ctrl+V 粘贴。
 * @param {string} absolutePath
 */
function copyFileToClipboardForPaste(absolutePath) {
  const filePath = pickExistingAbsolutePath(String(absolutePath || "").trim());
  if (!filePath || !checkFileExists(filePath)) {
    return Promise.resolve({
      ok: false,
      error: "file_not_accessible",
      message: `文件不可读：${absolutePath}`,
    });
  }

  if (process.platform !== "win32") {
    return Promise.resolve({
      ok: false,
      error: "not_windows",
      message: "当前仅 Windows 支持「复制文件到剪贴板」粘贴。",
    });
  }

  const escaped = filePath.replace(/'/g, "''");
  const command = `Set-Clipboard -LiteralPath '${escaped}'`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: 15000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error: "clipboard_failed",
            message: String(stderr || err.message || err),
            absolutePath: filePath,
          });
          return;
        }
        resolve({ ok: true, absolutePath: filePath });
      }
    );
  });
}

module.exports = { copyFileToClipboardForPaste };
