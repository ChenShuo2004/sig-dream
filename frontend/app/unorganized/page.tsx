"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, type AssetLibraryCode, useAssetLibrary } from "@/lib/assetLibrary";
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
import { formatBytes } from "@/lib/formatBytes";
import { coalescePositiveInt, formatResolutionForExtension } from "@/lib/mediaDisplay";
import { resolveDirectMediaUrl } from "@/lib/materialBrowserDownload";
import { thumbnailAccessContextHeaders } from "@/lib/thumbnailAccessContext";
import { TagSlashPicker, mergeTagSlashRecentStorage } from "@/components/TagSlashPicker";
import { tagCategoriesForLibrary, tagCategoryHoverTitle, tagCategoryShort } from "@/lib/tagCategoryUi";
import { isNasTransferReady, nasStatusFetchFailed, type NasClientStatus } from "@/lib/nasClientStatus";

/** 内容分析建议：文件机视觉模型产出，采纳前不写入素材正式字段 */
type AiAnalysis = {
  status?: string;
  description?: string | null;
  tags?: string[];
  tag_ids?: string[];
  unmatched_tags?: string[];
  keywords?: string[];
  copy_fit?: string | null;
  primary_taxonomy_id?: string | null;
  primary_taxonomy_name?: string | null;
  secondary_taxonomy_name?: string | null;
  secondary_taxonomy_id?: string | null;
  model?: string | null;
  frames?: number | null;
  analyzed_at?: string | null;
  error?: string | null;
  step?: string | null;
  step_label?: string | null;
  percent?: number | null;
};

const ANALYSIS_PROGRESS_STEPS: { key: string; label: string; percent: number }[] = [
  { key: "queued", label: "已排队，等待文件机领取", percent: 10 },
  { key: "claimed", label: "文件机已领取任务", percent: 20 },
  { key: "frames", label: "正在从预览或原片抽帧", percent: 40 },
  { key: "vision", label: "视觉模型正在看画面", percent: 75 },
  { key: "saving", label: "正在回写识别建议", percent: 90 },
];

function analysisPercent(analysis: AiAnalysis | null | undefined): number {
  const raw = analysis?.percent;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  const known = ANALYSIS_PROGRESS_STEPS.find((step) => step.key === analysis?.step);
  return known?.percent ?? (analysis?.status === "pending" ? 10 : 0);
}

type UnorganizedItem = {
  id: string;
  title: string;
  description?: string | null;
  original_filename: string | null;
  primary_file_id?: string | null;
  file_size?: number | null;
  asset_type: string | null;
  primary_media_width?: number | null;
  primary_media_height?: number | null;
  thumbnail_url: string | null;
  uploader_name: string | null;
  created_at: string;
  tags: string[];
  ai_analysis?: AiAnalysis | null;
};

type UnorganizedListResponse = {
  items: UnorganizedItem[];
  total: number;
  page: number;
  page_size: number;
};

