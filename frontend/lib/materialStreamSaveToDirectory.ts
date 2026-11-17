/**
 * 将 URL 流写入用户选择的本地目录（File System Access API）。
 * 从素材库页抽取，供集合页等与「选择保存方式」弹窗复用。
 */

export function isCoarseMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function supportsMaterialDirectorySave(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (isCoarseMobileDevice()) return false;
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  return typeof w.showDirectoryPicker === "function";
}

function sanitizeWindowsFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "download.bin";
}

function splitStemExt(filename: string): { stem: string; ext: string } {
  const normalized = sanitizeWindowsFilename(filename);
  const i = normalized.lastIndexOf(".");
  if (i <= 0 || i >= normalized.length - 1) return { stem: normalized || "download", ext: "" };
  return { stem: normalized.slice(0, i), ext: normalized.slice(i) };
}

async function pickUniqueFilenameInDirectory(dirHandle: FileSystemDirectoryHandle, baseName: string): Promise<string> {
  const { stem, ext } = splitStemExt(baseName);
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? `${stem}${ext}` : `${stem} (${n})${ext}`;
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      n += 1;
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return candidate;
      throw e;
    }
  }
}

export async function streamUrlToDirectoryWithProgress(
  absoluteUrl: string,
  baseFileName: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number, total: number) => void,
  existingDirHandle?: FileSystemDirectoryHandle | null
): Promise<number> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  let dirHandle: FileSystemDirectoryHandle;
  if (existingDirHandle) {
    dirHandle = existingDirHandle;
  } else {
    if (!w.showDirectoryPicker) throw new Error("当前浏览器不支持选择目录");
    dirHandle = await w.showDirectoryPicker();
  }
  const finalName = await pickUniqueFilenameInDirectory(dirHandle, baseFileName);
  const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  const resp = await fetch(absoluteUrl, { method: "GET", mode: "cors", credentials: "omit", ...(signal ? { signal } : {}) });
  if (!resp.ok) {
    await writable.close().catch(() => {});
    throw new Error(`下载请求失败 HTTP ${resp.status}`);
  }
  const total = Number(resp.headers.get("Content-Length")) || 0;
  const body = resp.body;
  if (!body) {
    await writable.close().catch(() => {});
    throw new Error("响应无正文流");
  }
  const reader = body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        await writable.write(value);
        received += value.byteLength;
        onProgress(received, total);
      }
    }
  } finally {
    reader.releaseLock();
  }
  await writable.close();
  return received;
}
