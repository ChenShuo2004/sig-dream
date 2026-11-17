"use client";

import { DragEvent, FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import TutorialGate from "@/components/tutorials/TutorialGate";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { MaterialFileCard } from "@/components/MaterialFileCard";
import { MaterialFilePreviewArea, type MaterialFilePreviewMode } from "@/components/MaterialFilePreviewArea";
import { useMaterialFileStreamUrl } from "@/hooks/useMaterialFileStreamUrl";
import { useMaterialPreviewVideoUrl } from "@/hooks/useMaterialPreviewVideoUrl";
import { formatBytes } from "@/lib/formatBytes";
import { formatResolutionForExtension } from "@/lib/mediaDisplay";
import type { DownloadTransportRoute, MaterialResolvedDownload } from "@/lib/materialBrowserDownload";
import {
  downloadMaterialFileBrowserDefault,
  resolveDirectMediaUrl,
  resolveMaterialDownload,
  triggerBrowserDownload,
} from "@/lib/materialBrowserDownload";
import { isCoarseMobileDevice, streamUrlToDirectoryWithProgress, supportsMaterialDirectorySave } from "@/lib/materialStreamSaveToDirectory";
import {
  persistMaterialSaveDirectoryHandle,
  tryReuseSavedMaterialDownloadDirectory,
} from "@/lib/materialSaveDirectoryPreference";
import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, useAssetLibrary } from "@/lib/assetLibrary";
import { thumbnailAccessContextHeaders } from "@/lib/thumbnailAccessContext";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";
const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const tabBtnSelected =
  "rounded-lg border border-sky-400/60 bg-sky-600/30 px-3 py-2 text-sm font-medium text-sky-100 shadow-sm";
const tabBtnIdle =
  "rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10";

const listBtnSelected =
  "w-full rounded-lg border border-sky-400/60 bg-sky-600/30 px-3 py-2 text-left text-sm text-sky-100 shadow-sm";
const listBtnIdle =
  "w-full rounded-lg border border-transparent px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/10";

const materialStatusLabel: Record<string, string> = {
  available: "可用",
  nas_syncing: "NAS同步中",
  nas_failed: "NAS同步失败",
  trash_pending: "删除同步中",
  trashed: "已移入回收站",
};

/** 与素材库卡片一致：无缩略图时按扩展名 / 粗类型用图标兜底 */
const collectionFileTypeIcon: Record<string, string> = {
  video: "/file-icons/video.svg",
  image: "/file-icons/image.svg",
  audio: "/file-icons/audio.svg",
  pdf: "/file-icons/pdf.svg",
  document: "/file-icons/doc.svg",
  other: "/file-icons/txt.svg",
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

/** 集合页：将条目引用拖至左侧其它集合 */
const COLLECTION_ITEM_MOVE_MIME = "application/x-lcwp-collection-move";

function toAbsoluteUrl(apiBaseUrl: string, maybeRelativeUrl: string): string {
  if (!maybeRelativeUrl) return "";
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  return `${apiBaseUrl.replace(/\/$/, "")}${maybeRelativeUrl}`;
}

type ThumbnailUrlResponse = { url?: string; alternate_urls?: string[] };

type GroupNode = {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
  user_group_name?: string | null;
  sort_order: number;
  children: GroupNode[];
};

type CollectionRow = {
  id: string;
  name: string;
  collection_type: string;
  group_id: string | null;
  status: string;
  item_count: number;
  created_by_name: string;
  created_at: string;
};

type CollectionDetail = {
  id: string;
  name: string;
  description: string | null;
  collection_type: string;
  group_id: string | null;
  status: string;
  visibility: string;
  permission_level: string | null;
  item_count: number;
  created_by_name: string;
  created_at: string;
  permissions: { user_group_name: string; permission_level: string }[];
};

type CollectionMaterialRow = {
  item_id: string;
  material_id: string;
  material_file_id: string | null;
  primary_file_id?: string | null;
  title: string;
  description?: string | null;
  thumbnail_url: string | null;
  file_type: string;
  tags: string[];
  note: string | null;
  sort_order: number;
  added_by_name: string;
  added_at: string;
  original_filename?: string | null;
  file_size?: number | null;
  primary_media_width?: number | null;
  primary_media_height?: number | null;
  download_count?: number;
  material_status?: string;
};

function getCollectionExtension(it: CollectionMaterialRow): string {
  const name = (it.original_filename || it.title || "").trim();
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  return "";
}

/** 与素材库 `getMaterialDisplayName` 对齐：带扩展名的展示文件名 */
function getCollectionDisplayName(it: CollectionMaterialRow): string {
  const ext = getCollectionExtension(it);
  const rawName = (it.original_filename || it.title || "").trim();
  if (!rawName) return (it.title || "").trim() || it.material_id;
  if (!ext) return rawName;
  return rawName.toLowerCase().endsWith(`.${ext}`) ? rawName : `${rawName}.${ext}`;
}

function collectionPersistedThumb(it: CollectionMaterialRow): string {
  const u = it.thumbnail_url?.trim();
  if (u && (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("/"))) return u;
  return "";
}

function getCollectionRowIcon(it: CollectionMaterialRow): string {
  const ext = getCollectionExtension(it);
  if (ext && fileTypeIconMap[ext]) return fileTypeIconMap[ext];
  return collectionFileTypeIcon[it.file_type] || "/file-icons/file.svg";
}

type ConfirmKind = "archive" | "restore" | "delete" | "archive_group" | "delete_group";

type InfoPanelMode = "collection" | "group";

function parseDetail(detail: unknown): string {
  if (detail && typeof detail === "object" && "detail" in detail) {
    const d = (detail as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
  }
  return "";
}

/** DELETE 等可能 204 无 body，不可直接 `resp.json()` */
async function assertOkOrThrowCollectionMutation(resp: Response): Promise<void> {
  const text = await resp.text();
  if (resp.ok) return;
  let msg = `HTTP ${resp.status}`;
  if (text.trim()) {
    try {
      msg = parseDetail(JSON.parse(text) as { detail?: unknown }) || msg;
    } catch {
      msg = text.slice(0, 300) || msg;
    }
  }
  throw new Error(msg);
}

function flattenGroups(nodes: GroupNode[], depth = 0): { node: GroupNode; depth: number }[] {
  const out: { node: GroupNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) {
      out.push(...flattenGroups(n.children, depth + 1));
    }
  }
  return out;
}

function groupOptionsForType(groups: GroupNode[], collectionType: "personal" | "project"): { id: string; label: string }[] {
  const flat = flattenGroups(groups);
  return flat
    .filter(({ node }) => node.group_type === collectionType)
    .map(({ node, depth }) => ({
      id: node.id,
      label: `${"　".repeat(depth)}${node.name}`,
    }));
}

function findGroupNode(nodes: GroupNode[], id: string): GroupNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sub = findGroupNode(n.children || [], id);
    if (sub) return sub;
  }
  return null;
}