type ActiveTag = { id: string; name: string; description?: string };
type ActiveTagGroups = Record<string, ActiveTag[]>;
type ThumbnailUrlResponse = {
  status: string;
  source: string;
  expires_at: string | null;
  url: string | null;
  alternate_urls?: string[];
  message?: string | null;
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

const previewImageExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const previewVideoExts = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

type TaxonomyNode = { id: string; name: string; children?: { id: string; name: string }[] };

function aiStatusLabel(analysis: AiAnalysis | null | undefined): string {
  switch (analysis?.status) {
    case "pending":
      return "识别中…";
    case "ready":
      return `待确认${analysis.model ? `｜${analysis.model}` : ""}`;
    case "applied":
      return "已采纳";
    case "failed":
      return "识别失败";
    default:
      return "";
  }
}

function aiStatusTextClass(analysis: AiAnalysis | null | undefined): string {
  switch (analysis?.status) {
    case "pending":
      return "text-violet-100";
    case "failed":
      return "text-amber-200";
    case "ready":
      return "text-violet-200";
    default:
      return "text-violet-200";
  }
}

function isAnalysisProgressResult(text: string): boolean {
  return /内容识别已排队|识别中 \d+|正在提交 \d+|文件机正在识别|每 3 秒刷新/.test(text);
}

function resultBannerClass(text: string): string {
  if (/失败|拦截|不是 JSON|500|超时/.test(text)) {
    return "rounded bg-amber-950 px-2.5 py-2 text-xs font-medium leading-relaxed text-amber-50 whitespace-pre-wrap";
  }
  if (/识别中|正在提交|已排队/.test(text)) {
    return "rounded bg-violet-900 px-2.5 py-2 text-xs font-medium leading-relaxed text-violet-50 whitespace-pre-wrap";
  }
  if (/内容识别完成/.test(text)) {
    return "rounded bg-emerald-950 px-2.5 py-2 text-xs font-medium leading-relaxed text-emerald-50 whitespace-pre-wrap";
  }
  return "rounded bg-slate-800 px-2.5 py-2 text-xs leading-relaxed text-slate-100 whitespace-pre-wrap";
}

function taxonomyAliasKeys(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];
  const keys = [raw.toLowerCase()];
  for (const part of raw.split("/")) {
    const key = part.trim().toLowerCase();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function taxonomyNamesMatch(nodeName: string, suggested: string): boolean {
  const left = nodeName.trim();
  const right = suggested.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftKeys = taxonomyAliasKeys(left);
  const rightKeys = taxonomyAliasKeys(right);
  if (leftKeys.some((key) => rightKeys.includes(key))) return true;
  const needle = right.toLowerCase();
  if (needle.length < 2) return false;
  return leftKeys.some((key) => key.includes(needle) || needle.includes(key));
}

function taxonomyOverlapScore(left: string, right: string): number {
  const a = left.trim().toLowerCase().replace(/[\s/]/g, "");
  const b = right.trim().toLowerCase().replace(/[\s/]/g, "");
  if (!a || !b) return 0;
  if (a === b) return 100;
  let score = 0;
  for (const n of [2, 3]) {
    const gramsA = new Set<string>();
    const gramsB = new Set<string>();
    for (let i = 0; i <= a.length - n; i += 1) gramsA.add(a.slice(i, i + n));
    for (let i = 0; i <= b.length - n; i += 1) gramsB.add(b.slice(i, i + n));
    gramsA.forEach((g) => {
      if (gramsB.has(g)) score += n;
    });
  }
  const skip = new Set(["的", "与", "和", "及", "或", "了", "着", "过"]);
  const charsA = new Set([...a].filter((c) => !skip.has(c)));
  const charsB = new Set([...b].filter((c) => !skip.has(c)));
  charsA.forEach((c) => {
    if (charsB.has(c)) score += 1;
  });
  return score;
}

function inferPrimaryForSecondary(tree: TaxonomyNode[], secondaryName: string): { id: string; name: string } | null {
  const needle = secondaryName.trim();
  if (!needle || tree.length === 0) return null;
  let bestScore = 0;
  let best = tree[0];
  for (const root of tree) {
    for (const child of root.children || []) {
      const score = taxonomyOverlapScore(child.name, needle);
      if (score > bestScore) {
        bestScore = score;
        best = root;
      }
    }
    const score = taxonomyOverlapScore(root.name, needle);
    if (score > bestScore) {
      bestScore = score;
      best = root;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

function resolveSuggestedTaxonomy(
  tree: TaxonomyNode[],
  suggestion: Pick<
    AiAnalysis,
    "primary_taxonomy_id" | "primary_taxonomy_name" | "secondary_taxonomy_id" | "secondary_taxonomy_name"
  >
): {
  primaryId: string;
  secondaryId: string;
  primaryName: string;
  secondaryName: string;
} {
  const primaryName = (suggestion.primary_taxonomy_name || "").trim();
  const secondaryName = (suggestion.secondary_taxonomy_name || "").trim();
  const secondaryById = tree
    .flatMap((node) => (node.children || []).map((child) => ({ parent: node, child })))
    .find(({ child }) => child.id === (suggestion.secondary_taxonomy_id || ""));
  if (secondaryById) {
    return {
      primaryId: secondaryById.parent.id,
      secondaryId: secondaryById.child.id,
      primaryName: secondaryById.parent.name,
      secondaryName: secondaryById.child.name,
    };
  }
  const secondaryHits = tree.flatMap((node) =>
    (node.children || [])
      .filter((child) => secondaryName && taxonomyNamesMatch(child.name, secondaryName))
      .map((child) => ({ parent: node, child }))
  );
  const preferredSecondary =
    secondaryHits.find(({ parent }) => (suggestion.primary_taxonomy_id && parent.id === suggestion.primary_taxonomy_id) || (primaryName && taxonomyNamesMatch(parent.name, primaryName))) ||
    secondaryHits[0];
  if (preferredSecondary) {
    return {
      primaryId: preferredSecondary.parent.id,
      secondaryId: preferredSecondary.child.id,
      primaryName: preferredSecondary.parent.name,
      secondaryName: preferredSecondary.child.name,
    };
  }
  const primaryById = tree.find((node) => node.id === (suggestion.primary_taxonomy_id || ""));
  const primaryByName = tree.find((node) => primaryName && taxonomyNamesMatch(node.name, primaryName));
  const primary = primaryById || primaryByName;
  if (primary) {
    return {
      primaryId: primary.id,
      secondaryId: "",
      primaryName: primary.name,
      secondaryName,
    };
  }
  if (primaryName) {
    return {
      primaryId: "",
      secondaryId: "",
      primaryName,
      secondaryName,
    };
  }
  const inferred = secondaryName ? inferPrimaryForSecondary(tree, secondaryName) : null;
  return {
    primaryId: inferred?.id || "",
    secondaryId: "",
    primaryName: inferred?.name || "",
    secondaryName,
  };
}

function existenceLabel(hasId: boolean, hasName: boolean): "已有" | "待新增" | "识别不完整" {
  if (hasId) return "已有";
  if (hasName) return "待新增";
  return "识别不完整";
}

export default function UnorganizedPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const { library, isPersonalVideo } = useAssetLibrary();
  const toAbsoluteUrl = useCallback((maybeRelativeUrl: string) => {
    if (!maybeRelativeUrl) return "";
    if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
    return `${apiBaseUrl.replace(/\/$/, "")}${maybeRelativeUrl}`;
  }, [apiBaseUrl]);
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const gridMarquee = useMaterialGridMarqueeSelection({ selectedIds, setSelectedIds });
  const [focusedId, setFocusedId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [primaryTaxonomyId, setPrimaryTaxonomyId] = useState("");
  const [secondaryTaxonomyId, setSecondaryTaxonomyId] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [copyFitText, setCopyFitText] = useState("");
  const [aiContentText, setAiContentText] = useState("");
  const [newThemeName, setNewThemeName] = useState("");
  const [newPrimaryName, setNewPrimaryName] = useState("");
  const [newSecondaryName, setNewSecondaryName] = useState("");
  const [taxonomyTree, setTaxonomyTree] = useState<{ id: string; name: string; children?: { id: string; name: string }[] }[]>([]);
  const [tagGroups, setTagGroups] = useState<ActiveTagGroups>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [analyzeSubmitting, setAnalyzeSubmitting] = useState(false);
  const [result, setResult] = useState("等待操作...");
  const [nasStatus, setNasStatus] = useState<NasClientStatus | null>(null);
  const [aiAutoApply, setAiAutoApply] = useState(false);
  const orderedTagGroupKeys = useMemo(() => {
    const keys = Object.keys(tagGroups);
    const order = tagCategoriesForLibrary(library);
    const inOrder = order.filter((key) => keys.includes(key));
    const extras = keys.filter((key) => !order.includes(key as (typeof order)[number]));
    return [...inOrder, ...extras];
  }, [tagGroups, library]);

  const [fileType, setFileType] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [uploaderId, setUploaderId] = useState("");
  const [organizedItems, setOrganizedItems] = useState<UnorganizedItem[]>([]);
  const [thumbnailUrlMap, setThumbnailUrlMap] = useState<Record<string, string>>({});
  const [thumbnailRetryTick, setThumbnailRetryTick] = useState(0);
  const thumbnailRequestedRef = useRef<Set<string>>(new Set());
  /** 递增时清空 {@link TagSlashPicker} 内「/」输入与下拉 */
  const [slashResetSeq, setSlashResetSeq] = useState(0);
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
  } = usePagedPrefetchList<UnorganizedItem>({ prefetchPages: [2, 3], enabled: true });
  const libraryEpochRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const authHeaders = useCallback(
    (extra: Record<string, string> = {}, lib: AssetLibraryCode = library): Record<string, string> => {
      const withLib = assetLibraryHeaders(extra, lib);
      return token ? { ...withLib, Authorization: `Bearer ${token}` } : withLib;
    },
    [library, token]
  );

  const fetchUnorganizedPage = useCallback(
    async (targetPage: number): Promise<{ items: UnorganizedItem[]; total: number }> => {
      const lib = library;
      const params = new URLSearchParams();
      if (fileType.trim()) params.set("file_type", fileType.trim());
      if (createdFrom) params.set("created_from", createdFrom);
      if (createdTo) params.set("created_to", createdTo);
      if (uploaderId.trim()) params.set("uploader_id", uploaderId.trim());
      params.set("page", String(targetPage));
      params.set("page_size", "20");
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized?${params.toString()}`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as UnorganizedListResponse | { detail?: unknown };
      if (lib !== libraryRef.current) {
        throw new DOMException("library switched", "AbortError");
      }
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const typed = data as UnorganizedListResponse;
      return { items: typed.items, total: typed.total };
    },
    [apiBaseUrl, authHeaders, createdFrom, createdTo, fileType, library, token, uploaderId]
  );

  async function loadUnorganized(options?: { preserveSelection?: boolean; silent?: boolean }) {
    if (!token) return;
    const epoch = libraryEpochRef.current;
    try {
      await resetAndLoad(fetchUnorganizedPage);
      if (epoch !== libraryEpochRef.current) return;
      if (!options?.preserveSelection) {
        setSelectedIds([]);
        setFocusedId("");
      }
      if (!options?.silent) {
        setResult("[加载未整理素材成功]");
      }
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResult(`[加载未整理素材失败]\n${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadActiveTags(): Promise<ActiveTagGroups> {
    const epoch = libraryEpochRef.current;
    const lib = library;
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/active`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = (await resp.json()) as ActiveTagGroups | { detail?: unknown };
      if (epoch !== libraryEpochRef.current) return {};
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const groups = data as ActiveTagGroups;
      setTagGroups(groups);
      return groups;
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return {};
      if (error instanceof DOMException && error.name === "AbortError") return {};
      setTagGroups({});
      return {};
    }
  }

  async function loadTaxonomy(): Promise<{ id: string; name: string; children?: { id: string; name: string }[] }[]> {
    const epoch = libraryEpochRef.current;
    const lib = library;
    if (lib !== "personal_video") {
      if (epoch === libraryEpochRef.current) setTaxonomyTree([]);
      return [];
    }
    try {
      const resp = await fetch(`${apiBaseUrl}/libraries/${lib}/taxonomy`, {
        headers: authHeaders({}, lib),
        signal: listAbortRef.current?.signal,
      });
      const data = await resp.json();
      if (epoch !== libraryEpochRef.current) return [];
      const tree = resp.ok && Array.isArray(data) ? data : [];
      setTaxonomyTree(tree);
      return tree;
    } catch (error) {
      if (epoch !== libraryEpochRef.current) return [];
      if (error instanceof DOMException && error.name === "AbortError") return [];
      setTaxonomyTree([]);
      return [];
    }
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
    if (isNasTransferReady(nasStatus)) return true;
    setResult(`[${actionName}已拦截]\n${nasStatus.message || "请联系管理员检查 NAS 客户端与局域网直传服务。"}`);
    return false;
  }

  function batchTargetIds(): string[] {
    if (selectedIds.length > 0) return [...selectedIds];
    if (focusedId) return [focusedId];
    return [];
  }

  async function removeAllTags() {
    const targets = batchTargetIds();
    if (targets.length === 0) return;
    if (!window.confirm(`确认移除 ${targets.length} 个素材上的全部标签？（将变为无标签，仍出现在未整理列表）`)) return;
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized/batch-tags`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ asset_ids: targets, tag_ids: [] }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setOrganizedItems((prev) => prev.filter((x) => !targets.includes(x.id)));
      setResult(`[移除全部标签成功]\n${JSON.stringify(data, null, 2)}`);
      setSelectedTagIds([]);
      setSlashResetSeq((s) => s + 1);
      setSelectedIds([]);
      setFocusedId("");
      await loadUnorganized();
    } catch (error) {
      setResult(`[移除全部标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function applyTags() {
    if (!ensureNasReadyOrWarn("应用标签")) return;
    const targets = batchTargetIds();
    if (targets.length === 0 || selectedTagIds.length === 0) return;
    if (isPersonalVideo && (!secondaryTaxonomyId || !copyFitText.trim() || !keywordsText.trim())) {
      setResult("[整理入库失败]\n个人视频库须填写二级分类、关键词和承接句意。");
      return;
    }
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized/batch-tags`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          asset_ids: targets,
          tag_ids: selectedTagIds,
          ...(isPersonalVideo
            ? {
                primary_taxonomy_id: primaryTaxonomyId || null,
                secondary_taxonomy_id: secondaryTaxonomyId || null,
                keywords: keywordsText.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean),
                copy_fit: copyFitText,
                description: aiContentText.trim() || null,
              }
            : {}),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(data));
      mergeTagSlashRecentStorage([...selectedTagIds]);
      const replacedTagNames = Object.values(tagGroups)
        .flat()
        .filter((x) => selectedTagIds.includes(x.id))
        .map((x) => x.name);
      const selectedRows = allItems.filter((x) => targets.includes(x.id));
      setOrganizedItems((prev) => {
        const map = new Map(prev.map((x) => [x.id, x]));
        selectedRows.forEach((row) => {
          map.set(row.id, { ...row, tags: replacedTagNames });
        });
        return Array.from(map.values());
      });
      setResult(`[应用标签成功]\n${JSON.stringify(data, null, 2)}`);
      await loadUnorganized({ preserveSelection: true });
    } catch (error) {
      setResult(`[应用标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  function markItemsAnalyzing(ids: string[]) {
    const idSet = new Set(ids);
    const stamp = (item: UnorganizedItem): UnorganizedItem =>
      idSet.has(item.id)
        ? {
            ...item,
            ai_analysis: {
              ...(item.ai_analysis || {}),
              status: "pending",
              step: "queued",
              step_label: "已排队，等待文件机领取",
              percent: 10,
              error: null,
            },
          }
        : item;
    setItems((prev) => prev.map(stamp));
    setOrganizedItems((prev) => prev.map(stamp));
  }

  async function analyzeContent() {
    if (!ensureNasReadyOrWarn("内容识别")) return;
    const targets = batchTargetIds();
    if (targets.length === 0) {
      setResult("[内容识别已拦截]\n请先勾选要识别的素材。");
      return;
    }
    setAnalyzeSubmitting(true);
    setActionBusy(true);
    setResult(`正在提交 ${targets.length} 个素材的识别…`);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized/analyze`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ asset_ids: targets, auto_apply: aiAutoApply }),
      });
      const data = (await resp.json()) as {
        success_count?: number;
        failed_count?: number;
        failed_items?: { asset_id?: string; id?: string; reason?: string; detail?: string }[];
      };
      if (!resp.ok) throw new Error(typeof data === "object" ? JSON.stringify(data) : String(data));
      const okCount = Number(data.success_count || 0);
      const failCount = Number(data.failed_count || 0);
      const failLines = (data.failed_items || [])
        .map((row) => `- ${row.asset_id || row.id || "未知"}：${row.reason || row.detail || "失败"}`)
        .slice(0, 6);
      if (okCount > 0) {
        markItemsAnalyzing(targets);
      }
      const lines = [
        okCount > 0 ? `[内容识别已排队] ${okCount} 个已提交` : "[内容识别排队失败] 没有素材成功提交",
        failCount > 0 ? `${failCount} 个未能排队` : "",
        okCount > 0
          ? aiAutoApply
            ? "已勾选自动确认：识别完成后会自动新增并入库。"
            : "文件机正在识别，完成后卡片和右侧会显示建议。"
          : "请稍后重试。若连续失败，多半是识别 Worker 未就绪。",
        okCount > 0 ? "页面约每 3 秒刷新一次识别进度。" : "",
        ...failLines,
      ].filter(Boolean);
      setResult(lines.join("\n"));
      await loadUnorganized({ preserveSelection: true, silent: true });
    } catch (error) {
      setResult(`[内容识别排队失败]\n${error instanceof Error ? error.message : String(error)}`);
      await loadUnorganized({ preserveSelection: true, silent: true });
    } finally {
      setAnalyzeSubmitting(false);
      setActionBusy(false);
    }
  }

  async function applyAiSuggestions() {
    if (!ensureNasReadyOrWarn("采纳建议")) return;
    const targets = batchTargetIds().filter((id) => allItems.find((x) => x.id === id)?.ai_analysis?.status === "ready");
    if (targets.length === 0) {
      setResult("[采纳建议已拦截]\n所选素材都没有可采纳的识别建议，请先执行内容识别。");
      return;
    }
    if (!aiAutoApply && !window.confirm(`确认按各自建议整理 ${targets.length} 个素材？将替换其全部标签并写入描述。`)) return;
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized/apply-suggestions`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ asset_ids: targets, auto_create: aiAutoApply }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const applied = allItems.filter((x) => targets.includes(x.id));
      setOrganizedItems((prev) => {
        const map = new Map(prev.map((x) => [x.id, x]));
        applied.forEach((row) => map.set(row.id, { ...row, tags: row.ai_analysis?.tags || [] }));
        return Array.from(map.values());
      });
      setResult(`[采纳建议成功]\n${JSON.stringify(data, null, 2)}`);
      await loadUnorganized({ preserveSelection: true });
    } catch (error) {
      setResult(`[采纳建议失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  /** 把当前预览项的建议填进右侧编辑区，改完再走「应用标签」，不直接写库 */
  async function fillEditorFromSuggestion() {
    const suggestion = focusedItem?.ai_analysis;
    if (!suggestion || suggestion.status !== "ready") return;
    setSelectedTagIds(suggestion.tag_ids || []);
    const extras: string[] = [];
    if (isPersonalVideo) {
      setKeywordsText((suggestion.keywords || []).join("、"));
      setCopyFitText(suggestion.copy_fit || "");
      const tree = (await loadTaxonomy()) || taxonomyTree;
      const resolved = resolveSuggestedTaxonomy(tree, suggestion);
      setPrimaryTaxonomyId(resolved.primaryId);
      setSecondaryTaxonomyId(resolved.secondaryId);
      setNewPrimaryName(resolved.primaryId ? "" : resolved.primaryName);
      setNewSecondaryName(resolved.secondaryId ? "" : resolved.secondaryName);
      setAiContentText((suggestion.description || "").trim());
      const unmatched = (suggestion.unmatched_tags || []).map((name) => name.trim()).filter(Boolean);
      setNewThemeName(unmatched.join("/"));
      if (resolved.secondaryId) {
        extras.push(`两级分类已有，已选中「${resolved.primaryName} / ${resolved.secondaryName}」。`);
      } else if (resolved.primaryId && resolved.secondaryName) {
        extras.push(`一级已有「${resolved.primaryName}」，二级「${resolved.secondaryName}」待新增。`);
      } else if (resolved.primaryName && resolved.secondaryName) {
        extras.push(`一级「${resolved.primaryName}」、二级「${resolved.secondaryName}」均待新增，请先点新增一级。`);
      } else if (resolved.secondaryName) {
        extras.push("建议分类缺少一级，请先选择或新增一级，才能写入二级。");
      } else {
        extras.push("这次建议未给出两级分类，请在右侧手工选择。");
      }
      if (unmatched.length > 0) {
        extras.push("待新增主题已写入右侧，点新增后会批量创建并勾选。");
      }
    }
    setResult(
      isPersonalVideo
        ? `[已填入编辑区]\n已有主题、分类与 AI 内容识别已填入右侧，确认后点「整理入库」。${extras.length ? ` ${extras.join("")}` : ""}`
        : `[已填入编辑区]\n建议标签已填入右侧，确认后点「应用标签」。`
    );
  }

  async function moveToTrash() {
    if (!ensureNasReadyOrWarn("移入回收站")) return;
    const targets = batchTargetIds();
    if (targets.length === 0) return;
    if (!window.confirm(`确认将 ${targets.length} 个素材移入回收站？`)) return;
    setActionBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/materials/unorganized/batch-trash`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ asset_ids: targets, reason: "未整理素材清理" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setResult(`[移入回收站成功]\n${JSON.stringify(data, null, 2)}`);
      setOrganizedItems((prev) => prev.filter((x) => !targets.includes(x.id)));
      setSelectedIds([]);
      setFocusedId("");
      await loadUnorganized();
    } catch (error) {
      setResult(`[移入回收站失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setFocusedId(id);
  }

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function findActiveTagIdByName(name: string, groups: ActiveTagGroups = tagGroups): string {
    const needle = name.trim().toLowerCase();
    if (!needle) return "";
    for (const rows of Object.values(groups)) {
      const hit = (rows || []).find((tag) => tag.name.trim().toLowerCase() === needle);
      if (hit) return hit.id;
    }
    return "";
  }

  function splitThemeNames(raw: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of raw.split("/")) {
      const name = part.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  }

  async function createThemeTag(nameOverride?: string): Promise<string> {
    const names = splitThemeNames(nameOverride ?? newThemeName);
    if (names.length === 0 || !isPersonalVideo || !canSubmitThemeTag) return "";
    if (!ensureNasReadyOrWarn(canCreateThemeTag ? "新增适用主题" : "申请适用主题")) return "";
    setActionBusy(true);
    try {
      let groups = tagGroups;
      const selected: string[] = [];
      const existed: string[] = [];
      const created: string[] = [];
      const pending: string[] = [];
      for (const name of names) {
        const existingId = findActiveTagIdByName(name, groups);
        if (existingId) {
          selected.push(existingId);
          existed.push(name);
          continue;
        }
        const resp = await fetch(`${apiBaseUrl}${canCreateThemeTag ? "/tags" : "/tags/apply"}`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            name,
            category: "适用主题",
            description: "",
            synonyms: [],
          }),
        });
        const data = (await resp.json()) as { id?: string; status?: string; name?: string; detail?: unknown };
        if (!resp.ok) {
          const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data);
          if (resp.status === 409 || detail === "Tag already exists") {
            groups = await loadActiveTags();
            const again = findActiveTagIdByName(name, groups);
            if (again) {
              selected.push(again);
              existed.push(name);
              continue;
            }
            throw new Error(`「${name}」已存在，请在下方列表中勾选，或更换名称。`);
          }
          throw new Error(detail);
        }
        if (data.status === "active" && data.id) {
          groups = await loadActiveTags();
          selected.push(data.id);
          created.push(name);
          continue;
        }
        pending.push(name);
      }
      if (selected.length > 0) {
        setSelectedTagIds((prev) => {
          const next = new Set(prev);
          selected.forEach((id) => next.add(id));
          return Array.from(next);
        });
      }
      setNewThemeName("");
      const parts: string[] = [];
      if (created.length > 0) parts.push(`新增并勾选：${created.join("、")}`);
      if (existed.length > 0) parts.push(`已存在并勾选：${existed.join("、")}`);
      if (pending.length > 0) parts.push(`已申请待审：${pending.join("、")}`);
      setResult(`[${canCreateThemeTag ? "新增" : "申请"}适用主题完成]\n${parts.join("\n") || "无变更"}`);
      return selected[0] || "";
    } catch (error) {
      setResult(`[${canCreateThemeTag ? "新增" : "申请"}适用主题失败]\n${error instanceof Error ? error.message : String(error)}`);
      return "";
    } finally {
      setActionBusy(false);
    }
  }

  function parseApiDetail(data: { detail?: unknown }): string {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("；");
    if (data.detail != null) return JSON.stringify(data.detail);
    return JSON.stringify(data);
  }

  async function createTaxonomyNode(name: string, parentId: string | null): Promise<{ id: string; name: string } | null> {
    const resp = await fetch(`${apiBaseUrl}/libraries/${library}/taxonomy`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, parent_id: parentId, description: "" }),
    });
    const data = (await resp.json()) as { id?: string; name?: string; detail?: unknown };
    if (!resp.ok) {
      const err = new Error(parseApiDetail(data)) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    if (!data.id) throw new Error("分类已创建但未返回节点 id");
    return { id: data.id, name: data.name || name };
  }

  async function createPrimaryTaxonomy(nameOverride?: string): Promise<string> {
    const name = (nameOverride ?? newPrimaryName).trim();
    if (!name || !isPersonalVideo || !canCreateTaxonomy) return "";
    if (!ensureNasReadyOrWarn("新增一级分类")) return "";
    const existing = taxonomyTree.find((node) => node.name.trim() === name);
    if (existing) {
      setPrimaryTaxonomyId(existing.id);
      setSecondaryTaxonomyId("");
      setNewPrimaryName("");
      setResult(`[一级分类已存在] 已选中「${name}」`);
      return existing.id;
    }
    setActionBusy(true);
    try {
      const created = await createTaxonomyNode(name, null);
      setNewPrimaryName("");
      await loadTaxonomy();
      if (created) {
        setPrimaryTaxonomyId(created.id);
        setSecondaryTaxonomyId("");
      }
      setResult(`[新增一级分类成功] ${name}`);
      return created?.id || "";
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 409 || message === "Taxonomy name already exists") {
        const tree = await loadTaxonomy();
        const hit = tree.find((node) => node.name.trim() === name);
        if (hit) {
          setPrimaryTaxonomyId(hit.id);
          setSecondaryTaxonomyId("");
          setNewPrimaryName("");
          setResult(`[一级分类已存在] 已选中「${name}」`);
          return hit.id;
        }
      }
      setResult(`[新增一级分类失败]\n${message}`);
      return "";
    } finally {
      setActionBusy(false);
    }
  }

  async function createSecondaryTaxonomy(nameOverride?: string, parentOverride?: string): Promise<string> {
    const name = (nameOverride ?? newSecondaryName).trim();
    const parentId = parentOverride || primaryTaxonomyId;
    if (!name || !isPersonalVideo || !canCreateTaxonomy) return "";
    if (!parentId) {
      setResult("[新增二级分类失败]\n请先选择或新增一级分类。");
      return "";
    }
    if (!ensureNasReadyOrWarn("新增二级分类")) return "";
    const parent = taxonomyTree.find((node) => node.id === parentId);
    const existing = (parent?.children || []).find((node) => node.name.trim() === name);
    if (existing) {
      setPrimaryTaxonomyId(parentId);
      setSecondaryTaxonomyId(existing.id);
      setNewSecondaryName("");
      setResult(`[二级分类已存在] 已选中「${name}」`);
      return existing.id;
    }
    setActionBusy(true);
    try {
      const created = await createTaxonomyNode(name, parentId);
      setNewSecondaryName("");
      await loadTaxonomy();
      setPrimaryTaxonomyId(parentId);
      if (created) setSecondaryTaxonomyId(created.id);
      setResult(`[新增二级分类成功] ${parent?.name || "一级"} / ${name}`);
      return created?.id || "";
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 409 || message === "Taxonomy name already exists") {
        const tree = await loadTaxonomy();
        const hit = (tree.find((node) => node.id === parentId)?.children || []).find((node) => node.name.trim() === name);
        if (hit) {
          setPrimaryTaxonomyId(parentId);
          setSecondaryTaxonomyId(hit.id);
          setNewSecondaryName("");
          setResult(`[二级分类已存在] 已选中「${name}」`);
          return hit.id;
        }
      }
      setResult(`[新增二级分类失败]\n${message}`);
      return "";
    } finally {
      setActionBusy(false);
    }
  }

  async function adoptSuggestedTaxonomy() {
    const suggestion = focusedItem?.ai_analysis;
    if (!suggestion) return;
    const resolved = resolveSuggestedTaxonomy(taxonomyTree, suggestion);
    if (resolved.secondaryId) {
      setPrimaryTaxonomyId(resolved.primaryId);
      setSecondaryTaxonomyId(resolved.secondaryId);
      setNewPrimaryName("");
      setNewSecondaryName("");
      setResult(`[已选中分类] ${resolved.primaryName} / ${resolved.secondaryName}`);
      return;
    }
    let parentId = resolved.primaryId;
    if (!parentId && resolved.primaryName) {
      parentId = await createPrimaryTaxonomy(resolved.primaryName);
    } else if (parentId) {
      setPrimaryTaxonomyId(parentId);
      setNewPrimaryName("");
    }
    if (!parentId) {
      setNewSecondaryName("");
      setResult("[建议分类缺少一级]\n必须先有一级分类，才能新增二级。请先选择或新增一级。");
      return;
    }
    if (resolved.secondaryName) {
      await createSecondaryTaxonomy(resolved.secondaryName, parentId);
    }
  }

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setPermissions(session.permissions || []);
    }
    try {
      setAiAutoApply(window.localStorage.getItem("unorganized-ai-auto-apply") === "1");
    } catch {
      setAiAutoApply(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    invalidateInFlight();
    listAbortRef.current?.abort();
    listAbortRef.current = new AbortController();
    libraryEpochRef.current += 1;
    setItems([]);
    setOrganizedItems([]);
    setTagGroups({});
    setSelectedTagIds([]);
    setPrimaryTaxonomyId("");
    setSecondaryTaxonomyId("");
    setKeywordsText("");
    setCopyFitText("");
    setAiContentText("");
    setNewThemeName("");
    setNewPrimaryName("");
    setNewSecondaryName("");
    void loadUnorganized();
    void loadActiveTags();
    void loadTaxonomy();
    void loadNasClientStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, library]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      void loadNasClientStatus();
    }, 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    bindLoadNext(() => loadNext(fetchUnorganizedPage));
  }, [bindLoadNext, fetchUnorganizedPage, loadNext]);

  const allItems = useMemo(() => [...items, ...organizedItems], [items, organizedItems]);
  const analyzingCount = useMemo(
    () => items.filter((x) => x.ai_analysis?.status === "pending").length,
    [items]
  );
  const suggestionReadyCount = useMemo(
    () => items.filter((x) => x.ai_analysis?.status === "ready").length,
    [items]
  );

  useEffect(() => {
    if (analyzeSubmitting || analyzingCount === 0) return;
    if (result === "等待操作..." || result === "[加载未整理素材成功]") {
      setResult(`识别中 ${analyzingCount} 个素材，完成后卡片和右侧会显示建议。`);
    }
  }, [analyzeSubmitting, analyzingCount, result]);

  const analyzingCountRef = useRef(0);
  useEffect(() => {
    const prev = analyzingCountRef.current;
    analyzingCountRef.current = analyzingCount;
    if (analyzeSubmitting || prev <= 0 || analyzingCount > 0) return;
    if (!isAnalysisProgressResult(result)) return;
    const failedCount = items.filter((x) => x.ai_analysis?.status === "failed").length;
    const readyCount = items.filter((x) => x.ai_analysis?.status === "ready").length;
    const lines: string[] = [];
    if (aiAutoApply && readyCount === 0 && failedCount === 0) {
      lines.push(`[内容识别完成] ${prev} 个已自动整理入库`);
    } else if (readyCount > 0) {
      lines.push(`[内容识别完成] ${readyCount} 个已出建议`);
      if (failedCount > 0) lines.push(`${failedCount} 个识别失败，可重新点识别。`);
      lines.push("请看卡片和右侧建议，确认后整理入库。");
    } else if (failedCount > 0) {
      lines.push(`[内容识别结束] ${failedCount} 个识别失败，可重新点识别。`);
    } else {
      lines.push("[内容识别完成] 识别进度已结束。");
    }
    setResult(lines.join("\n"));
  }, [analyzingCount, analyzeSubmitting, result, items, aiAutoApply]);

  /** 识别在文件机异步执行，有排队中的素材时轮询列表把建议刷出来 */
  useEffect(() => {
    if (!token || analyzingCount === 0) return;
    const timer = window.setInterval(() => {
      if (actionBusy) return;
      void loadUnorganized({ preserveSelection: true, silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, analyzingCount, actionBusy]);

  /** 与「当前预览」行一致：用该行上的业务标签预填批量打标区（排除「未整理」）；无标签或仅有「未整理」时不覆盖已选，便于沿用上一批勾选。 */
  useEffect(() => {
    if (!focusedId) {
      setSelectedTagIds([]);
      return;
    }
    const row = allItems.find((x) => x.id === focusedId);
    if (!row) {
      setSelectedTagIds([]);
      return;
    }
    const rawNames = (row.tags || []).map((n) => String(n).trim()).filter(Boolean);
    const names = rawNames.filter((n) => n !== "未整理");
    if (names.length === 0) {
      return;
    }
    const flat = Object.values(tagGroups).flat();
    const idByName = new Map(flat.map((t) => [t.name.trim(), t.id]));
    const ids = names.map((n) => idByName.get(n)).filter((id): id is string => Boolean(id));
    setSelectedTagIds(ids);
  }, [focusedId, allItems, tagGroups]);
  const focusedItem = useMemo(() => allItems.find((x) => x.id === focusedId) || null, [allItems, focusedId]);
  const getItemExtension = useCallback((item: UnorganizedItem) => {
    const fromAssetType = (item.asset_type || "").trim().toLowerCase().replace(/^\./, "");
    if (fromAssetType) return fromAssetType;
    const rawName = item.original_filename || item.title || "";
    const dotIndex = rawName.lastIndexOf(".");
    if (dotIndex >= 0 && dotIndex < rawName.length - 1) return rawName.slice(dotIndex + 1).toLowerCase();
    return "";
  }, []);
  const getDisplayFilename = useCallback((item: UnorganizedItem) => {
    const ext = getItemExtension(item);
    const rawName = (item.original_filename || item.title || "").trim();
    if (!rawName) return item.title;
    if (!ext) return rawName;
    return rawName.toLowerCase().endsWith(`.${ext}`) ? rawName : `${rawName}.${ext}`;
  }, [getItemExtension]);
  const canDownloadAsset = permissions.includes("asset.download");
  const canViewAsset = permissions.includes("asset.view");
  const canCreateThemeTag = permissions.includes("tag.create");
  const canRequestThemeTag = permissions.includes("tag.request");
  const canSubmitThemeTag = canCreateThemeTag || canRequestThemeTag;
  const canCreateTaxonomy = canCreateThemeTag;
  const drawerPreviewMode = useMemo((): MaterialFilePreviewMode => {
    if (!focusedItem) return "generic";
    const ext = getItemExtension(focusedItem);
    if (!ext) return "generic";
    if (previewImageExts.has(ext)) return "image";
    if (previewVideoExts.has(ext)) return "video";
    return "generic";
  }, [focusedItem, getItemExtension]);
  const unorgStreamResolveEnabled =
    (drawerPreviewMode === "image" || drawerPreviewMode === "video") &&
    canDownloadAsset &&
    !!token.trim() &&
    !!focusedItem?.primary_file_id;
  const unorgPreviewResolveEnabled =
    drawerPreviewMode === "video" && canViewAsset && !!token.trim() && !!focusedItem?.primary_file_id;
  const unorgStream = useMaterialFileStreamUrl({
    apiBaseUrl: apiBaseUrl,
    materialId: focusedItem?.id ?? null,
    fileId: focusedItem?.primary_file_id ?? null,
    filename: focusedItem ? getDisplayFilename(focusedItem) : "preview.bin",
    enabled: unorgStreamResolveEnabled,
    token,
  });
  const unorgPreviewVideo = useMaterialPreviewVideoUrl({
    apiBaseUrl: apiBaseUrl,
    materialId: focusedItem?.id ?? null,
    fileId: focusedItem?.primary_file_id ?? null,
    enabled: unorgPreviewResolveEnabled,
    token,
  });
  const normalizeThumb = useCallback((item: UnorganizedItem) => {
    const raw = String(item.thumbnail_url || "").trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) return raw;
    return "";
  }, []);
  const ensureCardThumbnails = useCallback(async () => {
    if (!token) return;
    const all = [...items, ...organizedItems];
    const candidates = all.filter((item) => {
      const ext = getItemExtension(item);
      return (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" || ext === "bmp" || ext === "gif" || ext === "mp4" || ext === "mov" || ext === "mkv" || ext === "avi" || ext === "webm" || ext === "m4v") && !!item.primary_file_id;
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
          if (!resp.ok) throw new Error(JSON.stringify(data));
          const absUrl = await resolveDirectMediaUrl(apiBaseUrl, data as ThumbnailUrlResponse);
          const url = absUrl ? `${absUrl}${absUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}` : "";
          if (url) setThumbnailUrlMap((prev) => ({ ...prev, [item.id]: url }));
        } catch {
          // 忽略，继续走图标兜底
        }
      })
    );
    if (pending.length > 0) {
      window.setTimeout(() => setThumbnailRetryTick((v) => v + 1), 1500);
    }
  }, [apiBaseUrl, getItemExtension, items, organizedItems, thumbnailUrlMap, toAbsoluteUrl, token]);

  useEffect(() => {
    void ensureCardThumbnails();
  }, [ensureCardThumbnails, thumbnailRetryTick]);

  /** 未整理 / 已整理共用：同一套卡片，避免两块漂移 */
  const renderFileCard = useCallback(
    (item: UnorganizedItem) => {
      const checked = selectedIds.includes(item.id);
      const focused = focusedId === item.id;
      const tagText = item.tags.length > 0 ? item.tags.join(" / ") : "无标签";
      const ext = getItemExtension(item);
      const iconPath = fileTypeIconMap[ext] || "/file-icons/file.svg";
      const cover = thumbnailUrlMap[item.id] || normalizeThumb(item) || iconPath;
      const visualState = focused ? "preview" : checked ? "checked" : "default";
      const aiLabel = aiStatusLabel(item.ai_analysis);
      const aiTags = (item.ai_analysis?.tags || []).join(" / ");
      const pending = item.ai_analysis?.status === "pending";
      const pendingPercent = analysisPercent(item.ai_analysis);
      return (
        <MaterialFileCard
          key={item.id}
          visualState={visualState}
          displayName={getDisplayFilename(item)}
          tagLine={tagText}
          coverBadge={pending ? `正在识别 ${pendingPercent}%` : null}
          tagsSlot={
            aiLabel ? (
              <div className="min-w-0">
                <div className="line-clamp-1 break-words" title={tagText}>
                  {tagText}
                </div>
                <div
                  className={`mt-0.5 line-clamp-1 break-words text-[10px] font-medium ${aiStatusTextClass(item.ai_analysis)}`}
                  title={aiTags ? `建议：${aiTags}` : aiLabel}
                >
                  {pending ? `正在识别 ${pendingPercent}%` : `AI ${aiLabel}`}
                  {!pending && aiTags ? `：${aiTags}` : ""}
                </div>
              </div>
            ) : undefined
          }
          fileSizeBytes={item.file_size ?? null}
          resolutionLabel={formatResolutionForExtension(
            (item.asset_type || "").trim().toLowerCase().replace(/^\./, ""),
            item.primary_media_width,
            item.primary_media_height
          )}
          coverSrc={cover}
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
            setFocusedId(item.id);
          }}
          checkboxChecked={checked}
          onCheckboxChange={() => toggleSelect(item.id)}
          marqueeCardId={item.id}
        />
      );
    },
    [focusedId, getDisplayFilename, getItemExtension, gridMarquee, normalizeThumb, selectedIds, thumbnailUrlMap, toggleSelect]
  );

  const focusedResolutionLabel = useMemo(() => {
    if (!focusedItem) return null;
    const ext = (focusedItem.asset_type || "").trim().toLowerCase().replace(/^\./, "");
    const w = coalescePositiveInt(focusedItem.primary_media_width);
    const h = coalescePositiveInt(focusedItem.primary_media_height);
    return formatResolutionForExtension(ext, w, h);
  }, [focusedItem]);

  const focusedDescriptionText = useMemo(() => {
    const raw = (focusedItem?.description ?? "").trim();
    return raw || null;
  }, [focusedItem]);

  const focusedSuggestion = focusedItem?.ai_analysis || null;
  const focusedTaxonomy = useMemo(
    () => (focusedSuggestion ? resolveSuggestedTaxonomy(taxonomyTree, focusedSuggestion) : null),
    [focusedSuggestion, taxonomyTree]
  );

  const twinListShellClass =
    "flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-slate-900/55 p-4 shadow-sm backdrop-blur-xl";
  const twinListGridClass =
    "grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  const twinListEmptyClass = "col-span-full py-8 text-center text-sm text-slate-500";

  return (
    <main className="mx-auto w-full min-w-0 px-4 py-8 sm:px-6 2xl:px-8">
      <section className="rounded-2xl border border-white/10 bg-slate-900/55 p-5 shadow-sm backdrop-blur-xl">
        <MaintenanceBanner token={token} />
        {nasStatus && !isNasTransferReady(nasStatus) ? (
          <div className="mb-3 rounded-lg border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {nasStatus.message}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold text-slate-100">未整理素材</h1>
        <div className="mt-3 text-sm text-slate-400" data-tour="unorganized-selected-count">
          共 {total} 个未整理素材｜已勾选 {selectedIds.length} 个
          {focusedItem ? (
            <span className="ml-2 text-slate-300">
              ｜当前预览：{getDisplayFilename(focusedItem)}
            </span>
          ) : (
            <span className="ml-2 text-slate-500">｜当前预览：无（请点击卡片）</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[auto,1fr,1fr,1fr,auto]">
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={busy || actionBusy} onClick={() => void loadUnorganized()}>
            刷新
          </button>
          <input className="rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="文件类型，如 mp4/png" value={fileType} onChange={(e) => setFileType(e.target.value)} />
          <input className="rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100" type="datetime-local" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
          <input className="rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100" type="datetime-local" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
          <input className="rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="上传人（可选）" value={uploaderId} onChange={(e) => setUploaderId(e.target.value)} />
        </div>
      </section>

      <section className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(12rem,2fr)_minmax(12rem,3fr)]">
        {/* 未整理 + 已整理：同一列内等分高度、同一套卡片与栅格，仅标题与数据源不同 */}
        <div className="flex min-h-[min(68vh,880px)] min-w-0 flex-col gap-4">
          <div className={twinListShellClass} data-tour="unorganized-material-list">
            <div className="mb-3 shrink-0 text-sm font-semibold text-slate-100">未整理文件（{total}）</div>
            <MaterialGridSelectionToolbar
              theme="dark"
              disabled={busy || actionBusy}
              selectAllDisabled={items.length === 0}
              clearDisabled={selectedIds.length === 0}
              onSelectAll={() => gridMarquee.selectAllIds(items.map((x) => x.id))}
              onClearSelection={() => gridMarquee.clearSelectedIds()}
              message={gridMarquee.toolbarMessage}
            />
            <div className={twinListGridClass} data-tour="unorganized-batch-select" onMouseDown={gridMarquee.onGridMouseDown}>
              {items.length === 0 ? <div className={twinListEmptyClass}>暂无未整理文件。</div> : items.map(renderFileCard)}
            </div>
            <div ref={sentinelRef} className="h-6 w-full shrink-0" />
          </div>

          <div className={twinListShellClass}>
            <div className="mb-3 shrink-0 text-sm font-semibold text-slate-100">已整理文件（{organizedItems.length}）</div>
            <MaterialGridSelectionToolbar
              theme="dark"
              disabled={busy || actionBusy}
              selectAllDisabled={organizedItems.length === 0}
              clearDisabled={selectedIds.length === 0}
              onSelectAll={() => gridMarquee.selectAllIds(organizedItems.map((x) => x.id))}
              onClearSelection={() => gridMarquee.clearSelectedIds()}
              message={gridMarquee.toolbarMessage}
            />
            <div className={twinListGridClass} onMouseDown={gridMarquee.onGridMouseDown}>
              {organizedItems.length === 0 ? (
                <div className={twinListEmptyClass}>暂无已整理文件（应用标签后出现在此，与上方列表同一套卡片）。</div>
              ) : (
                organizedItems.map(renderFileCard)
              )}
            </div>
          </div>
        </div>
        <MaterialGridMarqueeOverlay box={gridMarquee.marqueeActive ? gridMarquee.marqueeBox : null} />

        <aside className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-slate-900/55 p-4 shadow-sm backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-slate-100">预览与文件信息</h2>
          <div className="mt-3 flex flex-col gap-2 border-b border-white/10 pb-3">
            <button
              data-tour="unorganized-apply-tags-button"
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"
              disabled={
                busy ||
                actionBusy ||
                batchTargetIds().length === 0 ||
                selectedTagIds.length === 0 ||
                (isPersonalVideo && (!secondaryTaxonomyId || !copyFitText.trim() || !keywordsText.trim()))
              }
              onClick={() => void applyTags()}
            >
              {isPersonalVideo ? "整理入库（替换标签）" : "应用标签（替换原标签）"}
            </button>
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-40"
              disabled={busy || actionBusy || batchTargetIds().length === 0}
              onClick={() => void analyzeContent()}
              title={
                aiAutoApply
                  ? "识别完成后自动新增主题/分类并整理入库，不再弹确认"
                  : "在文件机上读缩略图或预览抽帧，生成建议标签与画面描述；只出建议，不直接改素材"
              }
            >
              {analyzeSubmitting
                ? "正在提交识别…"
                : analyzingCount > 0
                  ? `AI 识别内容（识别中 ${analyzingCount}）`
                  : "AI 识别内容"}
            </button>
            <div className={resultBannerClass(result)}>{result}</div>
            <label
              className={
                aiAutoApply
                  ? "inline-flex items-center gap-2 rounded bg-violet-900 px-2 py-1.5 text-sm font-medium text-violet-50"
                  : "inline-flex items-center gap-2 rounded border border-white/20 px-2 py-1.5 text-sm text-slate-200"
              }
            >
              <input
                type="checkbox"
                checked={aiAutoApply}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAiAutoApply(next);
                  try {
                    window.localStorage.setItem("unorganized-ai-auto-apply", next ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                }}
              />
              自动确认（识别后直接新增并入库）
            </label>
            <button
              type="button"
              className="rounded border border-violet-400/60 bg-violet-500/10 px-3 py-2 text-sm text-violet-100 disabled:opacity-40"
              disabled={busy || actionBusy || batchTargetIds().length === 0}
              onClick={() => void applyAiSuggestions()}
              title="按每个素材各自的建议整理：替换其标签并写入描述"
            >
              采纳建议并整理{suggestionReadyCount > 0 ? `（可采纳 ${suggestionReadyCount}）` : ""}
            </button>
            <button
              type="button"
              className="rounded border border-amber-400/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 disabled:opacity-40"
              disabled={busy || actionBusy || batchTargetIds().length === 0}
              onClick={() => void removeAllTags()}
            >
              移除所有标签
            </button>
            <button
              data-tour="unorganized-trash-button"
              className="rounded border border-red-300 px-3 py-2 text-sm text-red-300 disabled:opacity-40"
              disabled={busy || actionBusy || batchTargetIds().length === 0}
              onClick={() => void moveToTrash()}
            >
              移入回收站
            </button>
            <button
              className="rounded border border-white/20 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
              disabled={busy || actionBusy}
              onClick={() => {
                setSelectedIds([]);
                setSelectedTagIds([]);
                setFocusedId("");
                setSlashResetSeq((s) => s + 1);
              }}
            >
              清空选择
            </button>
          </div>
          {!focusedItem ? (
            <div className="mt-3 text-xs text-slate-400">请先在左侧文件列表中选中一个文件以查看预览与详情。</div>
          ) : (
            <div className="mt-3 grid gap-3 text-xs text-slate-300">
              {focusedSuggestion?.status === "pending" ? (
                <div className="rounded-lg border border-violet-400/40 bg-violet-950 p-2">
                  <div className="flex items-center justify-between text-[11px] font-medium text-violet-50">
                    <span>{focusedSuggestion.step_label || "正在识别"}</span>
                    <span>{analysisPercent(focusedSuggestion)}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-violet-900">
                    <div
                      className="h-full rounded bg-violet-500"
                      style={{ width: `${analysisPercent(focusedSuggestion)}%` }}
                    />
                  </div>
                  <ol className="mt-2 grid gap-1">
                    {ANALYSIS_PROGRESS_STEPS.map((step, idx) => {
                      const currentKey = focusedSuggestion.step || "queued";
                      const currentIdx = Math.max(
                        0,
                        ANALYSIS_PROGRESS_STEPS.findIndex((item) => item.key === currentKey)
                      );
                      const reached = idx <= currentIdx;
                      const current = idx === currentIdx;
                      return (
                        <li
                          key={step.key}
                          className={
                            current
                              ? "rounded bg-violet-800 px-2 py-1 text-[11px] font-medium text-violet-50"
                              : reached
                                ? "rounded px-2 py-1 text-[11px] text-violet-100"
                                : "rounded px-2 py-1 text-[11px] text-violet-200/60"
                          }
                        >
                          {idx + 1}. {step.label}
                          {current ? "（进行中）" : reached ? "（完成）" : ""}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-1.5 text-[11px] text-violet-100">
                    短视频通常 30～90 秒，模型忙时可能到 3～5 分钟。约每 3 秒刷新进度。
                  </div>
                </div>
              ) : null}
              <MaterialFilePreviewArea
                mode={drawerPreviewMode}
                src={
                  thumbnailUrlMap[focusedItem.id] ||
                  normalizeThumb(focusedItem) ||
                  (fileTypeIconMap[getItemExtension(focusedItem)] || "/file-icons/file.svg")
                }
                largeImageSrc={drawerPreviewMode === "image" ? unorgStream.streamUrl : null}
                largeImageLoading={drawerPreviewMode === "image" ? unorgStream.streamLoading : false}
                largeImageError={drawerPreviewMode === "image" ? unorgStream.streamError : null}
                largeImagePlaceholderHint={
                  drawerPreviewMode === "image" && !canDownloadAsset
                    ? "查看原图需具备「下载素材」权限（asset.download）。"
                    : drawerPreviewMode === "image" && !focusedItem.primary_file_id
                      ? "当前素材无主文件 id，无法解析原图。"
                      : null
                }
                videoFallbackPreviewUrl={drawerPreviewMode === "video" ? unorgPreviewVideo.previewUrl : null}
                videoStreamUrl={drawerPreviewMode === "video" ? unorgStream.streamUrl : null}
                videoStreamLoading={
                  drawerPreviewMode === "video"
                    ? unorgPreviewVideo.previewLoading || (unorgStreamResolveEnabled && unorgStream.streamLoading)
                    : false
                }
                videoStreamError={
                  drawerPreviewMode === "video" && !unorgPreviewVideo.previewUrl && !unorgStream.streamUrl
                    ? unorgPreviewVideo.previewError || unorgStream.streamError
                    : null
                }
                videoPlaceholderHint={
                  drawerPreviewMode === "video" && !focusedItem.primary_file_id
                    ? "当前素材无主文件 id，无法解析播放地址。"
                    : drawerPreviewMode === "video" && !canViewAsset
                      ? "内嵌播放需具备「查看素材」权限（asset.view）。"
                      : null
                }
                onError={(e) => {
                  const icon = fileTypeIconMap[getItemExtension(focusedItem)] || "/file-icons/file.svg";
                  const el = e.currentTarget;
                  setThumbnailUrlMap((prev) => {
                    if (!prev[focusedItem.id]) return prev;
                    const next = { ...prev };
                    delete next[focusedItem.id];
                    return next;
                  });
                  thumbnailRequestedRef.current.delete(focusedItem.id);
                  if (el.src.endsWith(icon)) return;
                  el.src = icon;
                }}
              />
              <div>
                <div className="text-slate-500">文件名</div>
                <div className="mt-1 break-words text-sm leading-snug text-white [overflow-wrap:anywhere]">
                  {getDisplayFilename(focusedItem)}
                </div>
                <div>文件大小：{formatBytes(focusedItem.file_size ?? null)}</div>
                {focusedResolutionLabel ? <div>分辨率：{focusedResolutionLabel}</div> : null}
                <div className="text-slate-500">{isPersonalVideo ? "AI内容识别" : "描述"}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-slate-200 [overflow-wrap:anywhere]">
                  {focusedDescriptionText || "—"}
                </div>
                <div>上传人：{focusedItem.uploader_name || "-"}</div>
                <div>上传时间：{focusedItem.created_at}</div>
              </div>
              <div>
                <div className="text-slate-500">标签信息</div>
                <div className="mt-1 break-all">{focusedItem.tags.length > 0 ? focusedItem.tags.join(" / ") : "无标签"}</div>
              </div>
              {focusedSuggestion ? (
                <div className="rounded-lg border border-violet-400/40 bg-violet-500/10 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-violet-100">内容识别建议</div>
                    <div className="text-[11px] text-violet-200">{aiStatusLabel(focusedSuggestion)}</div>
                  </div>
                  {focusedSuggestion.status === "pending" ? (
                    <div className="mt-1 text-violet-50">正在识别，进度见上方步骤条。</div>
                  ) : null}
                  {focusedSuggestion.status === "failed" ? (
                    <div className="mt-1 break-words text-amber-200">{focusedSuggestion.error || "识别失败"}</div>
                  ) : null}
                  {isPersonalVideo && focusedSuggestion.status === "ready" ? (
                    <div className="mt-1.5 grid gap-1.5 text-[11px]">
                      <div>
                        <div className="text-slate-400">AI内容识别</div>
                        <div className="mt-0.5 whitespace-pre-wrap break-words leading-snug text-slate-100 [overflow-wrap:anywhere]">
                          {focusedSuggestion.description || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">标签（已有）</div>
                        {(focusedSuggestion.tags || []).length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(focusedSuggestion.tags || []).map((name, idx) => {
                              const tagId = focusedSuggestion.tag_ids?.[idx] || "";
                              const selected = Boolean(tagId && selectedTagIds.includes(tagId));
                              return (
                                <button
                                  key={`${name}-${tagId || idx}`}
                                  type="button"
                                  className={
                                    selected
                                      ? "rounded bg-violet-800 px-1.5 py-0.5 text-[11px] font-medium text-violet-50"
                                      : "rounded bg-violet-700 px-1.5 py-0.5 text-[11px] text-violet-50 hover:bg-violet-800"
                                  }
                                  disabled={!tagId}
                                  onClick={() => tagId && toggleTag(tagId)}
                                >
                                  {name}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-slate-500">无已有主题命中</div>
                        )}
                      </div>
                      <div>
                        <div className="text-amber-100">主题（待新增）</div>
                        {(focusedSuggestion.unmatched_tags || []).length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(focusedSuggestion.unmatched_tags || []).map((name) => (
                              <button
                                key={name}
                                type="button"
                                className="rounded border border-amber-300/70 bg-amber-900 px-1.5 py-0.5 text-[11px] font-medium text-amber-50 hover:bg-amber-950 disabled:opacity-40"
                                disabled={busy || actionBusy || !canSubmitThemeTag}
                                onClick={() => void createThemeTag(name)}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-slate-500">无需新增主题</div>
                        )}
                      </div>
                      <div className="text-slate-200">
                        <div>两级分类</div>
                        <div className="mt-0.5">
                          一级 {focusedTaxonomy?.primaryName || "—"}（{existenceLabel(Boolean(focusedTaxonomy?.primaryId), Boolean(focusedTaxonomy?.primaryName))}）
                          {" / "}
                          二级 {focusedTaxonomy?.secondaryName || "—"}（{existenceLabel(Boolean(focusedTaxonomy?.secondaryId), Boolean(focusedTaxonomy?.secondaryName))}）
                        </div>
                        {canCreateTaxonomy && !focusedTaxonomy?.secondaryId && (focusedTaxonomy?.primaryId || focusedTaxonomy?.primaryName) ? (
                          <button
                            type="button"
                            className="mt-1 rounded bg-violet-800 px-2 py-0.5 text-[11px] font-medium text-violet-50 hover:bg-violet-900 disabled:opacity-40"
                            disabled={busy || actionBusy}
                            onClick={() => void adoptSuggestedTaxonomy()}
                          >
                            按建议写入分类
                          </button>
                        ) : null}
                      </div>
                      <div className="text-slate-300">关键词：{(focusedSuggestion.keywords || []).join("、") || "识别不完整，请重新识别"}</div>
                      <div className="break-words text-slate-300">承接句意：{focusedSuggestion.copy_fit || "识别不完整，请重新识别"}</div>
                    </div>
                  ) : (
                    <>
                      {focusedSuggestion.description ? (
                        <div className="mt-1 whitespace-pre-wrap break-words leading-snug text-slate-100 [overflow-wrap:anywhere]">
                          {focusedSuggestion.description}
                        </div>
                      ) : null}
                      {(focusedSuggestion.tags || []).length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(focusedSuggestion.tags || []).map((name, idx) => {
                            const tagId = focusedSuggestion.tag_ids?.[idx] || "";
                            const selected = Boolean(tagId && selectedTagIds.includes(tagId));
                            return (
                              <button
                                key={`${name}-${tagId || idx}`}
                                type="button"
                                className={
                                  selected
                                    ? "rounded bg-violet-800 px-1.5 py-0.5 text-[11px] font-medium text-violet-50"
                                    : "rounded bg-violet-700 px-1.5 py-0.5 text-[11px] text-violet-50 hover:bg-violet-800"
                                }
                                disabled={!tagId}
                                onClick={() => tagId && toggleTag(tagId)}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {(focusedSuggestion.unmatched_tags || []).length > 0 ? (
                        <div className="mt-1.5">
                          <div className="text-[11px] text-amber-100">建议主题（点「填入右侧」后写入右侧，也可用 / 批量）</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(focusedSuggestion.unmatched_tags || []).map((name) => (
                              <button
                                key={name}
                                type="button"
                                className="rounded border border-amber-300/70 bg-amber-900 px-1.5 py-0.5 text-[11px] font-medium text-amber-50 hover:bg-amber-950 disabled:opacity-40"
                                disabled={busy || actionBusy || !canSubmitThemeTag}
                                onClick={() => void createThemeTag(name)}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  {focusedSuggestion.status === "ready" ? (
                    <button
                      type="button"
                      className="mt-2 w-full rounded border border-violet-300/60 px-2 py-1 text-[11px] text-violet-100 disabled:opacity-40"
                      disabled={busy || actionBusy}
                      onClick={() => void fillEditorFromSuggestion()}
                    >
                      填入右侧编辑区（可改后再应用）
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </aside>

        <aside data-tour="unorganized-tag-panel" className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-slate-900/55 p-4 shadow-sm backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-slate-100">{isPersonalVideo ? "整理字段" : "批量打标签"}</h2>
          {isPersonalVideo ? (
            <div className="mt-2 grid gap-2 text-sm text-slate-200">
              <label className="grid gap-1">
                一级分类
                <select
                  className="rounded border border-white/20 bg-slate-950 px-2 py-1"
                  value={primaryTaxonomyId}
                  onChange={(e) => {
                    setPrimaryTaxonomyId(e.target.value);
                    setSecondaryTaxonomyId("");
                  }}
                >
                  <option value="">请选择</option>
                  {taxonomyTree.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              {canCreateTaxonomy ? (
                <div className="flex gap-2">
                  <input
                    data-tour="unorganized-create-primary-taxonomy"
                    className="min-w-0 flex-1 rounded border border-white/20 bg-slate-950 px-2 py-1 text-sm"
                    value={newPrimaryName}
                    onChange={(e) => setNewPrimaryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createPrimaryTaxonomy();
                      }
                    }}
                    placeholder="新增一级分类，如：触发"
                    disabled={actionBusy}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded bg-violet-800 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-900 disabled:opacity-40"
                    disabled={actionBusy || !newPrimaryName.trim()}
                    onClick={() => void createPrimaryTaxonomy()}
                  >
                    新增
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">没有新增分类权限，请到标签管理维护分类树。</div>
              )}
              <label className="grid gap-1">
                二级分类
                <select
                  className="rounded border border-white/20 bg-slate-950 px-2 py-1"
                  value={secondaryTaxonomyId}
                  onChange={(e) => setSecondaryTaxonomyId(e.target.value)}
                >
                  <option value="">请选择</option>
                  {(taxonomyTree.find((n) => n.id === primaryTaxonomyId)?.children || []).map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              {canCreateTaxonomy ? (
                <div className="flex gap-2">
                  <input
                    data-tour="unorganized-create-secondary-taxonomy"
                    className="min-w-0 flex-1 rounded border border-white/20 bg-slate-950 px-2 py-1 text-sm"
                    value={newSecondaryName}
                    onChange={(e) => setNewSecondaryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createSecondaryTaxonomy();
                      }
                    }}
                    placeholder={primaryTaxonomyId ? "新增二级分类，如：假装没事" : "请先选择或新增一级，才能新增二级"}
                    disabled={actionBusy || !primaryTaxonomyId}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded bg-violet-800 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-900 disabled:opacity-40"
                    disabled={actionBusy || !primaryTaxonomyId || !newSecondaryName.trim()}
                    onClick={() => void createSecondaryTaxonomy()}
                  >
                    新增
                  </button>
                </div>
              ) : null}
              <label className="grid gap-1">
                关键词（3–6 个，顿号/逗号分隔）
                <input
                  className="rounded border border-white/20 bg-slate-950 px-2 py-1"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="压抑、假笑、委屈"
                />
              </label>
              <label className="grid gap-1">
                承接句意
                <textarea
                  className="min-h-[4.5rem] rounded border border-white/20 bg-slate-950 px-2 py-1"
                  value={copyFitText}
                  onChange={(e) => setCopyFitText(e.target.value)}
                  placeholder="明明已经很难受了，却还是笑着说没事。"
                />
              </label>
              <label className="grid gap-1">
                AI内容识别
                <textarea
                  className="min-h-[5rem] rounded border border-white/20 bg-slate-950 px-2 py-1"
                  value={aiContentText}
                  onChange={(e) => setAiContentText(e.target.value)}
                  placeholder="点「填入右侧编辑区」写入识别建议，可改后再整理入库"
                />
              </label>
              <div className="text-xs text-slate-400">适用主题请在下方勾选（至少 1 个）</div>
              {canSubmitThemeTag ? (
                <div className="grid gap-1">
                  <div className="text-xs text-slate-300">直接新增适用主题（多个用 / 分隔）</div>
                  <div className="flex gap-2">
                    <input
                      data-tour="unorganized-create-theme-tag"
                      className="min-w-0 flex-1 rounded border border-white/20 bg-slate-950 px-2 py-1"
                      value={newThemeName}
                      onChange={(e) => setNewThemeName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createThemeTag();
                        }
                      }}
                      placeholder="破碎/荒凉/夕阳"
                      disabled={actionBusy}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded bg-violet-800 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-900 disabled:opacity-40"
                      disabled={actionBusy || !newThemeName.trim()}
                      onClick={() => void createThemeTag()}
                    >
                      {canCreateThemeTag ? "新增" : "申请"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">没有新增标签权限，请到标签管理申请，或请管理员创建。</div>
              )}
            </div>
          ) : null}
          <TagSlashPicker
            className="mt-2"
            theme="dark"
            slashResetSeq={slashResetSeq}
            inputDataTour="unorganized-replace-slash-input"
            tagGroups={tagGroups}
            selectedTagIds={selectedTagIds}
            onSelectedTagIdsChange={setSelectedTagIds}
          />
          <div className="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start items-start gap-2 overflow-y-auto pr-1">
            {orderedTagGroupKeys.map((group) => (
              <div key={group} className="min-w-0 max-w-full">
                <div className="mb-0.5 text-sm font-medium text-slate-300" title={tagCategoryHoverTitle(group)}>
                  {tagCategoryShort(group)}
                </div>
                <div className="max-h-28 overflow-auto rounded border border-white/20 p-2">
                  {(tagGroups[group] || []).map((tag) => (
                    <label
                      key={tag.id}
                      className="mr-2 inline-flex items-center gap-1 text-xs text-slate-300"
                      title={
                        (tag.description || "").trim()
                          ? `${tag.name} — ${(tag.description || "").trim()}`
                          : tag.name
                      }
                    >
                      <input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <pre className="mt-4 rounded bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{result}</pre>
      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="unorganized" />
      </Suspense>
    </main>
  );
}
