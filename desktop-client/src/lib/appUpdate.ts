export type AppUpdateStatus = {
  phase: string;
  message: string;
  version?: string;
  percent?: number;
  releaseNotes?: string;
};

export async function getDesktopAppVersion(): Promise<{ version: string; packaged: boolean } | null> {
  if (!window.desktopClient?.getAppVersion) return null;
  return (await window.desktopClient.getAppVersion()) as { version: string; packaged: boolean };
}

export async function checkDesktopAppUpdates(): Promise<{ ok: boolean; message?: string; updateInfo?: { version?: string } }> {
  if (!window.desktopClient?.checkForUpdates) {
    return { ok: false, message: "仅打包版桌面客户端支持检查更新" };
  }
  return (await window.desktopClient.checkForUpdates()) as {
    ok: boolean;
    message?: string;
    updateInfo?: { version?: string };
  };
}

export async function downloadDesktopAppUpdate(): Promise<{ ok: boolean; message?: string }> {
  if (!window.desktopClient?.downloadUpdate) return { ok: false, message: "不可用" };
  return (await window.desktopClient.downloadUpdate()) as { ok: boolean; message?: string };
}

export async function quitAndInstallDesktopUpdate(): Promise<{ ok: boolean }> {
  if (!window.desktopClient?.quitAndInstall) return { ok: false };
  return (await window.desktopClient.quitAndInstall()) as { ok: boolean };
}

export function subscribeDesktopAppUpdateStatus(handler: (s: AppUpdateStatus) => void): () => void {
  if (!window.desktopClient?.onUpdateStatus) return () => {};
  return window.desktopClient.onUpdateStatus(handler);
}
