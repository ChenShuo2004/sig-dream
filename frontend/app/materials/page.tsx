"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, type AssetLibraryCode, useAssetLibrary } from "@/lib/assetLibrary";
import {
  persistMaterialSaveDirectoryHandle,
  tryReuseSavedMaterialDownloadDirectory,
} from "@/lib/materialSaveDirectoryPreference";
import { usePagedPrefetchList } from "@/hooks/usePagedPrefetchList";
import TutorialGate from "@/components/tutorials/TutorialGate";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { MaterialFileCard } from "@/components/MaterialFileCard";
import { MaterialGridMarqueeOverlay } from "@/components/MaterialGridMarqueeOverlay";
import { MaterialGridSelectionToolbar } from "@/components/MaterialGridSelectionToolbar";
import { MaterialFilePreviewArea, type MaterialFilePreviewMode } from "@/components/MaterialFilePreviewArea";
import { useMaterialGridMarqueeSelection } from "@/hooks/useMaterialGridMarqueeSelection";
import { useMaterialFileStreamUrl } from "@/hooks/useMaterialFileStreamUrl";
import { useMaterialPreviewVideoUrl } from "@/hooks/useMaterialPreviewVideoUrl";
import { OpProgressBar } from "@/components/OpProgressBar";
import { formatBytes } from "@/lib/formatBytes";
import { coalescePositiveInt, formatResolutionForExtension } from "@/lib/mediaDisplay";
import { collectLanDownloadBases, resolveDirectMediaUrl } from "@/lib/materialBrowserDownload";
import { thumbnailAccessContextHeaders } from "@/lib/thumbnailAccessContext";
import { isNasTransferReady, nasStatusFetchFailed, type NasClientStatus } from "@/lib/nasClientStatus";
import { TagSlashPicker, mergeTagSlashRecentStorage, type TagSlashActiveTagGroups } from "@/components/TagSlashPicker";
import {
  MATERIAL_SIDEBAR_TO_BACKEND,
  MATERIAL_TAG_SIDEBAR_CATEGORIES,
  materialSidebarCategoriesForLibrary,
  tagCategoriesForLibrary,
  tagCategoryHoverTitle,
  tagCategoryHoverTitleForMaterialSidebar,
  tagCategoryShort,
} from "@/lib/tagCategoryUi";

/** 侧栏「标签分类」展示名：与 `tagCategoryShort` 一致（如后端「系统状态」→「系统」） */
function materialSidebarLabel(sidebarKey: string): string {
  const backend = MATERIAL_SIDEBAR_TO_BACKEND[sidebarKey];
  return tagCategoryShort(backend ?? sidebarKey);
}

type MaterialItem = {
  id: string;
  library_id?: string | null;
  library_code?: string | null;
  title: string;
  description: string | null;
  copy_fit?: string | null;
  keywords?: string[];
  primary_taxonomy_id?: string | null;
  secondary_taxonomy_id?: string | null;
  primary_taxonomy_name?: string | null;
  secondary_taxonomy_name?: string | null;
  tag_ids: string[];
  original_filename?: string | null;
  primary_file_id?: string | null;
  primary_extension?: string | null;
  primary_media_width?: number | null;
  primary_media_height?: number | null;
  file_size?: number | null;
  preview_thumbnail_path?: string | null;
  storage_pool_id?: string;
  status: string;
  download_count: number;
  uploader: string | null;
  created_at: string;
};

/** 与 `/collections/groups` 响应一致，用于收录弹层展平分组 */
type CollectModalGroupNode = {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
  children: CollectModalGroupNode[];
};
type CollectModalCollectionRow = { id: string; name: string; group_id: string | null };

type TaxonomyNode = {
  id: string;
  name: string;
  parent_id: string | null;
  children?: TaxonomyNode[];
};

function flattenCollectGroupNodes(nodes: CollectModalGroupNode[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name });
    if (n.children?.length) out.push(...flattenCollectGroupNodes(n.children));
  }
  return out;
}

const materialStatusLabel: Record<string, string> = {
  available: "可用",
  nas_syncing: "NAS同步中",
  nas_failed: "NAS同步失败",
  trash_pending: "删除同步中",
  trashed: "已移入回收站",
};
const fileTypeIconMap: Record<string, string> = {
  mp4: "/file-icons/video.svg",
  mov: "/file-icons/video.svg",
  mkv: "/file-icons/video.svg",
  avi: "/file-icons/video.svg",
  webm: "/file-icons/video.svg",
  m4v: "/file-icons/video.svg",
  jpg: "/file-icons/image.svg",
  jpeg: "/file-icons/image.svg",
  png: "/file-icons/image.svg",
  gif: "/file-icons/image.svg",
  webp: "/file-icons/image.svg",
  bmp: "/file-icons/image.svg",
  mp3: "/file-icons/audio.svg",
  wav: "/file-icons/audio.svg",
  m4a: "/file-icons/audio.svg",
  aac: "/file-icons/audio.svg",
  ogg: "/file-icons/audio.svg",
  flac: "/file-icons/audio.svg",
  pdf: "/file-icons/pdf.svg",
  doc: "/file-icons/doc.svg",
  docx: "/file-icons/doc.svg",
  xls: "/file-icons/xls.svg",
  xlsx: "/file-icons/xls.svg",
  ppt: "/file-icons/ppt.svg",
  pptx: "/file-icons/ppt.svg",
  zip: "/file-icons/zip.svg",
  rar: "/file-icons/zip.svg",
  "7z": "/file-icons/zip.svg",
  txt: "/file-icons/txt.svg",
};

type MaterialsResponse = {
  items: MaterialItem[];
  total: number;
  page: number;
  page_size: number;
};

type TagItem = {
  id: string;
  name: string;
  category: string;
  description?: string;
  status: string;
  sort_order: number;
};

type MaterialFile = {
  id: string;
  original_filename: string;
  extension?: string | null;
  file_size?: number | null;
  extra_metadata?: {
    thumbnail_path?: string;
    preview_path?: string;
    duration_seconds?: number;
    media_width?: number | null;
    media_height?: number | null;
  } | null;
};

type MaterialDetailResponse = MaterialItem & { files: MaterialFile[] };
/** ECS 签发票据 + LAN/公网 文件机根地址；LAN→WAN 探测后直连，失败则 ECS prepare_download 兜底 */
type MaterialDownloadRouteResponse = {
  material_id: string;
  file_id: string;
  ticket: string;
  expires_at: string;
  lan_download_base_url: string | null;
  lan_download_base_urls?: string[];
  public_download_base_url: string | null;
  recommended_order?: string[];
};
type ThumbnailUrlResponse = {
  status: string;
  source: string;
  expires_at: string | null;
  url: string | null;
  alternate_urls?: string[];
  message?: string | null;
};

type MaterialUsageItem = {
  id: string;
  source: string | null;
  username: string | null;
  created_at: string;
  usage_type?: string | null;
};
type MaterialUsageListResponse = { items: MaterialUsageItem[]; total: number };
type SyncDeadletter = {
  id: string;
  operation_id: string;
  operation_type: string;
  target_id: string | null;
  status: string;
  retry_count: number;
  last_error: string | null;
};
type SyncDeadletterResponse = { items: SyncDeadletter[]; total: number };
type DrawerOpProgress = {
  kind: "download" | "batch_download" | "unorganized" | "trash";
  done: number;
  total: number;
  detail?: string;
  /** 仅 download：替代「done/total」展示，避免被误认为文件分片数 */
  fractionLabel?: string;
  /** 仅 download：NAS 轮询无固定终点时用不确定进度条 */
  indeterminate?: boolean;
  /** 仅 download：显示「取消下载」 */
  cancellable?: boolean;
};
type TagPanelMode = "quick" | "category";
const quickViews = ["全部素材", "我的上传", "最近下载"] as const;
const previewImageExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const previewVideoExts = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";
const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toAbsoluteUrl(apiBaseUrl: string, maybeRelativeUrl: string): string {
  if (!maybeRelativeUrl) return "";
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  return `${apiBaseUrl.replace(/\/$/, "")}${maybeRelativeUrl}`;
}

