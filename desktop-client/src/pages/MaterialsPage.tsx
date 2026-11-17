import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { MaterialFileCard } from "@/components/MaterialFileCard";
import { MaterialFilePreviewArea } from "@/components/MaterialFilePreviewArea";
import { useMaterialFileStreamUrl } from "@/hooks/useMaterialFileStreamUrl";
import { useMaterialPreviewVideoUrl } from "@/hooks/useMaterialPreviewVideoUrl";
import { apiFetch, apiJson, getApiBaseUrl } from "@/lib/apiClient";
import { useAssetLibrary } from "@/lib/assetLibrary";
import { hasPermission, loadAuthSession } from "@/lib/auth";
import { formatBytes } from "@/lib/formatBytes";
import { materialDownloadAuthHeaders } from "@/lib/materialDownloadAuth";
import {
  resolveDirectMediaUrl,
  resolveMaterialDownload,
  toAbsoluteUrl,
  triggerBrowserDownload,
  type DownloadTransportRoute,
} from "@/lib/materialBrowserDownload";
import {
  copyMaterialFileForPaste,
  copyMaterialLocalPath,
  downloadMaterialToCache,
  openMaterialInFolder,
  performNativeMaterialDragSync,
  performNativeMaterialsDragSync,
  resolveMaterialFilePath,
  resolveMaterialLocalAccess,
  type MaterialDragItemPayload,
} from "@/lib/materialLocalAccess";
import { runDesktopMetadataSync } from "@/lib/metadataSync";
import { resolvedCacheRoot } from "@/lib/settingsStore";
import { thumbnailAccessContextHeaders } from "@/lib/thumbnailAccessContext";
import { isNasTransferReady, nasStatusFetchFailed, type NasClientStatus } from "@/lib/nasClientStatus";
import {
  MATERIAL_SIDEBAR_TO_BACKEND,
  MATERIAL_TAG_SIDEBAR_CATEGORIES,
  materialSidebarCategoriesForLibrary,
  tagCategoriesForLibrary,
  tagCategoryHoverTitle,
  tagCategoryHoverTitleForMaterialSidebar,
  tagCategoryShort,
} from "@/lib/tagCategoryUi";
import { streamUrlToDirectoryWithProgress, supportsMaterialDirectorySave } from "@/lib/materialStreamSaveToDirectory";

const quickViews = ["全部素材", "我的上传", "最近下载"] as const;

function materialSidebarLabel(sidebarKey: string): string {
  const backend = MATERIAL_SIDEBAR_TO_BACKEND[sidebarKey];
  return tagCategoryShort(backend ?? sidebarKey);
}

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

type MaterialItem = {
  id: string;
  title: string;
  description: string | null;
  copy_fit?: string | null;
  keywords?: string[];
  primary_taxonomy_id?: string | null;
  secondary_taxonomy_id?: string | null;
  primary_taxonomy_name?: string | null;
  secondary_taxonomy_name?: string | null;
  tag_ids: string[];
  primary_file_id?: string | null;
  primary_extension?: string | null;
  primary_media_width?: number | null;
  primary_media_height?: number | null;
  file_size?: number | null;
  preview_thumbnail_path?: string | null;
  status: string;
  download_count: number;
  uploader: string | null;
  created_at: string;
};

type MaterialsResponse = { items: MaterialItem[]; total: number; page: number; page_size: number };
type TagItem = {
  id: string;
  name: string;
  category: string;
  status: string;
  description?: string;
  sort_order?: number;
};
type TaxonomyNode = { id: string; name: string; children?: TaxonomyNode[] };
type MaterialFile = {
  id: string;
  original_filename: string;
  file_path?: string;
  file_relative_path?: string;
  extension?: string | null;
  file_size?: number | null;
};
type MaterialDetail = MaterialItem & { files: MaterialFile[] };

const materialStatusLabel: Record<string, string> = {
  available: "可用",
  nas_syncing: "NAS同步中",
  nas_failed: "NAS同步失败",
  trash_pending: "删除同步中",
  trashed: "已移入回收站",
};

const previewImageExts = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const previewVideoExts = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

function extIcon(ext: string | null | undefined): string {
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(e)) return "/file-icons/video.svg";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(e)) return "/file-icons/image.svg";
  return "/file-icons/video.svg";
}

function formatResolution(w: number | null | undefined, h: number | null | undefined): string | null {
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  return `${w}×${h}`;
}

/** 可点击页码：总页数 ≤10 全部展示；＞10 时首尾保留、中间用省略号压缩 */
function materialListPaginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  const tp = Math.max(1, Math.floor(totalPages));
  const cur = Math.min(Math.max(1, Math.floor(currentPage)), tp);
  if (tp <= 10) {
    return Array.from({ length: tp }, (_, i) => i + 1);
  }
  const out: Array<number | "ellipsis"> = [];
  const push = (v: number | "ellipsis") => {
    if (out.length > 0 && out[out.length - 1] === "ellipsis" && v === "ellipsis") return;
    out.push(v);
  };
  const range = (from: number, to: number) => {
    for (let p = from; p <= to; p++) push(p);
  };
  if (cur <= 4) {
    range(1, 5);
    push("ellipsis");
    push(tp);
  } else if (cur >= tp - 3) {
    push(1);
    push("ellipsis");
    range(tp - 4, tp);
  } else {
    push(1);
    push("ellipsis");
    range(cur - 1, cur + 1);
    push("ellipsis");
    push(tp);
  }
  return out;
}

type TagPanelMode = "quick" | "category";

type MaterialDownloadJobState = {
  source: "drag" | "sidebar";
  phase: "resolving" | "folder" | "writing";
  fileLabel: string;
  batchIndex: number;
  batchTotal: number;
  detail: string;
  received: number;
  total: number;
  paused: boolean;
};