export default function CollectionsPage() {
  const apiBase = useMemo(() => "/api-proxy", []);
  const { library, isPersonalVideo } = useAssetLibrary();
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tab, setTab] = useState<"personal" | "project" | "archived">("personal");
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  /** 勾选条目 id（`item_id`），与素材库多选语义一致 */
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  /** 拖放时高亮左侧目标集合按钮 */
  const [dropFocusCollectionId, setDropFocusCollectionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [items, setItems] = useState<CollectionMaterialRow[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  const [itemKeyword, setItemKeyword] = useState("");
  const [itemFileType, setItemFileType] = useState("");
  const [itemSort, setItemSort] = useState<"sort_order" | "added_at" | "created_at">("sort_order");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "info">("info");
  const [newGroupName, setNewGroupName] = useState("");
  const [newCollName, setNewCollName] = useState("");
  const [permLine, setPermLine] = useState("默认分组,view");
  const [confirmDialog, setConfirmDialog] = useState<null | { kind: ConfirmKind; id: string; name: string }>(null);
  const [infoPanelMode, setInfoPanelMode] = useState<InfoPanelMode>("collection");
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupUserGroupName, setEditGroupUserGroupName] = useState("");

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editVisibility, setEditVisibility] = useState("private");
  const [permRows, setPermRows] = useState<{ user_group_name: string; permission_level: string }[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  /** 单条下载：与素材库相同的「浏览器默认 / 选择目录」弹窗 */
  const [downloadSaveChoice, setDownloadSaveChoice] = useState<
    (MaterialResolvedDownload & { allowDirectoryPick: boolean }) | null
  >(null);
  const [thumbnailUrlMap, setThumbnailUrlMap] = useState<Record<string, string>>({});
  const [thumbnailRetryTick, setThumbnailRetryTick] = useState(0);
  const thumbnailRequestedRef = useRef<Set<string>>(new Set());
  /** 集合内拖放：`dragStart` 时写入，供 `dragOver` 设置 `dropEffect`（Chrome 在 over 阶段往往读不到 `getData`） */
  const collectionDragKindRef = useRef<"move" | "copy">("move");
  /** 左栏「分组：」「集合：」折叠面板（默认展开） */
  const [sidebarGroupsOpen, setSidebarGroupsOpen] = useState(true);
  const [sidebarCollectionsOpen, setSidebarCollectionsOpen] = useState(true);

  const canView = permissions.includes("collection.view");
  const canCreate = permissions.includes("collection.create");
  const canEditAll = permissions.includes("collection.edit_all");
  /** 与后端 `patch_group` 一致：具备 `collection.create` 或 `collection.edit_all`（超管由后端 role 兜底） */
  const canManageGroups = canCreate || canEditAll;
  const canDownloadAsset = permissions.includes("asset.download");
  const canBatchDownload = permissions.includes("asset.batch_download");
  const canViewAsset = permissions.includes("asset.view");

  useEffect(() => {
    const s = loadAuthSession();
    if (s?.access_token) setToken(s.access_token);
    setPermissions(s?.permissions || []);
  }, []);

  useEffect(() => {
    setSelectedGroupId(null);
    setSelectedCollectionId(null);
    setSelectedItemId(null);
    setSelectedItemIds([]);
    setItemPage(1);
  }, [library]);
  useEffect(() => {
    if (tab === "project") {
      setTab("personal");
      setSelectedGroupId(null);
      setSelectedCollectionId(null);
      setSelectedItemId(null);
      setSelectedItemIds([]);
      setItemPage(1);
      setMsg("");
      setInfoPanelMode("collection");
    }
  }, [tab]);

  const authHeaders = useCallback(
    (extra: Record<string, string> = {}) => {
      const withLib = assetLibraryHeaders(extra, library);
      return token ? { ...withLib, Authorization: `Bearer ${token}` } : withLib;
    },
    [token, library]
  );

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
        await fetch(`${apiBase}/materials/download-client-report`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });
      } catch {
        /* 非阻塞 */
      }
    })();
  }

  function commitCollectionBrowserDefaultDownload(r: MaterialResolvedDownload) {
    const totalSeconds = ((performance.now() - r.flowStartedAt) / 1000).toFixed(1);
    triggerBrowserDownload(r.absoluteUrl);
    postDownloadClientReport({
      material_id: r.materialId,
      file_id: r.fileId,
      download_mode: "browser_default",
      transport_route: r.transportRoute,
      success: true,
      file_size_bytes: null,
    });
    setMsg(
      r.outcomeKind === "ecs_fallback"
        ? `下载已开始（ECS 兜底，约 ${totalSeconds}s）`
        : `下载已开始（${r.directLabel || "文件机"}直连，约 ${totalSeconds}s）`,
      "success"
    );
  }

  /** 与素材库列表一致：对图片/视频扩展名拉取 `thumbnail-url`，解决仅 metadata 无可用直链时不显示缩略图 */
  const ensureCollectionThumbnails = useCallback(async () => {
    if (!token || !canView || !canViewAsset) return;
    const candidates = items.filter((it) => {
      const ext = getCollectionExtension(it);
      const fid = it.primary_file_id || it.material_file_id;
      return !!fid && (previewImageExts.has(ext) || previewVideoExts.has(ext));
    });
    const pending = candidates.filter(
      (it) => !thumbnailUrlMap[it.material_id] && !thumbnailRequestedRef.current.has(it.material_id)
    );
    if (pending.length === 0) return;

    await Promise.allSettled(
      pending.map(async (it) => {
        const fid = it.primary_file_id || it.material_file_id;
        if (!fid) return;
        thumbnailRequestedRef.current.add(it.material_id);
        try {
          const resp = await fetch(`${apiBase}/materials/${it.material_id}/files/${fid}/thumbnail-url`, {
            headers: authHeaders(thumbnailAccessContextHeaders()),
          });
          const data = (await resp.json()) as ThumbnailUrlResponse | { detail?: unknown };
          if (!resp.ok) throw new Error(parseDetail(data));
          const absUrl = await resolveDirectMediaUrl(apiBase, data as ThumbnailUrlResponse);
          const url = absUrl ? `${absUrl}${absUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}` : "";
          if (url) {
            setThumbnailUrlMap((prev) => ({ ...prev, [it.material_id]: url }));
          } else {
            thumbnailRequestedRef.current.delete(it.material_id);
          }
        } catch {
          thumbnailRequestedRef.current.delete(it.material_id);
        }
      })
    );
    if (pending.length > 0) {
      window.setTimeout(() => setThumbnailRetryTick((v) => v + 1), 1500);
    }
  }, [apiBase, authHeaders, canView, canViewAsset, items, thumbnailUrlMap, token]);

  useEffect(() => {
    setThumbnailUrlMap({});
    thumbnailRequestedRef.current.clear();
  }, [selectedCollectionId]);

  useEffect(() => {
    void ensureCollectionThumbnails();
  }, [ensureCollectionThumbnails, thumbnailRetryTick]);

  function setMsg(text: string, tone: "error" | "success" | "info" = "info") {
    setMessage(text);
    setMessageTone(tone);
  }

  const loadGroups = useCallback(async () => {
    if (!token || !canView) return;
    if (tab === "archived") {
      const [r1, r2] = await Promise.all([
        fetch(`${apiBase}/collections/groups?group_type=personal`, { headers: authHeaders() }),
        fetch(`${apiBase}/collections/groups?group_type=project`, { headers: authHeaders() }),
      ]);
      const d1 = (await r1.json()) as { items?: GroupNode[]; detail?: unknown };
      const d2 = (await r2.json()) as { items?: GroupNode[]; detail?: unknown };
      if (!r1.ok) throw new Error(parseDetail(d1));
      if (!r2.ok) throw new Error(parseDetail(d2));
      setGroups([...(Array.isArray(d1.items) ? d1.items : []), ...(Array.isArray(d2.items) ? d2.items : [])]);
      return;
    }
    const resp = await fetch(`${apiBase}/collections/groups?group_type=${tab}`, { headers: authHeaders() });
    const data = (await resp.json()) as { items?: GroupNode[]; detail?: unknown };
    if (!resp.ok) throw new Error(parseDetail(data));
    setGroups(Array.isArray(data.items) ? data.items : []);
  }, [apiBase, authHeaders, canView, tab, token]);

  const loadCollections = useCallback(async () => {
    if (!token || !canView) return;
    const st = tab === "archived" ? "archived" : "active";
    const ct = tab === "archived" ? undefined : tab === "personal" ? "personal" : "project";
    const params = new URLSearchParams();
    params.set("status", st);
    params.set("page", "1");
    params.set("page_size", "100");
    if (ct) params.set("collection_type", ct);
    if (selectedGroupId) params.set("group_id", selectedGroupId);
    const resp = await fetch(`${apiBase}/collections?${params.toString()}`, { headers: authHeaders() });
    const data = (await resp.json()) as { items?: CollectionRow[]; detail?: unknown };
    if (!resp.ok) throw new Error(parseDetail(data));
    setCollections(Array.isArray(data.items) ? data.items : []);
  }, [apiBase, authHeaders, canView, selectedGroupId, tab, token]);

  const loadCollectionDetail = useCallback(
    async (cid: string) => {
      if (!token || !canView) return;
      const dResp = await fetch(`${apiBase}/collections/${cid}`, { headers: authHeaders() });
      const dJson = (await dResp.json()) as CollectionDetail & { detail?: unknown };
      if (!dResp.ok) throw new Error(parseDetail(dJson));
      setDetail(dJson);
      setEditName(dJson.name || "");
      setEditDescription(dJson.description || "");
      setEditGroupId(dJson.group_id || "");
      setEditVisibility(dJson.visibility || "private");
      setPermRows(dJson.permissions?.length ? dJson.permissions.map((p) => ({ ...p })) : [{ user_group_name: "", permission_level: "view" }]);
    },
    [apiBase, authHeaders, canView, token]
  );

  const loadCollectionItems = useCallback(
    async (cid: string, page: number) => {
      if (!token || !canView) return;
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", "50");
      params.set("sort", itemSort);
      if (itemKeyword.trim()) params.set("keyword", itemKeyword.trim());
      if (itemFileType.trim()) params.set("file_type", itemFileType.trim());
      const mResp = await fetch(`${apiBase}/collections/${cid}/materials?${params.toString()}`, {
        headers: authHeaders(thumbnailAccessContextHeaders()),
      });
      const mJson = (await mResp.json()) as {
        items?: CollectionMaterialRow[];
        total?: number;
        detail?: unknown;
      };
      if (!mResp.ok) throw new Error(parseDetail(mJson));
      setItems(Array.isArray(mJson.items) ? mJson.items : []);
      setItemsTotal(typeof mJson.total === "number" ? mJson.total : 0);
    },
    [apiBase, authHeaders, canView, itemFileType, itemKeyword, itemSort, token]
  );

  useEffect(() => {
    if (!token || !canView) return;
    void (async () => {
      try {
        await loadGroups();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "加载分组失败", "error");
      }
    })();
  }, [canView, loadGroups, token]);

  useEffect(() => {
    if (!token || !canView) return;
    void (async () => {
      try {
        await loadCollections();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "加载集合失败", "error");
      }
    })();
  }, [canView, loadCollections, token]);

  useEffect(() => {
    if (!selectedCollectionId || !token) {
      setDetail(null);
      setItems([]);
      setItemsTotal(0);
      setSelectedItemId(null);
      setSelectedItemIds([]);
      return;
    }
    void (async () => {
      try {
        await loadCollectionDetail(selectedCollectionId);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "加载集合详情失败", "error");
      }
    })();
  }, [loadCollectionDetail, selectedCollectionId, token]);

  useEffect(() => {
    if (!selectedCollectionId || !token || !canView) return;
    void (async () => {
      try {
        await loadCollectionItems(selectedCollectionId, itemPage);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "加载条目失败", "error");
      }
    })();
  }, [itemFileType, itemKeyword, itemPage, itemSort, loadCollectionItems, selectedCollectionId, token, canView]);

  const selectedItem = useMemo(
    () => (selectedItemId ? items.find((x) => x.item_id === selectedItemId) ?? null : null),
    [items, selectedItemId]
  );

  const collectionDrawerResolutionLabel = useMemo(() => {
    if (!selectedItem) return null;
    const ext = getCollectionExtension(selectedItem);
    return formatResolutionForExtension(ext, selectedItem.primary_media_width, selectedItem.primary_media_height);
  }, [selectedItem]);

  const collectionDrawerDescription = useMemo(() => {
    const raw = (selectedItem?.description ?? "").trim();
    return raw || null;
  }, [selectedItem]);

  useEffect(() => {
    setSelectedItemIds((prev) => prev.filter((id) => items.some((x) => x.item_id === id)));
  }, [items]);

  function toggleCollectionItemSelection(itemId: string) {
    setSelectedItemIds((prev) => (prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId]));
    setSelectedItemId(itemId);
  }

  /** 下载 / 移除：有勾选优先；否则用当前预览行（`selectedItemId`） */
  const actionTargetItemIds = useMemo(() => {
    if (selectedItemIds.length > 0) return selectedItemIds;
    if (selectedItemId) return [selectedItemId];
    return [];
  }, [selectedItemId, selectedItemIds]);

  useEffect(() => {
    if (selectedItem) setNoteDraft(selectedItem.note || "");
    else setNoteDraft("");
  }, [selectedItem]);

  const selectedGroupNode = useMemo(() => {
    if (!selectedGroupId) return null;
    return findGroupNode(groups, selectedGroupId);
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (infoPanelMode !== "group" || !selectedGroupId) return;
    const node = findGroupNode(groups, selectedGroupId);
    if (node) {
      setEditGroupName(node.name || "");
      setEditGroupUserGroupName(node.user_group_name || "");
    }
  }, [infoPanelMode, selectedGroupId, groups]);

  const childSubgroupCount = useMemo(() => {
    if (!selectedGroupId) return 0;
    return flattenGroups(groups).filter(({ node }) => node.parent_id === selectedGroupId).length;
  }, [groups, selectedGroupId]);

  /** 当前列表请求在选中分组时已带 `group_id`，条目即该分组下（非已删）集合数量 */
  const collectionsInSelectedGroup = useMemo(() => {
    if (!selectedGroupId) return 0;
    return collections.filter((c) => c.group_id === selectedGroupId && c.status !== "deleted").length;
  }, [collections, selectedGroupId]);

  const groupCanArchiveOrDelete =
    !!selectedGroupId &&
    tab !== "archived" &&
    childSubgroupCount === 0 &&
    collectionsInSelectedGroup === 0 &&
    canManageGroups;

  const groupDangerBlockReason = useMemo(() => {
    if (!selectedGroupId) return "请先在左侧选中一个分组";
    if (tab === "archived") return "「已归档」页不支持分组归档/删除";
    if (!canManageGroups) return "无分组管理权限（需 collection.create 或 collection.edit_all）";
    if (childSubgroupCount > 0) return "存在子分组时不可归档或删除";
    if (collectionsInSelectedGroup > 0) return "分组下仍有集合时不可归档或删除";
    return "";
  }, [
    canManageGroups,
    childSubgroupCount,
    collectionsInSelectedGroup,
    selectedGroupId,
    tab,
  ]);

  async function onCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const gt = tab === "archived" ? "personal" : tab;
      const resp = await fetch(`${apiBase}/collections/groups`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: newGroupName.trim(),
          group_type: gt,
          parent_id: null,
          user_group_name: null,
        }),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      setNewGroupName("");
      await loadGroups();
      setMsg("分组已创建", "success");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateCollection(e: FormEvent) {
    e.preventDefault();
    if (!newCollName.trim()) return;
    if (!selectedGroupId) {
      setMsg("新建集合前请在左侧「分组」中点选一个具体分组（「全部」仅用于浏览筛选，不是分组）", "error");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const ct = tab === "archived" ? "personal" : tab === "personal" ? "personal" : "project";
      const body: Record<string, unknown> = {
        name: newCollName.trim(),
        collection_type: ct,
        group_id: selectedGroupId,
      };
      if (ct === "project") {
        const segs = permLine.split(",").map((x) => x.trim());
        if (segs.length < 2 || !segs[0]) {
          throw new Error("项目集合请填写权限：用户组名,权限级别（如 默认分组,edit）");
        }
        body.permissions = [{ user_group_name: segs[0], permission_level: segs[1] || "view" }];
      }
      const resp = await fetch(`${apiBase}/collections`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      setNewCollName("");
      await loadCollections();
      setMsg("集合已创建", "success");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveCollectionMeta() {
    if (!selectedCollectionId || !detail) return;
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        description: editDescription.trim() || null,
        group_id: editGroupId || null,
      };
      if (detail.collection_type === "project") {
        body.visibility = editVisibility;
      }
      if (detail.collection_type === "project" && canEditProjectPermissions) {
        const cleaned = permRows
          .map((r) => ({
            user_group_name: r.user_group_name.trim(),
            permission_level: r.permission_level.trim(),
          }))
          .filter((r) => r.user_group_name && r.permission_level);
        if (cleaned.length === 0) throw new Error("项目集合至少保留一条用户组权限");
        body.permissions = cleaned;
      }
      const resp = await fetch(`${apiBase}/collections/${selectedCollectionId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      await loadCollectionDetail(selectedCollectionId);
      await loadCollections();
      setMsg("已保存", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runArchive() {
    if (!confirmDialog || confirmDialog.kind !== "archive") return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/${confirmDialog.id}/archive`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      setConfirmDialog(null);
      await loadCollections();
      setSelectedCollectionId(null);
      setSelectedItemIds([]);
      setMsg("已归档", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "归档失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runRestore() {
    if (!confirmDialog || confirmDialog.kind !== "restore") return;
    const restoreId = confirmDialog.id;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/${restoreId}/restore`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      setConfirmDialog(null);
      await loadCollections();
      if (selectedCollectionId === restoreId) {
        await loadCollectionDetail(restoreId);
        await loadCollectionItems(restoreId, itemPage);
      }
      setMsg("已恢复为可用状态", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "恢复失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteCollection() {
    if (!confirmDialog || confirmDialog.kind !== "delete") return;
    const id = confirmDialog.id;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const data = (await resp.json()) as { detail?: unknown };
          msg = parseDetail(data) || msg;
        } catch {
          /* 204 或无 JSON */
        }
        throw new Error(msg);
      }
      setConfirmDialog(null);
      setSelectedCollectionId(null);
      setSelectedItemId(null);
      setSelectedItemIds([]);
      await loadCollections();
      setMsg("集合已删除（软删除）", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveGroupMeta() {
    if (!selectedGroupId || !selectedGroupNode) return;
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        name: editGroupName.trim(),
        parent_id: null,
      };
      if (selectedGroupNode.group_type === "project") {
        body.user_group_name = editGroupUserGroupName.trim() || null;
      }
      const resp = await fetch(`${apiBase}/collections/groups/${selectedGroupId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      await loadGroups();
      await loadCollections();
      setMsg("分组已保存", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runArchiveGroup() {
    if (!confirmDialog || confirmDialog.kind !== "archive_group") return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/groups/${confirmDialog.id}/archive`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      setConfirmDialog(null);
      if (selectedGroupId === confirmDialog.id) {
        setSelectedGroupId(null);
        setInfoPanelMode("collection");
      }
      await loadGroups();
      await loadCollections();
      setMsg("分组已归档", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "归档失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteGroup() {
    if (!confirmDialog || confirmDialog.kind !== "delete_group") return;
    const gid = confirmDialog.id;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/groups/${gid}`, { method: "DELETE", headers: authHeaders() });
      await assertOkOrThrowCollectionMutation(resp);
      setConfirmDialog(null);
      if (selectedGroupId === gid) {
        setSelectedGroupId(null);
        setInfoPanelMode("collection");
      }
      await loadGroups();
      await loadCollections();
      setMsg("分组已删除（软删除）", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeCollectionItems(itemIds: string[]) {
    if (!selectedCollectionId || itemIds.length === 0) return;
    if (itemIds.length > 1) {
      if (!window.confirm(`确定从本集合移除 ${itemIds.length} 条素材引用？`)) return;
    }
    setBusy(true);
    setMsg("");
    try {
      for (const itemId of itemIds) {
        const resp = await fetch(`${apiBase}/collections/${selectedCollectionId}/items/${itemId}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        await assertOkOrThrowCollectionMutation(resp);
      }
      setSelectedItemId((cur) => (cur && itemIds.includes(cur) ? null : cur));
      setSelectedItemIds((prev) => prev.filter((x) => !itemIds.includes(x)));
      await Promise.all([
        loadCollectionItems(selectedCollectionId, itemPage),
        loadCollectionDetail(selectedCollectionId),
        loadCollections(),
      ]);
      setMsg(itemIds.length > 1 ? `已批量移除 ${itemIds.length} 条` : "已从集合移除", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "移除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function applyCollectionItemsDropToTarget(
    targetCollectionId: string,
    itemIdsRaw: string[],
    mode: "move" | "copy"
  ) {
    if (!selectedCollectionId || !detail) return;
    if (!(detail.permission_level === "edit" || detail.permission_level === "manage")) return;
    if (targetCollectionId === selectedCollectionId) return;

    const targetRow = collections.find((x) => x.id === targetCollectionId);
    if (!targetRow || targetRow.status !== "active") {
      setMsg("仅可将引用拖入「活跃」状态的集合。", "error");
      return;
    }
    if (targetRow.collection_type !== detail.collection_type) {
      setMsg("个人集合与项目集合之间不可互相拖移或复制引用。", "error");
      return;
    }

    const rows = itemIdsRaw
      .map((id) => items.find((x) => x.item_id === id))
      .filter((x): x is CollectionMaterialRow => Boolean(x));
    if (rows.length === 0) {
      setMsg(
        mode === "move"
          ? "仅能移动当前列表页内的条目；其它页的勾选请先切到对应页再拖，或使用右侧「从集合移除」。"
          : "仅能复制当前列表页内的条目；其它页的勾选请先切到对应页再拖。",
        "error"
      );
      return;
    }
    const skipped = itemIdsRaw.length - rows.length;
    if (skipped > 0) {
      setMsg(`有 ${skipped} 条不在当前页，将只${mode === "copy" ? "复制" : "移动"}本页内找到的 ${rows.length} 条。`, "info");
    }

    if (rows.length > 1) {
      const ok = window.confirm(
        mode === "copy"
          ? `将 ${rows.length} 条素材引用复制到「${targetRow.name}」？\n源集合中的引用将保留（不删除素材文件）。`
          : `将 ${rows.length} 条素材引用移动到「${targetRow.name}」？\n原集合中的对应引用将被移除（不删除素材文件）。`
      );
      if (!ok) return;
    }

    setBusy(true);
    setMsg("");
    try {
      const body = {
        items: rows.map((r) => ({
          material_id: r.material_id,
          material_file_id: r.material_file_id,
          note: r.note,
        })),
      };
      const resp = await fetch(`${apiBase}/collections/${targetCollectionId}/items/batch`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));

      if (mode === "move") {
        for (const row of rows) {
          const delResp = await fetch(`${apiBase}/collections/${selectedCollectionId}/items/${row.item_id}`, {
            method: "DELETE",
            headers: authHeaders(),
          });
          await assertOkOrThrowCollectionMutation(delResp);
        }
        setSelectedItemId(null);
        setSelectedItemIds([]);
        await Promise.all([
          loadCollectionItems(selectedCollectionId, itemPage),
          loadCollectionDetail(selectedCollectionId),
          loadCollections(),
        ]);
        setMsg(`已将 ${rows.length} 条引用移动到「${targetRow.name}」`, "success");
      } else {
        await loadCollections();
        setMsg(`已将 ${rows.length} 条引用复制到「${targetRow.name}」`, "success");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : mode === "copy" ? "复制失败" : "移动失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveItemNote() {
    if (!selectedCollectionId || !selectedItem) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/collections/${selectedCollectionId}/items/${selectedItem.item_id}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ note: noteDraft.trim() || null }),
      });
      const data = (await resp.json()) as { detail?: unknown };
      if (!resp.ok) throw new Error(parseDetail(data));
      await loadCollectionItems(selectedCollectionId, itemPage);
      setMsg("备注已保存", "success");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存备注失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadCollectionTargets() {
    const ids = actionTargetItemIds;
    if (ids.length === 0) {
      setMsg("请先勾选条目或点击卡片选择一条", "error");
      return;
    }
    const rows = ids
      .map((id) => items.find((x) => x.item_id === id))
      .filter((x): x is CollectionMaterialRow => Boolean(x));
    if (rows.length !== ids.length) {
      setMsg("部分条目不在当前页，请重新勾选", "error");
      return;
    }
    if (ids.length >= 2 && !canBatchDownload) {
      setMsg("批量下载需要「批量下载」权限（asset.batch_download）", "error");
      return;
    }
    if (!canDownloadAsset) {
      setMsg("无下载权限", "error");
      return;
    }
    setMsg("");

    const validateRow = (row: CollectionMaterialRow) => {
      const fid = row.primary_file_id || row.material_file_id;
      if (!fid) {
        setMsg(`条目无文件：${getCollectionDisplayName(row)}`, "error");
        return null as string | null;
      }
      if (row.material_status && row.material_status !== "available") {
        setMsg(`素材非「可用」状态，无法下载：${getCollectionDisplayName(row)}`, "error");
        return null;
      }
      return fid;
    };

    /** 仅 1 条：与素材库一致弹「选择保存方式」（移动端仍直接浏览器下载） */
    if (rows.length === 1) {
      const row = rows[0];
      const fid = validateRow(row);
      if (!fid) return;
      if (isCoarseMobileDevice()) {
        setBusy(true);
        try {
          await downloadMaterialFileBrowserDefault({
            apiBaseUrl: apiBase,
            materialId: row.material_id,
            fileId: fid,
            authHeaders: () => authHeaders(),
            filename: getCollectionDisplayName(row),
          });
          setMsg("已开始下载", "success");
        } catch (e) {
          setMsg(e instanceof Error ? e.message : "下载失败", "error");
        } finally {
          setBusy(false);
        }
        return;
      }
      try {
        const resolved = await resolveMaterialDownload({
          apiBaseUrl: apiBase,
          materialId: row.material_id,
          fileId: fid,
          filename: getCollectionDisplayName(row),
          authHeaders: () => authHeaders(),
        });
        setDownloadSaveChoice({ ...resolved, allowDirectoryPick: supportsMaterialDirectorySave() });
        setMsg("已准备好下载，请在弹窗中选择保存方式。", "info");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "下载失败", "error");
      }
      return;
    }

    setBusy(true);
    let dirHandle: FileSystemDirectoryHandle | null = null;
    const canPickDir = supportsMaterialDirectorySave();
    if (canPickDir) {
      dirHandle = await tryReuseSavedMaterialDownloadDirectory();
      if (!dirHandle) {
        setBusy(false);
        setMsg(
          "批量下载需使用上次保存目录。请先在素材库对任意文件使用一次「选择本地目录保存」，再批量下载。",
          "error"
        );
        return;
      }
    } else {
      const cont = window.confirm(
        "当前环境无法选择文件夹批量保存；浏览器逐个下载通常只能成功第一个。是否仍继续？"
      );
      if (!cont) {
        setBusy(false);
        return;
      }
    }

    try {
      let i = 0;
      for (const row of rows) {
        i += 1;
        const fid = validateRow(row);
        if (!fid) return;
        if (i > 1 && !dirHandle) {
          await new Promise((r) => setTimeout(r, 1500));
        }
        setMsg(
          dirHandle ? `正在写入第 ${i}/${rows.length} 个到上次保存目录…` : `正在下载 ${i}/${rows.length}…`,
          "info"
        );
        if (dirHandle) {
          const resolved = await resolveMaterialDownload({
            apiBaseUrl: apiBase,
            materialId: row.material_id,
            fileId: fid,
            filename: getCollectionDisplayName(row),
            authHeaders: () => authHeaders(),
          });
          await streamUrlToDirectoryWithProgress(
            resolved.absoluteUrl,
            resolved.filename,
            undefined,
            () => {},
            dirHandle
          );
        } else {
          await downloadMaterialFileBrowserDefault({
            apiBaseUrl: apiBase,
            materialId: row.material_id,
            fileId: fid,
            authHeaders: () => authHeaders(),
            filename: getCollectionDisplayName(row),
            openInNewTab: false,
          });
        }
      }
      if (dirHandle) void persistMaterialSaveDirectoryHandle(dirHandle);
      setMsg(
        dirHandle
          ? `已将 ${rows.length} 个主文件写入上次保存目录`
          : `已触发 ${rows.length} 个下载；若缺少文件请先在素材库用「选择本地目录保存」记录目录`,
        "success"
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "下载失败", "error");
    } finally {
      setBusy(false);
    }
  }

  const flatGroups = useMemo(() => flattenGroups(groups), [groups]);
  const groupSelectOptions = useMemo(() => {
    if (!detail) return [];
    const t = detail.collection_type === "project" ? "project" : "personal";
    return groupOptionsForType(groups, t);
  }, [detail, groups]);

  const canArchiveOrRestore = detail && (detail.permission_level === "manage" || canEditAll);
  const canEditCollectionMeta =
    detail &&
    (canEditAll ||
      (detail.collection_type === "personal" && (detail.permission_level === "edit" || detail.permission_level === "manage")) ||
      (detail.collection_type === "project" && detail.permission_level === "manage"));
  const canEditProjectPermissions = detail?.collection_type === "project" && (detail.permission_level === "manage" || canEditAll);
  const canDeleteCollectionBtn = detail && (detail.permission_level === "manage" || canEditAll) && detail.status !== "deleted";
  const canEditItems = detail && (detail.permission_level === "edit" || detail.permission_level === "manage");
  const canDragCollectionItems = Boolean(
    canEditItems && tab !== "archived" && detail && detail.status === "active"
  );

  const collectionDrawerFileId = selectedItem
    ? String(selectedItem.primary_file_id || selectedItem.material_file_id || "").trim() || null
    : null;
  const collectionDrawerPreviewMode = useMemo((): MaterialFilePreviewMode => {
    if (!selectedItem) return "generic";
    const ext = getCollectionExtension(selectedItem);
    if (selectedItem.file_type === "video" || previewVideoExts.has(ext)) return "video";
    if (selectedItem.file_type === "image" || previewImageExts.has(ext)) return "image";
    return "generic";
  }, [selectedItem]);
  const collectionStreamResolveEnabled =
    (collectionDrawerPreviewMode === "image" || collectionDrawerPreviewMode === "video") &&
    canDownloadAsset &&
    !!token.trim() &&
    !!selectedItem?.material_id &&
    !!collectionDrawerFileId &&
    (selectedItem?.material_status || "") === "available";
  const collectionPreviewResolveEnabled =
    collectionDrawerPreviewMode === "video" &&
    canViewAsset &&
    !!token.trim() &&
    !!selectedItem?.material_id &&
    !!collectionDrawerFileId;
  const collectionStream = useMaterialFileStreamUrl({
    apiBaseUrl: apiBase,
    materialId: selectedItem?.material_id ?? null,
    fileId: collectionDrawerFileId,
    filename: selectedItem ? getCollectionDisplayName(selectedItem) : "preview.bin",
    enabled: collectionStreamResolveEnabled,
    token,
  });
  const collectionPreviewVideo = useMaterialPreviewVideoUrl({
    apiBaseUrl: apiBase,
    materialId: selectedItem?.material_id ?? null,
    fileId: collectionDrawerFileId,
    enabled: collectionPreviewResolveEnabled,
    token,
  });

  if (!canView) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-10">
        <MaintenanceBanner token={token} />
        <p className="mt-4 text-sm text-slate-300">您没有「查看集合」权限，无法使用素材集合模块。</p>
      </main>
    );
  }

  const itemPageTotal = Math.max(1, Math.ceil(itemsTotal / 50));

  return (
    <main className="mx-auto w-full min-w-0 px-4 py-8 sm:px-6 2xl:px-8">
      <MaintenanceBanner token={token} />

      {confirmDialog ? (
        <div
          className="fixed inset-0 z-[20000] flex items-center justify-center bg-slate-900/55 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              {confirmDialog.kind === "archive"
                ? "确认归档"
                : confirmDialog.kind === "restore"
                  ? "确认恢复"
                  : confirmDialog.kind === "archive_group"
                    ? "确认归档分组"
                    : confirmDialog.kind === "delete_group"
                      ? "确认删除分组"
                      : "确认删除集合"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {confirmDialog.kind === "archive"
                ? `确定要将集合「${confirmDialog.name}」归档吗？归档后可在「已归档」中查看并恢复。`
                : confirmDialog.kind === "restore"
                  ? `确定将集合「${confirmDialog.name}」恢复为「可用」状态吗？`
                  : confirmDialog.kind === "archive_group"
                    ? `确定归档分组「${confirmDialog.name}」吗？归档后该分组不再出现在左侧列表；分组下须无集合（历史子分组须已清空）。`
                    : confirmDialog.kind === "delete_group"
                      ? `确定软删除分组「${confirmDialog.name}」吗？记录保留为已删除状态；分组下须无集合（历史子分组须已清空）。`
                      : `确定软删除集合「${confirmDialog.name}」吗？不会删除素材文件，仅标记集合为已删除。`}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirmDialog(null)}>
                取消
              </button>
              <button
                type="button"
                className={
                  confirmDialog.kind === "delete" ||
                  confirmDialog.kind === "archive" ||
                  confirmDialog.kind === "archive_group" ||
                  confirmDialog.kind === "delete_group"
                    ? btnDanger
                    : btnPrimary
                }
                disabled={busy}
                onClick={() =>
                  void (confirmDialog.kind === "archive"
                    ? runArchive()
                    : confirmDialog.kind === "restore"
                      ? runRestore()
                      : confirmDialog.kind === "archive_group"
                        ? runArchiveGroup()
                        : confirmDialog.kind === "delete_group"
                          ? runDeleteGroup()
                          : runDeleteCollection())
                }
              >
                {confirmDialog.kind === "archive"
                  ? "确认归档"
                  : confirmDialog.kind === "restore"
                    ? "确认恢复"
                    : confirmDialog.kind === "archive_group"
                      ? "确认归档"
                      : confirmDialog.kind === "delete_group"
                        ? "确认删除"
                        : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {downloadSaveChoice ? (
        <div
          className="fixed inset-0 z-[20001] flex items-center justify-center bg-slate-900/55 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collections-download-save-choice-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="collections-download-save-choice-title" className="text-base font-semibold text-slate-900">
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
                时，浏览器视为<strong className="font-semibold">非安全上下文</strong>，不会开放「选择本地目录」API。需要该能力时请使用{" "}
                <strong className="font-semibold">HTTPS</strong> 或本机 <strong className="font-semibold">localhost</strong> 访问。此处仍可使用「浏览器默认下载」。
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
                  commitCollectionBrowserDefaultDownload(r);
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
                    setBusy(true);
                    void (async () => {
                      try {
                        const bytes = await streamUrlToDirectoryWithProgress(
                          r.absoluteUrl,
                          r.filename,
                          undefined,
                          (received, total) => {
                            setMsg(
                              `写入中… ${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""}`,
                              "info"
                            );
                          }
                        );
                        postDownloadClientReport({
                          material_id: r.materialId,
                          file_id: r.fileId,
                          download_mode: "choose_directory",
                          transport_route: r.transportRoute,
                          success: true,
                          file_size_bytes: bytes,
                        });
                        setMsg(`已写入所选文件夹（${formatBytes(bytes)}）`, "success");
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
                        setMsg(
                          isPickerCancel ? "已取消目录选择或未授予写入权限。" : `写入失败：${raw}`,
                          isPickerCancel ? "info" : "error"
                        );
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  选择本地目录保存
                </button>
              ) : null}
              <button type="button" className={btnSecondary + " w-full justify-center"} onClick={() => setDownloadSaveChoice(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h1 className="text-lg font-semibold tracking-wide text-slate-100" data-tour="collections-step-goto-materials">
        {isPersonalVideo ? "素材集合 · 个人视频素材库" : "素材集合 · 汽车素材库"}
      </h1>

      <div className="mt-4 flex flex-wrap gap-2" data-tour="collections-root-tabs">
        {(["personal", "archived"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-tour={t === "personal" ? "collections-tab-personal" : undefined}
            className={tab === t ? tabBtnSelected : tabBtnIdle}
            onClick={() => {
              setTab(t);
              setSelectedGroupId(null);
              setSelectedCollectionId(null);
              setSelectedItemId(null);
              setSelectedItemIds([]);
              setItemPage(1);
              setMsg("");
              setInfoPanelMode("collection");
              setSidebarGroupsOpen(true);
              setSidebarCollectionsOpen(true);
            }}
          >
            {t === "personal" ? "我的集合" : "已归档"}
          </button>
        ))}
      </div>

      {message ? (
        <p
          className={
            messageTone === "error"
              ? "mt-3 text-sm text-red-300"
              : messageTone === "success"
                ? "mt-3 text-sm text-emerald-300"
                : "mt-3 text-sm text-slate-400"
          }
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(10rem,3fr)_minmax(10rem,3fr)_minmax(0,10fr)_minmax(12rem,4fr)]">
        <aside data-tour="collections-tree" className="h-fit min-w-0 rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <div className="mb-2 text-sm font-semibold text-slate-100">分组与集合</div>
          <details
            className="mb-3"
            open={sidebarGroupsOpen}
            onToggle={(e) => setSidebarGroupsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">分组：</summary>
            <div className="mt-2 max-h-48 space-y-1 overflow-auto pr-1" data-tour="collections-group-list">
              <button
                type="button"
                className={selectedGroupId === null ? listBtnSelected : listBtnIdle}
                onClick={() => setSelectedGroupId(null)}
                title="筛选：列出当前标签下全部集合；新建集合须先点选下方某一具体分组"
              >
                全部
              </button>
              {flatGroups.map(({ node }) => (
                <button
                  key={node.id}
                  type="button"
                  className={selectedGroupId === node.id ? listBtnSelected : listBtnIdle}
                  onClick={() => setSelectedGroupId(node.id)}
                >
                  {node.name}
                </button>
              ))}
            </div>
          </details>

          {canCreate ? (
            <form onSubmit={onCreateGroup} data-tour="collections-new-group-form" className="mb-0 grid gap-2 border-t border-white/10 pt-3">
              <input
                className={inputClass}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="新分组名称"
              />
              <button data-tour="collections-new-group-submit" type="submit" className={btnPrimary + " w-full justify-center"} disabled={busy}>
                新建分组
              </button>
            </form>
          ) : null}

          <hr className={(canCreate ? "mt-4 " : "mt-3 ") + "border-0 border-t-2 border-sky-400/40"} />
          <div className="pt-3">
            <details
              open={sidebarCollectionsOpen}
              onToggle={(e) => setSidebarCollectionsOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">集合：</summary>
              <div data-tour="collections-collection-list" className="mt-2 max-h-[min(40vh,320px)] space-y-1 overflow-auto pr-1">
                {collections.map((c) => {
                  const isDropTarget =
                    canDragCollectionItems &&
                    c.id !== selectedCollectionId &&
                    c.status === "active" &&
                    detail &&
                    c.collection_type === detail.collection_type;
                  return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${selectedCollectionId === c.id ? listBtnSelected : listBtnIdle} mb-2${
                      dropFocusCollectionId === c.id && isDropTarget ? " ring-2 ring-amber-400/85 ring-offset-2 ring-offset-slate-900" : ""
                    }`}
                    onClick={() => {
                      setSelectedCollectionId(c.id);
                      setSelectedItemId(null);
                      setSelectedItemIds([]);
                      setItemPage(1);
                      setInfoPanelMode("collection");
                    }}
                    onDragOver={(e) => {
                      if (!canDragCollectionItems) return;
                      const types = Array.from(e.dataTransfer.types || []);
                      if (!types.includes(COLLECTION_ITEM_MOVE_MIME) && !types.includes("text/plain")) return;
                      e.preventDefault();
                      if (!isDropTarget) {
                        e.dataTransfer.dropEffect = "none";
                        return;
                      }
                      e.dataTransfer.dropEffect = collectionDragKindRef.current === "copy" ? "copy" : "move";
                      setDropFocusCollectionId(c.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropFocusCollectionId(null);
                      if (!canDragCollectionItems || !detail || !selectedCollectionId) return;
                      const raw =
                        e.dataTransfer.getData(COLLECTION_ITEM_MOVE_MIME) ||
                        e.dataTransfer.getData("text/plain") ||
                        "";
                      let parsed: { sourceCollectionId?: string; itemIds?: string[]; copy?: boolean } = {};
                      try {
                        parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
                      } catch {
                        return;
                      }
                      if (!parsed.sourceCollectionId || !Array.isArray(parsed.itemIds) || parsed.itemIds.length === 0)
                        return;
                      if (parsed.sourceCollectionId !== selectedCollectionId) return;
                      if (!isDropTarget) return;
                      const mode: "move" | "copy" = parsed.copy ? "copy" : "move";
                      void applyCollectionItemsDropToTarget(c.id, parsed.itemIds, mode);
                    }}
                  >
                    <div className="font-medium text-inherit">{c.name}</div>
                    <div className="mt-0.5 text-xs opacity-90">
                      {c.item_count} 条 · {c.status}
                    </div>
                  </button>
                  );
                })}
              </div>
            </details>
          </div>

          {canCreate ? (
            <form onSubmit={onCreateCollection} data-tour="collections-new-collection-form" className="mt-4 grid gap-2 border-t border-white/10 pt-3">
              {!selectedGroupId ? (
                <p className="text-[11px] leading-snug text-amber-200/90">
                  「全部」仅浏览筛选；新建集合须先在上方选中<strong className="font-medium">某一具体分组</strong>。
                </p>
              ) : null}
              <input
                className={inputClass}
                value={newCollName}
                onChange={(e) => setNewCollName(e.target.value)}
                placeholder="新集合名称"
                disabled={busy || tab === "archived" || !selectedGroupId}
              />
              {tab === "project" ? (
                <input
                  className={inputClass + " text-xs"}
                  value={permLine}
                  onChange={(e) => setPermLine(e.target.value)}
                  placeholder="项目权限：用户组名,级别（如 默认分组,edit）"
                  disabled={busy || !selectedGroupId}
                />
              ) : null}
              <button
                data-tour="collections-new-collection-submit"
                type="submit"
                className={btnSecondary + " w-full justify-center"}
                disabled={busy || tab === "archived" || !selectedGroupId}
                title={
                  !selectedGroupId
                    ? "请先选中左侧一个具体分组后再新建（「全部」不是分组）"
                    : undefined
                }
              >
                新建集合
              </button>
            </form>
          ) : null}
        </aside>

        <aside className="h-fit min-w-0 rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="text-sm font-semibold text-slate-100">
              {infoPanelMode === "collection" ? "集合信息" : "分组信息"}
            </div>
            <button
              data-tour="collections-info-mode-switch"
              type="button"
              className={btnSecondary + " !text-[11px] !py-1.5"}
              onClick={() => setInfoPanelMode((m) => (m === "collection" ? "group" : "collection"))}
            >
              {infoPanelMode === "collection" ? "切换到分组信息" : "切换到集合信息"}
            </button>
          </div>

          {infoPanelMode === "group" ? (
            !selectedGroupId ? (
              <p className="text-xs text-slate-400">
                请在左侧分组列表中选中一个分组；归档/删除分组仅当<strong className="font-medium text-slate-300">分组下无集合</strong>
                时可用（若仍有历史子分组数据，需先清空子分组或联系管理员）。
              </p>
            ) : !selectedGroupNode ? (
              <p className="text-xs text-slate-400">分组数据已变化，请稍后重试或重新选择。</p>
            ) : (
              <div className="grid gap-2 text-xs text-slate-300" data-tour="collections-group-meta-form">
                <div className="text-sm font-semibold text-slate-100">{selectedGroupNode.name}</div>
                <div>
                  <span className="text-slate-500">分组类型</span>{" "}
                  {selectedGroupNode.group_type === "project" ? "project" : "personal"}
                </div>

                {canManageGroups && tab !== "archived" ? (
                  <form
                    className="mt-2 grid gap-2 border-t border-white/10 pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveGroupMeta();
                    }}
                  >
                    <label className="text-[11px] text-slate-500">名称</label>
                    <input className={inputClass} value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} />
                    {selectedGroupNode.group_type === "project" ? (
                      <>
                        <label className="text-[11px] text-slate-500">绑定用户组（可选）</label>
                        <input
                          className={inputClass}
                          value={editGroupUserGroupName}
                          onChange={(e) => setEditGroupUserGroupName(e.target.value)}
                          placeholder="与项目分组可见性相关"
                        />
                      </>
                    ) : null}
                    <button type="submit" className={btnPrimary + " mt-2 w-full !text-xs"} disabled={busy}>
                      保存分组
                    </button>
                  </form>
                ) : (
                  <div className="mt-2 space-y-1 border-t border-white/10 pt-3">
                    {selectedGroupNode.group_type === "project" ? (
                      <div>
                        <span className="text-slate-500">绑定用户组</span> {selectedGroupNode.user_group_name || "—"}
                      </div>
                    ) : (
                      <p className="text-slate-500">无分组编辑权限（需 collection.create 或 collection.edit_all）。</p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    className={btnDanger + " w-full justify-center !text-xs"}
                    disabled={busy || !groupCanArchiveOrDelete}
                    title={!groupCanArchiveOrDelete ? groupDangerBlockReason : undefined}
                    onClick={() =>
                      selectedGroupId
                        ? setConfirmDialog({
                            kind: "archive_group",
                            id: selectedGroupId,
                            name: selectedGroupNode.name,
                          })
                        : undefined
                    }
                  >
                    归档分组
                  </button>
                  <button
                    type="button"
                    className={btnDanger + " w-full justify-center !text-xs"}
                    disabled={busy || !groupCanArchiveOrDelete}
                    title={!groupCanArchiveOrDelete ? groupDangerBlockReason : undefined}
                    onClick={() =>
                      selectedGroupId
                        ? setConfirmDialog({
                            kind: "delete_group",
                            id: selectedGroupId,
                            name: selectedGroupNode.name,
                          })
                        : undefined
                    }
                  >
                    删除分组（软删）
                  </button>
                </div>
              </div>
            )
          ) : !detail ? (
            <p className="text-xs text-slate-400">
              请先在左侧「分组与集合」中选择一个集合；或使用上方按钮切换到「分组信息」。
            </p>
          ) : (
            <div className="grid gap-2 text-xs text-slate-300" data-tour="collections-collection-meta-form">
              <div className="text-sm font-semibold text-slate-100">{detail.name}</div>

              {canEditCollectionMeta ? (
                <form
                  className="mt-2 grid gap-2 border-t border-white/10 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveCollectionMeta();
                  }}
                >
                  <label className="text-[11px] text-slate-500">名称</label>
                  <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <label className="text-[11px] text-slate-500">描述</label>
                  <textarea
                    className={inputClass + " min-h-[64px]"}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                  <label className="text-[11px] text-slate-500">所属分组</label>
                  <select className={inputClass} value={editGroupId} onChange={(e) => setEditGroupId(e.target.value)}>
                    <option value="">（无）</option>
                    {groupSelectOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  {detail.collection_type === "project" ? (
                    <>
                      <label className="text-[11px] text-slate-500">可见性</label>
                      <select className={inputClass} value={editVisibility} onChange={(e) => setEditVisibility(e.target.value)}>
                        <option value="private">private</option>
                        <option value="team">team</option>
                      </select>
                    </>
                  ) : null}

                  {canEditProjectPermissions ? (
                    <div className="mt-2 border-t border-white/10 pt-2">
                      <div className="mb-1 font-medium text-slate-200">用户组权限</div>
                      {permRows.map((row, i) => (
                        <div key={i} className="mb-2 flex flex-wrap gap-1">
                          <input
                            className={inputClass + " flex-1 min-w-[100px]"}
                            placeholder="用户组名"
                            value={row.user_group_name}
                            onChange={(e) =>
                              setPermRows((prev) => prev.map((r, j) => (j === i ? { ...r, user_group_name: e.target.value } : r)))
                            }
                          />
                          <select
                            className={inputClass + " w-28"}
                            value={row.permission_level}
                            onChange={(e) =>
                              setPermRows((prev) => prev.map((r, j) => (j === i ? { ...r, permission_level: e.target.value } : r)))
                            }
                          >
                            <option value="view">view</option>
                            <option value="edit">edit</option>
                            <option value="manage">manage</option>
                          </select>
                          <button
                            type="button"
                            className={btnDanger + " !text-[10px]"}
                            onClick={() => setPermRows((prev) => prev.filter((_, j) => j !== i))}
                          >
                            删行
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={btnSecondary + " !text-xs"}
                        onClick={() => setPermRows((prev) => [...prev, { user_group_name: "", permission_level: "view" }])}
                      >
                        添加一行
                      </button>
                    </div>
                  ) : detail.collection_type === "project" && detail.permissions.length ? (
                    <div className="mt-1 border-t border-white/10 pt-2">
                      <div className="mb-1 font-medium text-slate-200">用户组授权（只读）</div>
                      <ul className="list-disc space-y-1 pl-4 text-slate-400">
                        {detail.permissions.map((p) => (
                          <li key={p.user_group_name}>
                            {p.user_group_name} → {p.permission_level}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <button type="submit" className={btnPrimary + " mt-2 w-full !text-xs"} disabled={busy}>
                    保存修改
                  </button>
                </form>
              ) : (
                <>
                  {detail.collection_type === "project" ? (
                    <div>
                      <span className="text-slate-500">可见性</span> {detail.visibility}
                    </div>
                  ) : null}
                  {detail.description ? (
                    <div>
                      <span className="text-slate-500">说明</span> {detail.description}
                    </div>
                  ) : null}
                  {detail.collection_type === "project" && detail.permissions.length ? (
                    <div className="mt-1 border-t border-white/10 pt-2">
                      <div className="mb-1 font-medium text-slate-200">用户组授权</div>
                      <ul className="list-disc space-y-1 pl-4 text-slate-400">
                        {detail.permissions.map((p) => (
                          <li key={p.user_group_name}>
                            {p.user_group_name} → {p.permission_level}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}

              <div className="mt-2 text-[11px] text-slate-500">
                我的权限：<span className="text-slate-300">{detail.permission_level || "无"}</span>
              </div>

              <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                {tab !== "archived" && detail.status === "active" && canArchiveOrRestore ? (
                  <button
                    type="button"
                    className={btnDanger + " w-full justify-center !text-xs"}
                    disabled={busy}
                    onClick={() => setConfirmDialog({ kind: "archive", id: detail.id, name: detail.name })}
                  >
                    归档集合
                  </button>
                ) : null}
                {tab === "archived" && detail.status === "archived" && canArchiveOrRestore ? (
                  <button
                    type="button"
                    className={btnPrimary + " w-full justify-center !text-xs"}
                    disabled={busy}
                    onClick={() => setConfirmDialog({ kind: "restore", id: detail.id, name: detail.name })}
                  >
                    恢复集合
                  </button>
                ) : null}
                {canDeleteCollectionBtn ? (
                  <button
                    type="button"
                    className={btnDanger + " w-full justify-center !text-xs"}
                    disabled={busy}
                    onClick={() => setConfirmDialog({ kind: "delete", id: detail.id, name: detail.name })}
                  >
                    删除集合（软删）
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </aside>

        <section
          data-tour="collections-items-list"
          className="min-h-[min(72vh,640px)] min-w-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl"
        >
          <div className="mb-2 text-sm font-semibold text-slate-100">集合内素材</div>
          {!selectedCollectionId ? (
            <p className="text-xs text-slate-400">请先在「分组与集合」列选择集合。</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-end gap-2 border-b border-white/10 pb-3">
                <div className="min-w-[140px] flex-1">
                  <label className="mb-1 block text-[11px] text-slate-400">搜索标题</label>
                  <input
                    className={inputClass + " !py-1.5 !text-xs"}
                    value={itemKeyword}
                    onChange={(e) => {
                      setItemPage(1);
                      setItemKeyword(e.target.value);
                    }}
                    placeholder="关键词"
                  />
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-[11px] text-slate-400">类型</label>
                  <select
                    className={inputClass + " !py-1.5 !text-xs"}
                    value={itemFileType}
                    onChange={(e) => {
                      setItemFileType(e.target.value);
                      setItemPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    <option value="video">视频</option>
                    <option value="image">图片</option>
                    <option value="audio">音频</option>
                  </select>
                </div>
                <div className="w-36" data-tour="collections-sort-handle">
                  <label className="mb-1 block text-[11px] text-slate-400">排序</label>
                  <select
                    className={inputClass + " !py-1.5 !text-xs"}
                    value={itemSort}
                    onChange={(e) => {
                      setItemSort(e.target.value as typeof itemSort);
                      setItemPage(1);
                    }}
                  >
                    <option value="sort_order">手动顺序</option>
                    <option value="added_at">添加时间</option>
                    <option value="created_at">素材创建时间</option>
                  </select>
                </div>
                <button
                  type="button"
                  className={btnSecondary + " !text-xs"}
                  onClick={() => {
                    setItemKeyword("");
                    setItemFileType("");
                    setItemSort("sort_order");
                    setItemPage(1);
                  }}
                >
                  重置筛选
                </button>
              </div>
              <p data-tour="collections-drag-hint" className="mb-2 text-xs text-slate-400">
                共 {itemsTotal} 条 · 第 {itemPage}/{itemPageTotal} 页（每页 50）
              </p>
              {selectedItemIds.length > 0 ? (
                <p className="mb-2 text-xs text-sky-200">已勾选 {selectedItemIds.length} 条</p>
              ) : null}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="grid max-h-[min(72vh,920px)] min-h-0 grid-cols-2 gap-1.5 overflow-y-auto p-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {items.map((it) => {
                    const isChecked = selectedItemIds.includes(it.item_id);
                    const isPreview = selectedItemId === it.item_id;
                    const displayName = getCollectionDisplayName(it);
                    const iconPath = getCollectionRowIcon(it);
                    const persistedThumb = collectionPersistedThumb(it);
                    const coverPath = thumbnailUrlMap[it.material_id] || persistedThumb || iconPath;
                    const tagText = it.tags.filter(Boolean).join(" / ");
                    const visualState = isPreview ? "preview" : isChecked ? "checked" : "default";
                    return (
                      <MaterialFileCard
                        key={it.item_id}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedItemId(it.item_id);
                          }
                        }}
                        visualState={visualState}
                        displayName={displayName}
                        tagLine={tagText}
                        fileSizeBytes={it.file_size ?? null}
                        resolutionLabel={formatResolutionForExtension(
                          getCollectionExtension(it),
                          it.primary_media_width,
                          it.primary_media_height
                        )}
                        coverSrc={coverPath}
                        onCoverError={(e) => {
                          const el = e.currentTarget;
                          setThumbnailUrlMap((prev) => {
                            if (!prev[it.material_id]) return prev;
                            const next = { ...prev };
                            delete next[it.material_id];
                            return next;
                          });
                          thumbnailRequestedRef.current.delete(it.material_id);
                          if (el.src.endsWith(iconPath)) return;
                          el.src = iconPath;
                        }}
                        onCardClick={() => setSelectedItemId(it.item_id)}
                        checkboxChecked={isChecked}
                        onCheckboxChange={() => toggleCollectionItemSelection(it.item_id)}
                        checkboxAriaLabel="勾选以加入批量操作"
                        draggable={canDragCollectionItems}
                        onDragStartCard={
                          canDragCollectionItems
                            ? (ev: DragEvent<HTMLDivElement>) => {
                                const idsToMove =
                                  selectedItemIds.length > 0 && selectedItemIds.includes(it.item_id)
                                    ? [...selectedItemIds]
                                    : [it.item_id];
                                const copy = ev.ctrlKey || ev.metaKey;
                                collectionDragKindRef.current = copy ? "copy" : "move";
                                const payload = JSON.stringify({
                                  v: 1,
                                  sourceCollectionId: selectedCollectionId,
                                  itemIds: idsToMove,
                                  copy,
                                });
                                try {
                                  ev.dataTransfer.setData(COLLECTION_ITEM_MOVE_MIME, payload);
                                  ev.dataTransfer.setData("text/plain", payload);
                                } catch {
                                  /* 部分环境 setData 受限 */
                                }
                                ev.dataTransfer.effectAllowed = copy ? "copy" : "move";
                              }
                            : undefined
                        }
                        onDragEndCard={
                          canDragCollectionItems
                            ? () => {
                                setDropFocusCollectionId(null);
                                collectionDragKindRef.current = "move";
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
                {items.length === 0 ? (
                  <p className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500">当前筛选条件下暂无条目。</p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnSecondary + " !text-xs"}
                  disabled={busy || itemPage <= 1}
                  onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className={btnSecondary + " !text-xs"}
                  disabled={busy || itemPage >= itemPageTotal}
                  onClick={() => setItemPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </section>

        <aside
          data-tour="collections-detail-drawer"
          className="sticky top-4 z-10 flex max-h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl"
        >
          <div className="mb-2 shrink-0 text-sm font-semibold text-slate-100">预览与文件信息</div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]">
          {!detail ? (
            <p className="text-xs text-slate-400">选择集合或条目。</p>
          ) : selectedItem ? (
            <div className="grid gap-3 text-xs text-slate-300">
              <div className="grid gap-2" data-tour="collections-item-actions">
                {canDownloadAsset ? (
                  <button
                    type="button"
                    className={btnPrimary + " w-full !text-xs"}
                    disabled={busy || actionTargetItemIds.length === 0}
                    title={
                      actionTargetItemIds.length > 1
                        ? `将依次写入上次保存目录（共 ${actionTargetItemIds.length} 条）；无记录时请先在素材库单条「选择本地目录保存」`
                        : undefined
                    }
                    onClick={() => void downloadCollectionTargets()}
                  >
                    下载主文件{actionTargetItemIds.length > 1 ? `（${actionTargetItemIds.length}）` : ""}
                  </button>
                ) : null}
                {canEditItems ? (
                  <button
                    type="button"
                    className={btnDanger + " w-full !text-xs"}
                    disabled={busy || actionTargetItemIds.length === 0}
                    title={actionTargetItemIds.length > 1 ? `将移除 ${actionTargetItemIds.length} 条引用` : undefined}
                    onClick={() => void removeCollectionItems(actionTargetItemIds)}
                  >
                    从集合移除{actionTargetItemIds.length > 1 ? `（${actionTargetItemIds.length}）` : ""}
                  </button>
                ) : null}
              </div>
              {canEditItems ? (
                <div className="grid gap-2" data-tour="collections-note-editor">
                  <button type="button" className={btnPrimary + " w-full !text-xs"} disabled={busy} onClick={() => void saveItemNote()}>
                    保存备注
                  </button>
                  <label className="mb-0 block text-slate-500">备注</label>
                  <textarea
                    className={inputClass + " min-h-[72px] text-xs"}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <div className="text-slate-500">备注</div>
                  <div className="mt-1 break-words text-slate-200">{selectedItem.note || "—"}</div>
                </div>
              )}
              <MaterialFilePreviewArea
                mode={collectionDrawerPreviewMode}
                src={
                  thumbnailUrlMap[selectedItem.material_id] ||
                  collectionPersistedThumb(selectedItem) ||
                  getCollectionRowIcon(selectedItem)
                }
                largeImageSrc={collectionDrawerPreviewMode === "image" ? collectionStream.streamUrl : null}
                largeImageLoading={collectionDrawerPreviewMode === "image" ? collectionStream.streamLoading : false}
                largeImageError={collectionDrawerPreviewMode === "image" ? collectionStream.streamError : null}
                largeImagePlaceholderHint={
                  collectionDrawerPreviewMode === "image" && !canDownloadAsset
                    ? "查看原图需具备「下载素材」权限（asset.download）。"
                    : collectionDrawerPreviewMode === "image" && !collectionDrawerFileId
                      ? "当前条目无主文件 id，无法解析原图。"
                      : collectionDrawerPreviewMode === "image" && (selectedItem.material_status || "") !== "available"
                        ? "素材非「可用」状态时不解析原图直链。"
                        : null
                }
                videoFallbackPreviewUrl={collectionDrawerPreviewMode === "video" ? collectionPreviewVideo.previewUrl : null}
                videoStreamUrl={collectionDrawerPreviewMode === "video" ? collectionStream.streamUrl : null}
                videoStreamLoading={
                  collectionDrawerPreviewMode === "video"
                    ? collectionPreviewVideo.previewLoading ||
                      (collectionStreamResolveEnabled && collectionStream.streamLoading)
                    : false
                }
                videoStreamError={
                  collectionDrawerPreviewMode === "video" &&
                  !collectionPreviewVideo.previewUrl &&
                  !collectionStream.streamUrl
                    ? collectionPreviewVideo.previewError || collectionStream.streamError
                    : null
                }
                videoPlaceholderHint={
                  collectionDrawerPreviewMode === "video" && !collectionDrawerFileId
                    ? "当前条目无主文件 id，无法解析播放地址。"
                    : collectionDrawerPreviewMode === "video" && !canViewAsset
                      ? "内嵌播放需具备「查看素材」权限（asset.view）。"
                      : null
                }
                onError={(e) => {
                  const icon = getCollectionRowIcon(selectedItem);
                  const el = e.currentTarget;
                  setThumbnailUrlMap((prev) => {
                    if (!prev[selectedItem.material_id]) return prev;
                    const next = { ...prev };
                    delete next[selectedItem.material_id];
                    return next;
                  });
                  thumbnailRequestedRef.current.delete(selectedItem.material_id);
                  if (el.src.endsWith(icon)) return;
                  el.src = icon;
                }}
              />
              <div className="border-t border-white/10 pt-3">
                <div className="text-slate-500">文件名</div>
                <div className="mt-1 break-words text-sm leading-snug text-white [overflow-wrap:anywhere]">
                  {getCollectionDisplayName(selectedItem)}
                </div>
                <div>类型：{selectedItem.file_type}</div>
                <div>文件大小：{formatBytes(selectedItem.file_size ?? null)}</div>
                {collectionDrawerResolutionLabel ? <div>分辨率：{collectionDrawerResolutionLabel}</div> : null}
                <div className="text-slate-500">描述</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-slate-200 [overflow-wrap:anywhere]">
                  {collectionDrawerDescription || "—"}
                </div>
                <div>
                  素材状态：{materialStatusLabel[selectedItem.material_status || ""] || selectedItem.material_status || "—"}
                </div>
                <div>下载次数：{selectedItem.download_count ?? 0}</div>
                <div>添加人：{selectedItem.added_by_name}</div>
                <div>添加时间：{String(selectedItem.added_at)}</div>
                <div className="mt-2 text-slate-500">标签信息</div>
                <div className="mt-1 break-all">{selectedItem.tags.filter(Boolean).join(" / ") || "—"}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">请从中间「集合内素材」列表选择一条素材以查看预览与文件信息。</p>
          )}
          </div>
        </aside>
      </div>
      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="collections" />
      </Suspense>
    </main>
  );
}