function triggerBrowserDownload(url: string, options?: { openInNewTab?: boolean }): void {
  if (typeof window === "undefined" || !url) return;
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  a.rel = "noopener noreferrer";
  /** 批量勿开新标签；单条/移动端 Safari 对新标签更可靠 */
  if (options?.openInNewTab !== false) {
    a.target = "_blank";
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** HTTPS 页面打开 http 下载链易被静默拦截；此时应放弃 WAN 直连走 ECS 兜底 */
function isInsecureHttpFromSecurePage(targetBaseOrFullUrl: string): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  try {
    const raw = targetBaseOrFullUrl.trim();
    if (!raw) return false;
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type DownloadTransportRoute = "lan_direct" | "wan_direct" | "ecs_fallback";

type ResolvedMaterialDownload = {
  absoluteUrl: string;
  transportRoute: DownloadTransportRoute;
  filename: string;
  materialId: string;
  fileId: string;
  expiresAt: string;
  recommendedOrder?: string[];
  flowStartedAt: number;
  outcomeKind: "lan_machine" | "wan_machine" | "ecs_fallback";
  directLabel?: string;
  ecsNote?: string;
  /** 弹窗打开时写入：是否展示「选择本地目录保存」 */
  allowDirectoryPick?: boolean;
};

function isCoarseMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/** File System Access：需安全上下文；移动端仅浏览器默认下载 */
function supportsMaterialDirectorySave(): boolean {
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

async function streamUrlToDirectoryWithProgress(
  absoluteUrl: string,
  baseFileName: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number, total: number) => void,
  existingDirHandle?: FileSystemDirectoryHandle | null
): Promise<{ bytes: number; dirHandle: FileSystemDirectoryHandle }> {
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
  return { bytes: received, dirHandle };
}

/** 与《文件直传与自动选路》：LAN 短超时、WAN 略长 */
const FILE_MACHINE_PROBE_LAN_MS = 800;
const FILE_MACHINE_PROBE_WAN_MS = 1500;
const FILE_MACHINE_HEALTH_DEFAULT_MS = 2800;

function buildTicketDownloadUrl(baseUrl: string, ticket: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/download?ticket=${encodeURIComponent(ticket)}`;
}

/** 浏览器探测文件机 /health（需文件机 CORS 放行），用于选 LAN / 公网直连 */
async function probeFileMachineHealth(
  baseUrl: string,
  externalSignal: AbortSignal,
  timeoutMs: number = FILE_MACHINE_HEALTH_DEFAULT_MS,
  maxAttempts = 2
): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "");
  if (!base) return false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (externalSignal.aborted) return false;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    externalSignal.addEventListener("abort", onAbort);
    try {
      const resp = await fetch(`${base}/health`, { method: "GET", mode: "cors", signal: ctl.signal });
      if (resp.ok) return true;
    } catch {
      /* retry */
    } finally {
      window.clearTimeout(timer);
      externalSignal.removeEventListener("abort", onAbort);
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 160));
    }
  }
  return false;
}

type DownloadPrepareStatusJson = {
  job_id?: string;
  status?: string;
  error_message?: string | null;
  download_url?: string | null;
  detail?: unknown;
};

/** ECS 兜底：POST download-prepare → 轮询状态 → 返回带 access_token 的缓存下载绝对 URL */
async function pollEcsDownloadCacheFallback(
  apiBaseUrl: string,
  materialId: string,
  fileId: string,
  buildHeaders: () => Record<string, string>,
  signal: AbortSignal,
  onStatus?: (detail: string) => void
): Promise<string> {
  const prep = await fetch(`${apiBaseUrl}/materials/${materialId}/files/${fileId}/download-prepare`, {
    method: "POST",
    headers: buildHeaders(),
    signal,
  });
  const prepJson = (await prep.json()) as DownloadPrepareStatusJson;
  if (!prep.ok) throw new Error(pretty(prepJson));
  const jobId = prepJson.job_id;
  if (!jobId) throw new Error("download-prepare 未返回 job_id");

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const st = await fetch(`${apiBaseUrl}/materials/download-prepare/${jobId}`, {
      headers: buildHeaders(),
      signal,
    });
    const stj = (await st.json()) as DownloadPrepareStatusJson;
    if (!st.ok) throw new Error(pretty(stj));
    const status = String(stj.status || "");
    if (status === "failed" || status === "error") {
      throw new Error(stj.error_message || "prepare_download 失败");
    }
    if (status === "success" && stj.download_url) {
      return toAbsoluteUrl(apiBaseUrl, stj.download_url);
    }
    onStatus?.(status === "pending" ? "排队：等待 NAS worker 领取准备任务…" : "运行中：NAS 正在上传文件到 ECS 缓存…");
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("ECS 缓存下载准备超时（请检查文件机 run-worker 与 nas-jobs/poll）");
}

function MaterialsPageInner() {
  const searchParams = useSearchParams();
  const tutorialParam = searchParams.get("tutorial");
  const router = useRouter();
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const { library, isPersonalVideo } = useAssetLibrary();
  const sidebarCategories = useMemo(() => materialSidebarCategoriesForLibrary(library), [library]);

  const [token, setToken] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);

  const [keyword, setKeyword] = useState("");
  /** 列表查询：限定「至少有一个该分类下的启用标签」；与侧栏勾选 tag 为 AND，由后端 tag_category + tag_ids_all 实现 */
  const [listFilterTagCategory, setListFilterTagCategory] = useState("");
  const [uploaderKeyword, setUploaderKeyword] = useState("");
  const [tagMatchMode, setTagMatchMode] = useState<"and" | "or">("and");
  const [selectedQuickView, setSelectedQuickView] = useState<string>("全部素材");
  const [selectedCategory, setSelectedCategory] = useState<string>(MATERIAL_TAG_SIDEBAR_CATEGORIES[0]);
  const [tagPanelMode, setTagPanelMode] = useState<TagPanelMode>("quick");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [taxonomyTree, setTaxonomyTree] = useState<TaxonomyNode[]>([]);
  const [selectedPrimaryTaxonomyId, setSelectedPrimaryTaxonomyId] = useState("");
  const [selectedSecondaryTaxonomyId, setSelectedSecondaryTaxonomyId] = useState("");
  const [copyFitDraft, setCopyFitDraft] = useState("");
  const [keywordsDraft, setKeywordsDraft] = useState("");
  const [favoriteTagIds, setFavoriteTagIds] = useState<string[]>([]);
  const [recentTagIds, setRecentTagIds] = useState<string[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  /** 卡片网格内联：双击标题 / 双击标签 */
  const [cardTitleEditId, setCardTitleEditId] = useState<string | null>(null);
  const [cardTitleDraft, setCardTitleDraft] = useState("");
  const [cardTagsEditId, setCardTagsEditId] = useState<string | null>(null);
  const [cardTagsEditDraftIds, setCardTagsEditDraftIds] = useState<string[]>([]);
  const [nasStatus, setNasStatus] = useState<NasClientStatus | null>(null);

  const pageSize = 20;
  const [uiState, setUiState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [detailMap, setDetailMap] = useState<Record<string, MaterialDetailResponse>>({});
  const [tags, setTags] = useState<TagItem[]>([]);
  /** 快捷视图下列侧栏：与当前列表同源筛选下，素材上出现过的启用标签 id（GET /materials/facet-tag-ids） */
  const [quickViewFacetTagIds, setQuickViewFacetTagIds] = useState<string[]>([]);
  const [quickViewFacetLoading, setQuickViewFacetLoading] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [result, setResult] = useState("等待操作...");
  const [selectedItemUsages, setSelectedItemUsages] = useState<MaterialUsageItem[]>([]);
  const [thumbnailUrlMap, setThumbnailUrlMap] = useState<Record<string, string>>({});
  const [thumbnailRetryTick, setThumbnailRetryTick] = useState(0);
  const thumbnailRequestedRef = useRef<Set<string>>(new Set());
  const libraryEpochRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  /** 主搜索框「/」快捷：备选项为「最近用于查询素材」的标签（与 `recentTagIds` / 侧边「最近」同源） */
  const keywordSearchWrapRef = useRef<HTMLDivElement>(null);
  const [keywordSlashOpen, setKeywordSlashOpen] = useState(false);
  const [keywordSlashHighlight, setKeywordSlashHighlight] = useState(0);

  const gridMarquee = useMaterialGridMarqueeSelection({
    selectedIds: selectedMaterialIds,
    setSelectedIds: setSelectedMaterialIds,
  });

  const [drawerOpProgress, setDrawerOpProgress] = useState<DrawerOpProgress | null>(null);
  const drawerProgressClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 中止当前下载流程中的 fetch（领票、探测、直连；用户点「取消下载」） */
  const downloadPrepareAbortRef = useRef<AbortController | null>(null);
  /** 选路完成后：桌面端可选「浏览器默认 / 选择目录」；批量下载不弹窗 */
  const [downloadSaveChoice, setDownloadSaveChoice] = useState<ResolvedMaterialDownload | null>(null);

  /** 素材库 → 集合收录（第二阶段）；materialIds 为本次要收录的素材 id（支持多选，已过滤为「可用」） */
  const [collectModal, setCollectModal] = useState<
    | null
    | {
        mode: "personal" | "project";
        groups: { id: string; name: string }[];
        list: CollectModalCollectionRow[];
        loading: boolean;
        materialIds: string[];
      }
  >(null);
  const [collectGroupFilter, setCollectGroupFilter] = useState("");
  const [collectPickId, setCollectPickId] = useState("");
  const [collectNote, setCollectNote] = useState("");
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectErr, setCollectErr] = useState("");

  function scheduleClearDrawerProgress(delayMs: number) {
    if (drawerProgressClearRef.current) {
      clearTimeout(drawerProgressClearRef.current);
    }
    drawerProgressClearRef.current = setTimeout(() => {
      drawerProgressClearRef.current = null;
      setDrawerOpProgress(null);
    }, delayMs);
  }

  function cancelScheduledDrawerProgressClear() {
    if (drawerProgressClearRef.current) {
      clearTimeout(drawerProgressClearRef.current);
      drawerProgressClearRef.current = null;
    }
  }
  const {
    items,
    total,
    page,
    totalPages,
    busy,
    loadingMore,
    error: pageError,
    hasMore,
    sentinelRef,
    setItems,
    setTotal,
    resetAndLoad,
    loadNext,
    goToPage,
    bindLoadNext,
    invalidateInFlight,
  } = usePagedPrefetchList<MaterialItem>({
    prefetchPages: [],
    appendMode: false,
    pageSize,
    autoLoadSentinel: false,
    enabled: true,
  });

  const [boundLibrary, setBoundLibrary] = useState(library);
  if (library !== boundLibrary) {
    setBoundLibrary(library);
    setItems([]);
    setTotal(0);
    setTags([]);
    setTaxonomyTree([]);
    setThumbnailUrlMap({});
    setSelectedMaterialIds([]);
    setSelectedMaterialId("");
    setSelectedTagIds([]);
    setSelectedPrimaryTaxonomyId("");
    setSelectedSecondaryTaxonomyId("");
    setListFilterTagCategory("");
    setFavoriteTagIds([]);
    setRecentTagIds([]);
    setPrefsLoaded(false);
    setQuickViewFacetTagIds([]);
    setSelectedCategory(materialSidebarCategoriesForLibrary(library)[0] ?? "品牌");
    setUiState(token ? "loading" : "idle");
  }

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const hasPermission = useCallback((code: string) => permissionSet.has(code), [permissionSet]);
  const isAdminRole = currentRole === "super_admin" || currentRole === "material_admin";
  const canTrashRole = hasPermission("asset.delete_all") || hasPermission("asset.delete_own");
  const canEditAll = hasPermission("asset.edit_all");
  const canEditOwn = hasPermission("asset.edit_own");
  const canEditRole = canEditAll || canEditOwn;
  const canDownloadSingle = hasPermission("asset.download");
  const canViewAsset = hasPermission("asset.view");
  const canBatchDownload = hasPermission("asset.batch_download");
  const canViewUsages = hasPermission("log.view");
  const canCollectionView = hasPermission("collection.view");
  const tagNameById = useMemo(() => {
    const map = new Map<string, string>();
    tags.forEach((tag) => {
      map.set(tag.id, tag.name);
    });
    return map;
  }, [tags]);
  const formatTagNames = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return "无标签";
      return ids.map((id) => tagNameById.get(id) || id).join(" / ");
    },
    [tagNameById]
  );
  const tagSlashGroups = useMemo<TagSlashActiveTagGroups>(() => {
    const g: TagSlashActiveTagGroups = {};
    for (const t of tags) {
      if (t.status !== "active") continue;
      const cat = (t.category || "").trim() || "其他";
      if (!g[cat]) g[cat] = [];
      const desc = (t.description || "").trim();
      g[cat].push({ id: t.id, name: t.name, ...(desc ? { description: desc } : {}) });
    }
    return g;
  }, [tags]);
  const getMaterialExtension = useCallback((item: MaterialItem) => {
    const fromPrimary = (item.primary_extension || "").trim().toLowerCase().replace(/^\./, "");
    if (fromPrimary) return fromPrimary;
    const name = item.original_filename || item.title || "";
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex >= 0 && dotIndex < name.length - 1) {
      return name.slice(dotIndex + 1).toLowerCase();
    }
    return "";
  }, []);
  const getMaterialDisplayName = useCallback((item: MaterialItem) => {
    const ext = getMaterialExtension(item);
    const rawName = (item.original_filename || item.title || "").trim();
    if (!rawName) return item.title;
    if (!ext) return rawName;
    return rawName.toLowerCase().endsWith(`.${ext}`) ? rawName : `${rawName}.${ext}`;
  }, [getMaterialExtension]);

  /** 双击改「展示名」：与 {@link getMaterialDisplayName} 一致落库到 title + 主文件 original_filename */
  function displayInputToTitleAndPrimaryFilename(
    item: MaterialItem,
    raw: string,
    extensionFrom: (i: MaterialItem) => string
  ): { title: string; primary_original_filename: string } {
    const t = raw.trim();
    const ext = extensionFrom(item).replace(/^\./, "");
    const lastDot = t.lastIndexOf(".");
    const hasExtInInput = lastDot > 0 && lastDot < t.length - 1;
    const withExt = !hasExtInInput && ext ? `${t}.${ext}` : t;
    const stemLast = withExt.lastIndexOf(".");
    const stem = stemLast > 0 ? withExt.slice(0, stemLast) : withExt;
    return {
      title: stem.slice(0, 200),
      primary_original_filename: withExt.slice(0, 255),
    };
  }
  const getMaterialIcon = useCallback((item: MaterialItem) => {
    const ext = getMaterialExtension(item);
    return fileTypeIconMap[ext] || "/file-icons/file.svg";
  }, [getMaterialExtension]);

  /** 收录目标：有勾选则用勾选列表；否则用当前预览行一条；仅保留当前列表中且状态为「可用」的 id */
  const collectTargetMaterialIds = useMemo(() => {
    const raw =
      selectedMaterialIds.length > 0 ? [...selectedMaterialIds] : selectedMaterialId ? [selectedMaterialId] : [];
    return raw.filter((id) => items.some((x) => x.id === id && x.status === "available"));
  }, [items, selectedMaterialId, selectedMaterialIds]);

  const collectFilteredCollections = useMemo(() => {
    if (!collectModal) return [];
    const g = collectGroupFilter.trim();
    if (!g) return collectModal.list;
    return collectModal.list.filter((c) => (c.group_id || "") === g);
  }, [collectModal, collectGroupFilter]);

  const collectGroupNameById = useMemo(() => {
    if (!collectModal) return new Map<string, string>();
    return new Map(collectModal.groups.map((x) => [x.id, x.name]));
  }, [collectModal]);

  useEffect(() => {
    if (!collectModal || collectModal.loading) return;
    const f = collectGroupFilter.trim();
    const filtered = !f ? collectModal.list : collectModal.list.filter((c) => (c.group_id || "") === f);
    setCollectPickId((prev) => {
      if (prev && filtered.some((c) => c.id === prev)) return prev;
      if (filtered.length === 1) return filtered[0].id;
      return "";
    });
  }, [collectModal, collectGroupFilter]);

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
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    return sorted;
  }, [favoriteTagIds, recentTagIds, selectedCategory, tags]);
  /** 快捷视图：仅展示「当前筛选下全部匹配素材」上出现过的启用标签（全量聚合，非仅当前页） */
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
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.name.localeCompare(b.name, "zh-CN");
        });
        grouped.push({ category, tags: sorted });
      }
    }
    const rest = activeInView.filter((t) => !categoryOrder.includes(t.category as (typeof categoryOrder)[number]));
    if (rest.length > 0) {
      const sorted = [...rest];
      sorted.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      grouped.push({ category: "其他", tags: sorted });
    }
    return grouped;
  }, [tagPanelMode, tags, quickViewFacetTagIds, library]);
  const selectedMaterials = useMemo(
    () => items.filter((x) => selectedMaterialIds.includes(x.id)),
    [items, selectedMaterialIds]
  );
  const hasForeignSelection =
    !isAdminRole &&
    selectedMaterials.some((m) => (m.uploader || "") !== currentUsername);
  const hasForeignEditSelection =
    !canEditAll &&
    selectedMaterials.some((m) => (m.uploader || "") !== currentUsername);
  const canMoveSelectedToTrash =
    !!token &&
    canTrashRole &&
    selectedMaterialIds.length > 0 &&
    !busy &&
    !actionBusy &&
    !hasForeignSelection;
  const canMarkSelectedUnorganized =
    !!token &&
    canEditRole &&
    selectedMaterialIds.length > 0 &&
    !busy &&
    !actionBusy &&
    !hasForeignEditSelection;

  const authHeaders = useCallback(
    (headers: Record<string, string> = {}, lib: AssetLibraryCode = library): Record<string, string> => {
      const withLib = assetLibraryHeaders(headers, lib);
      return token ? { ...withLib, Authorization: `Bearer ${token}` } : withLib;
    },
    [library, token]
  );

  async function openCollectModal(mode: "personal" | "project") {
    if (!token || !canCollectionView || collectTargetMaterialIds.length === 0) return;
    setCollectModal({
      mode,
      groups: [],
      list: [],
      loading: true,
      materialIds: collectTargetMaterialIds,
    });
    setCollectGroupFilter("");
    setCollectPickId("");
    setCollectNote("");
    setCollectErr("");
    try {
      const base = new URLSearchParams();
      base.set("collection_type", mode);
      base.set("status", "active");
      base.set("page_size", "100");
      base.set("page", "1");
      if (mode === "project") base.set("for_item_edit", "true");
      const [gResp, cResp] = await Promise.all([
        fetch(`${apiBaseUrl}/collections/groups?group_type=${mode}`, { headers: authHeaders() }),
        fetch(`${apiBaseUrl}/collections?${base.toString()}`, { headers: authHeaders() }),
      ]);
      const gJson = (await gResp.json()) as { items?: CollectModalGroupNode[]; detail?: unknown };
      if (!gResp.ok) throw new Error(pretty(gJson));
      const gItems = Array.isArray(gJson.items) ? gJson.items : [];
      const groups = flattenCollectGroupNodes(gItems);

      const data = (await cResp.json()) as {
        items?: { id: string; name: string; group_id?: string | null }[];
        total?: number;
        detail?: unknown;
      };
      if (!cResp.ok) throw new Error(pretty(data));
      let list: CollectModalCollectionRow[] = Array.isArray(data.items)
        ? data.items.map((x) => ({
            id: x.id,
            name: x.name,
            group_id: x.group_id != null && String(x.group_id).trim() ? String(x.group_id) : null,
          }))
        : [];
      const total = typeof data.total === "number" ? data.total : list.length;
      if (total > list.length) {
        base.set("page", "2");
        const resp2 = await fetch(`${apiBaseUrl}/collections?${base.toString()}`, { headers: authHeaders() });
        const data2 = (await resp2.json()) as {
          items?: { id: string; name: string; group_id?: string | null }[];
          detail?: unknown;
        };
        if (resp2.ok && Array.isArray(data2.items)) {
          list = [
            ...list,
            ...data2.items.map((x) => ({
              id: x.id,
              name: x.name,
              group_id: x.group_id != null && String(x.group_id).trim() ? String(x.group_id) : null,
            })),
          ];
        }
      }
      setCollectModal((prev) => (prev ? { ...prev, groups, list, loading: false } : null));
    } catch (e) {
      setCollectModal((prev) => (prev ? { ...prev, groups: [], list: [], loading: false } : null));
      setCollectErr(e instanceof Error ? e.message : "加载分组或集合列表失败");
    }
  }

  async function submitCollectToCollection() {
    if (!collectPickId || !token || !collectModal || collectModal.materialIds.length === 0) return;
    setCollectBusy(true);
    setCollectErr("");
    let added = 0;
    let skipped = 0;
    const failures: string[] = [];
    try {
      for (const mid of collectModal.materialIds) {
        const mat = items.find((x) => x.id === mid);
        if (!mat) {
          failures.push(`${mid}（已不在当前列表）`);
          continue;
        }
        const d = detailMap[mat.id];
        const fileId = d?.files?.[0]?.id ?? mat.primary_file_id ?? null;
        const resp = await fetch(`${apiBaseUrl}/materials/${mat.id}/collect`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            collection_id: collectPickId,
            material_file_id: fileId,
            note: collectNote.trim() || null,
          }),
        });
        const data = (await resp.json()) as { status?: string; item_id?: string; detail?: unknown };
        if (!resp.ok) {
          failures.push(
            `${mid}: ${typeof data.detail === "string" ? data.detail : pretty(data)}`
          );
          continue;
        }
        if (data.status === "already_exists") skipped += 1;
        else added += 1;
      }
      setResult(
        pretty({
          收录汇总: { 目标条数: collectModal.materialIds.length, 新收录: added, 已在集合跳过: skipped, 失败: failures },
          collection_id: collectPickId,
        })
      );
      if (failures.length === collectModal.materialIds.length) {
        setCollectErr("全部失败，请查看操作日志区 JSON。");
      } else {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("lcp-tutorial-collect-done"));
        }
        setCollectModal(null);
      }
      if (added > 0) await queryMaterials(false);
    } catch (e) {
      setCollectErr(e instanceof Error ? e.message : "收录失败");
    } finally {
      setCollectBusy(false);
    }
  }

  function postDownloadClientReport(payload: {
    material_id: string;
    file_id: string;
    download_mode: "browser_default" | "choose_directory";
    transport_route: DownloadTransportRoute;
    success: boolean;
    file_size_bytes?: number | null;
    error_message?: string | null;
  }) {
    if (!token) return;
    void (async () => {
      try {
        await fetch(`${apiBaseUrl}/materials/download-client-report`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });
      } catch {
        // 非阻塞
      }
    })();
  }

  function selectedChips(): Array<{ key: string; label: string; onRemove: () => void }> {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (selectedQuickView !== "全部素材") {
      chips.push({ key: `quick-${selectedQuickView}`, label: selectedQuickView, onRemove: () => setSelectedQuickView("全部素材") });
    }
    chips.push({
      key: "tag-match-mode",
      label: tagMatchMode === "and" ? "条件: 并且/AND" : "条件: 或者/OR",
      onRemove: () => setTagMatchMode("and"),
    });
    if (keyword.trim()) {
      chips.push({ key: "keyword", label: `关键词:${keyword.trim()}`, onRemove: () => setKeyword("") });
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
      chips.push({ key: `tag-${id}`, label: tag?.name || id, onRemove: () => setSelectedTagIds((prev) => prev.filter((x) => x !== id)) });
    });
    return chips;
  }

  function syncQueryToUrl() {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (uploaderKeyword.trim()) params.set("uploader", uploaderKeyword.trim());
    if (selectedQuickView !== "全部素材") params.set("quick", selectedQuickView);
    if (tagPanelMode === "category" && selectedCategory !== MATERIAL_TAG_SIDEBAR_CATEGORIES[0]) params.set("category", selectedCategory);
    if (listFilterTagCategory) params.set("tag_category", listFilterTagCategory);
    selectedTagIds.forEach((tagId) => params.append("tag_ids_all", tagId));
    params.set("tag_match_mode", tagMatchMode);
    params.set("page", String(page));
    const qs = params.toString();
    router.replace(`/materials${qs ? `?${qs}` : ""}`);
  }

  async function loadTags() {
    const epoch = libraryEpochRef.current;
    const lib = library;
    try {
      const resp = await fetch(`${apiBaseUrl}/tags`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as (TagItem & { description?: string; sort_order?: unknown })[] | { detail?: unknown };
      if (epoch !== libraryEpochRef.current) return;
      if (!resp.ok) throw new Error(pretty(data));
      const categoryOrder = tagCategoriesForLibrary(lib);
      const rank = new Map(categoryOrder.map((c, i) => [c, i] as [string, number]));
      const rows = (data as TagItem[]).map((t) => ({
        ...t,
        description: typeof t.description === "string" ? t.description : "",
        sort_order:
          typeof t.sort_order === "number" && !Number.isNaN(t.sort_order)
            ? t.sort_order
            : Number(t.sort_order) || 0,
      }));
      rows.sort((a, b) => {
        const ra = rank.get(a.category) ?? 999;
        const rb = rank.get(b.category) ?? 999;
        if (ra !== rb) return ra - rb;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      setTags(rows);
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTags([]);
    }
  }

  async function loadTaxonomy() {
    const epoch = libraryEpochRef.current;
    const lib = library;
    if (lib !== "personal_video") {
      if (epoch === libraryEpochRef.current) setTaxonomyTree([]);
      return;
    }
    try {
      const resp = await fetch(`${apiBaseUrl}/libraries/${lib}/taxonomy`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as TaxonomyNode[] | { detail?: unknown };
      if (epoch !== libraryEpochRef.current) return;
      if (!resp.ok) throw new Error(pretty(data));
      setTaxonomyTree(Array.isArray(data) ? data : []);
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTaxonomyTree([]);
    }
  }

  async function loadTagPreferences(sessionToken: string) {
    const epoch = libraryEpochRef.current;
    const lib = library;
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/preferences`, {
        headers: assetLibraryHeaders({ Authorization: `Bearer ${sessionToken}` }, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as { favorite_tag_ids?: string[]; recent_tag_ids?: string[]; detail?: unknown };
      if (epoch !== libraryEpochRef.current) return;
      if (!resp.ok) throw new Error(pretty(data));
      setFavoriteTagIds(Array.isArray(data.favorite_tag_ids) ? data.favorite_tag_ids : []);
      setRecentTagIds(Array.isArray(data.recent_tag_ids) ? data.recent_tag_ids : []);
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFavoriteTagIds([]);
      setRecentTagIds([]);
    } finally {
      if (epoch === libraryEpochRef.current) setPrefsLoaded(true);
    }
  }

  async function saveTagPreferences(nextFavoriteTagIds: string[], nextRecentTagIds: string[]) {
    if (!token) return;
    await fetch(`${apiBaseUrl}/tags/preferences`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        favorite_tag_ids: nextFavoriteTagIds,
        recent_tag_ids: nextRecentTagIds,
      }),
    });
  }

  async function loadNasClientStatus() {
    if (!token) return;
    try {
      const resp = await fetch(`${apiBaseUrl}/nas-jobs/client-status`, { headers: authHeaders() });
      let data: unknown = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
      if (!resp.ok) {
        setNasStatus(nasStatusFetchFailed(resp.status, data));
        return;
      }
      setNasStatus(data as NasClientStatus);
    } catch {
      setNasStatus(nasStatusFetchFailed());
    }
  }

  function ensureNasReadyOrWarn(actionName: string): boolean {
    if (!nasStatus) return true;
    /** 下载可走 WAN/ECS，不应要求「本机一定能连 LAN + worker 同时满足」；蜂窝网用户常见 worker 判离线但仍可走公网或缓存 */
    if (actionName === "下载") {
      if (isNasTransferReady(nasStatus)) return true;
      setResult(
        `[下载提示] 未检测到 NAS 心跳/文件机注册（蜂窝网常见）。将仍尝试 WAN 与 ECS 缓存；若 ECS 准备超时，请在局域网启动 run-worker。`
      );
      return true;
    }
    if (isNasTransferReady(nasStatus)) return true;
    setResult(`[${actionName}已拦截]\n${nasStatus.message || "请联系管理员检查 NAS 客户端与局域网直传服务。"}`);
    return false;
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

  const fetchMaterialsPage = useCallback(
    async (targetPage: number): Promise<{ items: MaterialItem[]; total: number }> => {
      const lib = library;
      const params = buildMaterialListFilterParams();
      params.set("page", String(targetPage));
      params.set("page_size", String(pageSize));
      params.set("sort_by", "created_at");
      params.set("sort_order", "desc");
      const resp = await fetch(`${apiBaseUrl}/materials?${params.toString()}`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as MaterialsResponse | { detail?: unknown };
      if (lib !== libraryRef.current) {
        throw new DOMException("library switched", "AbortError");
      }
      if (!resp.ok) throw new Error(pretty(data));
      const typed = data as MaterialsResponse;
      return { items: typed.items, total: typed.total };
    },
    [apiBaseUrl, authHeaders, buildMaterialListFilterParams, library, pageSize]
  );

  useEffect(() => {
    if (!token || tagPanelMode !== "quick") {
      setQuickViewFacetTagIds([]);
      setQuickViewFacetLoading(false);
      return;
    }
    let cancelled = false;
    setQuickViewFacetLoading(true);
    const params = buildMaterialListFilterParams();
    const hdr: Record<string, string> = authHeaders();
    void (async () => {
      try {
        const resp = await fetch(`${apiBaseUrl}/materials/facet-tag-ids?${params.toString()}`, { headers: hdr });
        const data = (await resp.json()) as { tag_ids?: string[]; detail?: unknown };
        if (!resp.ok) {
          if (!cancelled) setQuickViewFacetTagIds([]);
          return;
        }
        const ids = Array.isArray(data.tag_ids) ? data.tag_ids.filter((x): x is string => typeof x === "string" && Boolean(x.trim())) : [];
        if (!cancelled) setQuickViewFacetTagIds(ids);
      } catch {
        if (!cancelled) setQuickViewFacetTagIds([]);
      } finally {
        if (!cancelled) setQuickViewFacetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, authHeaders, buildMaterialListFilterParams, library, tagPanelMode, token]);

  async function queryMaterials(recordRecentTags = false) {
    if (!token) return;
    const epoch = libraryEpochRef.current;
    setUiState("loading");
    setErrorMessage("");
    setSelectedMaterialIds([]);
    setSelectedMaterialId("");
    await resetAndLoad(fetchMaterialsPage);
    if (epoch !== libraryEpochRef.current) return;
    setUiState("success");
    setResult("[查询成功] 已加载前几页，向下滚动将继续加载。");
    if (recordRecentTags && selectedTagIds.length > 0) {
      const nextRecentTagIds = [...selectedTagIds, ...recentTagIds.filter((id) => !selectedTagIds.includes(id))].slice(0, 20);
      setRecentTagIds(nextRecentTagIds);
      void saveTagPreferences(favoriteTagIds, nextRecentTagIds);
    }
    syncQueryToUrl();
  }

  async function loadMaterialDetail(materialId: string) {
    if (!token) return;
    setActionBusy(true);
    try {
      const detailQuery = canEditAll ? "?include_all=true" : "";
      const resp = await fetch(`${apiBaseUrl}/materials/${materialId}${detailQuery}`, { headers: authHeaders() });
      const data = (await resp.json()) as MaterialDetailResponse | { detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      setDetailMap((prev) => ({ ...prev, [materialId]: data as MaterialDetailResponse }));
    } catch (error) {
      setResult(`[详情加载失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  function commitBrowserDefaultDownload(
    resolved: ResolvedMaterialDownload,
    options?: { openInNewTab?: boolean }
  ) {
    const totalSeconds = ((performance.now() - resolved.flowStartedAt) / 1000).toFixed(1);
    triggerBrowserDownload(resolved.absoluteUrl, { openInNewTab: options?.openInNewTab });
    postDownloadClientReport({
      material_id: resolved.materialId,
      file_id: resolved.fileId,
      download_mode: "browser_default",
      transport_route: resolved.transportRoute,
      success: true,
      file_size_bytes: null,
    });
    if (resolved.outcomeKind === "ecs_fallback") {
      setResult(
        `[下载完成]\n${pretty({
          mode: "ecs_fallback",
          download_url: resolved.absoluteUrl,
          expires_at: resolved.expiresAt,
          total_seconds: Number(totalSeconds),
          note: (resolved.ecsNote || "").trim(),
          transport_route: resolved.transportRoute,
        })}`
      );
    } else {
      const mode = resolved.outcomeKind === "wan_machine" ? "public-file-machine" : "lan-file-machine";
      setResult(
        `[下载完成]\n${pretty({
          mode,
          download_url: resolved.absoluteUrl,
          expires_at: resolved.expiresAt,
          total_seconds: Number(totalSeconds),
          recommended_order: resolved.recommendedOrder,
          transport_route: resolved.transportRoute,
        })}`
      );
    }
  }

  async function createDownloadLink(
    materialId: string,
    options?: {
      skipDrawerProgress?: boolean;
      skipActionBusy?: boolean;
      skipDownloadSaveChoiceModal?: boolean;
      /** 仅解析选路并返回结果，不弹窗、不触发浏览器下载（供批量写入目录等） */
      returnResolvedOnly?: boolean;
      /** 批量依次触发浏览器下载时传 false */
      browserDownloadOpenInNewTab?: boolean;
    }
  ): Promise<ResolvedMaterialDownload | void> {
    if (!ensureNasReadyOrWarn("下载")) return;
    if (!canDownloadSingle) {
      setResult("[下载失败]\n当前账号无下载权限");
      return;
    }
    if (!token) {
      setResult("[下载失败]\n请先登录后再下载");
      return;
    }
    const showDrawer = !options?.skipDrawerProgress;
    downloadPrepareAbortRef.current?.abort();
    const ac = new AbortController();
    downloadPrepareAbortRef.current = ac;
    const { signal } = ac;
    const downloadFlowStartedAt = performance.now();
    if (showDrawer) {
      cancelScheduledDrawerProgressClear();
      setDrawerOpProgress({
        kind: "download",
        done: 0,
        total: 1,
        detail: "准备下载任务…",
        fractionLabel: "启动",
        indeterminate: false,
        cancellable: true,
      });
    }
    const manageBusy = !options?.skipActionBusy;
    if (manageBusy) setActionBusy(true);
    try {
      // 下载仅需「可用」素材与 files[0]；include_all 会强制要求 asset.edit_all，普通成员会 403
      const detailResp = await fetch(`${apiBaseUrl}/materials/${materialId}`, { headers: authHeaders(), signal });
      const detailData = (await detailResp.json()) as MaterialDetailResponse | { detail?: unknown };
      if (!detailResp.ok) throw new Error(pretty(detailData));
      const firstFile = (detailData as MaterialDetailResponse).files?.[0];
      if (!firstFile) throw new Error("该素材没有可下载文件");
      if (showDrawer) {
        setDrawerOpProgress({
          kind: "download",
          done: 1,
          total: 4,
          detail: "已拉取素材详情，正在向 ECS 请求下载权限…",
          fractionLabel: "步骤 1/4",
          indeterminate: false,
          cancellable: true,
        });
      }

      const routeResp = await fetch(`${apiBaseUrl}/materials/${materialId}/files/${firstFile.id}/download-route`, {
        method: "POST",
        headers: authHeaders(),
        signal,
      });
      const routeJson = (await routeResp.json()) as MaterialDownloadRouteResponse | { detail?: unknown };
      if (!routeResp.ok) throw new Error(pretty(routeJson));
      const route = routeJson as MaterialDownloadRouteResponse;
      const ticket = route.ticket;

      const offerResolvedDownload = (resolved: ResolvedMaterialDownload) => {
        if (options?.returnResolvedOnly) {
          return resolved;
        }
        const totalSeconds = ((performance.now() - resolved.flowStartedAt) / 1000).toFixed(1);
        /** 移动端仍直接下载；桌面端始终弹窗（目录按钮仅在 HTTPS+Chromium 等支持时显示） */
        const skipModal = options?.skipDownloadSaveChoiceModal === true || isCoarseMobileDevice();

        if (showDrawer) {
          if (skipModal) {
            const detailMsg =
              resolved.outcomeKind === "ecs_fallback"
                ? `已通过 ECS 缓存兜底触发下载 · 约 ${totalSeconds}s`
                : `已通过${resolved.directLabel || ""}文件机直连触发下载 · 约 ${totalSeconds}s`;
            setDrawerOpProgress({
              kind: "download",
              done: 4,
              total: 4,
              detail: detailMsg,
              fractionLabel: "完成",
              indeterminate: false,
              cancellable: false,
            });
            scheduleClearDrawerProgress(2000);
          } else {
            setDrawerOpProgress({
              kind: "download",
              done: 4,
              total: 4,
              detail: "选路完成，请选择保存方式（见页面中央弹窗）",
              fractionLabel: "完成",
              indeterminate: false,
              cancellable: false,
            });
            scheduleClearDrawerProgress(4000);
          }
        }
        if (skipModal) {
          commitBrowserDefaultDownload(resolved, {
            openInNewTab: options?.browserDownloadOpenInNewTab,
          });
        } else {
          setDownloadSaveChoice({ ...resolved, allowDirectoryPick: supportsMaterialDirectorySave() });
          setResult("[下载] 已准备好链接，请在弹窗中选择保存方式。");
        }
        return undefined;
      };

      const tryResolveDirect = async (
        label: string,
        base: string | null,
        transportRoute: DownloadTransportRoute,
        outcomeKind: "lan_machine" | "wan_machine"
      ): Promise<ResolvedMaterialDownload | null> => {
        if (!base) return null;
        /** HTTPS 页面对 `http://` 文件机 `fetch /health` 属混合内容，避免无效探测 */
        if (isInsecureHttpFromSecurePage(base)) return null;
        const directUrl = buildTicketDownloadUrl(base, ticket);
        if (label.includes("公网") && isInsecureHttpFromSecurePage(directUrl)) {
          return null;
        }
        const probeMs = label.includes("公网") ? FILE_MACHINE_PROBE_WAN_MS : FILE_MACHINE_PROBE_LAN_MS;
        if (showDrawer) {
          setDrawerOpProgress({
            kind: "download",
            done: 2,
            total: 4,
            detail: `探测 ${label} 文件机 /health（${probeMs}ms）…`,
            fractionLabel: "步骤 2/4",
            indeterminate: true,
            cancellable: true,
          });
        }
        const ok = await probeFileMachineHealth(base, signal, probeMs);
        if (!ok || signal.aborted) return null;
        return {
          absoluteUrl: directUrl,
          transportRoute,
          filename: firstFile.original_filename || "download.bin",
          materialId,
          fileId: firstFile.id,
          expiresAt: route.expires_at || "",
          recommendedOrder: route.recommended_order,
          flowStartedAt: downloadFlowStartedAt,
          outcomeKind,
          directLabel: label,
        };
      };

      const lanBases = collectLanDownloadBases(route);
      for (const [idx, base] of lanBases.entries()) {
        const label = lanBases.length > 1 ? `局域网(${idx + 1}/${lanBases.length})` : "局域网";
        const directLan = await tryResolveDirect(label, base, "lan_direct", "lan_machine");
        if (directLan) {
          const maybe = offerResolvedDownload(directLan);
          if (options?.returnResolvedOnly) return maybe;
          return;
        }
      }
      const directWan = await tryResolveDirect("公网", route.public_download_base_url, "wan_direct", "wan_machine");
      if (directWan) {
        const maybe = offerResolvedDownload(directWan);
        if (options?.returnResolvedOnly) return maybe;
        return;
      }

      const hasLan = lanBases.length > 0;
      const hasPub = !!(route.public_download_base_url && String(route.public_download_base_url).trim());
      const routeHint =
        !hasLan && !hasPub
          ? "ECS 未返回文件机基址（请检查 nas_file_service_nodes 或 LAN_/PUBLIC_DOWNLOAD_BASE_URL）。"
          : hasLan && !hasPub
            ? "外网可能无法访问局域网文件机；建议配置 DEPLOY_PUBLIC_DOWNLOAD_BASE_URL。"
            : "文件机 /health 不可达或直连未触发。";

      if (showDrawer) {
        setDrawerOpProgress({
          kind: "download",
          done: 2,
          total: 4,
          detail: `文件机不可用，${routeHint} 正在走 ECS 缓存兜底…`,
          fractionLabel: "步骤 3/4",
          indeterminate: true,
          cancellable: true,
        });
      }
      const fallbackUrl = await pollEcsDownloadCacheFallback(
        apiBaseUrl,
        materialId,
        firstFile.id,
        () => authHeaders(),
        signal,
        (detail) => {
          if (showDrawer) {
            setDrawerOpProgress((prev) =>
              prev && prev.kind === "download"
                ? { ...prev, detail, fractionLabel: "步骤 3/4", indeterminate: true, cancellable: true }
                : prev
            );
          }
        }
      );
      const fallbackResolved: ResolvedMaterialDownload = {
        absoluteUrl: fallbackUrl,
        transportRoute: "ecs_fallback",
        filename: firstFile.original_filename || "download.bin",
        materialId,
        fileId: firstFile.id,
        expiresAt: route.expires_at || "",
        recommendedOrder: route.recommended_order,
        flowStartedAt: downloadFlowStartedAt,
        outcomeKind: "ecs_fallback",
        ecsNote: routeHint,
      };
      const maybeFb = offerResolvedDownload(fallbackResolved);
      if (options?.returnResolvedOnly) return maybeFb;
    } catch (error) {
      const isAbort =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message)));
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = isAbort ? "用户已取消下载" : rawMsg;
      if (showDrawer) {
        setDrawerOpProgress((prev) =>
          prev && prev.kind === "download"
            ? {
                ...prev,
                detail: isAbort || msg.includes("已取消") ? `已取消（${msg}）` : `失败：${msg}`,
                fractionLabel: isAbort || msg.includes("已取消") ? "已取消" : "已中断",
                indeterminate: false,
                cancellable: false,
              }
            : {
                kind: "download",
                done: 0,
                total: 1,
                detail: isAbort || msg.includes("已取消") ? `已取消（${msg}）` : `失败：${msg}`,
                fractionLabel: isAbort || msg.includes("已取消") ? "已取消" : "已中断",
                indeterminate: false,
                cancellable: false,
              }
        );
        scheduleClearDrawerProgress(4500);
      }
      setResult(isAbort || msg.includes("已取消") ? `[下载已取消]\n${msg}` : `[下载失败]\n${msg}`);
    } finally {
      if (manageBusy) setActionBusy(false);
      downloadPrepareAbortRef.current = null;
    }
  }

  const ensureCardThumbnails = useCallback(async () => {
    if (!token || !canViewAsset) return;
    const candidates = items.filter((item) => {
      const ext = getMaterialExtension(item);
      return (previewImageExts.has(ext) || previewVideoExts.has(ext)) && !!item.primary_file_id;
    });
    const pending = candidates.filter((item) => !thumbnailUrlMap[item.id] && !thumbnailRequestedRef.current.has(item.id));
    if (pending.length === 0) return;

    await Promise.allSettled(
      pending.map(async (item) => {
        thumbnailRequestedRef.current.add(item.id);
        try {
          const resp = await fetch(`${apiBaseUrl}/materials/${item.id}/files/${item.primary_file_id}/thumbnail-url`, {
            headers: authHeaders(thumbnailAccessContextHeaders()),
          });
          const data = (await resp.json()) as ThumbnailUrlResponse | { detail?: unknown };
          if (!resp.ok) throw new Error(pretty(data));
          const absUrl = await resolveDirectMediaUrl(apiBaseUrl, data as ThumbnailUrlResponse);
          const url = absUrl ? `${absUrl}${absUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}` : "";
          if (url) {
            setThumbnailUrlMap((prev) => ({ ...prev, [item.id]: url }));
          } else {
            thumbnailRequestedRef.current.delete(item.id);
          }
        } catch {
          // 缩略图拿不到时保持图标兜底
          thumbnailRequestedRef.current.delete(item.id);
        }
      })
    );
    if (pending.length > 0) {
      window.setTimeout(() => setThumbnailRetryTick((v) => v + 1), 1500);
    }
  }, [apiBaseUrl, authHeaders, canViewAsset, getMaterialExtension, items, thumbnailUrlMap, token]);

  async function viewSyncDeadletters() {
    if (!token || currentRole !== "super_admin") {
      setResult("[同步异常查询失败]\n需要管理员权限");
      return;
    }
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/nas-jobs/sync/deadletters?status_filter=sync_deadletter&limit=20`, {
        headers: authHeaders(),
      });
      const data = (await resp.json()) as SyncDeadletterResponse | { detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      const typed = data as SyncDeadletterResponse;
      setResult(
        `[同步异常列表]\n${pretty({
          total: typed.total,
          items: typed.items.map((x) => ({
            operation_id: x.operation_id,
            operation_type: x.operation_type,
            target_id: x.target_id,
            retry_count: x.retry_count,
            error: x.last_error,
          })),
        })}`
      );
    } catch (error) {
      setResult(`[同步异常查询失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function batchDownloadSelected() {
    if (!canBatchDownload) {
      setResult("[批量下载失败]\n当前账号无批量下载权限");
      return;
    }
    if (selectedMaterialIds.length < 2) {
      setResult("[批量下载] 请至少勾选 2 个素材");
      return;
    }
    const n = selectedMaterialIds.length;
    cancelScheduledDrawerProgressClear();
    setDrawerOpProgress({ kind: "batch_download", done: 0, total: n, detail: "准备批量下载…" });
    setActionBusy(true);

    let dirHandle: FileSystemDirectoryHandle | null = null;
    const canPickDir = supportsMaterialDirectorySave();
    if (canPickDir) {
      /** 批量仅复用 IndexedDB 中上次「选择目录保存」的文件夹，不再弹 showDirectoryPicker */
      dirHandle = await tryReuseSavedMaterialDownloadDirectory();
      if (!dirHandle) {
        setActionBusy(false);
        setDrawerOpProgress(null);
        setResult(
          "[批量下载失败]\n尚未记录保存目录。请先在右侧预览对任意素材使用一次「选择本地目录保存」，再批量下载。"
        );
        return;
      }
    } else {
      const cont = window.confirm(
        "当前环境无法使用「选择文件夹」批量保存；浏览器逐个下载在批量异步流程中通常只能成功第一个。是否仍继续？"
      );
      if (!cont) {
        setActionBusy(false);
        setDrawerOpProgress(null);
        return;
      }
    }

    try {
      for (let i = 0; i < n; i += 1) {
        const materialId = selectedMaterialIds[i];
        if (i > 0 && !dirHandle) {
          await new Promise((r) => setTimeout(r, 1500));
        }
        setDrawerOpProgress({
          kind: "batch_download",
          done: i,
          total: n,
          detail: dirHandle
            ? `正在写入第 ${i + 1}/${n} 个到上次保存目录…`
            : `正在处理第 ${i + 1}/${n} 个（与单条下载相同：LAN/WAN→ECS 兜底）`,
        });

        if (dirHandle) {
          if (!ensureNasReadyOrWarn("下载")) throw new Error("NAS 未就绪");
          if (!canDownloadSingle || !token) throw new Error("无下载权限或未登录");
          const resolved = await createDownloadLink(materialId, {
            skipDrawerProgress: true,
            skipActionBusy: true,
            skipDownloadSaveChoiceModal: true,
            returnResolvedOnly: true,
          });
          if (!resolved) throw new Error("未能解析下载地址");
          const { bytes } = await streamUrlToDirectoryWithProgress(
            resolved.absoluteUrl,
            resolved.filename,
            undefined,
            (received, total) => {
              setDrawerOpProgress({
                kind: "batch_download",
                done: i,
                total: n,
                detail: `第 ${i + 1}/${n} 个：${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""}`,
              });
            },
            dirHandle
          );
          postDownloadClientReport({
            material_id: resolved.materialId,
            file_id: resolved.fileId,
            download_mode: "choose_directory",
            transport_route: resolved.transportRoute,
            success: true,
            file_size_bytes: bytes,
          });
        } else {
          // eslint-disable-next-line no-await-in-loop
          await createDownloadLink(materialId, {
            skipDrawerProgress: true,
            skipActionBusy: true,
            skipDownloadSaveChoiceModal: true,
            browserDownloadOpenInNewTab: false,
          });
        }
      }
      setDrawerOpProgress({ kind: "batch_download", done: n, total: n, detail: "全部完成" });
      scheduleClearDrawerProgress(2200);
      if (dirHandle) void persistMaterialSaveDirectoryHandle(dirHandle);
      setResult(
        `[批量下载完成] 已依次处理 ${n} 个素材。${dirHandle ? "（已写入上次保存目录）" : "（浏览器默认下载：若缺少文件，请先用「选择本地目录保存」记录目录后再批量）"}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setDrawerOpProgress((prev) =>
        prev && prev.kind === "batch_download"
          ? { ...prev, detail: `已中断：${msg}` }
          : { kind: "batch_download", done: 0, total: n, detail: `失败：${msg}` }
      );
      scheduleClearDrawerProgress(5000);
      setResult(`[批量下载失败]\n${msg}`);
    } finally {
      setActionBusy(false);
    }
  }

  function toggleMaterialSelection(materialId: string) {
    setSelectedMaterialIds((prev) => (prev.includes(materialId) ? prev.filter((x) => x !== materialId) : [...prev, materialId]));
    setSelectedMaterialId(materialId);
  }

  const canEditMaterialInGrid = useCallback(
    (item: MaterialItem) => canEditRole && (canEditAll || (item.uploader || "") === currentUsername),
    [canEditAll, canEditRole, currentUsername]
  );

  async function saveMaterialTitleFromCard(item: MaterialItem, rawTitle: string) {
    const t = rawTitle.trim();
    if (!t) {
      setResult("[展示名] 不能为空");
      return;
    }
    const { title: nextTitle, primary_original_filename: nextOrig } = displayInputToTitleAndPrimaryFilename(
      item,
      rawTitle,
      getMaterialExtension
    );
    const previewItem: MaterialItem = { ...item, title: nextTitle, original_filename: nextOrig };
    if (getMaterialDisplayName(previewItem) === getMaterialDisplayName(item)) {
      setCardTitleEditId(null);
      return;
    }
    if (!token) return;
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/${item.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, primary_original_filename: nextOrig }),
      });
      const data = (await resp.json()) as { detail?: unknown; title?: string; original_filename?: string | null };
      if (!resp.ok) throw new Error(pretty(data));
      const savedTitle = typeof data.title === "string" ? data.title : nextTitle;
      const savedOrig =
        typeof data.original_filename === "string" && data.original_filename.trim() ? data.original_filename.trim() : nextOrig;
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, title: savedTitle, original_filename: savedOrig } : x))
      );
      setDetailMap((dm) => {
        const cur = dm[item.id];
        if (!cur) return dm;
        const f0 = cur.files?.[0];
        const nextFiles =
          f0 && cur.files
            ? [{ ...f0, original_filename: savedOrig }, ...cur.files.slice(1)]
            : cur.files;
        return { ...dm, [item.id]: { ...cur, title: savedTitle, original_filename: savedOrig, files: nextFiles } };
      });
      setCardTitleEditId(null);
      setResult("[展示名已保存]（已同步素材标题与主文件原始文件名）");
    } catch (error) {
      setResult(`[展示名保存失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function saveMaterialTagsFromCard(materialId: string, tagIds: string[]) {
    if (!token) return;
    const prevIds = items.find((x) => x.id === materialId)?.tag_ids ?? [];
    const norm = (a: string[]) => [...a].sort().join("\u0001");
    if (norm(prevIds) === norm(tagIds)) {
      setCardTagsEditId(null);
      return;
    }
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/${materialId}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids: tagIds }),
      });
      const data = (await resp.json()) as { detail?: unknown; tag_ids?: string[] };
      if (!resp.ok) throw new Error(pretty(data));
      const next = Array.isArray(data.tag_ids) ? data.tag_ids : tagIds;
      setItems((prev) => prev.map((x) => (x.id === materialId ? { ...x, tag_ids: next } : x)));
      setDetailMap((dm) => {
        const cur = dm[materialId];
        if (!cur) return dm;
        return { ...dm, [materialId]: { ...cur, tag_ids: next } };
      });
      mergeTagSlashRecentStorage(tagIds);
      setCardTagsEditId(null);
      setResult("[标签已保存]");
    } catch (error) {
      setResult(`[标签保存失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (cardTitleEditId) setCardTitleEditId(null);
      if (cardTagsEditId) setCardTagsEditId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardTitleEditId, cardTagsEditId]);

  async function moveSelectedToTrash() {
    if (!ensureNasReadyOrWarn("移入回收站")) return;
    if (!token || !canTrashRole) {
      setResult("[移入回收站失败]\n当前账号无删除权限");
      return;
    }
    if (selectedMaterialIds.length === 0) {
      setResult("[移入回收站] 请先勾选素材");
      return;
    }
    if (hasForeignSelection) {
      setResult("[移入回收站失败]\n普通成员只能移入自己上传的素材。请取消勾选他人素材后重试。");
      return;
    }
    const n = selectedMaterialIds.length;
    cancelScheduledDrawerProgressClear();
    setDrawerOpProgress({ kind: "trash", done: 0, total: n, detail: "正在移入回收站…" });
    setActionBusy(true);
    try {
      for (let i = 0; i < n; i += 1) {
        const materialId = selectedMaterialIds[i];
        setDrawerOpProgress({ kind: "trash", done: i, total: n, detail: `第 ${i + 1}/${n} 条` });
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetch(`${apiBaseUrl}/materials/${materialId}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = (await resp.json()) as { detail?: unknown };
        if (!resp.ok) throw new Error(pretty(data));
      }
      setDrawerOpProgress({ kind: "trash", done: n, total: n, detail: "全部完成" });
      scheduleClearDrawerProgress(2000);
      setResult(`[移入回收站成功] 已处理 ${n} 条素材。`);
      setSelectedMaterialIds([]);
      await queryMaterials(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setDrawerOpProgress((prev) =>
        prev && prev.kind === "trash" ? { ...prev, detail: `已中断：${msg}` } : { kind: "trash", done: 0, total: n, detail: `失败：${msg}` }
      );
      scheduleClearDrawerProgress(5000);
      setResult(`[移入回收站失败]\n${msg}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function markSelectedAsUnorganized() {
    if (!canEditRole) {
      setResult("[加入未整理失败]\n当前账号无素材编辑权限");
      return;
    }
    if (selectedMaterialIds.length === 0) {
      setResult("[加入未整理] 请先勾选素材");
      return;
    }
    if (hasForeignEditSelection) {
      setResult("[加入未整理失败]\n当前账号仅可编辑自己上传的素材。请取消勾选他人素材后重试。");
      return;
    }
    const count = selectedMaterialIds.length;
    cancelScheduledDrawerProgressClear();
    setDrawerOpProgress({ kind: "unorganized", done: 0, total: 2, detail: `将提交 ${count} 条素材…` });
    setActionBusy(true);
    try {
      setDrawerOpProgress({ kind: "unorganized", done: 1, total: 2, detail: "请求处理中…" });
      const resp = await fetch(`${apiBaseUrl}/materials/batch-mark-unorganized`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ asset_ids: selectedMaterialIds }),
      });
      const data = (await resp.json()) as { success_count?: number; failed_count?: number; failed_items?: unknown; detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      setDrawerOpProgress({ kind: "unorganized", done: 2, total: 2, detail: "完成，即将跳转未整理页" });
      scheduleClearDrawerProgress(2000);
      setResult(
        `[加入未整理完成]\n` +
          `仅添加“未整理”标签，不会移除原有标签。\n` +
          `${pretty({
            success_count: data.success_count || 0,
            failed_count: data.failed_count || 0,
            failed_items: data.failed_items || [],
          })}`
      );
      await queryMaterials(false);
      router.push("/unorganized");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setDrawerOpProgress((prev) =>
        prev && prev.kind === "unorganized"
          ? { ...prev, detail: `失败：${msg}` }
          : { kind: "unorganized", done: 0, total: 2, detail: `失败：${msg}` }
      );
      scheduleClearDrawerProgress(5000);
      setResult(`[加入未整理失败]\n${msg}`);
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setCurrentRole(session.role);
      setCurrentUsername(session.username);
      setPermissions(session.permissions || []);
    }
  }, []);

  useEffect(() => {
    invalidateInFlight();
    listAbortRef.current?.abort();
    listAbortRef.current = new AbortController();
    libraryEpochRef.current += 1;
    thumbnailRequestedRef.current.clear();
    setUiState(token ? "loading" : "idle");
    void loadTags();
    void loadTaxonomy();
    if (token) void loadTagPreferences(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, library, token]);

  useEffect(() => {
    if (!token) return;
    void queryMaterials(false);
    void loadNasClientStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedQuickView, library, selectedPrimaryTaxonomyId, selectedSecondaryTaxonomyId]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      void loadNasClientStatus();
    }, 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    bindLoadNext(() => loadNext(fetchMaterialsPage));
  }, [bindLoadNext, fetchMaterialsPage, loadNext]);

  useEffect(() => {
    return () => {
      if (drawerProgressClearRef.current) {
        clearTimeout(drawerProgressClearRef.current);
      }
    };
  }, []);

  const selectedListThumb = useMemo(() => {
    if (!selectedMaterialId) return "";
    return items.find((x) => x.id === selectedMaterialId)?.preview_thumbnail_path || "";
  }, [items, selectedMaterialId]);

  useEffect(() => {
    if (!selectedMaterialId || !token) return;
    void loadMaterialDetail(selectedMaterialId);
  }, [selectedMaterialId, token, selectedListThumb]);

  /** 集合页「在素材库打开」写入的素材 id，首屏列表加载成功后定位详情 */
  useEffect(() => {
    if (typeof window === "undefined" || !token || !prefsLoaded || uiState !== "success") return;
    const raw = window.sessionStorage.getItem("lcp_collections_focus_material")?.trim();
    if (!raw) return;
    window.sessionStorage.removeItem("lcp_collections_focus_material");
    void (async () => {
      await loadMaterialDetail(raw);
      setSelectedMaterialId(raw);
    })();
    // loadMaterialDetail 为页面内函数，仅在此 effect 消费一次 sessionStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, prefsLoaded, uiState]);

  useEffect(() => {
    void ensureCardThumbnails();
  }, [ensureCardThumbnails, thumbnailRetryTick]);

  useEffect(() => {
    if (!pageError) return;
    setUiState("error");
    setErrorMessage(pageError);
    setResult(`[查询失败]\n${pageError}`);
  }, [pageError]);

  const chips = selectedChips();

  const keywordSlashQuery = useMemo(() => {
    const i = keyword.lastIndexOf("/");
    if (i < 0) return null;
    return keyword.slice(i + 1);
  }, [keyword]);

  /** `/` 后无字：仅「最近用于查询素材」；有字：在全部活跃标签中按名称子串匹配（与打标页 `/` 逻辑一致，排除名称「未整理」） */
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

  const selectedItem = items.find((x) => x.id === selectedMaterialId) || null;
  /** 单条下载：优先当前预览选中行；否则用首个勾选行 */
  const singleDownloadMaterialId = useMemo(() => {
    if (selectedMaterialId && items.some((i) => i.id === selectedMaterialId)) return selectedMaterialId;
    return selectedMaterialIds[0] || "";
  }, [items, selectedMaterialId, selectedMaterialIds]);

  const drawerPreviewMode = useMemo((): MaterialFilePreviewMode => {
    if (!selectedItem) return "generic";
    const ext = getMaterialExtension(selectedItem);
    if (!ext) return "generic";
    if (previewImageExts.has(ext)) return "image";
    if (previewVideoExts.has(ext)) return "video";
    return "generic";
  }, [selectedItem, getMaterialExtension]);
  const drawerStreamResolveEnabled =
    (drawerPreviewMode === "image" || drawerPreviewMode === "video") &&
    canDownloadSingle &&
    !!token.trim() &&
    !!selectedItem?.primary_file_id &&
    selectedItem?.status === "available";
  const drawerPreviewResolveEnabled =
    drawerPreviewMode === "video" &&
    canViewAsset &&
    !!token.trim() &&
    !!selectedItem?.primary_file_id;
  const drawerStream = useMaterialFileStreamUrl({
    apiBaseUrl,
    materialId: selectedItem?.id,
    fileId: selectedItem?.primary_file_id,
    filename: selectedItem ? getMaterialDisplayName(selectedItem) : "preview.bin",
    enabled: drawerStreamResolveEnabled,
    token,
  });
  const drawerPreviewVideo = useMaterialPreviewVideoUrl({
    apiBaseUrl,
    materialId: selectedItem?.id,
    fileId: selectedItem?.primary_file_id,
    enabled: drawerPreviewResolveEnabled,
    token,
  });

  const selectedItemDetail = selectedMaterialId ? detailMap[selectedMaterialId] : undefined;
  const drawerResolutionLabel = useMemo(() => {
    if (!selectedItem) return null;
    const ext = getMaterialExtension(selectedItem);
    const f0 = selectedItemDetail?.files?.[0];
    const meta = f0?.extra_metadata;
    const w = coalescePositiveInt(
      selectedItem.primary_media_width,
      selectedItemDetail?.primary_media_width,
      meta && typeof meta === "object" ? (meta as { media_width?: unknown }).media_width : undefined
    );
    const h = coalescePositiveInt(
      selectedItem.primary_media_height,
      selectedItemDetail?.primary_media_height,
      meta && typeof meta === "object" ? (meta as { media_height?: unknown }).media_height : undefined
    );
    return formatResolutionForExtension(ext, w, h);
  }, [selectedItem, selectedItemDetail, getMaterialExtension]);

  const drawerDescriptionText = useMemo(() => {
    const raw = (selectedItemDetail?.description ?? selectedItem?.description ?? "").trim();
    return raw || null;
  }, [selectedItem, selectedItemDetail]);

  /** 预览侧栏：切换当前预览素材时自动拉取使用记录（后端 `limit` 最大 200） */
  useEffect(() => {
    if (!selectedMaterialId) {
      setSelectedItemUsages([]);
      return;
    }
    if (!token || !canViewUsages) {
      setSelectedItemUsages([]);
      return;
    }
    const id = selectedMaterialId;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(`${apiBaseUrl}/materials/${id}/usages?limit=200`, { headers: authHeaders() });
        const data = (await resp.json()) as MaterialUsageListResponse | { detail?: unknown };
        if (!resp.ok) throw new Error(pretty(data));
        if (cancelled) return;
        const typed = data as MaterialUsageListResponse;
        setSelectedItemUsages(typed.items || []);
      } catch (error) {
        if (!cancelled) {
          setSelectedItemUsages([]);
          setResult(`[使用记录加载失败]\n${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- authHeaders 依赖 token，与 token 同步即可
  }, [selectedMaterialId, token, canViewUsages, apiBaseUrl]);

  const multiDrawerDownload = selectedMaterialIds.length >= 2;
  const drawerDownloadDisabled =
    busy ||
    actionBusy ||
    !token ||
    (multiDrawerDownload ? !canBatchDownload : !canDownloadSingle || !singleDownloadMaterialId);

  const savePreviewOriginalToDirectory = useCallback(async () => {
    if (!singleDownloadMaterialId || !canDownloadSingle || !token.trim()) {
      gridMarquee.setToolbarMessage({ tone: "warn", text: "请先选择可下载的素材并确保已登录。" });
      return;
    }
    if (!supportsMaterialDirectorySave()) {
      gridMarquee.setToolbarMessage({
        tone: "warn",
        text: "当前浏览器或访问方式不支持选择目录（需 HTTPS 下的桌面 Chrome / Edge 等）。",
      });
      return;
    }
    if (!ensureNasReadyOrWarn("下载")) return;
    setActionBusy(true);
    gridMarquee.setToolbarMessage(null);
    try {
      let dir: FileSystemDirectoryHandle | null = await tryReuseSavedMaterialDownloadDirectory();
      if (!dir) {
        const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
        if (!w.showDirectoryPicker) throw new Error("当前浏览器不支持选择目录");
        try {
          dir = await w.showDirectoryPicker();
        } catch (err) {
          const cancel =
            err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError");
          if (cancel) {
            gridMarquee.setToolbarMessage({ tone: "warn", text: "已取消选择目录。" });
            return;
          }
          throw err;
        }
      }
      const resolved = await createDownloadLink(singleDownloadMaterialId, {
        skipDrawerProgress: true,
        skipActionBusy: true,
        skipDownloadSaveChoiceModal: true,
        returnResolvedOnly: true,
      });
      if (!resolved) return;
      cancelScheduledDrawerProgressClear();
      setDrawerOpProgress({
        kind: "download",
        done: 0,
        total: 100,
        detail: "正在写入所选文件夹…",
        fractionLabel: "…",
        indeterminate: true,
        cancellable: false,
      });
      const { bytes, dirHandle: usedDir } = await streamUrlToDirectoryWithProgress(
        resolved.absoluteUrl,
        resolved.filename,
        undefined,
        (received, total) => {
          setDrawerOpProgress({
            kind: "download",
            done: total ? Math.min(99, Math.floor((received / total) * 100)) : 0,
            total: 100,
            detail: `${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""}`,
            fractionLabel: total ? `${Math.min(99, Math.floor((received / total) * 100))}%` : "…",
            indeterminate: !total,
            cancellable: false,
          });
        },
        dir
      );
      await persistMaterialSaveDirectoryHandle(usedDir);
      postDownloadClientReport({
        material_id: resolved.materialId,
        file_id: resolved.fileId,
        download_mode: "choose_directory",
        transport_route: resolved.transportRoute,
        success: true,
        file_size_bytes: bytes,
      });
      gridMarquee.setToolbarMessage({ tone: "ok", text: "已保存 1 个文件到所选目录。" });
      setDrawerOpProgress({
        kind: "download",
        done: 100,
        total: 100,
        detail: "已写入所选文件夹",
        fractionLabel: "完成",
        indeterminate: false,
        cancellable: false,
      });
      scheduleClearDrawerProgress(2200);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      gridMarquee.setToolbarMessage({ tone: "warn", text: `保存失败：${raw}` });
      setDrawerOpProgress({
        kind: "download",
        done: 0,
        total: 1,
        detail: `失败：${raw}`,
        fractionLabel: "已中断",
        indeterminate: false,
        cancellable: false,
      });
      scheduleClearDrawerProgress(5000);
    } finally {
      setActionBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createDownloadLink / ensureNasReadyOrWarn 为页内稳定闭包
  }, [singleDownloadMaterialId, canDownloadSingle, token]);

  function onDrawerDownloadClick() {
    if (multiDrawerDownload) {
      void batchDownloadSelected();
      return;
    }
    if (singleDownloadMaterialId) void createDownloadLink(singleDownloadMaterialId);
  }

  return (
    <main className="mx-auto w-full min-w-0 px-4 py-8 sm:px-6 2xl:px-8">
      {tutorialParam === "collections" ? (
        <p
          data-tour="materials-step-goto-collections"
          className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-center text-[11px] leading-snug text-sky-100"
        >
          收录成功后，在引导浮层点击「下一步」将返回<strong className="font-medium text-white">素材集合</strong>继续第三步。
        </p>
      ) : null}
      {downloadSaveChoice ? (
        <div
          className="fixed inset-0 z-[20000] flex items-center justify-center bg-slate-900/55 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-save-choice-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="download-save-choice-title" className="text-base font-semibold text-slate-900">
              选择保存方式
            </h2>
            <p className="mt-2 break-all text-sm text-slate-600 [overflow-wrap:anywhere]">
              文件名：<span className="font-medium text-slate-800">{downloadSaveChoice.filename}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              传输路径：
              {downloadSaveChoice.transportRoute === "lan_direct"
                ? "局域网直连"
                : downloadSaveChoice.transportRoute === "wan_direct"
                  ? "公网直连"
                  : "ECS 缓存兜底"}
            </p>
            {downloadSaveChoice.allowDirectoryPick ? null : (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 [overflow-wrap:anywhere]">
                当前页是 <strong className="font-semibold">http://</strong> 且主机不是 <strong className="font-semibold">localhost</strong>
                时，浏览器视为<strong className="font-semibold">非安全上下文</strong>，不会开放「选择本地目录」API（与是否有域名无关；仅有 IP 也一样）。
                需要该能力时请改为 <strong className="font-semibold">HTTPS</strong>（建议绑定域名 + 证书），或通过本机{" "}
                <strong className="font-semibold">localhost</strong> / 隧道访问同一前端。此处仍可使用「浏览器默认下载」。
              </p>
            )}
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className={btnPrimary + " w-full justify-center"}
                onClick={() => {
                  const r = downloadSaveChoice;
                  if (!r) return;
                  setDownloadSaveChoice(null);
                  commitBrowserDefaultDownload(r);
                }}
              >
                浏览器默认下载
              </button>
              {downloadSaveChoice.allowDirectoryPick ? (
              <button
                type="button"
                className={btnSecondary + " w-full justify-center border-sky-300 text-sky-900 hover:bg-sky-50"}
                onClick={() => {
                  const r = downloadSaveChoice;
                  if (!r) return;
                  setDownloadSaveChoice(null);
                  cancelScheduledDrawerProgressClear();
                  setActionBusy(true);
                  setDrawerOpProgress({
                    kind: "download",
                    done: 0,
                    total: 100,
                    detail: "请选择文件夹后，将开始拉取并写入…",
                    fractionLabel: "等待",
                    indeterminate: true,
                    cancellable: false,
                  });
                  void (async () => {
                    try {
                      const { bytes, dirHandle: dirWritten } = await streamUrlToDirectoryWithProgress(
                        r.absoluteUrl,
                        r.filename,
                        undefined,
                        (received, total) => {
                          setDrawerOpProgress({
                            kind: "download",
                            done: total ? Math.min(99, Math.floor((received / total) * 100)) : 0,
                            total: 100,
                            detail: `${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""}`,
                            fractionLabel: total ? `${Math.min(99, Math.floor((received / total) * 100))}%` : "…",
                            indeterminate: !total,
                            cancellable: false,
                          });
                        }
                      );
                      void persistMaterialSaveDirectoryHandle(dirWritten);
                      postDownloadClientReport({
                        material_id: r.materialId,
                        file_id: r.fileId,
                        download_mode: "choose_directory",
                        transport_route: r.transportRoute,
                        success: true,
                        file_size_bytes: bytes,
                      });
                      const totalSeconds = ((performance.now() - r.flowStartedAt) / 1000).toFixed(1);
                      setResult(
                        `[下载完成]\n${pretty({
                          mode: "choose_directory",
                          download_url: r.absoluteUrl,
                          bytes_written: bytes,
                          total_seconds: Number(totalSeconds),
                          transport_route: r.transportRoute,
                        })}`
                      );
                      setDrawerOpProgress({
                        kind: "download",
                        done: 100,
                        total: 100,
                        detail: "已写入所选文件夹",
                        fractionLabel: "完成",
                        indeterminate: false,
                        cancellable: false,
                      });
                      scheduleClearDrawerProgress(2800);
                    } catch (err) {
                      const raw = err instanceof Error ? err.message : String(err);
                      const isPickerCancel =
                        err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError");
                      if (!isPickerCancel) {
                        postDownloadClientReport({
                          material_id: r.materialId,
                          file_id: r.fileId,
                          download_mode: "choose_directory",
                          transport_route: r.transportRoute,
                          success: false,
                          file_size_bytes: null,
                          error_message: raw.slice(0, 1800),
                        });
                      }
                      setResult(
                        isPickerCancel
                          ? "[下载已取消]\n已关闭目录选择或未授予写入权限。"
                          : `[下载失败]\n${raw}\n\n若使用「选择本地目录保存」且走局域网/公网文件机，请确认文件机对 GET /download 返回了 CORS 头（Access-Control-Allow-Origin 等）。`
                      );
                      setDrawerOpProgress({
                        kind: "download",
                        done: 0,
                        total: 1,
                        detail: isPickerCancel ? "已取消" : `失败：${raw}`,
                        fractionLabel: isPickerCancel ? "已取消" : "已中断",
                        indeterminate: false,
                        cancellable: false,
                      });
                      scheduleClearDrawerProgress(5000);
                    } finally {
                      setActionBusy(false);
                    }
                  })();
                }}
              >
                选择本地目录保存
              </button>
              ) : null}
              <button
                type="button"
                className={btnSecondary + " w-full justify-center"}
                onClick={() => setDownloadSaveChoice(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {collectModal ? (
        <div
          data-tour="materials-collect-modal"
          className="fixed inset-0 z-[20001] flex items-center justify-center bg-slate-900/55 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              {collectModal.mode === "personal" ? "收录到我的集合" : "收录到项目集合"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              本次共 <span className="font-medium text-slate-800">{collectModal.materialIds.length}</span>{" "}
              条「可用」素材；逐条调用收录接口，已在目标集合中的会跳过（already_exists），其余会写入。
            </p>
            {collectModal.loading ? <p className="mt-3 text-sm text-slate-600">正在加载分组与集合…</p> : null}
            {collectErr ? (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{collectErr}</p>
            ) : null}
            <div className="mt-4 grid gap-2">
              <label className="text-xs font-medium text-slate-600">选择分组</label>
              <select
                data-tour="materials-collect-group-select"
                className={inputClass}
                value={collectGroupFilter}
                onChange={(e) => setCollectGroupFilter(e.target.value)}
                disabled={collectModal.loading || collectBusy}
              >
                <option value="">全部</option>
                {collectModal.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <label className="text-xs font-medium text-slate-600">选择集合</label>
              <select
                data-tour="materials-collect-collection-select"
                className={inputClass}
                value={collectPickId}
                onChange={(e) => setCollectPickId(e.target.value)}
                disabled={collectModal.loading || collectBusy || collectFilteredCollections.length === 0}
              >
                <option value="">
                  {collectFilteredCollections.length === 0 ? "当前筛选下无集合" : "请选择…"}
                </option>
                {collectFilteredCollections.map((c) => {
                  const gn = c.group_id ? collectGroupNameById.get(c.group_id) : null;
                  const label = gn ? `${gn} / ${c.name}` : c.name;
                  return (
                    <option key={c.id} value={c.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <label className="text-xs font-medium text-slate-600">备注（可选）</label>
              <textarea
                className={inputClass + " min-h-[72px] resize-y"}
                value={collectNote}
                onChange={(e) => setCollectNote(e.target.value)}
                placeholder="仅在集合内显示，不写回素材库"
                disabled={collectBusy}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  data-tour="materials-collect-submit"
                  type="button"
                  className={btnPrimary}
                  disabled={
                    collectBusy || collectModal.loading || !collectPickId || collectFilteredCollections.length === 0
                  }
                  onClick={() => void submitCollectToCollection()}
                >
                  收录到所选集合（批量）
                </button>
                <button type="button" className={btnSecondary} disabled={collectBusy} onClick={() => setCollectModal(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-100">
        {isPersonalVideo ? "个人视频素材库" : "素材库"}
      </h1>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,10%)_minmax(0,10%)_minmax(0,60%)_minmax(0,20%)]">
        <aside className="h-fit min-w-0 rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <details open className="mb-3" data-tour="materials-quick-view">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">快捷视图</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {quickViews.map((item) => (
                <li
                  key={item}
                  className={selectedQuickView === item ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
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
                  className={selectedCategory === item ? "cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-slate-100" : "cursor-pointer rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5"}
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
            <div className="mt-3 text-xs text-slate-400" />
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
                          className={selectedTagIds.includes(tag.id) ? "flex items-center justify-between gap-2 rounded-md border border-sky-400/60 bg-sky-600/30 px-2 py-1 text-xs text-sky-100" : "flex items-center justify-between gap-2 rounded-md border border-transparent bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"}
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate bg-transparent p-0 text-left outline-none"
                            title={
                              (tag.description || "").trim()
                                ? `${tag.name} — ${(tag.description || "").trim()}`
                                : tag.name
                            }
                            onClick={() => {
                              setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]));
                            }}
                          >
                            {tag.name}
                          </button>
                          <button
                            type="button"
                            className={(favoriteTagIds.includes(tag.id) ? "text-amber-300" : "text-slate-400 hover:text-amber-300") + " bg-transparent p-0 outline-none"}
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
                    className={selectedTagIds.includes(tag.id) ? "flex items-center justify-between gap-2 rounded-md border border-sky-400/60 bg-sky-600/30 px-2 py-1 text-xs text-sky-100" : "flex items-center justify-between gap-2 rounded-md border border-transparent bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate bg-transparent p-0 text-left outline-none"
                      title={
                        (tag.description || "").trim()
                          ? `${tag.name} — ${(tag.description || "").trim()}`
                          : tag.name
                      }
                      onClick={() => {
                        setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]));
                      }}
                    >
                      {tag.name}
                    </button>
                    <button
                      type="button"
                    className={(favoriteTagIds.includes(tag.id) ? "text-amber-300" : "text-slate-400 hover:text-amber-300") + " bg-transparent p-0 outline-none"}
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
          <MaintenanceBanner token={token} />
          {nasStatus && !isNasTransferReady(nasStatus) ? (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {nasStatus.message}
            </div>
          ) : null}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div ref={keywordSearchWrapRef} className="relative min-w-[min(100%,280px)] max-w-[440px] flex-[1_1_280px]">
                <label className="mb-1 block text-xs font-medium text-slate-600">搜索</label>
                <input
                  data-tour="materials-search-input"
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
                              (t.description || "").trim()
                                ? `${t.name} — ${(t.description || "").trim()}`
                                : t.name
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
                  data-tour="materials-list-tag-category"
                  className={inputClass + " w-full"}
                  value={listFilterTagCategory}
                  onChange={(e) => setListFilterTagCategory(e.target.value)}
                  aria-label="列表筛选：标签分类"
                  title="仅查询「至少带有一个该分类下启用标签」的素材；与下方勾选的具体标签为并且关系"
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
                <input className={inputClass + " w-full"} value={uploaderKeyword} onChange={(e) => setUploaderKeyword(e.target.value)} placeholder="模糊匹配" />
              </div>
              <div className="min-w-[130px] flex-[0_0_auto]">
                <label className="mb-1 block text-xs font-medium text-slate-600">标签条件</label>
                <select
                  data-tour="materials-match-mode"
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
                <button type="button" className={btnPrimary} disabled={busy || actionBusy} onClick={() => { void queryMaterials(true); }}>
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
                <button key={chip.key} type="button" onClick={chip.onRemove} className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">
                  {chip.label} ×
                </button>
              ))}
            </div>

            <div data-tour="materials-view-switch" className="mt-3" />
          </section>

          <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-tour="materials-list">
            {uiState === "loading" ? <div className="border-b border-slate-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">正在加载素材列表...</div> : null}
            {uiState === "error" ? <div className="border-b border-slate-100 bg-red-50 px-4 py-2 text-sm text-red-700">查询失败：{errorMessage || "未知错误"}</div> : null}

            <MaterialGridSelectionToolbar
              theme="light"
              disabled={busy || actionBusy}
              selectAllDisabled={items.length === 0}
              clearDisabled={selectedMaterialIds.length === 0}
              onSelectAll={() => gridMarquee.selectAllIds(items.map((x) => x.id))}
              onClearSelection={() => gridMarquee.clearSelectedIds()}
              message={gridMarquee.toolbarMessage}
            />

            <div
              className="relative grid max-h-[min(72vh,920px)] min-h-0 gap-1.5 overflow-y-auto p-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              onMouseDown={gridMarquee.onGridMouseDown}
            >
              {items.map((item) => {
                const isChecked = selectedMaterialIds.includes(item.id);
                const tagText = formatTagNames(item.tag_ids);
                const displayName = getMaterialDisplayName(item);
                const iconPath = getMaterialIcon(item);
                const thumb = item.preview_thumbnail_path;
                const persistedThumb = thumb && (thumb.startsWith("http://") || thumb.startsWith("https://") || thumb.startsWith("/")) ? thumb : "";
                const coverPath = thumbnailUrlMap[item.id] || persistedThumb || iconPath;
                const visualState = selectedMaterialId === item.id ? "preview" : isChecked ? "checked" : "default";
                const canEditThis = canEditMaterialInGrid(item);
                return (
                  <MaterialFileCard
                    key={item.id}
                    visualState={visualState}
                    displayName={displayName}
                    tagLine={tagText}
                    fileSizeBytes={item.file_size ?? null}
                    resolutionLabel={formatResolutionForExtension(
                      getMaterialExtension(item),
                      item.primary_media_width,
                      item.primary_media_height
                    )}
                    coverSrc={coverPath}
                    titleSlot={
                      cardTitleEditId === item.id ? (
                        <input
                          className={inputClass + " !py-1 !text-xs"}
                          value={cardTitleDraft}
                          onChange={(e) => setCardTitleDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void saveMaterialTitleFromCard(item, cardTitleDraft);
                            }
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setCardTitleEditId(null);
                            }
                          }}
                          onBlur={(e) => {
                            void saveMaterialTitleFromCard(item, (e.target as HTMLInputElement).value);
                          }}
                          autoFocus
                          aria-label="编辑素材标题"
                        />
                      ) : undefined
                    }
                    tagsSlot={
                      cardTagsEditId === item.id ? (
                        <div className="space-y-1">
                          <TagSlashPicker
                            theme="light"
                            className="!gap-1"
                            tagGroups={tagSlashGroups}
                            selectedTagIds={cardTagsEditDraftIds}
                            onSelectedTagIdsChange={setCardTagsEditDraftIds}
                            inputDataTour="materials-card-tag-slash"
                          />
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className={btnPrimary + " !py-0.5 !px-2 !text-[10px]"}
                              disabled={actionBusy}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                void saveMaterialTagsFromCard(item.id, cardTagsEditDraftIds);
                              }}
                            >
                              保存标签
                            </button>
                            <button
                              type="button"
                              className={btnSecondary + " !py-0.5 !px-2 !text-[10px]"}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCardTagsEditId(null);
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : undefined
                    }
                    onTitleDoubleClick={
                      canEditThis
                        ? (e) => {
                            e.stopPropagation();
                            setCardTagsEditId(null);
                            setCardTitleEditId(item.id);
                            setCardTitleDraft(getMaterialDisplayName(item));
                          }
                        : undefined
                    }
                    onTagsDoubleClick={
                      canEditThis
                        ? (e) => {
                            e.stopPropagation();
                            setCardTitleEditId(null);
                            setCardTagsEditId(item.id);
                            setCardTagsEditDraftIds([...item.tag_ids]);
                          }
                        : undefined
                    }
                    onCoverError={(e) => {
                      const el = e.currentTarget;
                      setThumbnailUrlMap((prev) => {
                        if (!prev[item.id]) return prev;
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      });
                      thumbnailRequestedRef.current.delete(item.id);
                      if (el.src.endsWith(iconPath)) return;
                      el.src = iconPath;
                    }}
                    onCardClick={() => {
                      if (gridMarquee.shouldSuppressCardClick()) return;
                      setSelectedMaterialId(item.id);
                    }}
                    checkboxChecked={isChecked}
                    onCheckboxChange={() => toggleMaterialSelection(item.id)}
                    marqueeCardId={item.id}
                  />
                );
              })}
            </div>
            <MaterialGridMarqueeOverlay box={gridMarquee.marqueeActive ? gridMarquee.marqueeBox : null} />

            {items.length === 0 ? <p className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500">{uiState === "success" ? "当前筛选条件下暂无数据。" : "暂无数据，请先登录并查询。"}</p> : null}

            <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-slate-500">
                共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={btnSecondary + " !py-1 !text-xs"}
                  disabled={busy || actionBusy || loadingMore || page <= 1}
                  onClick={() => void goToPage(page - 1, fetchMaterialsPage)}
                >
                  上一页
                </button>
                <div className="flex max-w-[min(100%,36rem)] flex-wrap gap-1 overflow-x-auto">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={
                        (p === page
                          ? "rounded border border-sky-500 bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-800"
                          : "rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50") + " disabled:opacity-40"
                      }
                      disabled={busy || actionBusy || loadingMore}
                      onClick={() => void goToPage(p, fetchMaterialsPage)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={btnSecondary + " !py-1 !text-xs"}
                  disabled={busy || actionBusy || loadingMore || !hasMore}
                  onClick={() => void loadNext(fetchMaterialsPage)}
                >
                  下一页
                </button>
              </div>
            </div>
            <div ref={sentinelRef} className="h-8 w-full" />
          </section>

          <details className="mt-5 rounded-xl border border-slate-200 bg-slate-900 p-1 shadow-sm">
            <summary className="cursor-pointer select-none rounded-lg px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800">操作日志（JSON / 调试）</summary>
            <pre className="max-h-[min(420px,50vh)] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-emerald-100">{result}</pre>
          </details>
        </section>

        <aside
          data-tour="materials-detail-drawer"
          className="sticky top-4 z-10 flex max-h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl"
        >
          <div className="shrink-0 text-sm font-semibold text-slate-100">预览与文件信息</div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]">
          {!selectedItem ? null : (
            <div className="grid gap-3 text-xs text-slate-300">
              <div className="grid gap-2">
                <button type="button" className={btnSecondary + " !text-xs"} disabled={busy || actionBusy || !token || currentRole !== "super_admin"} onClick={() => void viewSyncDeadletters()}>同步异常上报</button>
                <button
                  data-tour="materials-download-button"
                  type="button"
                  className={btnSecondary + " !text-xs"}
                  disabled={drawerDownloadDisabled}
                  title={
                    multiDrawerDownload
                      ? canBatchDownload
                        ? `将依次写入上次「选择本地目录保存」的文件夹（共 ${selectedMaterialIds.length} 个）；无记录时需先单条保存一次目录`
                        : "批量下载需具备「批量下载」权限（asset.batch_download）"
                      : !canDownloadSingle
                        ? "需具备「下载素材」权限（asset.download）"
                        : !singleDownloadMaterialId
                          ? "请先点选一条素材作为预览或勾选一条"
                          : "下载当前预览/首个勾选素材"
                  }
                  onClick={() => onDrawerDownloadClick()}
                >
                  {multiDrawerDownload ? `下载（${selectedMaterialIds.length} 条）` : "下载"}
                </button>
                {canCollectionView ? (
                  <>
                    <button
                      data-tour="materials-collect-button"
                      type="button"
                      className={btnSecondary + " !text-xs"}
                      disabled={busy || actionBusy || !token || collectTargetMaterialIds.length === 0}
                      title={
                        collectTargetMaterialIds.length === 0
                          ? "请勾选或点选至少一条「可用」素材；多选时将批量收录"
                          : collectTargetMaterialIds.length > 1
                            ? `将 ${collectTargetMaterialIds.length} 条可用素材批量收录`
                            : undefined
                      }
                      onClick={() => void openCollectModal("personal")}
                    >
                      收录到我的集合
                    </button>
                    <button
                      type="button"
                      className={btnSecondary + " !text-xs"}
                      disabled={busy || actionBusy || !token || collectTargetMaterialIds.length === 0}
                      title={
                        collectTargetMaterialIds.length === 0
                          ? "请勾选或点选至少一条「可用」素材；多选时将批量收录"
                          : collectTargetMaterialIds.length > 1
                            ? `将 ${collectTargetMaterialIds.length} 条可用素材批量收录`
                            : undefined
                      }
                      onClick={() => void openCollectModal("project")}
                    >
                      收录到项目集合
                    </button>
                  </>
                ) : null}
                {canEditRole ? (
                  <>
                    <button
                      type="button"
                      className={btnSecondary + " !text-xs"}
                      disabled={!canMarkSelectedUnorganized}
                      onClick={() => void markSelectedAsUnorganized()}
                      title={hasForeignEditSelection ? "当前账号仅可编辑自己上传的素材" : ""}
                    >
                      批量加入未整理
                    </button>
                    {hasForeignEditSelection ? (
                      <div className="text-[11px] text-amber-300">已勾选他人素材，当前账号不可加入未整理</div>
                    ) : null}
                  </>
                ) : null}
                {canTrashRole ? (
                  <>
                    <button
                      type="button"
                      className={btnDanger + " !text-xs"}
                      disabled={!canMoveSelectedToTrash}
                      onClick={() => void moveSelectedToTrash()}
                      title={hasForeignSelection ? "普通成员只能移入自己上传的素材" : ""}
                    >
                      移入回收站
                    </button>
                    {hasForeignSelection ? (
                      <div className="text-[11px] text-amber-300">已勾选他人素材，普通成员不可移入回收站</div>
                    ) : null}
                  </>
                ) : null}
              </div>
              {drawerOpProgress ? (
                <div className="space-y-2">
                  {drawerOpProgress.kind === "download" && drawerOpProgress.cancellable ? (
                    <button
                      type="button"
                      className={btnSecondary + " !text-xs w-full"}
                      disabled={!actionBusy}
                      onClick={() => downloadPrepareAbortRef.current?.abort()}
                    >
                      取消下载
                    </button>
                  ) : null}
                  <OpProgressBar
                    variant="dark"
                    label={
                      drawerOpProgress.kind === "download"
                        ? "文件机下载"
                        : drawerOpProgress.kind === "batch_download"
                          ? "批量下载"
                          : drawerOpProgress.kind === "unorganized"
                            ? "批量加入未整理"
                            : "移入回收站"
                    }
                    done={drawerOpProgress.done}
                    total={drawerOpProgress.total}
                    detail={drawerOpProgress.detail}
                    fractionLabel={drawerOpProgress.kind === "download" ? drawerOpProgress.fractionLabel : undefined}
                    indeterminate={drawerOpProgress.kind === "download" ? drawerOpProgress.indeterminate : false}
                  />
                </div>
              ) : null}
              <MaterialFilePreviewArea
                mode={drawerPreviewMode}
                src={
                  thumbnailUrlMap[selectedItem.id] ||
                  (selectedItem.preview_thumbnail_path &&
                  (selectedItem.preview_thumbnail_path.startsWith("http://") ||
                    selectedItem.preview_thumbnail_path.startsWith("https://") ||
                    selectedItem.preview_thumbnail_path.startsWith("/"))
                    ? selectedItem.preview_thumbnail_path
                    : getMaterialIcon(selectedItem))
                }
                largeImageSrc={drawerPreviewMode === "image" ? drawerStream.streamUrl : null}
                largeImageLoading={drawerPreviewMode === "image" ? drawerStream.streamLoading : false}
                largeImageError={drawerPreviewMode === "image" ? drawerStream.streamError : null}
                largeImagePlaceholderHint={
                  drawerPreviewMode === "image" && !canDownloadSingle
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
                    ? drawerPreviewVideo.previewLoading || (drawerStreamResolveEnabled && drawerStream.streamLoading)
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
                    : drawerPreviewMode === "video" && !canViewAsset
                      ? "内嵌播放需具备「查看素材」权限（asset.view）。"
                      : null
                }
                onSaveOriginalToDirectory={canDownloadSingle ? savePreviewOriginalToDirectory : undefined}
                saveToDirectoryDisabled={drawerDownloadDisabled || actionBusy}
                saveToDirectoryTitle={
                  !canDownloadSingle
                    ? "需具备「下载素材」权限（asset.download）"
                    : !singleDownloadMaterialId
                      ? "请先点选一条素材作为预览或勾选一条"
                      : "将当前主文件保存到本地目录（已记住目录时不再弹出选择框）"
                }
                onError={(e) => {
                  const icon = getMaterialIcon(selectedItem);
                  const el = e.currentTarget;
                  setThumbnailUrlMap((prev) => {
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
              <div>
                <div className="text-slate-500">文件名</div>
                <div className="mt-1 break-words text-sm leading-snug text-white [overflow-wrap:anywhere]">
                  {getMaterialDisplayName(selectedItem)}
                </div>
                <div>文件大小：{formatBytes(selectedItem.file_size ?? null)}</div>
                {drawerResolutionLabel ? <div>分辨率：{drawerResolutionLabel}</div> : null}
                <div className="text-slate-500">{isPersonalVideo ? "AI内容识别" : "描述"}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-slate-200 [overflow-wrap:anywhere]">
                  {drawerDescriptionText || "—"}
                </div>
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
                      disabled={actionBusy || !canEditMaterialInGrid(selectedItem)}
                      onClick={() => {
                        void (async () => {
                          setActionBusy(true);
                          try {
                            const resp = await fetch(`${apiBaseUrl}/materials/${selectedItem.id}`, {
                              method: "PATCH",
                              headers: { ...authHeaders(), "Content-Type": "application/json" },
                              body: JSON.stringify({
                                copy_fit: copyFitDraft,
                                keywords: keywordsDraft.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean),
                              }),
                            });
                            const data = await resp.json();
                            if (!resp.ok) throw new Error(pretty(data));
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === selectedItem.id
                                  ? { ...x, copy_fit: data.copy_fit, keywords: data.keywords || [] }
                                  : x
                              )
                            );
                            setResult("[承接句意 / 关键词已保存]");
                          } catch (error) {
                            setResult(`[保存失败]\n${error instanceof Error ? error.message : String(error)}`);
                          } finally {
                            setActionBusy(false);
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
                <div className="mt-1 break-all">{formatTagNames(selectedItem.tag_ids)}</div>
              </div>
              <div>
                <div className="text-slate-500">使用记录</div>
                <div className="mt-1 max-h-[min(280px,40vh)] overflow-auto rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300 whitespace-pre-wrap break-words">
                  {!canViewUsages
                    ? "当前账号无「操作日志」查看权限（log.view），无法加载使用记录。"
                    : selectedItemUsages.length === 0
                      ? "暂无使用记录。"
                      : selectedItemUsages
                          .map(
                            (u) =>
                              `${u.created_at} | ${u.username || "-"} | ${u.usage_type || "-"} | ${u.source || "-"}`
                          )
                          .join("\n")}
                </div>
              </div>
            </div>
          )}
          </div>
        </aside>
      </div>
      <TutorialGate pageTutorialKey="materials" alsoRespondTo={["collections"]} />
    </main>
  );
}

export default function MaterialsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-sm text-slate-400">
          素材库加载中…
        </main>
      }
    >
      <MaterialsPageInner />
    </Suspense>
  );
}