export default function MaterialsPage() {
  const canView = hasPermission("asset.view");
  const canDownload = hasPermission("asset.download");
  const { library, isPersonalVideo } = useAssetLibrary();
  const sidebarCategories = materialSidebarCategoriesForLibrary(library);
  const libraryEpochRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const [tags, setTags] = useState<TagItem[]>([]);
  const [favoriteTagIds, setFavoriteTagIds] = useState<string[]>([]);
  const [recentTagIds, setRecentTagIds] = useState<string[]>([]);
  const [quickViewFacetTagIds, setQuickViewFacetTagIds] = useState<string[]>([]);
  const [quickViewFacetLoading, setQuickViewFacetLoading] = useState(false);
  const [selectedQuickView, setSelectedQuickView] = useState<(typeof quickViews)[number]>("全部素材");
  const [tagPanelMode, setTagPanelMode] = useState<TagPanelMode>("quick");
  const [selectedCategory, setSelectedCategory] = useState<string>(MATERIAL_TAG_SIDEBAR_CATEGORIES[0]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [taxonomyTree, setTaxonomyTree] = useState<TaxonomyNode[]>([]);
  const [selectedPrimaryTaxonomyId, setSelectedPrimaryTaxonomyId] = useState("");
  const [selectedSecondaryTaxonomyId, setSelectedSecondaryTaxonomyId] = useState("");
  const [copyFitDraft, setCopyFitDraft] = useState("");
  const [keywordsDraft, setKeywordsDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [listFilterTagCategory, setListFilterTagCategory] = useState("");
  const [uploaderKeyword, setUploaderKeyword] = useState("");
  const [tagMatchMode, setTagMatchMode] = useState<"and" | "or">("and");

  const keywordSearchWrapRef = useRef<HTMLDivElement>(null);
  const [keywordSlashOpen, setKeywordSlashOpen] = useState(false);
  const [keywordSlashHighlight, setKeywordSlashHighlight] = useState(0);

  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [uiState, setUiState] = useState<"idle" | "loading" | "success" | "error">(() => (canView ? "loading" : "idle"));
  const [errorMessage, setErrorMessage] = useState("");

  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [detailMap, setDetailMap] = useState<Record<string, MaterialDetail>>({});
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [nasStatus, setNasStatus] = useState<NasClientStatus | null>(null);

  const [downloadToast, setDownloadToast] = useState("");
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDownloadToast = useCallback((message: string) => {
    if (downloadToastTimerRef.current) clearTimeout(downloadToastTimerRef.current);
    setDownloadToast(message);
    downloadToastTimerRef.current = setTimeout(() => {
      setDownloadToast("");
      downloadToastTimerRef.current = null;
    }, 12000);
  }, []);
  const [materialDownloadJob, setMaterialDownloadJob] = useState<MaterialDownloadJobState | null>(null);
  const dragUrlCache = useRef<Map<string, string>>(new Map());
  const dragNasPathCache = useRef<Map<string, string>>(new Map());
  const [metadataSyncHint, setMetadataSyncHint] = useState("");
  const metadataFileCountRef = useRef(0);
  const materialDownloadBusyRef = useRef(false);
  const materialDownloadAbortRef = useRef<AbortController | null>(null);
  const materialDownloadPausedRef = useRef<boolean>(false);
  /**
   * 拖曳会话：`usedDownloadUrl` 为真表示已在 `dragstart` 写入 Chromium `DownloadURL`（单条且已预解析 URL），
   * 拖到资源管理器由系统落盘，`dragend` 不再走 `runMaterialDownloadJob`，也不弹目录选择器。
   */
  const materialCardDragSessionRef = useRef<{
    starterId: string;
    materialIds: string[];
    usedDownloadUrl: boolean;
    usedNativeNasPath: boolean;
    pendingCacheFallback: boolean;
    nasDragFailMessage?: string;
    nativeDragAt?: number;
    nativeDragPath?: string;
  } | null>(null);
  /** 侧栏「选择目录保存」成功后复用，供批量拖出写入同一文件夹（拖拽不再弹 `showDirectoryPicker`） */
  const lastMaterialExportDirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const thumbnailRequestedRef = useRef<Set<string>>(new Set());
  const marqueeRootRef = useRef<HTMLDivElement | null>(null);
  const marqueePointerId = useRef<number | null>(null);
  const marqueeLatestRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const [boundLibrary, setBoundLibrary] = useState(library);
  if (library !== boundLibrary) {
    setBoundLibrary(library);
    setItems([]);
    setTotal(0);
    setPage(1);
    setTags([]);
    setTaxonomyTree([]);
    setThumbMap({});
    setSelectedMaterialIds([]);
    setSelectedMaterialId(null);
    setSelectedTagIds([]);
    setSelectedPrimaryTaxonomyId("");
    setSelectedSecondaryTaxonomyId("");
    setListFilterTagCategory("");
    setFavoriteTagIds([]);
    setRecentTagIds([]);
    setQuickViewFacetTagIds([]);
    setSelectedCategory(sidebarCategories[0] ?? "品牌");
    setUiState(canView ? "loading" : "idle");
  }

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const keywordSlashQuery = useMemo(() => {
    const i = keyword.lastIndexOf("/");
    if (i < 0) return null;
    return keyword.slice(i + 1);
  }, [keyword]);

  const allActiveTagsFlatForKeywordSlash = useMemo(
    () =>
      tags
        .filter((t) => t.status === "active" && t.name.trim() !== "未整理")
        .map((t) => ({
          id: t.id,
          name: t.name,
          description: (t.description || "").trim(),
        })),
    [tags]
  );

  const keywordSlashSuggestions = useMemo(() => {
    if (!keywordSlashOpen || keywordSlashQuery === null) return [];
    const rawQ = keywordSlashQuery.trim();
    const qLower = rawQ.toLowerCase();
    if (!rawQ) {
      const rows = recentTagIds.map((id) => {
        const full = tags.find((t) => t.id === id);
        return {
          id,
          name: full?.name ?? id.slice(0, 8),
          description: (full?.description || "").trim(),
        };
      });
      return rows.slice(0, 30);
    }
    return allActiveTagsFlatForKeywordSlash
      .filter(
        (t) =>
          t.name.includes(rawQ) ||
          t.name.toLowerCase().includes(qLower) ||
          (t.description && (t.description.includes(rawQ) || t.description.toLowerCase().includes(qLower)))
      )
      .slice(0, 40);
  }, [keywordSlashOpen, keywordSlashQuery, recentTagIds, tags, allActiveTagsFlatForKeywordSlash]);

  useEffect(() => {
    setKeywordSlashHighlight(0);
  }, [keywordSlashSuggestions]);

  useEffect(() => {
    if (!keywordSlashOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = keywordSearchWrapRef.current;
      if (el && !el.contains(e.target as Node)) setKeywordSlashOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [keywordSlashOpen]);

  const pickKeywordSlashTag = useCallback((tagId: string) => {
    setKeyword((k) => {
      const i = k.lastIndexOf("/");
      if (i < 0) return k;
      return k.slice(0, i).trimEnd();
    });
    setSelectedTagIds((prev) => (prev.includes(tagId) ? prev : [...prev, tagId]));
    setKeywordSlashOpen(false);
  }, []);

  const TAG_CATEGORY_RANK = useMemo(
    () => new Map(tagCategoriesForLibrary(library).map((c, i) => [c, i] as [string, number])),
    [library]
  );

  useEffect(() => {
    listAbortRef.current?.abort();
    listAbortRef.current = new AbortController();
    libraryEpochRef.current += 1;
    setItems([]);
    setTotal(0);
    setPage(1);
    setTags([]);
    setTaxonomyTree([]);
    setThumbMap({});
    thumbnailRequestedRef.current.clear();
    setSelectedMaterialIds([]);
    setSelectedMaterialId(null);
    setSelectedTagIds([]);
    setSelectedPrimaryTaxonomyId("");
    setSelectedSecondaryTaxonomyId("");
    setListFilterTagCategory("");
    setSelectedCategory(sidebarCategories[0] ?? "品牌");
    setUiState(canView ? "loading" : "idle");
  }, [canView, library, sidebarCategories]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      try {
        const rawTags = await apiJson<TagItem[]>("/tags", {
          signal: listAbortRef.current?.signal,
          headers: { "X-Asset-Library": library },
        });
        if (cancelled) return;
        const rows = (Array.isArray(rawTags) ? rawTags : []).map((t) => ({
          ...t,
          description: typeof t.description === "string" ? t.description : "",
          sort_order:
            typeof t.sort_order === "number" && !Number.isNaN(t.sort_order)
              ? t.sort_order
              : Number(t.sort_order) || 0,
        }));
        rows.sort((a, b) => {
          const ra = TAG_CATEGORY_RANK.get(a.category) ?? 999;
          const rb = TAG_CATEGORY_RANK.get(b.category) ?? 999;
          if (ra !== rb) return ra - rb;
          if (a.sort_order !== b.sort_order) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
          return a.name.localeCompare(b.name, "zh-CN");
        });
        setTags(rows);
      } catch (e) {
        if (cancelled) return;
        if (
          (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError")
        ) {
          return;
        }
        setTags([]);
      }
      try {
        const data = await apiJson<{ favorite_tag_ids?: string[]; recent_tag_ids?: string[] }>("/tags/preferences", {
          signal: listAbortRef.current?.signal,
          headers: { "X-Asset-Library": library },
        });
        if (cancelled) return;
        setFavoriteTagIds(Array.isArray(data.favorite_tag_ids) ? data.favorite_tag_ids : []);
        setRecentTagIds(Array.isArray(data.recent_tag_ids) ? data.recent_tag_ids : []);
      } catch (e) {
        if (cancelled) return;
        if (
          (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError")
        ) {
          return;
        }
        setFavoriteTagIds([]);
        setRecentTagIds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, TAG_CATEGORY_RANK, library]);

  useEffect(() => {
    if (!isPersonalVideo) {
      setTaxonomyTree([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiJson<TaxonomyNode[]>(`/libraries/${library}/taxonomy`, {
          signal: listAbortRef.current?.signal,
          headers: { "X-Asset-Library": library },
        });
        if (!cancelled) setTaxonomyTree(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        if (
          (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError")
        ) {
          return;
        }
        setTaxonomyTree([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPersonalVideo, library]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<NasClientStatus>("/nas-jobs/client-status");
        if (!cancelled) setNasStatus(data);
      } catch {
        if (!cancelled) setNasStatus(nasStatusFetchFailed());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!canView || !window.desktopClient?.metadataSyncApply) return;
    if (!loadAuthSession()?.access_token) return;
    let cancelled = false;
    void (async () => {
      try {
        const stats = await runDesktopMetadataSync((p) => {
          if (cancelled) return;
          if (p.phase === "fetching" || p.phase === "applying") setMetadataSyncHint(p.message);
        });
        if (!cancelled) {
          metadataFileCountRef.current = stats.fileCount;
          setMetadataSyncHint(`本机元数据已同步：${stats.materialCount} 条素材 · ${stats.fileCount} 条 NAS 路径`);
        }
      } catch {
        if (!cancelled) {
          setMetadataSyncHint("");
          setDownloadToast("元数据同步失败：请确认 ECS 已部署最新后端并重新登录。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, library]);

  async function saveTagPreferences(nextFavoriteTagIds: string[], nextRecentTagIds: string[]) {
    const session = loadAuthSession();
    if (!session?.access_token) return;
    try {
      await apiFetch("/tags/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          favorite_tag_ids: nextFavoriteTagIds,
          recent_tag_ids: nextRecentTagIds,
        }),
      });
    } catch {
      /* 非阻塞 */
    }
  }

  const buildMaterialListFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (uploaderKeyword.trim()) params.set("uploader", uploaderKeyword.trim());
    if (listFilterTagCategory) params.set("tag_category", listFilterTagCategory);
    selectedTagIds.forEach((id) => params.append("tag_ids_all", id));
    params.set("tag_match_mode", tagMatchMode);
    if (selectedQuickView === "我的上传") params.set("quick_view", "my_upload");
    if (selectedQuickView === "最近下载") params.set("quick_view", "recent_download");
    if (selectedPrimaryTaxonomyId) params.set("primary_taxonomy_id", selectedPrimaryTaxonomyId);
    if (selectedSecondaryTaxonomyId) params.set("secondary_taxonomy_id", selectedSecondaryTaxonomyId);
    return params;
  }, [keyword, listFilterTagCategory, selectedQuickView, selectedTagIds, tagMatchMode, uploaderKeyword, selectedPrimaryTaxonomyId, selectedSecondaryTaxonomyId]);

  useEffect(() => {
    if (!canView || tagPanelMode !== "quick") {
      setQuickViewFacetTagIds([]);
      setQuickViewFacetLoading(false);
      return;
    }
    let cancelled = false;
    setQuickViewFacetLoading(true);
    const params = buildMaterialListFilterParams();
    void (async () => {
      try {
        const data = await apiJson<{ tag_ids?: string[] }>(`/materials/facet-tag-ids?${params.toString()}`);
        if (cancelled) return;
        const ids = Array.isArray(data.tag_ids)
          ? data.tag_ids.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
          : [];
        setQuickViewFacetTagIds(ids);
      } catch {
        if (!cancelled) setQuickViewFacetTagIds([]);
      } finally {
        if (!cancelled) setQuickViewFacetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, tagPanelMode, buildMaterialListFilterParams]);

  const visibleTags = useMemo(() => {
    let rows: TagItem[];
    if (selectedCategory === "收藏") {
      const fav = new Set(favoriteTagIds);
      rows = tags.filter((t) => t.status === "active" && fav.has(t.id));
    } else if (selectedCategory === "最近") {
      rows = recentTagIds
        .map((id) => tags.find((t) => t.status === "active" && t.id === id))
        .filter((x): x is TagItem => Boolean(x));
      return rows;
    } else {
      const backendCategory = MATERIAL_SIDEBAR_TO_BACKEND[selectedCategory];
      if (!backendCategory) return [];
      rows = tags.filter((t) => t.status === "active" && t.category === backendCategory);
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return a.name.localeCompare(b.name, "zh-CN");
    });
    return sorted;
  }, [favoriteTagIds, recentTagIds, selectedCategory, tags]);

  const quickViewTagsByCategory = useMemo(() => {
    if (tagPanelMode !== "quick") return [];
    const idSet = new Set(quickViewFacetTagIds);
    const activeInView = tags.filter((t) => t.status === "active" && idSet.has(t.id));
    const grouped: Array<{ category: string; tags: TagItem[] }> = [];
    const categoryOrder = tagCategoriesForLibrary(library);
    for (const category of categoryOrder) {
      const rows = activeInView.filter((t) => t.category === category);
      if (rows.length > 0) {
        const sorted = [...rows];
        sorted.sort((a, b) => {
          if (a.sort_order !== b.sort_order) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
          return a.name.localeCompare(b.name, "zh-CN");
        });
        grouped.push({ category, tags: sorted });
      }
    }
    const rest = activeInView.filter(
      (t) => !categoryOrder.includes(t.category as (typeof categoryOrder)[number])
    );
    if (rest.length > 0) {
      const sorted = [...rest];
      sorted.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return a.name.localeCompare(b.name, "zh-CN");
      });
      grouped.push({ category: "其他", tags: sorted });
    }
    return grouped;
  }, [tagPanelMode, tags, quickViewFacetTagIds, library]);

  const fetchMaterialsPage = useCallback(
    async (targetPage: number) => {
      const lib = library;
      const params = buildMaterialListFilterParams();
      params.set("page", String(targetPage));
      params.set("page_size", String(pageSize));
      params.set("sort_by", "created_at");
      params.set("sort_order", "desc");
      const data = await apiJson<MaterialsResponse>(`/materials?${params.toString()}`, {
        signal: listAbortRef.current?.signal,
        headers: { "X-Asset-Library": lib },
      });
      if (lib !== libraryRef.current) {
        throw new DOMException("library switched", "AbortError");
      }
      return data;
    },
    [buildMaterialListFilterParams, library, pageSize]
  );

  async function queryMaterials(recordRecentTags = false) {
    if (!canView) return;
    const epoch = libraryEpochRef.current;
    dragUrlCache.current.clear();
    dragNasPathCache.current.clear();
    thumbnailRequestedRef.current.clear();
    setThumbMap({});
    setUiState("loading");
    setErrorMessage("");
    setSelectedMaterialIds([]);
    setSelectedMaterialId(null);
    try {
      const data = await fetchMaterialsPage(1);
      if (epoch !== libraryEpochRef.current) return;
      setItems(data.items);
      setTotal(data.total);
      setPage(1);
      setUiState("success");
      if (recordRecentTags && selectedTagIds.length > 0) {
        const nextRecentTagIds = [...selectedTagIds, ...recentTagIds.filter((id) => !selectedTagIds.includes(id))].slice(
          0,
          20
        );
        setRecentTagIds(nextRecentTagIds);
        void saveTagPreferences(favoriteTagIds, nextRecentTagIds);
      }
    } catch (e) {
      if (epoch !== libraryEpochRef.current) return;
      if (
        (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        return;
      }
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
      setUiState("error");
    }
  }

  async function goToPage(p: number) {
    if (!canView || p < 1) return;
    const epoch = libraryEpochRef.current;
    const lib = library;
    dragUrlCache.current.clear();
    dragNasPathCache.current.clear();
    thumbnailRequestedRef.current.clear();
    setThumbMap({});
    setUiState("loading");
    try {
      const params = buildMaterialListFilterParams();
      params.set("page", String(p));
      params.set("page_size", String(pageSize));
      params.set("sort_by", "created_at");
      params.set("sort_order", "desc");
      const data = await apiJson<MaterialsResponse>(`/materials?${params.toString()}`, {
        signal: listAbortRef.current?.signal,
        headers: { "X-Asset-Library": lib },
      });
      if (epoch !== libraryEpochRef.current || lib !== libraryRef.current) return;
      setItems(data.items);
      setTotal(data.total);
      setPage(p);
      setUiState("success");
    } catch (e) {
      if (epoch !== libraryEpochRef.current) return;
      if (
        (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        return;
      }
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setUiState("error");
    }
  }

  function getMaterialExtension(m: MaterialItem): string {
    const fromList = (m.primary_extension || "").toLowerCase().replace(/^\./, "");
    if (fromList) return fromList;
    const name = (m.title || "").trim() || m.id;
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  const ensureCardThumbnails = useCallback(async () => {
    if (!canView) return;
    const base = getApiBaseUrl();
    if (!base) return;
    const candidates = items.filter((item) => {
      const ext = getMaterialExtension(item);
      return (previewImageExts.has(ext) || previewVideoExts.has(ext)) && !!item.primary_file_id;
    });
    const pending = candidates.filter((item) => !thumbMap[item.id] && !thumbnailRequestedRef.current.has(item.id));
    if (pending.length === 0) return;

    await Promise.allSettled(
      pending.map(async (item) => {
        thumbnailRequestedRef.current.add(item.id);
        try {
          const resp = await apiFetch(`/materials/${item.id}/files/${item.primary_file_id}/thumbnail-url`, {
            headers: thumbnailAccessContextHeaders(),
          });
          const rawText = await resp.text();
          let data: { url?: string | null; alternate_urls?: string[]; detail?: unknown } = {};
          try {
            data = rawText
              ? (JSON.parse(rawText) as { url?: string | null; alternate_urls?: string[]; detail?: unknown })
              : {};
          } catch {
            throw new Error("缩略图接口返回非 JSON");
          }
          if (!resp.ok) {
            const msg =
              data.detail != null
                ? typeof data.detail === "string"
                  ? data.detail
                  : JSON.stringify(data.detail)
                : `${resp.status}`;
            throw new Error(msg);
          }
          const absUrl = await resolveDirectMediaUrl(base, data);
          const url = absUrl ? `${absUrl}${absUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}` : "";
          if (url) {
            setThumbMap((prev) => ({ ...prev, [item.id]: url }));
          } else {
            thumbnailRequestedRef.current.delete(item.id);
          }
        } catch {
          thumbnailRequestedRef.current.delete(item.id);
        }
      })
    );
  }, [canView, items, thumbMap]);

  useEffect(() => {
    void ensureCardThumbnails();
  }, [ensureCardThumbnails]);

  useEffect(() => {
    if (!canView) return;
    if (!getApiBaseUrl()) {
      setUiState("error");
      setErrorMessage("未配置 API 根地址，请检查 local.settings.json 或环境变量。");
      return;
    }
    void queryMaterials(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Web 一致：首屏加载 + 切换快捷视图 / 素材库时重拉列表
  }, [canView, selectedQuickView, library, selectedPrimaryTaxonomyId, selectedSecondaryTaxonomyId]);

  const selectedItem = useMemo(() => items.find((m) => m.id === selectedMaterialId) ?? null, [items, selectedMaterialId]);
  const selectedDetail = selectedMaterialId ? detailMap[selectedMaterialId] : undefined;

  const saveTargetMaterialIds = useMemo(() => {
    const checked = selectedMaterialIds.filter((id) => {
      const row = items.find((x) => x.id === id);
      return Boolean(row?.primary_file_id);
    });
    if (checked.length > 0) return checked;
    if (selectedMaterialId) {
      const row = items.find((x) => x.id === selectedMaterialId);
      if (row?.primary_file_id) return [selectedMaterialId];
    }
    return [];
  }, [selectedMaterialIds, selectedMaterialId, items]);

  useEffect(() => {
    if (!canView || !selectedMaterialId) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<MaterialDetail>(`/materials/${selectedMaterialId}`);
        if (!cancelled) setDetailMap((prev) => ({ ...prev, [selectedMaterialId]: d }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, selectedMaterialId]);

  function toggleMaterialSelection(id: string) {
    setSelectedMaterialIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function formatTagNames(ids: string[]): string {
    if (!ids.length) return "";
    return ids
      .map((id) => tagById.get(id)?.name)
      .filter(Boolean)
      .join(" · ");
  }

  function displayName(m: MaterialItem): string {
    return (m.title || "").trim() || m.id;
  }

  function dragSaveFileLabel(m: MaterialItem): string {
    const base = displayName(m).replace(/:/g, "_").trim().slice(0, 200) || m.id;
    const ext = getMaterialExtension(m);
    if (!ext) return base;
    if (base.toLowerCase().endsWith(`.${ext}`)) return base;
    return `${base}.${ext}`;
  }

  const token = loadAuthSession()?.access_token ?? "";

  const drawerPreviewMode = useMemo((): "image" | "video" | "generic" => {
    if (!selectedItem) return "generic";
    const ext = getMaterialExtension(selectedItem);
    if (previewImageExts.has(ext)) return "image";
    if (previewVideoExts.has(ext)) return "video";
    return "generic";
  }, [selectedItem]);

  const drawerStreamResolveEnabled =
    (drawerPreviewMode === "image" || drawerPreviewMode === "video") &&
    canDownload &&
    !!token.trim() &&
    !!getApiBaseUrl() &&
    !!selectedItem?.primary_file_id &&
    selectedItem?.status === "available";
  const drawerPreviewResolveEnabled =
    drawerPreviewMode === "video" &&
    canView &&
    !!token.trim() &&
    !!getApiBaseUrl() &&
    !!selectedItem?.primary_file_id;

  const drawerStream = useMaterialFileStreamUrl({
    apiBaseUrl: getApiBaseUrl(),
    materialId: selectedItem?.id,
    fileId: selectedItem?.primary_file_id,
    filename: selectedItem ? displayName(selectedItem) : "preview.bin",
    enabled: drawerStreamResolveEnabled,
    token,
  });
  const drawerPreviewVideo = useMaterialPreviewVideoUrl({
    apiBaseUrl: getApiBaseUrl(),
    materialId: selectedItem?.id,
    fileId: selectedItem?.primary_file_id,
    enabled: drawerPreviewResolveEnabled,
    token,
  });

  function postDownloadClientReport(payload: {
    material_id: string;
    file_id: string;
    download_mode: "browser_default" | "choose_directory" | "nas_smb_open" | "nas_smb_drag";
    transport_route: DownloadTransportRoute;
    success: boolean;
    file_size_bytes?: number | null;
    error_message?: string | null;
  }) {
    void (async () => {
      try {
        await apiFetch("/materials/download-client-report", {
          method: "POST",
          headers: materialDownloadAuthHeaders(),
          body: JSON.stringify(payload),
        });
      } catch {
        /* 非阻塞 */
      }
    })();
  }

  async function runMaterialDownloadJob(source: "drag" | "sidebar", materialIds: string[]) {
    if (!canDownload) {
      setDownloadToast("当前账号无下载权限（asset.download）。");
      return;
    }
    if (materialDownloadBusyRef.current) {
      setDownloadToast("已有进行中的下载任务，请先完成、暂停后取消或点击「取消」。");
      return;
    }
    const ids = materialIds.filter((id) => items.some((r) => r.id === id && r.primary_file_id));
    if (ids.length === 0) {
      setDownloadToast("没有可下载的素材（需有主文件）。");
      return;
    }
    const base = getApiBaseUrl();
    if (!base) {
      setDownloadToast("未配置 API 根地址。");
      return;
    }

    if (
      supportsMaterialDirectorySave() &&
      source === "drag" &&
      !lastMaterialExportDirHandleRef.current &&
      ids.length > 1 &&
      !window.desktopClient?.startNativeFilesDragSync
    ) {
      setDownloadToast(
        "浏览器环境批量拖出需先使用侧栏「选择目录保存」选定文件夹；桌面客户端可多选后直接拖到文件夹。"
      );
      return;
    }

    const rowFor = (id: string) => items.find((x) => x.id === id);
    const fileLabelFor = (id: string) => {
      const row = rowFor(id);
      return row ? dragSaveFileLabel(row) : id;
    };

    materialDownloadBusyRef.current = true;
    materialDownloadPausedRef.current = false;
    materialDownloadAbortRef.current?.abort();
    const ac = new AbortController();
    materialDownloadAbortRef.current = ac;

    setMaterialDownloadJob({
      source,
      phase: "resolving",
      fileLabel: fileLabelFor(ids[0]),
      batchIndex: 1,
      batchTotal: ids.length,
      detail: "正在准备…",
      received: 0,
      total: 0,
      paused: false,
    });

    const directoryWriteFlow =
      supportsMaterialDirectorySave() &&
      (source === "sidebar" || (source === "drag" && lastMaterialExportDirHandleRef.current != null));

    try {
      if (!directoryWriteFlow) {
        for (let i = 0; i < ids.length; i += 1) {
          if (ac.signal.aborted) return;
          const id = ids[i];
          const row = rowFor(id);
          if (!row?.primary_file_id) continue;
          setMaterialDownloadJob({
            source,
            phase: "resolving",
            fileLabel: fileLabelFor(id),
            batchIndex: i + 1,
            batchTotal: ids.length,
            detail: `正在解析（${i + 1}/${ids.length}）…`,
            received: 0,
            total: 0,
            paused: false,
          });
          const detailRow = await apiJson<MaterialDetail>(`/materials/${id}`);
          const firstFile = detailRow.files?.[0];
          if (!firstFile?.id) throw new Error("该素材没有可下载文件");
          const filename = (firstFile.original_filename || "").trim() || "download.bin";
          const resolved = await resolveMaterialDownload({
            apiBaseUrl: base,
            materialId: id,
            fileId: firstFile.id,
            filename,
            authHeaders: materialDownloadAuthHeaders,
            signal: ac.signal,
            onPhase: (msg) => {
              setMaterialDownloadJob((j) =>
                j
                  ? {
                      ...j,
                      phase: "resolving",
                      fileLabel: filename,
                      batchIndex: i + 1,
                      batchTotal: ids.length,
                      detail: msg,
                      paused: false,
                    }
                  : null
              );
            },
          });
          if (ac.signal.aborted) return;
          triggerBrowserDownload(resolved.absoluteUrl);
          postDownloadClientReport({
            material_id: id,
            file_id: firstFile.id,
            download_mode: "browser_default",
            transport_route: resolved.transportRoute,
            success: true,
            file_size_bytes: null,
          });
        }
        if (!supportsMaterialDirectorySave()) {
          setDownloadToast(`已触发 ${ids.length} 个系统下载（当前环境无目录选择器）。`);
        } else {
          setDownloadToast(
            "已触发系统下载（单条拖出：若未预解析链接，可先略停卡片再拖；或先用侧栏「选择目录保存」绑定文件夹）。"
          );
        }
        return;
      }

      const w = window as unknown as {
        showDirectoryPicker?: (opts?: { signal?: AbortSignal }) => Promise<FileSystemDirectoryHandle>;
      };
      if (!w.showDirectoryPicker) throw new Error("当前环境不支持选择目录");

      let dirHandle: FileSystemDirectoryHandle;
      if (source === "drag") {
        dirHandle = lastMaterialExportDirHandleRef.current as FileSystemDirectoryHandle;
      } else {
        setMaterialDownloadJob((j) =>
          j
            ? {
                ...j,
                phase: "folder",
                detail: "请在系统对话框中选择要保存到的文件夹…",
                paused: false,
              }
            : null
        );
        dirHandle = await w.showDirectoryPicker({ signal: ac.signal });
        if (ac.signal.aborted) return;
        lastMaterialExportDirHandleRef.current = dirHandle;
      }

      for (let i = 0; i < ids.length; i += 1) {
        if (ac.signal.aborted) return;
        const id = ids[i];
        const row = rowFor(id);
        if (!row?.primary_file_id) continue;

        setMaterialDownloadJob({
          source,
          phase: "resolving",
          fileLabel: fileLabelFor(id),
          batchIndex: i + 1,
          batchTotal: ids.length,
          detail: `正在解析下载地址（${i + 1}/${ids.length}）…`,
          received: 0,
          total: 0,
          paused: false,
        });

        const detailRow = await apiJson<MaterialDetail>(`/materials/${id}`);
        const firstFile = detailRow.files?.[0];
        if (!firstFile?.id) throw new Error("该素材没有可下载文件");
        const diskName = (firstFile.original_filename || "").trim() || dragSaveFileLabel(row);
        const ticketName = dragSaveFileLabel(row);

        const resolved = await resolveMaterialDownload({
          apiBaseUrl: base,
          materialId: id,
          fileId: firstFile.id,
          filename: ticketName,
          authHeaders: materialDownloadAuthHeaders,
          signal: ac.signal,
          onPhase: (msg) => {
            setMaterialDownloadJob((j) =>
              j
                ? {
                    ...j,
                    phase: "resolving",
                    fileLabel: diskName,
                    batchIndex: i + 1,
                    batchTotal: ids.length,
                    detail: msg,
                    paused: materialDownloadPausedRef.current,
                  }
                : null
            );
          },
        });
        if (ac.signal.aborted) return;
        dragUrlCache.current.set(id, resolved.absoluteUrl);

        materialDownloadPausedRef.current = false;
        setMaterialDownloadJob({
          source,
          phase: "writing",
          fileLabel: diskName,
          batchIndex: i + 1,
          batchTotal: ids.length,
          detail: "开始写入…",
          received: 0,
          total: 0,
          paused: false,
        });

        const bytes = await streamUrlToDirectoryWithProgress(
          resolved.absoluteUrl,
          diskName,
          ac.signal,
          (received, tot) => {
            setMaterialDownloadJob({
              source,
              phase: "writing",
              fileLabel: diskName,
              batchIndex: i + 1,
              batchTotal: ids.length,
              detail: tot ? `${formatBytes(received)} / ${formatBytes(tot)}` : formatBytes(received),
              received,
              total: tot,
              paused: materialDownloadPausedRef.current,
            });
          },
          dirHandle,
          materialDownloadPausedRef
        );

        postDownloadClientReport({
          material_id: id,
          file_id: firstFile.id,
          download_mode: "choose_directory",
          transport_route: resolved.transportRoute,
          success: true,
          file_size_bytes: bytes,
        });
      }

      setDownloadToast(
        source === "drag"
          ? `已保存 ${ids.length} 个文件到上次在侧栏「选择目录保存」中选定的文件夹。`
          : `已保存 ${ids.length} 个文件到所选目录。`
      );
    } catch (err) {
      const dom = err instanceof DOMException ? err : null;
      if (dom && (dom.name === "AbortError" || dom.name === "NotAllowedError")) {
        setDownloadToast("已取消下载。");
      } else if (dom && dom.name === "TimeoutError") {
        setDownloadToast("下载票据请求超时（60s）。请确认 API 根地址可达且网络正常。");
      } else {
        let raw = err instanceof Error ? err.message : String(err);
        if (raw === "AbortError" || raw.includes("AbortError")) {
          raw = "请求被中断或已取消。";
        }
        setDownloadToast(`下载失败：${raw}`);
      }
    } finally {
      materialDownloadBusyRef.current = false;
      materialDownloadAbortRef.current = null;
      materialDownloadPausedRef.current = false;
      setMaterialDownloadJob(null);
    }
  }

  async function runNasDragCacheFallback(materialId: string, failMessage?: string) {
    const row = items.find((x) => x.id === materialId);
    const fid = row?.primary_file_id;
    if (!row || !fid) return;
    const base = getApiBaseUrl();
    if (!base) {
      setDownloadToast("未配置 API 根地址。");
      return;
    }
    setDownloadToast(failMessage || "NAS 不可访问，正在下载到本地缓存…");
    try {
      let detail = detailMap[materialId];
      if (!detail) detail = await apiJson<MaterialDetail>(`/materials/${materialId}`);
      const firstFile = detail.files?.find((f) => f.id === fid) || detail.files?.[0];
      if (!firstFile?.id) throw new Error("该素材没有可下载文件");
      const filename = (firstFile.original_filename || "").trim() || dragSaveFileLabel(row);
      const resolved = await resolveMaterialDownload({
        apiBaseUrl: base,
        materialId,
        fileId: firstFile.id,
        filename,
        authHeaders: materialDownloadAuthHeaders,
      });
      const cached = await downloadMaterialToCache({
        url: resolved.absoluteUrl,
        materialId,
        fileId: firstFile.id,
        originalFilename: filename,
        expectedSize: firstFile.file_size ?? row.file_size,
        headers: materialDownloadAuthHeaders(),
      });
      if (!cached.ok || !cached.absolutePath) {
        throw new Error(cached.message || "缓存下载失败");
      }
      dragNasPathCache.current.set(materialId, cached.absolutePath);
      postDownloadClientReport({
        material_id: materialId,
        file_id: firstFile.id,
        download_mode: "browser_default",
        transport_route: resolved.transportRoute,
        success: true,
        file_size_bytes: firstFile.file_size ?? row.file_size ?? null,
      });
      setDownloadToast(
        cached.fromCache
          ? "本地缓存已就绪，请再次拖拽到文件夹或剪映。"
          : "已下载到本地缓存，请再次拖拽到文件夹或剪映。"
      );
    } catch (e) {
      setDownloadToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolveSelectedPrimaryLocalAccess() {
    if (!selectedItem?.primary_file_id) return null;
    const base = getApiBaseUrl();
    if (!base) return null;
    const detail = selectedDetail || (await apiJson<MaterialDetail>(`/materials/${selectedItem.id}`));
    const firstFile = detail.files?.find((f) => f.id === selectedItem.primary_file_id) || detail.files?.[0];
    if (!firstFile?.id) return null;
    const filename = (firstFile.original_filename || "").trim() || dragSaveFileLabel(selectedItem);
    return resolveMaterialLocalAccess({
      apiBaseUrl: base,
      materialId: selectedItem.id,
      fileId: firstFile.id,
      filename,
      fileRelativePath: firstFile.file_relative_path || firstFile.file_path,
      authHeaders: materialDownloadAuthHeaders,
    });
  }

  async function handleOpenNasInFolder() {
    if (!canDownload || !selectedItem?.primary_file_id) {
      setDownloadToast("请先选择有主文件的素材。");
      return;
    }
    try {
      const access = await resolveSelectedPrimaryLocalAccess();
      if (!access) throw new Error("无法解析文件");
      if (access.mode !== "nas_smb") {
        setDownloadToast("NAS 不可访问：请配置 material_assets_root、同步元数据，并确认 SMB 可读写。");
        return;
      }
      const ok = await openMaterialInFolder(access);
      if (!ok) throw new Error("打开资源管理器失败");
      postDownloadClientReport({
        material_id: access.materialId,
        file_id: access.fileId,
        download_mode: "nas_smb_open",
        transport_route: "nas_smb",
        success: true,
      });
      setDownloadToast("已在资源管理器中定位 NAS 文件。");
    } catch (e) {
      setDownloadToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleNativeDragDidNotTake(materialId: string, absPath?: string) {
    const path = absPath || dragNasPathCache.current.get(materialId);
    if (path) {
      const copied = await copyMaterialFileForPaste(path);
      if (copied.ok) {
        showDownloadToast(
          "系统拖放未挂上（Windows 上较常见）。\n已复制该文件，请打开目标文件夹后按 Ctrl+V 粘贴；剪映部分版本也支持粘贴导入。"
        );
        return;
      }
    }
    showDownloadToast("拖放未生效，正在下载到本地缓存…");
    void runNasDragCacheFallback(materialId);
  }

  async function handleCopyFileForPaste() {
    if (!canDownload || !selectedItem?.primary_file_id) {
      showDownloadToast("请先选择有主文件的素材。");
      return;
    }
    try {
      const access = await resolveSelectedPrimaryLocalAccess();
      if (!access || access.mode !== "nas_smb") {
        const cached = dragNasPathCache.current.get(selectedItem.id);
        if (cached) {
          const copied = await copyMaterialFileForPaste(cached);
          if (copied.ok) {
            showDownloadToast("已复制文件。请打开目标文件夹后按 Ctrl+V 粘贴。");
            return;
          }
        }
        showDownloadToast("NAS 路径不可用，无法复制文件。");
        return;
      }
      const copied = await copyMaterialFileForPaste(access.absolutePath);
      if (!copied.ok) throw new Error(copied.message || "复制失败");
      showDownloadToast("已复制文件。请打开目标文件夹后按 Ctrl+V 粘贴。");
    } catch (e) {
      showDownloadToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCopyNasPath() {
    if (!canDownload || !selectedItem?.primary_file_id) {
      setDownloadToast("请先选择有主文件的素材。");
      return;
    }
    try {
      const access = await resolveSelectedPrimaryLocalAccess();
      if (!access || access.mode !== "nas_smb") {
        setDownloadToast("NAS 共享路径不可用，无法复制路径。");
        return;
      }
      const ok = await copyMaterialLocalPath(access);
      if (!ok) throw new Error("复制失败");
      setDownloadToast("已复制 NAS 绝对路径到剪贴板。");
    } catch {
      setDownloadToast("复制 NAS 路径失败。");
    }
  }

  async function handleTestDirectDragPath() {
    if (!selectedItem?.primary_file_id) {
      setDownloadToast("请先点选一条素材。");
      return;
    }
    try {
      const detail = selectedDetail || (await ensureDetailLoaded(selectedItem.id));
      const f = detail?.files?.find((x) => x.id === selectedItem.primary_file_id) || detail?.files?.[0];
      const r = await resolveMaterialFilePath({
        materialId: selectedItem.id,
        fileId: f?.id || selectedItem.primary_file_id,
        fileRelativePath: f?.file_relative_path || f?.file_path,
      });
      if (r.ok && r.exists && r.absolutePath) {
        showDownloadToast(`直拖路径可用：\n${r.absolutePath}`);
      } else {
        showDownloadToast(r.message || r.error || "直拖路径不可用，请检查 material_assets_root 与 SMB。");
      }
    } catch (e) {
      showDownloadToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSavePreviewToDirectory() {
    const ids = saveTargetMaterialIds;
    if (ids.length === 0) {
      setDownloadToast("请先勾选要保存的素材（或点选一条有主文件的素材）。");
      return;
    }
    await runMaterialDownloadJob("sidebar", ids);
  }

  const ensureDetailLoaded = useCallback(
    async (materialId: string): Promise<MaterialDetail | null> => {
      const cached = detailMap[materialId];
      if (cached?.files?.length) return cached;
      try {
        const d = await apiJson<MaterialDetail>(`/materials/${materialId}`);
        setDetailMap((prev) => ({ ...prev, [materialId]: d }));
        return d;
      } catch {
        return null;
      }
    },
    [detailMap]
  );

  const prefetchDragDownloadUrl = useCallback(
    async (materialId: string) => {
      if (!canDownload || dragNasPathCache.current.has(materialId) || dragUrlCache.current.has(materialId)) return;
      const row = items.find((x) => x.id === materialId);
      const fid = row?.primary_file_id;
      if (!fid) return;

      const detail = await ensureDetailLoaded(materialId);
      const detailFile = detail?.files?.find((f) => f.id === fid) || detail?.files?.[0];
      const fileRelativePath = detailFile?.file_relative_path || detailFile?.file_path;

      if (window.desktopClient?.resolveMaterialFile || window.desktopClient?.resolveNasFile) {
        try {
          const nas = await resolveMaterialFilePath({ materialId, fileId: fid, fileRelativePath });
          if (nas.ok && nas.exists && nas.absolutePath) {
            dragNasPathCache.current.set(materialId, nas.absolutePath);
            return;
          }
        } catch {
          dragNasPathCache.current.delete(materialId);
        }
      }

      if (dragUrlCache.current.has(materialId)) return;
      const base = getApiBaseUrl();
      if (!base) return;
      try {
        const resolved = await resolveMaterialDownload({
          apiBaseUrl: base,
          materialId,
          fileId: fid,
          filename: row ? dragSaveFileLabel(row) : "download.bin",
          authHeaders: materialDownloadAuthHeaders,
        });
        dragUrlCache.current.set(materialId, resolved.absoluteUrl);
      } catch {
        dragUrlCache.current.delete(materialId);
      }
    },
    [canDownload, items, ensureDetailLoaded]
  );

  const prepareMaterialForDrag = useCallback(
    async (materialId: string) => {
      if (!canDownload) return;
      await prefetchDragDownloadUrl(materialId);
    },
    [canDownload, prefetchDragDownloadUrl]
  );

  const itemIdsKey = useMemo(() => items.map((i) => i.id).join("|"), [items]);

  useEffect(() => {
    if (!canView || !canDownload || uiState !== "success") return;
    let cancelled = false;
    const run = async () => {
      const batch = items.filter((i) => i.primary_file_id && !dragUrlCache.current.has(i.id));
      const CHUNK = 5;
      for (let i = 0; i < batch.length; i += CHUNK) {
        if (cancelled) return;
        const slice = batch.slice(i, i + CHUNK);
        await Promise.all(slice.map((row) => prefetchDragDownloadUrl(row.id)));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [canView, canDownload, uiState, itemIdsKey, prefetchDragDownloadUrl]);

  function onGridPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const root = marqueeRootRef.current;
    if (!root) return;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    marqueePointerId.current = e.pointerId;
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left + root.scrollLeft;
    const y = e.clientY - r.top + root.scrollTop;
    const box = { x1: x, y1: y, x2: x, y2: y };
    marqueeLatestRef.current = box;
    setMarqueeBox(box);
  }

  function onGridPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (marqueePointerId.current !== e.pointerId || !marqueeRootRef.current) return;
    const root = marqueeRootRef.current;
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left + root.scrollLeft;
    const y = e.clientY - r.top + root.scrollTop;
    setMarqueeBox((b) => {
      if (!b) return b;
      const next = { ...b, x2: x, y2: y };
      marqueeLatestRef.current = next;
      return next;
    });
  }

  function onGridPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (marqueePointerId.current !== e.pointerId) return;
    const root = marqueeRootRef.current;
    if (root) {
      try {
        root.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    marqueePointerId.current = null;
    const b = marqueeLatestRef.current;
    marqueeLatestRef.current = null;
    setMarqueeBox(null);
    if (!root || !b) return;
    const left = Math.min(b.x1, b.x2);
    const right = Math.max(b.x1, b.x2);
    const top = Math.min(b.y1, b.y2);
    const bottom = Math.max(b.y1, b.y2);
    if (right - left < 6 || bottom - top < 6) return;
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      items.forEach((item) => {
        const el = root.querySelector(`[data-material-card="${item.id}"]`);
        if (!(el instanceof HTMLElement)) return;
        const er = el.getBoundingClientRect();
        const rr = root.getBoundingClientRect();
        const cl = er.left - rr.left + root.scrollLeft;
        const cr = er.right - rr.left + root.scrollLeft;
        const ct = er.top - rr.top + root.scrollTop;
        const cb = er.bottom - rr.top + root.scrollTop;
        if (cr >= left && cl <= right && cb >= top && ct <= bottom) next.add(item.id);
      });
      return [...next];
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginationItems = useMemo(() => materialListPaginationItems(page, totalPages), [page, totalPages]);
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (selectedQuickView !== "全部素材") {
    chips.push({
      key: `quick-${selectedQuickView}`,
      label: selectedQuickView,
      onRemove: () => setSelectedQuickView("全部素材"),
    });
  }
  if (listFilterTagCategory) {
    chips.push({
      key: "list-tag-category",
      label: `标签分类:${tagCategoryShort(listFilterTagCategory)}`,
      onRemove: () => setListFilterTagCategory(""),
    });
  }
  selectedTagIds.forEach((id) => {
    const tag = tags.find((x) => x.id === id);
    chips.push({
      key: `tag-${id}`,
      label: tag?.name || id,
      onRemove: () => setSelectedTagIds((prev) => prev.filter((x) => x !== id)),
    });
  });

  if (!canView) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">当前账号无「查看素材」权限（asset.view）。</div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full min-w-0 px-4 py-8 sm:px-6 2xl:px-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-100">
        {isPersonalVideo ? "个人视频素材库" : "素材库"}
      </h1>

      <div className="grid w-full min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,10%)_minmax(0,10%)_minmax(0,60%)_minmax(0,20%)] xl:items-start">
        <aside className="h-fit min-w-0 rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <details open className="mb-3" data-tour="materials-quick-view">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">快捷视图</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {quickViews.map((item) => (
                <li
                  key={item}
                  className={
                    selectedQuickView === item
                      ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100"
                      : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"
                  }
                  onClick={() => {
                    setTagPanelMode("quick");
                    setSelectedTagIds([]);
                    setSelectedQuickView(item);
                  }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </details>

          <details open>
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">
              {isPersonalVideo ? "一级分类" : "标签分类"}
            </summary>
            {isPersonalVideo ? (
              <ul className="mt-2 space-y-1 text-sm">
                <li
                  className={!selectedPrimaryTaxonomyId ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
                  onClick={() => {
                    setSelectedPrimaryTaxonomyId("");
                    setSelectedSecondaryTaxonomyId("");
                  }}
                >
                  全部
                </li>
                {taxonomyTree.map((node) => (
                  <li
                    key={node.id}
                    className={selectedPrimaryTaxonomyId === node.id ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
                    onClick={() => {
                      setSelectedPrimaryTaxonomyId(node.id);
                      setSelectedSecondaryTaxonomyId("");
                    }}
                  >
                    {node.name}
                  </li>
                ))}
              </ul>
            ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {sidebarCategories.map((item) => (
                <li
                  key={item}
                  title={tagCategoryHoverTitleForMaterialSidebar(item)}
                  className={
                    selectedCategory === item
                      ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100"
                      : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"
                  }
                  onClick={() => {
                    setTagPanelMode("category");
                    setSelectedCategory(item);
                  }}
                >
                  {materialSidebarLabel(item)}
                </li>
              ))}
            </ul>
            )}
          </details>
        </aside>

        <aside className="h-fit min-w-0 rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl" data-tour="materials-tag-filter">
          {isPersonalVideo ? (
            <div className="mb-4">
              <div className="mb-2 text-sm font-semibold text-slate-100">二级分类</div>
              <ul className="mb-3 space-y-1 text-sm">
                <li
                  className={!selectedSecondaryTaxonomyId ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
                  onClick={() => setSelectedSecondaryTaxonomyId("")}
                >
                  全部
                </li>
                {(taxonomyTree.find((n) => n.id === selectedPrimaryTaxonomyId)?.children || (selectedPrimaryTaxonomyId ? [] : taxonomyTree.flatMap((n) => n.children || []))).map((node) => (
                  <li
                    key={node.id}
                    className={selectedSecondaryTaxonomyId === node.id ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
                    onClick={() => {
                      setSelectedSecondaryTaxonomyId(node.id);
                      if (!selectedPrimaryTaxonomyId) {
                        const parent = taxonomyTree.find((n) => (n.children || []).some((c) => c.id === node.id));
                        if (parent) setSelectedPrimaryTaxonomyId(parent.id);
                      }
                    }}
                  >
                    {node.name}
                  </li>
                ))}
              </ul>
              <div className="mb-2 text-sm font-semibold text-slate-100">适用主题</div>
            </div>
          ) : null}
          <div className="mb-2 text-sm font-semibold text-slate-100">
            {isPersonalVideo ? "主题筛选（可多选）" : tagPanelMode === "quick" ? `${selectedQuickView}（可搜索）` : `${materialSidebarLabel(selectedCategory)}（可搜索）`}
          </div>
          <div className="max-h-[68vh] overflow-auto pr-1">
            {tagPanelMode === "quick" ? (
              quickViewFacetLoading ? (
                <div className="text-xs text-slate-400">正在加载与当前视图匹配的标签…</div>
              ) : quickViewTagsByCategory.length === 0 ? (
                <div className="text-xs text-slate-400">当前视图下暂无关联的启用标签（或筛选结果为空）。</div>
              ) : (
                quickViewTagsByCategory.map((group) => (
                  <div key={group.category} className="mb-3">
                    <div
                      className="mb-1 text-xs font-medium text-slate-400"
                      title={group.category !== "其他" ? tagCategoryHoverTitle(group.category) : undefined}
                    >
                      {group.category === "其他" ? "其他" : tagCategoryShort(group.category)}
                    </div>
                    <div className="grid gap-1">
                      {group.tags.map((tag) => (
                        <div
                          key={tag.id}
                          className={
                            selectedTagIds.includes(tag.id)
                              ? "flex items-center justify-between gap-2 rounded-md border border-sky-400/60 bg-sky-600/30 px-2 py-1 text-xs text-sky-100"
                              : "flex items-center justify-between gap-2 rounded-md border border-transparent bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                          }
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate bg-transparent p-0 text-left outline-none"
                            title={
                              (tag.description || "").trim()
                                ? `${tag.name} — ${(tag.description || "").trim()}`
                                : tag.name
                            }
                            onClick={() =>
                              setSelectedTagIds((prev) =>
                                prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]
                              )
                            }
                          >
                            {tag.name}
                          </button>
                          <button
                            type="button"
                            className={
                              (favoriteTagIds.includes(tag.id) ? "text-amber-300" : "text-slate-400 hover:text-amber-300") +
                              " bg-transparent p-0 outline-none"
                            }
                            title={favoriteTagIds.includes(tag.id) ? "取消收藏" : "加入收藏"}
                            onClick={() => {
                              const nextFavoriteTagIds = favoriteTagIds.includes(tag.id)
                                ? favoriteTagIds.filter((x) => x !== tag.id)
                                : [tag.id, ...favoriteTagIds.filter((x) => x !== tag.id)].slice(0, 100);
                              setFavoriteTagIds(nextFavoriteTagIds);
                              void saveTagPreferences(nextFavoriteTagIds, recentTagIds);
                            }}
                          >
                            {favoriteTagIds.includes(tag.id) ? "★" : "☆"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )
            ) : visibleTags.length === 0 ? (
              <div className="text-xs text-slate-400">当前分类暂无可选标签。</div>
            ) : (
              <div className="grid gap-1">
                {visibleTags.map((tag) => (
                  <div
                    key={tag.id}
                    className={
                      selectedTagIds.includes(tag.id)
                        ? "flex items-center justify-between gap-2 rounded-md border border-sky-400/60 bg-sky-600/30 px-2 py-1 text-xs text-sky-100"
                        : "flex items-center justify-between gap-2 rounded-md border border-transparent bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                    }
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate bg-transparent p-0 text-left outline-none"
                      title={
                        (tag.description || "").trim()
                          ? `${tag.name} — ${(tag.description || "").trim()}`
                          : tag.name
                      }
                      onClick={() =>
                        setSelectedTagIds((prev) =>
                          prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]
                        )
                      }
                    >
                      {tag.name}
                    </button>
                    <button
                      type="button"
                      className={
                        (favoriteTagIds.includes(tag.id) ? "text-amber-300" : "text-slate-400 hover:text-amber-300") +
                        " bg-transparent p-0 outline-none"
                      }
                      title={favoriteTagIds.includes(tag.id) ? "取消收藏" : "加入收藏"}
                      onClick={() => {
                        const nextFavoriteTagIds = favoriteTagIds.includes(tag.id)
                          ? favoriteTagIds.filter((x) => x !== tag.id)
                          : [tag.id, ...favoriteTagIds.filter((x) => x !== tag.id)].slice(0, 100);
                        setFavoriteTagIds(nextFavoriteTagIds);
                        void saveTagPreferences(nextFavoriteTagIds, recentTagIds);
                      }}
                    >
                      {favoriteTagIds.includes(tag.id) ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {metadataSyncHint ? (
              <div className="mb-3 rounded-lg border border-sky-300/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">{metadataSyncHint}</div>
            ) : null}
            {nasStatus && !isNasTransferReady(nasStatus) ? (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{nasStatus.message}</div>
            ) : null}
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div ref={keywordSearchWrapRef} className="relative min-w-[min(100%,280px)] max-w-[440px] flex-[1_1_280px]">
                <label className="mb-1 block text-xs font-medium text-slate-600">搜索</label>
                <input
                  className={inputClass + " w-full"}
                  value={keyword}
                  title="键入 /：无后缀时列出最近查询用过的标签；/ 后有字时在全部活跃标签中按名称匹配并加入筛选"
                  onChange={(e) => {
                    const v = e.target.value;
                    setKeyword(v);
                    setKeywordSlashOpen(v.includes("/"));
                  }}
                  onKeyDown={(e) => {
                    if (!keywordSlashOpen || keyword.lastIndexOf("/") < 0) return;
                    if (keywordSlashSuggestions.length === 0) {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setKeywordSlashOpen(false);
                      }
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setKeywordSlashHighlight((h) => Math.min(keywordSlashSuggestions.length - 1, h + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setKeywordSlashHighlight((h) => Math.max(0, h - 1));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const t = keywordSlashSuggestions[keywordSlashHighlight];
                      if (t) pickKeywordSlashTag(t.id);
                    } else if (e.key === "Escape") {
                      setKeywordSlashOpen(false);
                    }
                  }}
                  placeholder="标题 / 原始文件名 / 描述 / 标签 / 备注"
                />
                {keywordSlashOpen && keyword.includes("/") ? (
                  <ul
                    className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                    role="listbox"
                  >
                    {keywordSlashSuggestions.length === 0 ? (
                      <li className="px-2 py-2 text-left text-xs text-slate-500">
                        {keywordSlashQuery !== null && keywordSlashQuery.trim() ? (
                          <>无匹配的活跃标签（已排除「未整理」）。可改关键词或清空 / 后内容再试。</>
                        ) : (
                          <>
                            暂无最近用于「查询素材」的标签。请先在侧栏勾选标签并点击「查询素材」，即可在仅输入「/」时快速复选。
                          </>
                        )}
                      </li>
                    ) : (
                      keywordSlashSuggestions.map((t, idx) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={idx === keywordSlashHighlight}
                            className={
                              "w-full px-2 py-1.5 text-left text-sm " +
                              (idx === keywordSlashHighlight ? "bg-sky-500/25 text-slate-900" : "text-slate-800 hover:bg-slate-100")
                            }
                            onMouseEnter={() => setKeywordSlashHighlight(idx)}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => pickKeywordSlashTag(t.id)}
                            title={
                              (t.description || "").trim() ? `${t.name} — ${(t.description || "").trim()}` : t.name
                            }
                          >
                            {t.name}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              <div className="min-w-[140px] flex-[0_1_160px]">
                <label className="mb-1 block text-xs font-medium text-slate-600">标签分类</label>
                <select
                  className={inputClass + " w-full"}
                  value={listFilterTagCategory}
                  onChange={(e) => setListFilterTagCategory(e.target.value)}
                  aria-label="列表筛选：标签分类"
                  title="仅查询「至少带有一个该分类下启用标签」的素材；与侧栏勾选的具体标签为并且关系"
                >
                  <option value="">全部分类</option>
                  {tagCategoriesForLibrary(library).map((c) => (
                    <option key={c} value={c} title={tagCategoryHoverTitle(c)}>
                      {tagCategoryShort(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[160px] flex-[1_1_200px]">
                <label className="mb-1 block text-xs font-medium text-slate-600">上传用户名</label>
                <input
                  className={inputClass + " w-full"}
                  value={uploaderKeyword}
                  onChange={(e) => setUploaderKeyword(e.target.value)}
                  placeholder="模糊匹配"
                />
              </div>
              <div className="min-w-[130px] flex-[0_0_auto]">
                <label className="mb-1 block text-xs font-medium text-slate-600">标签条件</label>
                <select
                  className={inputClass + " w-full"}
                  value={tagMatchMode}
                  onChange={(e) => setTagMatchMode((e.target.value as "and" | "or") || "and")}
                  title="对侧栏勾选的具体标签生效；与「标签分类」组合时为：先满足分类，再按此模式匹配勾选标签"
                >
                  <option value="and">并且 / AND</option>
                  <option value="or">或者 / OR</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2 pb-0.5">
                <button type="button" className={btnPrimary} disabled={uiState === "loading"} onClick={() => void queryMaterials(true)}>
                  查询素材
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    setKeyword("");
                    setListFilterTagCategory("");
                    setUploaderKeyword("");
                    setKeywordSlashOpen(false);
                    setTagPanelMode("quick");
                    setSelectedQuickView("全部素材");
                    setSelectedTagIds([]);
                  }}
                >
                  筛选重置
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">当前筛选：</span>
              {chips.length === 0 ? <span className="text-slate-400">无</span> : null}
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700"
                >
                  {chip.label} ×
                </button>
              ))}
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {uiState === "loading" ? <div className="border-b border-slate-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">正在加载…</div> : null}
            {uiState === "error" ? <div className="border-b border-slate-100 bg-red-50 px-4 py-2 text-sm text-red-700">查询失败：{errorMessage}</div> : null}

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="text-slate-500">在卡片间隙按下拖动可框选追加勾选。</span>
              <button
                type="button"
                className={btnSecondary + " !py-1 !text-xs"}
                disabled={uiState !== "success" || items.length === 0}
                onClick={() => setSelectedMaterialIds(items.map((i) => i.id))}
              >
                全选本页
              </button>
              <button type="button" className={btnSecondary + " !py-1 !text-xs"} onClick={() => setSelectedMaterialIds([])}>
                清除勾选
              </button>
              {downloadToast ? (
                <span className="max-w-md truncate text-amber-800" title={downloadToast}>
                  见页面底部提示条
                </span>
              ) : null}
            </div>

            <div
              ref={marqueeRootRef}
              className="relative max-h-[min(72vh,920px)] min-h-0 overflow-y-auto p-3"
              onPointerDown={onGridPointerDown}
              onPointerMove={onGridPointerMove}
              onPointerUp={onGridPointerEnd}
              onPointerCancel={onGridPointerEnd}
            >
              {marqueeBox ? (
                <div
                  className="pointer-events-none absolute z-20 border border-sky-500 bg-sky-400/20"
                  style={{
                    left: Math.min(marqueeBox.x1, marqueeBox.x2),
                    top: Math.min(marqueeBox.y1, marqueeBox.y2),
                    width: Math.abs(marqueeBox.x2 - marqueeBox.x1),
                    height: Math.abs(marqueeBox.y2 - marqueeBox.y1),
                  }}
                />
              ) : null}
              <div className="grid gap-1.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((item) => {
                const isChecked = selectedMaterialIds.includes(item.id);
                const tagText = formatTagNames(item.tag_ids);
                const iconPath = extIcon(item.primary_extension);
                const persisted = item.preview_thumbnail_path;
                const persistedThumb =
                  persisted && (persisted.startsWith("http") || persisted.startsWith("https") || persisted.startsWith("/"))
                    ? persisted
                    : "";
                const coverPath = thumbMap[item.id] || persistedThumb || iconPath;
                const visualState = selectedMaterialId === item.id ? "preview" : isChecked ? "checked" : "default";
                return (
                  <div key={item.id} data-material-card={item.id} className="min-w-0">
                    <MaterialFileCard
                      visualState={visualState}
                      displayName={displayName(item)}
                      tagLine={tagText}
                      fileSizeBytes={item.file_size ?? null}
                      resolutionLabel={formatResolution(item.primary_media_width, item.primary_media_height)}
                      coverSrc={coverPath}
                      onCoverError={(e) => {
                        const el = e.currentTarget;
                        if (!el.src.endsWith(iconPath)) el.src = iconPath;
                      }}
                      onCardClick={() => setSelectedMaterialId(item.id)}
                      checkboxChecked={isChecked}
                      onCheckboxChange={() => toggleMaterialSelection(item.id)}
                      draggable={canDownload && Boolean(item.primary_file_id)}
                      onMouseEnter={() => void prepareMaterialForDrag(item.id)}
                      onPointerDown={() => void prepareMaterialForDrag(item.id)}
                      onDragStart={(e) => {
                        if (!canDownload || !item.primary_file_id) {
                          showDownloadToast("无法拖放：无下载权限或该素材无主文件。");
                          return;
                        }
                        let ids: string[] = [];
                        if (selectedMaterialIds.length > 0 && selectedMaterialIds.includes(item.id)) {
                          ids = selectedMaterialIds.filter((id) => Boolean(items.find((r) => r.id === id)?.primary_file_id));
                        }
                        if (ids.length === 0) ids = [item.id];

                        let usedDownloadUrl = false;
                        let usedNativeNasPath = false;
                        let pendingCacheFallback = false;
                        let nasDragFailMessage: string | undefined;

                        if (ids.length >= 1 && window.desktopClient) {
                          if (
                            !window.desktopClient.startNativeFileDragSync &&
                            !window.desktopClient.peekFileDragSync &&
                            !window.desktopClient.startNativeFilesDragSync
                          ) {
                            showDownloadToast(
                              "拖放 API 未加载：请完全关闭本窗口后重新运行 desktop-client\\一键运行.bat（仅刷新网页无效）。"
                            );
                            return;
                          }

                          const buildDragItem = (materialId: string): MaterialDragItemPayload | null => {
                            const row = items.find((r) => r.id === materialId);
                            if (!row?.primary_file_id) return null;
                            const detailFile =
                              detailMap[materialId]?.files?.find((f) => f.id === row.primary_file_id) ||
                              detailMap[materialId]?.files?.[0];
                            return {
                              materialId,
                              fileId: row.primary_file_id,
                              fileRelativePath: detailFile?.file_relative_path || detailFile?.file_path,
                              cachedAbsolutePath: dragNasPathCache.current.get(materialId),
                            };
                          };

                          if (ids.length > 1 && window.desktopClient.startNativeFilesDragSync) {
                            const dragItems = ids.map(buildDragItem).filter((x): x is MaterialDragItemPayload => Boolean(x));
                            if (dragItems.length === 0) {
                              showDownloadToast("所选素材均无主文件，无法批量拖出。");
                              return;
                            }
                            if (metadataFileCountRef.current <= 0) {
                              showDownloadToast(
                                "本机尚未同步 NAS 路径。请打开「本机连接与缓存」→ 填写 UNC 根目录 →「同步素材元数据」后再拖。"
                              );
                              return;
                            }
                            showDownloadToast(`正在启动批量拖放（${dragItems.length} 个文件）…`);
                            const dragResult = performNativeMaterialsDragSync(e, dragItems);
                            if (dragResult.ok && (dragResult.fileCount ?? dragResult.files?.length ?? 0) > 0) {
                              usedNativeNasPath = true;
                              for (const p of dragResult.files || []) {
                                const hit = dragItems.find((it) => p.includes(it.materialId) || dragNasPathCache.current.has(it.materialId));
                                if (hit) dragNasPathCache.current.set(hit.materialId, p);
                              }
                              const miss = dragResult.missingCount ?? dragResult.skipped?.length ?? 0;
                              const trunc = dragResult.truncated ? `\n（最多 ${dragResult.maxBulk ?? 40} 个，超出部分请分批）` : "";
                              showDownloadToast(
                                `已请求批量拖放 ${dragResult.fileCount ?? dragResult.files?.length} 个文件，请移到目标文件夹后松手。${miss > 0 ? `\n${miss} 个未能解析路径已跳过。` : ""}${trunc}`
                              );
                            } else {
                              showDownloadToast(
                                dragResult.message ||
                                  "批量 NAS 直拖失败：请确认已同步元数据，或改用侧栏「选择目录保存」。"
                              );
                            }
                          } else if (ids.length === 1) {
                          const onlyId = ids[0];
                          const row = items.find((r) => r.id === onlyId);
                          const detailFile =
                            detailMap[onlyId]?.files?.find((f) => f.id === row?.primary_file_id) ||
                            detailMap[onlyId]?.files?.[0];

                          showDownloadToast("正在启动系统拖放，请保持按住鼠标移到目标文件夹…");
                          const dragResult = performNativeMaterialDragSync(e, {
                            materialId: onlyId,
                            fileId: row?.primary_file_id || item.primary_file_id,
                            fileRelativePath: detailFile?.file_relative_path || detailFile?.file_path,
                            cachedAbsolutePath: dragNasPathCache.current.get(onlyId),
                          });

                          if (dragResult.ok && dragResult.absolutePath) {
                            usedNativeNasPath = true;
                            dragNasPathCache.current.set(onlyId, dragResult.absolutePath);
                            showDownloadToast(
                              `已请求系统拖放，请按住鼠标移到目标文件夹。\n若松手后仍无反应，将自动复制文件供 Ctrl+V 粘贴。\n${dragResult.absolutePath}`
                            );
                            postDownloadClientReport({
                              material_id: onlyId,
                              file_id: row?.primary_file_id || item.primary_file_id || "",
                              download_mode: "nas_smb_drag",
                              transport_route: "nas_smb",
                              success: true,
                            });
                          } else {
                            pendingCacheFallback = true;
                            nasDragFailMessage =
                              dragResult.message ||
                              (dragResult.error === "file_relative_path_not_found"
                                ? "缺少 file_relative_path：请同步元数据或先点击素材加载详情。"
                                : dragResult.error === "material_assets_root_not_configured"
                                  ? "未配置 material_assets_root，请到「本机连接与缓存」设置 NAS 根目录。"
                                  : "NAS 文件不可访问，松手后将下载到本地缓存，再拖一次。");
                            showDownloadToast(nasDragFailMessage);
                          }
                          }
                        } else if (ids.length === 1 && !window.desktopClient) {
                          const onlyId = ids[0];
                          const url = dragUrlCache.current.get(onlyId);
                          if (url) {
                            const row = items.find((r) => r.id === onlyId);
                            const label = row ? dragSaveFileLabel(row) : dragSaveFileLabel(item);
                            try {
                              e.dataTransfer.setData("DownloadURL", `application/octet-stream:${url}:${label}`);
                              usedDownloadUrl = true;
                            } catch {
                              /* ignore */
                            }
                          }
                        }

                        materialCardDragSessionRef.current = {
                          starterId: item.id,
                          materialIds: ids,
                          usedDownloadUrl,
                          usedNativeNasPath,
                          pendingCacheFallback,
                          nasDragFailMessage,
                          nativeDragAt: usedNativeNasPath ? Date.now() : undefined,
                          nativeDragPath:
                            usedNativeNasPath && ids.length === 1
                              ? dragNasPathCache.current.get(ids[0])
                              : undefined,
                        };
                        if (!usedNativeNasPath) {
                          try {
                            e.dataTransfer.setData(
                              "text/plain",
                              ids.length > 1 ? `${ids.length} 个素材` : dragSaveFileLabel(item)
                            );
                          } catch {
                            /* ignore */
                          }
                          e.dataTransfer.effectAllowed = "copy";
                        }
                      }}
                      onDragEnd={() => {
                        const s = materialCardDragSessionRef.current;
                        materialCardDragSessionRef.current = null;
                        if (!s || s.starterId !== item.id) return;
                        if (materialDownloadBusyRef.current) return;
                        if (!s.materialIds.length) return;
                        if (s.usedDownloadUrl && s.materialIds.length === 1) return;
                        if (s.usedNativeNasPath) {
                          if (s.materialIds.length === 1) {
                            const elapsed = Date.now() - (s.nativeDragAt ?? 0);
                            if (elapsed < 450) {
                              void handleNativeDragDidNotTake(s.materialIds[0], s.nativeDragPath);
                            }
                          }
                          return;
                        }
                        if (s.pendingCacheFallback && s.materialIds.length === 1) {
                          void runNasDragCacheFallback(s.materialIds[0], s.nasDragFailMessage);
                          return;
                        }
                        void runMaterialDownloadJob("drag", s.materialIds);
                      }}
                    />
                  </div>
                );
              })}
              </div>
            </div>

            {uiState === "success" && items.length === 0 ? (
              <p className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500">当前筛选条件下暂无数据。</p>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm">
              <span className="text-slate-500">
                共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className={btnSecondary + " !py-1 !text-xs"} disabled={uiState === "loading" || page <= 1} onClick={() => void goToPage(page - 1)}>
                  上一页
                </button>
                <div className="flex max-w-[min(100%,42rem)] flex-wrap items-center gap-1">
                  {paginationItems.map((entry, idx) =>
                    entry === "ellipsis" ? (
                      <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-slate-500 select-none" aria-hidden>
                        …
                      </span>
                    ) : (
                      <button
                        key={entry}
                        type="button"
                        className={
                          entry === page
                            ? "min-w-[2rem] rounded border border-sky-400/60 bg-sky-600/30 px-2 py-1 text-xs font-medium text-sky-100 shadow-sm"
                            : "min-w-[2rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 shadow-sm hover:bg-slate-50"
                        }
                        disabled={uiState === "loading" || entry === page}
                        aria-current={entry === page ? "page" : undefined}
                        onClick={() => void goToPage(entry)}
                      >
                        {entry}
                      </button>
                    )
                  )}
                </div>
                <button type="button" className={btnSecondary + " !py-1 !text-xs"} disabled={uiState === "loading" || page >= totalPages} onClick={() => void goToPage(page + 1)}>
                  下一页
                </button>
              </div>
            </div>
          </section>
        </section>

        <aside className="sticky top-4 z-10 flex max-h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <div className="shrink-0 text-sm font-semibold text-slate-100">预览与文件信息</div>
          <div className="mt-3 shrink-0 space-y-2 border-b border-white/10 pb-3">
            <button
              type="button"
              className={btnPrimary + " !text-xs w-full"}
              disabled={!canDownload || materialDownloadJob !== null || saveTargetMaterialIds.length === 0}
              title={
                !canDownload
                  ? "需 asset.download 权限"
                  : saveTargetMaterialIds.length === 0
                    ? "请先勾选素材，或点选一条有主文件的素材"
                    : supportsMaterialDirectorySave()
                      ? saveTargetMaterialIds.length > 1
                        ? `将 ${saveTargetMaterialIds.length} 个文件保存到同一目录`
                        : "选择本地目录保存当前素材主文件"
                      : "当前环境将依次打开系统下载"
              }
              onClick={() => void handleSavePreviewToDirectory()}
            >
              选择目录保存…
            </button>
            <button
              type="button"
              className={btnSecondary + " !text-xs w-full"}
              disabled={!canDownload || !selectedItem?.primary_file_id || !window.desktopClient}
              onClick={() => void handleTestDirectDragPath()}
            >
              检测 NAS 直拖路径
            </button>
            <button
              type="button"
              className={btnSecondary + " !text-xs w-full"}
              disabled={!canDownload || !selectedItem?.primary_file_id || !window.desktopClient}
              onClick={() => void handleOpenNasInFolder()}
            >
              在资源管理器中打开（NAS）
            </button>
            <button
              type="button"
              className={btnSecondary + " !text-xs w-full"}
              disabled={!canDownload || !selectedItem?.primary_file_id || !window.desktopClient}
              onClick={() => void handleCopyNasPath()}
            >
              复制 NAS 绝对路径
            </button>
            <button
              type="button"
              className={btnSecondary + " !text-xs w-full"}
              disabled={!canDownload || !selectedItem?.primary_file_id || !window.desktopClient}
              onClick={() => void handleCopyFileForPaste()}
            >
              复制文件（文件夹 Ctrl+V）
            </button>
            <p className="text-[11px] text-amber-200/90">
              操作反馈在页面<strong>底部黄色提示条</strong>。多选后从任一已选卡片「⋮⋮ 拖到文件夹」可批量直拖（最多 40 个）；NAS 不可用请用「选择目录保存」。
            </p>
            <p className="text-[11px] text-slate-500">
              单条/批量拖放均走 NAS 零拷贝；失败可用「复制文件（文件夹 Ctrl+V）」或「选择目录保存」。
            </p>
            <p className="text-[11px] text-slate-500 [overflow-wrap:anywhere]">
              默认缓存目录（缩略图等后续可落盘时沿用）：{resolvedCacheRoot()}
            </p>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]">
            {!selectedItem ? (
              <p className="text-xs text-slate-400">请点击卡片查看预览与详情。</p>
            ) : (
              <div className="grid gap-3 text-xs text-slate-300">
                {(() => {
                  const persisted = selectedItem.preview_thumbnail_path;
                  const persistedThumb =
                    persisted && (persisted.startsWith("http") || persisted.startsWith("https") || persisted.startsWith("/"))
                      ? persisted
                      : "";
                  const drawerThumbSrc = thumbMap[selectedItem.id] || persistedThumb || extIcon(selectedItem.primary_extension);
                  return (
                    <MaterialFilePreviewArea
                      mode={drawerPreviewMode}
                      src={drawerThumbSrc}
                      largeImageSrc={drawerPreviewMode === "image" ? drawerStream.streamUrl : null}
                      largeImageLoading={drawerPreviewMode === "image" ? drawerStream.streamLoading : false}
                      largeImageError={drawerPreviewMode === "image" ? drawerStream.streamError : null}
                      largeImagePlaceholderHint={
                        drawerPreviewMode === "image" && !canDownload
                          ? "查看原图需具备「下载素材」权限（asset.download）。"
                          : drawerPreviewMode === "image" && !selectedItem.primary_file_id
                            ? "当前素材无主文件 id，无法解析原图。"
                            : drawerPreviewMode === "image" && selectedItem.status !== "available"
                              ? "素材非「可用」状态时不解析原图直链。"
                              : null
                      }
                      videoFallbackPreviewUrl={drawerPreviewMode === "video" ? drawerPreviewVideo.previewUrl : null}
                      videoStreamUrl={drawerPreviewMode === "video" ? drawerStream.streamUrl : null}
                      videoStreamLoading={
                        drawerPreviewMode === "video"
                          ? drawerPreviewVideo.previewLoading ||
                            (drawerStreamResolveEnabled && drawerStream.streamLoading)
                          : false
                      }
                      videoStreamError={
                        drawerPreviewMode === "video" && !drawerPreviewVideo.previewUrl && !drawerStream.streamUrl
                          ? drawerPreviewVideo.previewError || drawerStream.streamError
                          : null
                      }
                      videoPlaceholderHint={
                        drawerPreviewMode === "video" && !selectedItem.primary_file_id
                          ? "当前素材无主文件 id，无法解析播放地址。"
                          : drawerPreviewMode === "video" && !canView
                            ? "内嵌播放需具备「查看素材」权限（asset.view）。"
                            : null
                      }
                      onError={(e) => {
                        const el = e.currentTarget;
                        const icon = extIcon(selectedItem.primary_extension);
                        setThumbMap((prev) => {
                          if (!prev[selectedItem.id]) return prev;
                          const next = { ...prev };
                          delete next[selectedItem.id];
                          return next;
                        });
                        thumbnailRequestedRef.current.delete(selectedItem.id);
                        if (el.src.endsWith(icon)) return;
                        el.src = icon;
                      }}
                    />
                  );
                })()}
                <div>
                  <div className="text-slate-500">文件名</div>
                  <div className="mt-1 break-words text-sm text-white [overflow-wrap:anywhere]">{displayName(selectedItem)}</div>
                  <div>文件大小：{formatBytes(selectedItem.file_size ?? null)}</div>
                  {formatResolution(selectedItem.primary_media_width, selectedItem.primary_media_height) ? (
                    <div>分辨率：{formatResolution(selectedItem.primary_media_width, selectedItem.primary_media_height)}</div>
                  ) : null}
                  <div className="text-slate-500">{isPersonalVideo ? "AI内容识别" : "描述"}</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200 [overflow-wrap:anywhere]">{selectedItem.description?.trim() || "—"}</div>
                  {isPersonalVideo ? (
                    <div className="mt-3 grid gap-2">
                      <div className="text-slate-500">一级 / 二级分类</div>
                      <div className="text-sm text-slate-100">
                        {[selectedItem.primary_taxonomy_name, selectedItem.secondary_taxonomy_name].filter(Boolean).join(" / ") || "—"}
                      </div>
                      <div className="text-slate-500">关键词</div>
                      <div className="text-sm text-slate-100">{(selectedItem.keywords || []).join("、") || "—"}</div>
                      <div className="text-slate-500">承接句意</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-100">{selectedItem.copy_fit || "—"}</div>
                      <label className="mt-1 grid gap-1 text-slate-500">
                        编辑承接句意
                        <textarea
                          className="min-h-[4.5rem] rounded border border-white/20 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                          value={copyFitDraft}
                          onChange={(e) => setCopyFitDraft(e.target.value)}
                          onFocus={() => setCopyFitDraft(selectedItem.copy_fit || "")}
                        />
                      </label>
                      <label className="grid gap-1 text-slate-500">
                        编辑关键词（逗号分隔）
                        <input
                          className="rounded border border-white/20 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                          value={keywordsDraft}
                          onChange={(e) => setKeywordsDraft(e.target.value)}
                          onFocus={() => setKeywordsDraft((selectedItem.keywords || []).join("、"))}
                        />
                      </label>
                      <button
                        type="button"
                        className="rounded bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                        onClick={() => {
                          void (async () => {
                            try {
                              const data = await apiJson<MaterialItem>(`/materials/${selectedItem.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  copy_fit: copyFitDraft,
                                  keywords: keywordsDraft.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean),
                                }),
                              });
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === selectedItem.id
                                    ? { ...x, copy_fit: data.copy_fit, keywords: data.keywords || [] }
                                    : x
                                )
                              );
                              showDownloadToast("承接句意 / 关键词已保存");
                            } catch (error) {
                              showDownloadToast(error instanceof Error ? error.message : "保存失败");
                            }
                          })();
                        }}
                      >
                        保存文案字段
                      </button>
                    </div>
                  ) : null}
                  <div>素材状态：{materialStatusLabel[selectedItem.status] || selectedItem.status}</div>
                  <div>上传人：{selectedItem.uploader || "—"}</div>
                  <div>上传时间：{selectedItem.created_at}</div>
                  <div>下载次数：{selectedItem.download_count}</div>
                </div>
                <div>
                  <div className="text-slate-500">标签信息</div>
                  <div className="mt-1 break-all">{formatTagNames(selectedItem.tag_ids) || "—"}</div>
                </div>
                {selectedDetail?.files?.length ? (
                  <div>
                    <div className="text-slate-500">文件列表</div>
                    <ul className="mt-1 list-inside list-disc text-slate-400">
                      {selectedDetail.files.map((f) => (
                        <li key={f.id}>
                          {f.original_filename} {f.file_size != null ? `(${formatBytes(f.file_size)})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>

      {materialDownloadJob ? (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-download-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-slate-100 shadow-xl">
            <h2 id="material-download-title" className="text-base font-semibold text-white">
              素材下载
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {materialDownloadJob.source === "drag" ? "来源：拖曳卡片" : "来源：选择目录保存"}
              {materialDownloadJob.batchTotal > 1
                ? ` · 第 ${materialDownloadJob.batchIndex}/${materialDownloadJob.batchTotal} 个`
                : null}
            </p>
            <p className="mt-2 break-all text-sm text-slate-300 [overflow-wrap:anywhere]" title={materialDownloadJob.fileLabel}>
              {materialDownloadJob.fileLabel}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {materialDownloadJob.paused && materialDownloadJob.phase === "writing"
                ? `已暂停（网络已反压） · ${materialDownloadJob.detail}`
                : materialDownloadJob.detail}
            </p>
            {materialDownloadJob.phase === "writing" && materialDownloadJob.total > 0 ? (
              <div className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className="h-full bg-sky-500 transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, Math.round((materialDownloadJob.received / Math.max(1, materialDownloadJob.total)) * 100))}%`,
                  }}
                />
              </div>
            ) : materialDownloadJob.phase === "writing" ? (
              <div className="mt-3 h-2 w-full animate-pulse rounded bg-slate-700" />
            ) : materialDownloadJob.phase === "resolving" || materialDownloadJob.phase === "folder" ? (
              <div className="mt-3 h-2 w-full animate-pulse rounded bg-slate-700" />
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className={btnSecondary + " !text-xs border-slate-500 text-slate-200 hover:bg-slate-800"}
                disabled={materialDownloadJob.phase !== "writing" || materialDownloadJob.paused}
                onClick={() => {
                  materialDownloadPausedRef.current = true;
                  setMaterialDownloadJob((j) => (j ? { ...j, paused: true } : null));
                }}
              >
                暂停
              </button>
              <button
                type="button"
                className={btnSecondary + " !text-xs border-slate-500 text-slate-200 hover:bg-slate-800"}
                disabled={materialDownloadJob.phase !== "writing" || !materialDownloadJob.paused}
                onClick={() => {
                  materialDownloadPausedRef.current = false;
                  setMaterialDownloadJob((j) => (j ? { ...j, paused: false } : null));
                }}
              >
                继续
              </button>
              <button
                type="button"
                className={btnSecondary + " !text-xs border-slate-500 text-slate-200 hover:bg-slate-800"}
                onClick={() => {
                  materialDownloadPausedRef.current = false;
                  materialDownloadAbortRef.current?.abort();
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {downloadToast ? (
        <div
          className="pointer-events-none fixed bottom-5 left-1/2 z-[25000] w-[min(94vw,44rem)] -translate-x-1/2 rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-medium leading-snug text-amber-950 shadow-2xl"
          role="status"
          aria-live="polite"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">操作提示</div>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-sans text-[13px]">{downloadToast}</pre>
        </div>
      ) : null}
    </main>
  );
}
