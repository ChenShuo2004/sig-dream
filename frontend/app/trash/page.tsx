"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, useAssetLibrary } from "@/lib/assetLibrary";
import { usePagedPrefetchList } from "@/hooks/usePagedPrefetchList";
import TutorialGate from "@/components/tutorials/TutorialGate";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { OpProgressBar } from "@/components/OpProgressBar";
import { MaterialFilePreviewArea, type MaterialFilePreviewMode } from "@/components/MaterialFilePreviewArea";
import { useMaterialPreviewVideoUrl } from "@/hooks/useMaterialPreviewVideoUrl";

type MaterialItem = {
  id: string;
  title: string;
  status: string;
  uploader: string | null;
  created_at: string;
  primary_file_id?: string | null;
  primary_extension?: string | null;
  original_filename?: string | null;
};

type MaterialsResponse = {
  items: MaterialItem[];
  total: number;
  page: number;
  page_size: number;
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const previewImageExts = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif"]);
const previewVideoExts = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

export default function TrashPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const { library } = useAssetLibrary();
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [result, setResult] = useState("等待操作...");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [permanentProgress, setPermanentProgress] = useState<{ done: number; total: number; detail?: string } | null>(null);
  const permanentProgressClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleClearPermanentProgress(delayMs: number) {
    if (permanentProgressClearRef.current) clearTimeout(permanentProgressClearRef.current);
    permanentProgressClearRef.current = setTimeout(() => {
      permanentProgressClearRef.current = null;
      setPermanentProgress(null);
    }, delayMs);
  }

  function cancelScheduledPermanentProgressClear() {
    if (permanentProgressClearRef.current) {
      clearTimeout(permanentProgressClearRef.current);
      permanentProgressClearRef.current = null;
    }
  }
  const {
    items,
    total,
    busy,
    loadingMore,
    hasMore,
    sentinelRef,
    setItems,
    resetAndLoad,
    loadNext,
    bindLoadNext,
    invalidateInFlight,
  } = usePagedPrefetchList<MaterialItem>({ prefetchPages: [2, 3], enabled: true });
  const listAbortRef = useRef<AbortController | null>(null);
  const libraryEpochRef = useRef(0);

  const canManageAllTrash = permissions.includes("asset.restore_all");
  const canPermanentDelete = permissions.includes("asset.permanent_delete");
  const canViewAsset = permissions.includes("asset.view");
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const previewItem = useMemo(() => items.find((x) => x.id === previewId) || null, [items, previewId]);
  const previewExt = String(previewItem?.primary_extension || "").toLowerCase().replace(/^\./, "");
  const previewMode: MaterialFilePreviewMode = previewVideoExts.has(previewExt)
    ? "video"
    : previewImageExts.has(previewExt)
      ? "image"
      : "generic";
  const trashPreviewVideo = useMaterialPreviewVideoUrl({
    apiBaseUrl,
    materialId: previewItem?.id,
    fileId: previewItem?.primary_file_id,
    enabled: previewMode === "video" && canViewAsset && !!token.trim() && !!previewItem?.primary_file_id,
    token,
  });

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setPermissions(session.permissions || []);
    }
  }, []);

  function authHeaders(extra: Record<string, string> = {}) {
    const withLib = assetLibraryHeaders(extra, library);
    return token ? { ...withLib, Authorization: `Bearer ${token}` } : withLib;
  }

  const fetchTrashPage = useCallback(
    async (targetPage: number): Promise<{ items: MaterialItem[]; total: number }> => {
      const resp = await fetch(`${apiBaseUrl}/materials?status=trashed,trash_pending&include_all=${canManageAllTrash ? "true" : "false"}&page=${targetPage}&page_size=20`, {
        headers: authHeaders(),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as MaterialsResponse | { detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      const typed = data as MaterialsResponse;
      return { items: typed.items, total: typed.total };
    },
    [apiBaseUrl, canManageAllTrash, token, library]
  );

  async function loadTrash() {
    const epoch = libraryEpochRef.current;
    try {
      await resetAndLoad(fetchTrashPage);
      if (epoch !== libraryEpochRef.current) return;
      setResult("[加载回收站成功]");
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return;
      setResult(`[加载回收站失败]\n${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function restore(materialId: string) {
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/${materialId}/restore`, {
        method: "POST",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[恢复成功]\n${pretty(data)}`);
      await loadTrash();
    } catch (error) {
      setResult(`[恢复失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function permanentDelete(materialId: string) {
    const confirmText = window.prompt("请输入 PERMANENT_DELETE 确认永久删除");
    if (confirmText?.trim() !== "PERMANENT_DELETE") return;
    cancelScheduledPermanentProgressClear();
    setPermanentProgress({ done: 0, total: 1, detail: "正在彻底删除…" });
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/${materialId}/permanent?confirm=PERMANENT_DELETE`, {
        method: "DELETE",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setPermanentProgress({ done: 1, total: 1, detail: "完成" });
      scheduleClearPermanentProgress(2000);
      setResult(`[永久删除成功]\n${pretty(data)}`);
      await loadTrash();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setPermanentProgress({ done: 0, total: 1, detail: `失败：${msg}` });
      scheduleClearPermanentProgress(4500);
      setResult(`[永久删除失败]\n${msg}`);
    } finally {
      setActionBusy(false);
    }
  }

  function toggleOne(materialId: string) {
    setSelectedIds((prev) => (prev.includes(materialId) ? prev.filter((id) => id !== materialId) : [...prev, materialId]));
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !items.some((item) => item.id === id)));
      return;
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...items.map((item) => item.id)])));
  }

  async function permanentDeleteSelected() {
    if (!canManageAllTrash) return;
    if (selectedIds.length === 0) {
      setResult("[批量彻底删除] 请先勾选素材");
      return;
    }
    const confirmText = window.prompt(`将彻底删除 ${selectedIds.length} 条素材，输入 PERMANENT_DELETE 确认`);
    if (confirmText?.trim() !== "PERMANENT_DELETE") return;
    const n = selectedIds.length;
    cancelScheduledPermanentProgressClear();
    setPermanentProgress({ done: 0, total: n, detail: "开始批量彻底删除…" });
    setActionBusy(true);
    let success = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    try {
      for (let i = 0; i < n; i += 1) {
        const materialId = selectedIds[i];
        setPermanentProgress({ done: i, total: n, detail: `第 ${i + 1}/${n} 条` });
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetch(`${apiBaseUrl}/materials/${materialId}/permanent?confirm=PERMANENT_DELETE`, {
          method: "DELETE",
          headers: authHeaders({ "X-Access-Context": "internal" }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          failed.push({ id: materialId, reason: JSON.stringify(data) });
          continue;
        }
        success += 1;
      }
      setPermanentProgress({
        done: n,
        total: n,
        detail: `完成（成功 ${success}，失败 ${failed.length}）`,
      });
      scheduleClearPermanentProgress(2800);
      setSelectedIds([]);
      await loadTrash();
      setResult(`[批量彻底删除完成] 成功=${success} 失败=${failed.length}\n${failed.length ? JSON.stringify(failed, null, 2) : ""}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setPermanentProgress({ done: 0, total: n, detail: `已中断：${msg}` });
      scheduleClearPermanentProgress(5000);
      setResult(`[批量彻底删除失败]\n${msg}`);
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    invalidateInFlight();
    listAbortRef.current?.abort();
    listAbortRef.current = new AbortController();
    libraryEpochRef.current += 1;
    setItems([]);
    if (token) void loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, library]);

  useEffect(() => {
    bindLoadNext(() => loadNext(fetchTrashPage));
  }, [bindLoadNext, fetchTrashPage, loadNext]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  useEffect(() => {
    return () => {
      if (permanentProgressClearRef.current) clearTimeout(permanentProgressClearRef.current);
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 grid gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <MaintenanceBanner token={token} />
        <h1 className="text-xl font-semibold text-slate-900">回收站</h1>
        <p className="mt-1 text-sm text-slate-600" data-tour="trash-permission-hint">
          恢复 `trashed` 素材。超级管理员与素材管理员可彻底删除；其他成员仅可恢复自己上传素材。
        </p>
        <div className="mt-2 text-sm text-slate-500">共 {total} 条</div>
        {permanentProgress ? (
          <OpProgressBar
            variant="light"
            label="彻底删除进度"
            done={permanentProgress.done}
            total={permanentProgress.total}
            detail={permanentProgress.detail}
          />
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm grid gap-2" data-tour="trash-list">
        {previewItem ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-900 p-3 text-slate-100">
            <div className="mb-2 text-sm font-medium text-slate-200">
              预览：{previewItem.original_filename || previewItem.title}
            </div>
            <MaterialFilePreviewArea
              mode={previewMode}
              src=""
              showCaption={false}
              videoFallbackPreviewUrl={previewMode === "video" ? trashPreviewVideo.previewUrl : null}
              videoStreamLoading={previewMode === "video" ? trashPreviewVideo.previewLoading : false}
              videoStreamError={previewMode === "video" ? trashPreviewVideo.previewError : null}
              videoPlaceholderHint={
                previewMode === "video" && !previewItem.primary_file_id
                  ? "当前素材无主文件 id，无法解析播放地址。"
                  : previewMode === "video" && !canViewAsset
                    ? "内嵌播放需具备「查看素材」权限（asset.view）。"
                    : previewMode === "generic"
                      ? "该类型暂不支持回收站内预览。"
                      : null
              }
            />
          </div>
        ) : (
          <p className="text-sm text-slate-500">点击一条素材可预览视频（优先播 H.264 预览片，不走原片下载）。</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="w-fit rounded border px-3 py-2" onClick={loadTrash} disabled={busy || actionBusy}>刷新回收站</button>
          <button className="w-fit rounded border px-3 py-2" onClick={toggleAllVisible} disabled={busy || actionBusy || items.length === 0}>
            {allVisibleSelected ? "取消全选" : "全选当前页"}
          </button>
          {canPermanentDelete ? (
            <button
              className="w-fit rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-40"
              onClick={() => void permanentDeleteSelected()}
              disabled={busy || actionBusy || selectedIds.length === 0}
            >
              一键彻底删除勾选（{selectedIds.length}）
            </button>
          ) : null}
        </div>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className={`flex flex-wrap items-center gap-2 rounded border p-2 text-sm ${previewId === item.id ? "border-slate-700 bg-slate-100" : ""}`}
            data-tour={idx === 0 ? "trash-select-item" : undefined}
            onClick={() => setPreviewId(item.id)}
          >
            <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleOne(item.id)} />
            <span className="font-medium">{item.title}</span>
            <span className="text-slate-500">{item.status}</span>
            <span className="text-xs text-slate-400">{item.id}</span>
            <button
              data-tour={idx === 0 ? "trash-restore-button" : undefined}
              className="ml-auto rounded border px-2 py-1 text-xs"
              onClick={() => restore(item.id)}
              disabled={busy || actionBusy}
            >
              恢复
            </button>
            {canPermanentDelete ? (
              <button
                data-tour={idx === 0 ? "trash-permanent-delete-button" : undefined}
                className="rounded border px-2 py-1 text-xs text-red-700"
                onClick={() => permanentDelete(item.id)}
                disabled={busy || actionBusy}
              >
                彻底删除
              </button>
            ) : null}
          </div>
        ))}
        <div className="mt-2 flex justify-end">
          <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={busy || actionBusy || loadingMore || !hasMore} onClick={() => void loadNext(fetchTrashPage)}>
            加载更多
          </button>
        </div>
        <div ref={sentinelRef} className="h-6 w-full" />
      </section>

      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="trash" />
      </Suspense>

      <pre className="rounded bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{result}</pre>
    </main>
  );
}
