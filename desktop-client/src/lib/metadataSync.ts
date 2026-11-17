/**
 * 从 FastAPI 分页拉取素材元数据并写入 Electron 主进程本地索引。
 */

import { apiJson } from "@/lib/apiClient";

export type MetadataSyncStats = {
  tagCount: number;
  materialCount: number;
  fileCount: number;
  lastSyncedAt: string | null;
};

type SyncPage = {
  tags?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  files?: Array<Record<string, unknown>>;
  page: number;
  page_size: number;
  total_materials: number;
  synced_at: string;
};

export type MetadataSyncProgress = {
  phase: "fetching" | "applying" | "done" | "error";
  page: number;
  totalPages: number;
  message: string;
};

const PAGE_SIZE = 100;

export async function runDesktopMetadataSync(onProgress?: (p: MetadataSyncProgress) => void): Promise<MetadataSyncStats> {
  if (typeof window === "undefined" || !window.desktopClient?.metadataSyncApply) {
    throw new Error("仅 Electron 桌面壳支持元数据同步");
  }

  let page = 1;
  let totalPages = 1;
  let lastStats: MetadataSyncStats = {
    tagCount: 0,
    materialCount: 0,
    fileCount: 0,
    lastSyncedAt: null,
  };

  while (page <= totalPages) {
    onProgress?.({
      phase: "fetching",
      page,
      totalPages,
      message: `正在从服务器拉取元数据（第 ${page}/${totalPages} 页）…`,
    });
    const data = await apiJson<SyncPage>(
      `/materials/desktop-metadata-sync?page=${page}&page_size=${PAGE_SIZE}`
    );
    totalPages = Math.max(1, Math.ceil((data.total_materials || 0) / PAGE_SIZE));
    onProgress?.({
      phase: "applying",
      page,
      totalPages,
      message: `正在写入本机索引（第 ${page}/${totalPages} 页）…`,
    });
    lastStats = (await window.desktopClient.metadataSyncApply({
      tags: data.tags || [],
      materials: data.materials || [],
      files: data.files || [],
      synced_at: data.synced_at,
    })) as MetadataSyncStats;
    page += 1;
  }

  onProgress?.({
    phase: "done",
    page: totalPages,
    totalPages,
    message: `同步完成：${lastStats.materialCount} 条素材、${lastStats.fileCount} 个 NAS 文件路径。`,
  });
  return lastStats;
}

export async function getMetadataSyncStats(): Promise<MetadataSyncStats | null> {
  if (!window.desktopClient?.metadataSyncStats) return null;
  return (await window.desktopClient.metadataSyncStats()) as MetadataSyncStats;
}
