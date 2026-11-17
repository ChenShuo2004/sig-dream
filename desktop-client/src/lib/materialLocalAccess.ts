/**
 * NAS 文件直拖：material_assets_root + file_relative_path → 系统原生拖出。
 */

import {
  resolveMaterialDownload,
  type DownloadTransportRoute,
  type MaterialResolvedDownload,
} from "@/lib/materialBrowserDownload";
import { resolvedCacheRoot } from "@/lib/settingsStore";

export type MaterialFileResolveResult = {
  ok: boolean;
  exists?: boolean;
  absolutePath?: string;
  file_relative_path?: string;
  material_assets_root?: string;
  error?: string | null;
  message?: string | null;
};

export type PeekFileDragSyncResult = {
  ok: boolean;
  exists?: boolean;
  absolutePath?: string;
  error?: string;
  message?: string;
  material_assets_root?: string;
  file_relative_path?: string;
};

export type MaterialLocalAccess =
  | {
      mode: "nas_smb";
      absolutePath: string;
      fileRelativePath: string;
      fileId: string;
      materialId: string;
    }
  | {
      mode: "http";
      resolved: MaterialResolvedDownload;
      fileId: string;
      materialId: string;
    };

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktopClient);
}

export async function resolveMaterialFilePath(opts: {
  materialId: string;
  fileId?: string;
  fileRelativePath?: string;
}): Promise<MaterialFileResolveResult> {
  if (!isDesktopShell()) return { ok: false, error: "not_desktop" };
  const api = window.desktopClient?.resolveMaterialFile ?? window.desktopClient?.resolveNasFile;
  if (!api) return { ok: false, error: "ipc_missing" };
  return (await api({
    materialId: opts.materialId,
    fileId: opts.fileId,
    fileRelativePath: opts.fileRelativePath,
    file_relative_path: opts.fileRelativePath,
  })) as MaterialFileResolveResult;
}

/** @deprecated */
export const resolveNasFilePath = resolveMaterialFilePath;

/** dragstart 第一步：仅解析路径，不调用 startDrag */
export function peekFileDragSync(opts: {
  materialId: string;
  fileId?: string;
  fileRelativePath?: string;
}): PeekFileDragSyncResult {
  if (!window.desktopClient?.peekFileDragSync) {
    return { ok: false, error: "not_desktop", message: "仅 Electron 桌面壳支持原生文件拖出。" };
  }
  return window.desktopClient.peekFileDragSync({
    materialId: opts.materialId,
    fileId: opts.fileId,
    fileRelativePath: opts.fileRelativePath,
    file_relative_path: opts.fileRelativePath,
  }) as PeekFileDragSyncResult;
}

function peekCachedFileExists(absolutePath: string): boolean {
  if (!window.desktopClient?.beginCachedFileDragSync) return false;
  const r = window.desktopClient.beginCachedFileDragSync({ absolutePath }) as { ok?: boolean };
  return Boolean(r?.ok);
}

export function resolveDragAbsolutePath(opts: {
  materialId: string;
  fileId?: string;
  fileRelativePath?: string;
  cachedPath?: string;
}): PeekFileDragSyncResult {
  const cached = String(opts.cachedPath || "").trim();
  if (cached && peekCachedFileExists(cached)) {
    return { ok: true, absolutePath: cached };
  }
  return peekFileDragSync({
    materialId: opts.materialId,
    fileId: opts.fileId,
    fileRelativePath: opts.fileRelativePath,
  });
}

export type NativeFileDragSyncResult = PeekFileDragSyncResult & {
  mode?: "nas_smb" | "local_cache";
  fileCount?: number;
  files?: string[];
  missingCount?: number;
  skipped?: Array<{ materialId?: string; error?: string; message?: string | null }>;
  truncated?: boolean;
  maxBulk?: number;
};

export type MaterialDragItemPayload = {
  materialId: string;
  fileId?: string;
  fileRelativePath?: string;
  cachedAbsolutePath?: string;
};

/**
 * dragstart 内同步调用主进程：preventDefault + 解析路径 + startDrag。
 */
export function performNativeMaterialDragSync(
  e: DragEvent,
  opts: {
    materialId: string;
    fileId?: string;
    fileRelativePath?: string;
    cachedAbsolutePath?: string;
  }
): NativeFileDragSyncResult {
  if (!window.desktopClient) {
    return { ok: false, error: "not_desktop", message: "非 Electron 环境，无法原生拖出文件。" };
  }
  e.preventDefault();
  e.dataTransfer.effectAllowed = "copy";

  const sync = window.desktopClient.startNativeFileDragSync;
  if (sync) {
    return sync({
      materialId: opts.materialId,
      fileId: opts.fileId,
      fileRelativePath: opts.fileRelativePath,
      file_relative_path: opts.fileRelativePath,
      absolutePath: opts.cachedAbsolutePath,
      path: opts.cachedAbsolutePath,
    }) as NativeFileDragSyncResult;
  }

  const peek = resolveDragAbsolutePath({
    materialId: opts.materialId,
    fileId: opts.fileId,
    fileRelativePath: opts.fileRelativePath,
    cachedPath: opts.cachedAbsolutePath,
  });
  if (!peek.ok || !peek.absolutePath) return peek;
  window.desktopClient.startNativeFileDrag?.({ path: peek.absolutePath });
  return { ok: true, absolutePath: peek.absolutePath, mode: "nas_smb" };
}

/** 批量 NAS 直拖（Windows：startDrag files 数组） */
export function performNativeMaterialsDragSync(
  e: DragEvent,
  items: MaterialDragItemPayload[]
): NativeFileDragSyncResult {
  if (!window.desktopClient) {
    return { ok: false, error: "not_desktop", message: "非 Electron 环境，无法原生拖出文件。" };
  }
  const api = window.desktopClient.startNativeFilesDragSync;
  if (!api) {
    return { ok: false, error: "ipc_missing", message: "批量拖放 API 未加载，请重启桌面客户端。" };
  }
  e.preventDefault();
  e.dataTransfer.effectAllowed = "copy";
  return api({
    items: items.map((it) => ({
      materialId: it.materialId,
      fileId: it.fileId,
      fileRelativePath: it.fileRelativePath,
      file_relative_path: it.fileRelativePath,
      cachedAbsolutePath: it.cachedAbsolutePath,
    })),
  }) as NativeFileDragSyncResult;
}

export async function downloadMaterialToCache(opts: {
  url: string;
  materialId: string;
  fileId: string;
  originalFilename: string;
  expectedSize?: number | null;
  headers?: Record<string, string>;
  cacheRoot?: string;
}): Promise<{ ok: boolean; absolutePath?: string; fromCache?: boolean; message?: string }> {
  if (!window.desktopClient?.downloadToCache) {
    return { ok: false, message: "主进程缓存下载不可用。" };
  }
  return (await window.desktopClient.downloadToCache({
    url: opts.url,
    materialId: opts.materialId,
    fileId: opts.fileId,
    originalFilename: opts.originalFilename,
    expectedSize: opts.expectedSize ?? undefined,
    headers: opts.headers,
    cacheRoot: opts.cacheRoot || resolvedCacheRoot(),
  })) as { ok: boolean; absolutePath?: string; fromCache?: boolean; message?: string };
}

export async function resolveMaterialLocalAccess(opts: {
  apiBaseUrl: string;
  materialId: string;
  fileId: string;
  filename: string;
  fileRelativePath?: string;
  authHeaders: () => Record<string, string>;
  signal?: AbortSignal;
  onPhase?: (message: string) => void;
}): Promise<MaterialLocalAccess> {
  const nas = await resolveMaterialFilePath({
    materialId: opts.materialId,
    fileId: opts.fileId,
    fileRelativePath: opts.fileRelativePath,
  });
  if (nas.ok && nas.exists && nas.absolutePath) {
    opts.onPhase?.("已解析 NAS 共享路径（零拷贝）");
    return {
      mode: "nas_smb",
      absolutePath: nas.absolutePath,
      fileRelativePath: nas.file_relative_path || opts.fileRelativePath || "",
      fileId: opts.fileId,
      materialId: opts.materialId,
    };
  }

  opts.onPhase?.("NAS 直拖不可用，改用 HTTP 下载选路…");
  const resolved = await resolveMaterialDownload({
    apiBaseUrl: opts.apiBaseUrl,
    materialId: opts.materialId,
    fileId: opts.fileId,
    filename: opts.filename,
    authHeaders: opts.authHeaders,
    signal: opts.signal,
    onPhase: opts.onPhase,
  });
  return { mode: "http", resolved, fileId: opts.fileId, materialId: opts.materialId };
}

export async function openMaterialInFolder(access: MaterialLocalAccess): Promise<boolean> {
  if (access.mode !== "nas_smb" || !window.desktopClient?.showItemInFolder) return false;
  const r = await window.desktopClient.showItemInFolder(access.absolutePath);
  return Boolean(r && typeof r === "object" && (r as { ok?: boolean }).ok);
}

export async function copyMaterialLocalPath(access: MaterialLocalAccess): Promise<boolean> {
  if (access.mode !== "nas_smb" || !window.desktopClient?.copyText) return false;
  const r = await window.desktopClient.copyText(access.absolutePath);
  return Boolean(r && typeof r === "object" && (r as { ok?: boolean }).ok);
}

/** Windows：复制文件到剪贴板，可在资源管理器/部分软件中 Ctrl+V 粘贴 */
export async function copyMaterialFileForPaste(absolutePath: string): Promise<{ ok: boolean; message?: string }> {
  if (!window.desktopClient?.copyFileForPaste) {
    return { ok: false, message: "当前环境不支持复制文件到剪贴板。" };
  }
  const r = (await window.desktopClient.copyFileForPaste(absolutePath)) as { ok?: boolean; message?: string };
  return { ok: Boolean(r?.ok), message: r?.message };
}

export type { DownloadTransportRoute };
