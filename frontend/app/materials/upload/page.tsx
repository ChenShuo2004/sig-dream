"use client";

import { ChangeEvent, DragEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sha256 } from "js-sha256";
import { loadAuthSession } from "@/lib/auth";
import { ASSET_LIBRARY_OPTIONS, assetLibraryHeaders, useAssetLibrary, type AssetLibraryCode } from "@/lib/assetLibrary";
import TutorialGate from "@/components/tutorials/TutorialGate";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { formatBytes, formatSpeed } from "@/lib/formatBytes";
import { TagSlashPicker, mergeTagSlashRecentStorage } from "@/components/TagSlashPicker";
import { tagCategoriesForLibrary, tagCategoryHoverTitle, tagCategoryShort } from "@/lib/tagCategoryUi";

type UploadInitResponse = {
  upload_session_id: string;
  total_chunks: number;
  uploaded_chunks: number[];
};

type UploadCompleteResponse = {
  upload_session_id: string;
  status: string;
  merged_path: string;
  sha256: string;
};

type UploadIngestResponse = {
  upload_session_id: string;
  material_id: string;
  material_file_id: string;
  nas_job_id: string;
  status: string;
};
type LanUploadTicketResponse = {
  ticket: string;
  expires_at: string;
  upload_url: string | null;
  lan_upload_base_url?: string | null;
  public_upload_base_url?: string | null;
};

/** 文件机 `POST /upload` 成功体里由 ECS `ingest-from-nas` 返回的嵌套字段（与 MaterialIngestFromNasResponse 一致） */
type LanUploadOkBody = {
  status?: string;
  duplicate?: boolean;
  file_size?: number;
  ingest?: {
    material_id?: string;
    material_file_id?: string;
    nas_job_id?: string;
    status?: string;
  };
};

function trimmedIdString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

/** 从 LAN `POST /upload` 成功 JSON 中取出新入库的 material / file id（兼容嵌套 `ingest`、顶层展平、非 string id、驼峰键） */
function extractLanIngestMaterialIds(data: unknown): { mid: string; mfid: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { mid: "", mfid: "" };
  const o = data as Record<string, unknown>;
  let ingestRaw: unknown = o.ingest;
  if (typeof ingestRaw === "string") {
    try {
      ingestRaw = JSON.parse(ingestRaw) as unknown;
    } catch {
      ingestRaw = null;
    }
  }
  const sources: Record<string, unknown>[] = [];
  if (ingestRaw && typeof ingestRaw === "object" && !Array.isArray(ingestRaw)) {
    sources.push(ingestRaw as Record<string, unknown>);
  }
  sources.push(o);
  for (const src of sources) {
    const mid = trimmedIdString(src.material_id ?? src.materialId);
    const mfid = trimmedIdString(
      src.material_file_id ?? src.materialFileId ?? src.file_id ?? src.fileId
    );
    if (mid && mfid) return { mid, mfid };
  }
  return { mid: "", mfid: "" };
}

function lanUploadJsonHasFreshIngest(data: unknown): boolean {
  const { mid, mfid } = extractLanIngestMaterialIds(data);
  return Boolean(mid && mfid);
}

function uploadDedupResponseMeansExists(data: unknown): boolean {
  const ex = (data as { exists?: unknown } | null)?.exists;
  return ex === true;
}

/** 仅当响应明确表示「重复且未返回新 ingest」时才视为跳过入库（避免 duplicate 为 1 / "true" 等真值误伤） */
function isLanUploadDuplicateSkipPayload(data: unknown): boolean {
  if (lanUploadJsonHasFreshIngest(data)) return false;
  const o = data as { status?: unknown; duplicate?: unknown };
  if (o.status === "exists") return true;
  return o.duplicate === true;
}

type ActiveTag = { id: string; name: string; description?: string };
type ActiveTagGroups = Record<string, ActiveTag[]>;

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
const COLLECT_WAIT_INTERVAL_MS = 2500;
const COLLECT_WAIT_MAX_MS = 10 * 60 * 1000;

type UploadPickGroupNode = {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
  children: UploadPickGroupNode[];
};

function flattenUploadPickGroupNodes(
  nodes: UploadPickGroupNode[],
  scope: "personal" | "project"
): { id: string; name: string; scope: "personal" | "project" }[] {
  const out: { id: string; name: string; scope: "personal" | "project" }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, scope });
    if (n.children?.length) out.push(...flattenUploadPickGroupNodes(n.children, scope));
  }
  return out;
}

async function fetchGroupsForUploadCollectPick(
  apiBaseUrl: string,
  token: string,
  mode: "personal" | "project",
  libraryCode: AssetLibraryCode
): Promise<{ id: string; name: string; scope: "personal" | "project" }[]> {
  const url = `${apiBaseUrl}/collections/groups?group_type=${mode}`;
  const resp = await fetch(url, { headers: assetLibraryHeaders({ Authorization: `Bearer ${token}` }, libraryCode) });
  const data = (await resp.json()) as { items?: UploadPickGroupNode[]; detail?: unknown };
  if (!resp.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data);
    throw new Error(detail);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return flattenUploadPickGroupNodes(items, mode);
}

async function fetchCollectionsForUploadCollectPick(
  apiBaseUrl: string,
  token: string,
  mode: "personal" | "project",
  libraryCode: AssetLibraryCode
): Promise<{ id: string; name: string; group_id: string | null }[]> {
  const loadPage = async (page: string) => {
    const base = new URLSearchParams();
    base.set("collection_type", mode);
    base.set("status", "active");
    base.set("page_size", "100");
    base.set("page", page);
    if (mode === "project") base.set("for_item_edit", "true");
    const url = `${apiBaseUrl}/collections?${base.toString()}`;
    const resp = await fetch(url, { headers: assetLibraryHeaders({ Authorization: `Bearer ${token}` }, libraryCode) });
    const data = (await resp.json()) as {
      items?: { id: string; name: string; group_id?: string | null }[];
      total?: number;
      detail?: unknown;
    };
    if (!resp.ok) {
      const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data);
      throw new Error(detail);
    }
    return data;
  };
  const first = await loadPage("1");
  let list: { id: string; name: string; group_id: string | null }[] = Array.isArray(first.items)
    ? first.items.map((x) => ({
        id: x.id,
        name: x.name,
        group_id: x.group_id != null && String(x.group_id).trim() ? String(x.group_id) : null,
      }))
    : [];
  const total = typeof first.total === "number" ? first.total : list.length;
  if (total > list.length) {
    const second = await loadPage("2");
    if (Array.isArray(second.items)) {
      list = [
        ...list,
        ...second.items.map((x) => ({
          id: x.id,
          name: x.name,
          group_id: x.group_id != null && String(x.group_id).trim() ? String(x.group_id) : null,
        })),
      ];
    }
  }
  return list;
}

type UploadStatus = "待上传" | "计算 hash" | "重复检测" | "上传中" | "上传完成" | "上传失败";
type IngestStatus =
  | "待入库"
  | "入库中"
  | "已提交NAS同步"
  | "已提交NAS同步（未整理）"
  | "入库失败"
  | "已存在，跳过入库"
  | "LAN大小校验失败，已改用服务器分片上传";

type QueueItem = {
  id: string;
  file: File;
  title: string;
  description: string;
  selectedTagIds: string[];
  uploadStatus: UploadStatus;
  ingestStatus: IngestStatus;
  tagStatus: "未选择标签" | "已选择标签" | "将进入未整理";
  progress: number;
  sessionId: string;
  sha256: string;
  error: string;
  completed: boolean;
  /** 上传过程中实时提示（耗时、近似速度） */
  transferHint?: string;
  /** 本文件上传结束后汇总 */
  timingSummary?: string;
  /** 上传页「完成后收录」异步状态（仅 ECS 分片 + ingest 成功路径会进入 pending/done/failed） */
  collectionAttachStatus?: "pending" | "done" | "skipped" | "failed";
  collectionAttachMessage?: string;
};

async function waitMaterialAvailableThenCollect(params: {
  itemId: string;
  materialId: string;
  materialFileId: string;
  collectionId: string;
  note: string;
  apiBaseUrl: string;
  token: string;
  libraryCode: AssetLibraryCode;
  signal: AbortSignal;
  updateItem: (id: string, updater: (item: QueueItem) => QueueItem) => void;
}): Promise<void> {
  const { itemId, materialId, materialFileId, collectionId, note, apiBaseUrl, token, libraryCode, signal, updateItem } = params;
  const t0 = Date.now();
  let lastReported = "";
  let becameAvailable = false;
  try {
    while (Date.now() - t0 < COLLECT_WAIT_MAX_MS) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const url = `${apiBaseUrl}/materials/${materialId}?include_all=true`;
      const resp = await fetch(url, { headers: assetLibraryHeaders({ Authorization: `Bearer ${token}` }, libraryCode), signal });
      const data = (await resp.json()) as { status?: string; detail?: unknown };
      if (!resp.ok) {
        const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data);
        throw new Error(detail);
      }
      const st = typeof data.status === "string" ? data.status : "";
      if (st !== lastReported) {
        lastReported = st;
        updateItem(itemId, (x) => ({
          ...x,
          collectionAttachMessage: st === "available" ? "素材已可用，正在收录…" : `等待素材可用（当前：${st || "未知"}）…`,
        }));
      }
      if (st === "available") {
        becameAvailable = true;
        break;
      }
      if (st === "trashed" || st === "trash_pending" || st === "nas_failed") {
        throw new Error(`素材状态为「${st}」，无法收录`);
      }
      await new Promise((r) => setTimeout(r, COLLECT_WAIT_INTERVAL_MS));
    }
    if (!becameAvailable) {
      throw new Error("等待素材变为「可用」超时，请稍后在素材库手动收录");
    }
    const collectResp = await fetch(`${apiBaseUrl}/materials/${materialId}/collect`, {
      method: "POST",
      headers: assetLibraryHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, libraryCode),
      signal,
      body: JSON.stringify({
        collection_id: collectionId,
        material_file_id: materialFileId,
        note: note.trim() ? note.trim() : null,
      }),
    });
    const collectData = (await collectResp.json()) as { status?: string; detail?: unknown };
    if (!collectResp.ok) {
      const detail = typeof collectData.detail === "string" ? collectData.detail : JSON.stringify(collectData);
      throw new Error(detail);
    }
    const doneMsg = collectData.status === "already_exists" ? "已在目标集合中" : "已收录到目标集合";
    updateItem(itemId, (x) => ({ ...x, collectionAttachStatus: "done", collectionAttachMessage: doneMsg }));
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (aborted) {
      updateItem(itemId, (x) => ({
        ...x,
        collectionAttachStatus: "failed",
        collectionAttachMessage: "收录流程已中断",
      }));
      return;
    }
    const msg = error instanceof Error ? error.message : String(error);
    updateItem(itemId, (x) => ({ ...x, collectionAttachStatus: "failed", collectionAttachMessage: msg }));
  }
}

function makeQueueId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fileFingerprint(file: File): string {
  const relPath = typeof (file as File & { webkitRelativePath?: string }).webkitRelativePath === "string"
    ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || ""
    : "";
  return `${file.name}__${file.size}__${file.lastModified}__${file.type || "unknown"}__${relPath}`;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function uploadsDedupUrl(apiBaseUrl: string, digest: string, libraryCode: AssetLibraryCode): string {
  return `${apiBaseUrl}/uploads/dedup?sha256=${encodeURIComponent(digest)}&library=${encodeURIComponent(libraryCode)}`;
}

/** 仅同源 ECS /api-proxy 带库头；文件机跨域 POST /upload 带 X-Asset-Library 会触发 CORS 预检失败。 */
function shouldAttachAssetLibraryHeader(url: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  try {
    const resolved = new URL(raw, typeof window !== "undefined" ? window.location.href : "http://localhost");
    if (typeof window !== "undefined") return resolved.origin === window.location.origin;
    return true;
  } catch {
    return false;
  }
}

async function fetchJsonWithTrace(
  url: string,
  init?: RequestInit,
  step?: string,
  libraryCode?: AssetLibraryCode
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const merged = new Headers(init?.headers || {});
    if (shouldAttachAssetLibraryHeader(url)) {
      const headers = assetLibraryHeaders({}, libraryCode);
      Object.entries(headers).forEach(([k, v]) => merged.set(k, v));
    }
    const resp = await fetch(url, { ...init, headers: merged });
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    const method = (init?.method || "GET").toUpperCase();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[网络失败] 步骤=${step || "unknown"} 方法=${method} 接口=${url} 详情=${message}`);
  }
}

/** 幂等冲突后回填 id：`exists===true` 但缺 `material_id` 多为旧版后端；`exists!==true` 时短重试以覆盖刚提交事务的读延迟 */
const DEDUP_RESOLVE_MAX_ATTEMPTS = 6;
const DEDUP_RESOLVE_DELAY_MS = 400;

async function fetchDedupLiveMaterialIdsIfExists(
  apiBaseUrl: string,
  digest: string,
  signal: AbortSignal,
  libraryCode: AssetLibraryCode
): Promise<{ mid: string; mfid: string } | null> {
  for (let attempt = 1; attempt <= DEDUP_RESOLVE_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) return null;
    const dedupUrl = uploadsDedupUrl(apiBaseUrl, digest, libraryCode);
    const dedupResult = await fetchJsonWithTrace(dedupUrl, { signal }, "dedup-resolve", libraryCode);
    if (dedupResult.ok) {
      const d = dedupResult.data as { exists?: unknown; material_id?: unknown; material_file_id?: unknown };
      if (d.exists === true) {
        const mid = trimmedIdString(d.material_id);
        const mfid = trimmedIdString(d.material_file_id);
        if (mid && mfid) return { mid, mfid };
        return null;
      }
    }
    if (attempt < DEDUP_RESOLVE_MAX_ATTEMPTS && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, DEDUP_RESOLVE_DELAY_MS);
        signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(t);
            resolve();
          },
          { once: true }
        );
      });
    }
  }
  return null;
}

async function fetchJsonWithNetworkRetry(
  url: string,
  init: RequestInit | undefined,
  step: string,
  retries = 2,
  delayMs = 500,
  libraryCode?: AssetLibraryCode
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJsonWithTrace(url, init, step, libraryCode);
    } catch (error) {
      lastErr = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isNetworkError = msg.includes("[网络失败]");
      if (!isNetworkError || attempt >= retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)));
}

async function sha256Hex(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  return sha256(new Uint8Array(data));
}

async function checkApiHealth(baseUrl: string, timeoutMs = 0): Promise<boolean> {
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const FILE_MACHINE_UPLOAD_PROBE_MS = 2800;
/** 同一文件机基址上，进入直传前对 `/health` 的最少尝试次数（单次失败会间隔重试） */
const FILE_MACHINE_UPLOAD_PROBE_MAX_ATTEMPTS = 3;
const FILE_MACHINE_UPLOAD_PROBE_RETRY_DELAY_MS = 280;

/** 跨域探测文件机 /health（与素材页下载选路一致，需文件机 CORS） */
async function probeUploadFileMachineBase(baseUrl: string, externalSignal: AbortSignal): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "");
  if (!base) return false;
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), FILE_MACHINE_UPLOAD_PROBE_MS);
  const onAbort = () => ctl.abort();
  externalSignal.addEventListener("abort", onAbort);
  try {
    if (externalSignal.aborted) return false;
    const resp = await fetch(`${base}/health`, { method: "GET", mode: "cors", signal: ctl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
    externalSignal.removeEventListener("abort", onAbort);
  }
}

/** 对同一基址连续探测若干次，任一次成功即视为可达（缓解瞬时网络/CORS 抖动） */
async function probeUploadFileMachineBaseWithRetries(
  baseUrl: string,
  externalSignal: AbortSignal,
  onAttempt: (attempt: number, maxAttempts: number) => void
): Promise<boolean> {
  const max = FILE_MACHINE_UPLOAD_PROBE_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (externalSignal.aborted) return false;
    onAttempt(attempt, max);
    const ok = await probeUploadFileMachineBase(baseUrl, externalSignal);
    if (ok) return true;
    if (attempt < max && !externalSignal.aborted) {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, FILE_MACHINE_UPLOAD_PROBE_RETRY_DELAY_MS);
        externalSignal.addEventListener("abort", () => {
          window.clearTimeout(t);
          resolve();
        }, { once: true });
      });
    }
  }
  return false;
}

export default function MaterialUploadPage() {
  const initialApiBaseUrl = useMemo(() => "/api-proxy", []);
  const { library, isPersonalVideo } = useAssetLibrary();
  const [apiBaseUrl, setApiBaseUrl] = useState(initialApiBaseUrl);
  const [apiResolved, setApiResolved] = useState(false);
  const [token, setToken] = useState("");
  const [canUpload, setCanUpload] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [tagGroups, setTagGroups] = useState<ActiveTagGroups>({});
  const [tagLoading, setTagLoading] = useState(false);
  const [tagLoadError, setTagLoadError] = useState("");
  const [selectedPanelTagIds, setSelectedPanelTagIds] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("等待操作...");
  const [pickNotice, setPickNotice] = useState("");
  /** 文件队列区域：拖拽本地文件悬停高亮 */
  const [queueDropActive, setQueueDropActive] = useState(false);
  const [lanTransferBaseUrl, setLanTransferBaseUrl] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [pickableGroups, setPickableGroups] = useState<{ id: string; name: string; scope: "personal" | "project" }[]>([]);
  const [pickableCollections, setPickableCollections] = useState<
    { id: string; name: string; scope: "personal" | "project"; group_id: string | null }[]
  >([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsLoadError, setCollectionsLoadError] = useState("");
  const [postUploadAutoCollect, setPostUploadAutoCollect] = useState(false);
  const [postUploadGroupFilter, setPostUploadGroupFilter] = useState("");
  const [postUploadCollectionId, setPostUploadCollectionId] = useState("");
  const [postUploadCollectNote, setPostUploadCollectNote] = useState("");
  const collectOptsRef = useRef({ enabled: false, collectionId: "", note: "" });
  const canCollectionView = permissions.includes("collection.view");
  /** 中止当前文件正在进行的 fetch（与「暂停全部」不同：立即中断网络请求） */
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  /** 本会话内最近一次直传成功的文件机根地址；批量队列后续项优先走该基址并跳过 /health，避免探测抖动导致误走 ECS */
  const preferredDirectUploadFileMachineBaseRef = useRef("");
  const orderedTagGroupKeys = useMemo(() => {
    const keys = Object.keys(tagGroups);
    const order = tagCategoriesForLibrary(library);
    const inOrder = order.filter((key) => keys.includes(key));
    const extras = keys.filter((key) => !order.includes(key as (typeof order)[number]));
    return [...inOrder, ...extras];
  }, [tagGroups, library]);

  useEffect(() => {
    let cancelled = false;
    async function resolveApiBaseUrl() {
      setApiResolved(false);
      const normalized = initialApiBaseUrl.trim().replace(/\/+$/, "");
      if (!normalized) {
        if (!cancelled) {
          setApiBaseUrl("");
          setResult("[连接检测失败] 前端代理地址为空。");
        }
        return;
      }
      try {
        const resp = await fetch(`${normalized}/health`, { method: "GET" });
        if (!resp.ok) {
          throw new Error(`status=${resp.status}`);
        }
        if (!cancelled) {
          setApiBaseUrl(normalized);
          setApiResolved(true);
          setResult(`[连接检测] 上传接口可用：${normalized}（同源代理）`);
        }
      } catch (error) {
        if (!cancelled) {
          setApiResolved(false);
          setApiBaseUrl("");
          setResult(
            `[连接检测失败] 无法访问上传接口代理：${normalized}\n` +
              `详情：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    void resolveApiBaseUrl();
    return () => {
      cancelled = true;
    };
  }, [initialApiBaseUrl]);


  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setPermissions(session.permissions || []);
    }
  }, []);

  useEffect(() => {
    collectOptsRef.current = {
      enabled: postUploadAutoCollect && canCollectionView && Boolean(postUploadCollectionId.trim()),
      collectionId: postUploadCollectionId.trim(),
      note: postUploadCollectNote,
    };
  }, [postUploadAutoCollect, canCollectionView, postUploadCollectionId, postUploadCollectNote]);

  const uploadFilteredPickableCollections = useMemo(() => {
    const g = postUploadGroupFilter.trim();
    if (!g) return pickableCollections;
    return pickableCollections.filter((c) => (c.group_id || "") === g);
  }, [pickableCollections, postUploadGroupFilter]);

  const uploadPickGroupNameById = useMemo(() => new Map(pickableGroups.map((x) => [x.id, x.name])), [pickableGroups]);

  useEffect(() => {
    const f = postUploadGroupFilter.trim();
    const filtered = !f ? pickableCollections : pickableCollections.filter((c) => (c.group_id || "") === f);
    setPostUploadCollectionId((prev) => {
      if (prev && filtered.some((c) => c.id === prev)) return prev;
      if (filtered.length === 1) return filtered[0].id;
      return "";
    });
  }, [pickableCollections, postUploadGroupFilter]);

  useEffect(() => {
    const g = postUploadGroupFilter.trim();
    if (!g) return;
    if (!pickableGroups.some((x) => x.id === g)) setPostUploadGroupFilter("");
  }, [pickableGroups, postUploadGroupFilter]);

  const loadPickableCollections = useCallback(async () => {
    if (!token || !apiResolved || !apiBaseUrl || !canCollectionView) {
      setPickableGroups([]);
      setPickableCollections([]);
      return;
    }
    setCollectionsLoading(true);
    setCollectionsLoadError("");
    try {
      const [personalCols, projectCols, personalGroups, projectGroups] = await Promise.all([
        fetchCollectionsForUploadCollectPick(apiBaseUrl, token, "personal", library),
        fetchCollectionsForUploadCollectPick(apiBaseUrl, token, "project", library),
        fetchGroupsForUploadCollectPick(apiBaseUrl, token, "personal", library),
        fetchGroupsForUploadCollectPick(apiBaseUrl, token, "project", library),
      ]);
      setPickableGroups([...personalGroups, ...projectGroups]);
      setPickableCollections([
        ...personalCols.map((c) => ({ ...c, scope: "personal" as const })),
        ...projectCols.map((c) => ({ ...c, scope: "project" as const })),
      ]);
    } catch (error) {
      setPickableGroups([]);
      setPickableCollections([]);
      setCollectionsLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setCollectionsLoading(false);
    }
  }, [token, apiResolved, apiBaseUrl, canCollectionView, library]);

  useEffect(() => {
    if (!token || !apiResolved || !apiBaseUrl || !canCollectionView) return;
    void loadPickableCollections();
  }, [token, apiResolved, apiBaseUrl, canCollectionView, loadPickableCollections, library]);

  useEffect(() => {
    async function checkPermission() {
      if (!token || !apiResolved || !apiBaseUrl) {
        setCanUpload(null);
        return;
      }
      try {
        const resp = await fetch(`${apiBaseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok) {
          setCanUpload(true);
          return;
        }
        // Only explicit authz failures should show "no upload permission".
        if (resp.status === 401 || resp.status === 403) {
          setCanUpload(false);
          return;
        }
        setCanUpload(null);
      } catch {
        setCanUpload(null);
      }
    }
    void checkPermission();
  }, [apiBaseUrl, apiResolved, token]);

  useEffect(() => {
    async function loadActiveTags() {
      if (!token || !apiResolved || !apiBaseUrl) {
        setTagGroups({});
        setTagLoadError(apiResolved ? "上传接口不可用，无法加载标签。" : "正在检测上传接口，稍后加载标签。");
        setTagLoading(false);
        return;
      }
      setTagLoading(true);
      setTagLoadError("");
      try {
        const resp = await fetch(`${apiBaseUrl}/tags/active`, { headers: assetLibraryHeaders({ Authorization: `Bearer ${token}` }, library) });
        const data = (await resp.json()) as ActiveTagGroups | { detail?: unknown };
        if (!resp.ok) throw new Error(pretty(data));
        setTagGroups(data as ActiveTagGroups);
      } catch (error) {
        setTagGroups({});
        setTagLoadError(`标签加载失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setTagLoading(false);
      }
    }
    void loadActiveTags();
  }, [apiBaseUrl, apiResolved, token, library]);

  function withAuth(headers: Record<string, string> = {}): Record<string, string> {
    return token ? assetLibraryHeaders({ ...headers, Authorization: `Bearer ${token}` }, library) : assetLibraryHeaders(headers, library);
  }

  function updateItem(id: string, updater: (item: QueueItem) => QueueItem) {
    setQueue((prev) => {
      const next = prev.map((item) => (item.id === id ? updater(item) : item));
      queueRef.current = next;
      return next;
    });
  }

  /** 与「选择文件」、拖拽到文件队列共用 */
  function addFilesToQueue(files: File[]) {
    if (files.length === 0) {
      setPickNotice("未选择文件。");
      return;
    }
    let duplicatedCount = 0;
    let zeroSizeCount = 0;
    let addedCount = 0;
    let firstAddedId = "";
    const prevQueue = queueRef.current;
    const existingKeys = new Set(prevQueue.map((x) => fileFingerprint(x.file)));
    const next: QueueItem[] = [...prevQueue];
    for (const file of files) {
      const key = fileFingerprint(file);
      if (existingKeys.has(key)) {
        duplicatedCount += 1;
        continue;
      }
      existingKeys.add(key);
      if (file.size <= 0) {
        zeroSizeCount += 1;
        continue;
      }
      const row: QueueItem = {
        id: makeQueueId(),
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
        description: "",
        selectedTagIds: [],
        uploadStatus: "待上传",
        ingestStatus: "待入库",
        tagStatus: "未选择标签",
        progress: 0,
        sessionId: "",
        sha256: "",
        error: "",
        completed: false,
      };
      if (!firstAddedId) firstAddedId = row.id;
      next.push(row);
      addedCount += 1;
    }
    setQueue(next);
    queueRef.current = next;
    if (!activeId && firstAddedId) setActiveId(firstAddedId);
    const skipBits: string[] = [];
    if (duplicatedCount > 0) skipBits.push(`重复跳过 ${duplicatedCount} 个`);
    if (zeroSizeCount > 0) skipBits.push(`0KB 跳过 ${zeroSizeCount} 个`);
    // 与「已选 N 个」不重复：仅提示跳过类信息；新增数量见上方统计与进度条
    setPickNotice(
      addedCount > 0
        ? skipBits.length > 0
          ? `${skipBits.join("；")}。`
          : ""
        : skipBits.length > 0
          ? `本次未新增文件（${skipBits.join("；")}）。`
          : ""
    );
    setResult(
      `[已加入上传队列] 新增 ${addedCount} 个文件` +
        `${duplicatedCount > 0 ? `，跳过重复 ${duplicatedCount} 个` : ""}` +
        `${zeroSizeCount > 0 ? `，跳过 0KB 文件 ${zeroSizeCount} 个` : ""}。`
    );
  }

  function onChooseFile(e: ChangeEvent<HTMLInputElement>) {
    addFilesToQueue(Array.from(e.target.files || []));
    e.target.value = "";
  }

  /** 浏览器在 dragover 若不持续 preventDefault，松手会按默认打开文件；types 在部分环境也可能暂为空，故仅用其做高亮判断 */
  function likelyFileDrag(e: DragEvent<HTMLElement>): boolean {
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes("Files")) return true;
    if (types.some((t) => t === "application/x-moz-file" || t.toLowerCase() === "public.file-url")) return true;
    try {
      const items = e.dataTransfer?.items;
      if (items) {
        for (let i = 0; i < items.length; i += 1) {
          if (items[i].kind === "file") return true;
        }
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function onQueueAsideDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || canUpload === false) {
      try {
        e.dataTransfer.dropEffect = "none";
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* ignore */
    }
  }

  function onQueueAsideDragEnter(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || canUpload === false) return;
    if (likelyFileDrag(e)) setQueueDropActive(true);
  }

  function onQueueAsideDragLeave(e: DragEvent<HTMLElement>) {
    const rel = e.relatedTarget as Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setQueueDropActive(false);
  }

  function onQueueAsideDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setQueueDropActive(false);
    if (busy) {
      setPickNotice("正在上传中，暂不可添加文件。");
      return;
    }
    if (canUpload === false) {
      setResult("当前账号没有上传权限（asset.upload），无法添加文件。");
      return;
    }
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) {
      setPickNotice("未检测到可加入队列的文件（请勿仅拖入文件夹或浏览器不支持的类型）。");
      return;
    }
    addFilesToQueue(files);
  }

  function onClickChooseFile() {
    if (canUpload === false) {
      setResult("当前账号没有上传权限（asset.upload），无法选择文件。");
      return;
    }
    fileInputRef.current?.click();
  }

  async function uploadOne(item: QueueItem) {
    uploadAbortControllerRef.current?.abort();
    const ac = new AbortController();
    uploadAbortControllerRef.current = ac;
    const signal = ac.signal;
    const flowStartedAt = performance.now();
    try {
      if (item.file.size <= 0) {
        throw new Error("文件大小为 0 KB，无法上传。");
      }
      updateItem(item.id, (x) => ({
        ...x,
        uploadStatus: "计算 hash",
        ingestStatus: "待入库",
        error: "",
        transferHint: "",
        timingSummary: "",
        collectionAttachStatus: undefined,
        collectionAttachMessage: undefined,
      }));
      const digest = await sha256Hex(item.file);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      updateItem(item.id, (x) => ({ ...x, sha256: digest, uploadStatus: "重复检测" }));

      const dedupUrl = uploadsDedupUrl(apiBaseUrl, digest, library);
      const dedupResult = await fetchJsonWithTrace(dedupUrl, { signal }, "dedup", library);
      if (dedupResult.ok && uploadDedupResponseMeansExists(dedupResult.data)) {
        const d0 = dedupResult.data as { material_id?: unknown; material_file_id?: unknown };
        const earlyMid = trimmedIdString(d0.material_id);
        const earlyMfid = trimmedIdString(d0.material_file_id);
        if (earlyMid && earlyMfid) {
          const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
          const opts = collectOptsRef.current;
          const timingSummary = "重复检测：本库已有同内容主文件，跳过上传";
          if (opts.enabled) {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              timingSummary: `${timingSummary}；将尝试自动收录`,
              collectionAttachStatus: "pending",
              collectionAttachMessage: "等待素材可用后自动收录…",
            }));
            void waitMaterialAvailableThenCollect({
              itemId: item.id,
              materialId: earlyMid,
              materialFileId: earlyMfid,
              collectionId: opts.collectionId,
              note: opts.note,
              apiBaseUrl,
              token,
              libraryCode: library,
              signal,
              updateItem,
            });
          } else {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              timingSummary,
            }));
          }
          return;
        }
        const wantCollect = collectOptsRef.current.enabled;
        updateItem(item.id, (x) => ({
          ...x,
          uploadStatus: "上传完成",
          ingestStatus: "已存在，跳过入库",
          completed: true,
          progress: 100,
          ...(wantCollect
            ? {
                collectionAttachStatus: "skipped" as const,
                collectionAttachMessage:
                  "本库重复检测已存在；dedup 未返回 material_id（请确认 ECS 已部署新版 /uploads/dedup），无法自动收录",
              }
            : {}),
        }));
        return;
      }

      updateItem(item.id, (x) => ({ ...x, uploadStatus: "上传中" }));

      // ECS 签票 + 返回 LAN/公网 文件机根地址 → 探测 /health → 直连 upload → 失败则 ECS 分片
      const ticketUrl = `${apiBaseUrl}/materials/lan-upload-ticket`;
      const ticketResult = await fetchJsonWithTrace(
        ticketUrl,
        {
          method: "POST",
          headers: withAuth({ "Content-Type": "application/json" }),
          signal,
          body: JSON.stringify({
            original_filename: item.file.name,
            title: item.title.trim() || item.file.name.replace(/\.[^.]+$/, ""),
            description: item.description.trim() || null,
            tag_ids: item.selectedTagIds,
            mime_type: item.file.type || null,
            file_size: item.file.size,
            sha256: digest,
            library,
          }),
        },
        "lan-ticket",
        library
      );
      const ticketData = (ticketResult.data || {}) as LanUploadTicketResponse | { detail?: unknown };

      if (ticketResult.status === 409) {
        const recovered = await fetchDedupLiveMaterialIdsIfExists(apiBaseUrl, digest, signal, library);
        if (recovered) {
          const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
          const opts = collectOptsRef.current;
          const timingSummary = "与同内容素材合并（签票 409 幂等）· 本库已有同 sha256 主文件";
          if (opts.enabled) {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
              collectionAttachStatus: "pending",
              collectionAttachMessage: "等待素材可用后自动收录…",
            }));
            void waitMaterialAvailableThenCollect({
              itemId: item.id,
              materialId: recovered.mid,
              materialFileId: recovered.mfid,
              collectionId: opts.collectionId,
              note: opts.note,
              apiBaseUrl,
              token,
              libraryCode: library,
              signal,
              updateItem,
            });
          } else {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
            }));
          }
          return;
        }
        // 签票 409 但本库 dedup 无记录：视为跨库误伤或竞态，改走 ECS 分片，不把别库文件当本库重复。
      }

      const runDirectUploadFromBase = async (
        uploadTicket: string,
        baseRaw: string,
        routeLabel: string
      ): Promise<"success" | "size_retry" | "fail"> => {
        const base = baseRaw.replace(/\/$/, "");
        const uploadUrl = `${base}/upload?ticket=${encodeURIComponent(uploadTicket)}`;
        const lanForm = new FormData();
        lanForm.append("upload_file", item.file, item.file.name);
        const lanT0 = performance.now();
        updateItem(item.id, (x) => ({
          ...x,
          transferHint: `${routeLabel}文件机直传 NAS 中…（可点「取消当前上传」）`,
        }));
        let lanUploadResult: { ok: boolean; status: number; data: unknown };
        try {
          lanUploadResult = await fetchJsonWithTrace(
            uploadUrl,
            {
              method: "POST",
              body: lanForm,
              signal,
            },
            "lan-upload",
            library
          );
        } catch {
          return "fail";
        }
        const lanSec = (performance.now() - lanT0) / 1000;
        const lanSpeed = item.file.size / Math.max(lanSec, 0.001);
        if (!lanUploadResult.ok) return "fail";
        const lanData = (lanUploadResult.data || {}) as LanUploadOkBody;
        if (isLanUploadDuplicateSkipPayload(lanUploadResult.data)) {
          const recovered = await fetchDedupLiveMaterialIdsIfExists(apiBaseUrl, digest, signal, library);
          if (recovered) {
            const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
            const opts = collectOptsRef.current;
            const timingSummary = `${routeLabel}直传约 ${lanSec.toFixed(1)}s · 约 ${formatSpeed(lanSpeed)} · 与同内容素材幂等合并（NAS 返回无 ingest id，已从库回填）`;
            if (opts.enabled) {
              updateItem(item.id, (x) => ({
                ...x,
                uploadStatus: "上传完成",
                ingestStatus: finalIngestStatus,
                completed: true,
                progress: 100,
                transferHint: "",
                timingSummary,
                collectionAttachStatus: "pending",
                collectionAttachMessage: "等待素材可用后自动收录…",
              }));
              void waitMaterialAvailableThenCollect({
                itemId: item.id,
                materialId: recovered.mid,
                materialFileId: recovered.mfid,
                collectionId: opts.collectionId,
                note: opts.note,
                apiBaseUrl,
                token,
                libraryCode: library,
                signal,
                updateItem,
              });
            } else {
              updateItem(item.id, (x) => ({
                ...x,
                uploadStatus: "上传完成",
                ingestStatus: finalIngestStatus,
                completed: true,
                progress: 100,
                transferHint: "",
                timingSummary,
              }));
            }
            return "success";
          }
          return "fail";
        }

        const { mid, mfid } = extractLanIngestMaterialIds(lanUploadResult.data);
        const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
        const opts = collectOptsRef.current;

        /**
         * LAN 已成功 `ingest-from-nas` 时响应里必有 material / file id。
         * 若仍用 `file_size` 与浏览器 `File.size` 硬比对，multipart 与落盘统计常见少量偏差（如日志里 Content-Length 与 bytes 不一致），
         * 会误判走 ECS 分片 → init 409「同 sha 已存在」→ 界面错成「已存在，跳过入库」而库内实际已入库。
         */
        if (mid && mfid) {
          const received = typeof lanData.file_size === "number" ? lanData.file_size : NaN;
          const sizeMismatch = Number.isFinite(received) && received !== item.file.size;
          const timingExtra = sizeMismatch
            ? ` · 字节：NAS ${received} / 本地 ${item.file.size}（已返回入库 id，视为直传成功）`
            : "";
          const timingSummary = `${routeLabel}直传约 ${lanSec.toFixed(1)}s · 约 ${formatSpeed(lanSpeed)}${timingExtra}`;
          if (opts.enabled) {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
              collectionAttachStatus: "pending",
              collectionAttachMessage: "等待素材可用后自动收录…",
            }));
            void waitMaterialAvailableThenCollect({
              itemId: item.id,
              materialId: mid,
              materialFileId: mfid,
              collectionId: opts.collectionId,
              note: opts.note,
              apiBaseUrl,
              token,
              libraryCode: library,
              signal,
              updateItem,
            });
          } else {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
            }));
          }
          return "success";
        }

        const received = typeof lanData.file_size === "number" ? lanData.file_size : NaN;
        if (received !== item.file.size) {
          const sizeHint = Number.isFinite(received)
            ? `NAS 返回 ${received} 字节，本地 ${item.file.size} 字节，不一致。`
            : `NAS 未返回有效 file_size，本地 ${item.file.size} 字节。`;
          updateItem(item.id, (x) => ({
            ...x,
            uploadStatus: "上传中",
            ingestStatus: "LAN大小校验失败，已改用服务器分片上传",
            error: sizeHint,
          }));
          return "size_retry";
        }
        /* 此处 mid/mfid 仍为空：仅 size 一致且无入库 id 的兼容路径 */
        updateItem(item.id, (x) => ({
          ...x,
          uploadStatus: "上传完成",
          ingestStatus: finalIngestStatus,
          completed: true,
          progress: 100,
          transferHint: "",
          timingSummary: `${routeLabel}直传约 ${lanSec.toFixed(1)}s · 约 ${formatSpeed(lanSpeed)}`,
          ...(opts.enabled
            ? {
                collectionAttachStatus: "skipped" as const,
                collectionAttachMessage:
                  "已直传但响应中缺少 ingest.material_id/material_file_id（请确认文件机与后端版本一致），无法自动收录。",
              }
            : {}),
        }));
        return "success";
      };

      if (ticketResult.ok) {
        const typed = ticketData as LanUploadTicketResponse;
        const normalizeUploadBase = (u: string) => u.trim().replace(/\/$/, "");
        if (!preferredDirectUploadFileMachineBaseRef.current && typeof window !== "undefined") {
          const stored = window.localStorage.getItem("lan_transfer_base_url");
          if (stored) preferredDirectUploadFileMachineBaseRef.current = normalizeUploadBase(stored);
        }
        const lanB = (typed.lan_upload_base_url || "").trim() || null;
        const pubB = (typed.public_upload_base_url || "").trim() || null;
        const legacyUrl = (typed.upload_url || "").trim() || null;
        let legacyOrigin: string | null = null;
        if (legacyUrl) {
          try {
            legacyOrigin = new URL(legacyUrl).origin.replace(/\/$/, "") || null;
          } catch {
            legacyOrigin = null;
          }
        }
        const ordered: { label: string; base: string | null }[] = [
          { label: "局域网", base: lanB },
          { label: "公网", base: pubB },
        ];
        if (legacyOrigin && legacyOrigin !== lanB?.replace(/\/$/, "") && legacyOrigin !== pubB?.replace(/\/$/, "")) {
          ordered.push({ label: "兼容", base: legacyOrigin });
        }
        const pref = normalizeUploadBase(preferredDirectUploadFileMachineBaseRef.current);
        const candidates = ordered.filter((x): x is { label: string; base: string } => Boolean(x.base));
        const prefIdx = pref ? candidates.findIndex((x) => normalizeUploadBase(x.base) === pref) : -1;
        const orderedSorted = prefIdx >= 0 ? [candidates[prefIdx], ...candidates.filter((_, i) => i !== prefIdx)] : candidates;

        let directOutcome: "none" | "done" | "size_retry" = "none";
        for (const { label, base } of orderedSorted) {
          const baseNorm = normalizeUploadBase(base);
          const skipHealth = Boolean(pref && baseNorm === pref);
          if (skipHealth) {
            updateItem(item.id, (x) => ({ ...x, transferHint: `优先 ${label} 文件机直传（已记住可用基址）…` }));
          } else {
            const healthy = await probeUploadFileMachineBaseWithRetries(base, signal, (attempt, max) => {
              updateItem(item.id, (x) => ({
                ...x,
                transferHint: `探测 ${label} 文件机 /health（${attempt}/${max}）…`,
              }));
            });
            if (!healthy || signal.aborted) continue;
          }
          setLanTransferBaseUrl(baseNorm);
          if (typeof window !== "undefined") {
            window.localStorage.setItem("lan_transfer_base_url", baseNorm);
          }
          let outcome = await runDirectUploadFromBase(typed.ticket, base, label);
          if (outcome === "fail" && skipHealth) {
            const healthy = await probeUploadFileMachineBaseWithRetries(base, signal, (attempt, max) => {
              updateItem(item.id, (x) => ({
                ...x,
                transferHint: `探测 ${label} 文件机 /health（${attempt}/${max}）…`,
              }));
            });
            if (!healthy || signal.aborted) continue;
            outcome = await runDirectUploadFromBase(typed.ticket, base, label);
          }
          if (outcome === "success") {
            preferredDirectUploadFileMachineBaseRef.current = baseNorm;
            return;
          }
          if (outcome === "size_retry") {
            preferredDirectUploadFileMachineBaseRef.current = baseNorm;
            directOutcome = "size_retry";
            break;
          }
          if (outcome === "fail") continue;
        }
        if (directOutcome === "size_retry") {
          /* 已写 error，继续 ECS */
        }
      }

      const initUrl = `${apiBaseUrl}/uploads/init`;
      const initResult = await fetchJsonWithNetworkRetry(initUrl, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        signal,
        body: JSON.stringify({
          file_name: item.file.name,
          file_size: item.file.size,
          chunk_size: DEFAULT_CHUNK_SIZE,
          sha256: digest,
          library,
        }),
      }, "init", 3, 600, library);
      const initData = (initResult.data || {}) as UploadInitResponse;
      if (initResult.status === 409) {
        const recovered = await fetchDedupLiveMaterialIdsIfExists(apiBaseUrl, digest, signal, library);
        if (recovered) {
          const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
          const opts = collectOptsRef.current;
          const totalFlowSec = (performance.now() - flowStartedAt) / 1000;
          const timingSummary = `与同内容素材合并（分片 init 幂等 409）· 总耗时约 ${totalFlowSec.toFixed(1)}s`;
          if (opts.enabled) {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
              collectionAttachStatus: "pending",
              collectionAttachMessage: "等待素材可用后自动收录…",
            }));
            void waitMaterialAvailableThenCollect({
              itemId: item.id,
              materialId: recovered.mid,
              materialFileId: recovered.mfid,
              collectionId: opts.collectionId,
              note: opts.note,
              apiBaseUrl,
              token,
              libraryCode: library,
              signal,
              updateItem,
            });
          } else {
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              transferHint: "",
              timingSummary,
            }));
          }
          return;
        }
        const wantCollect = collectOptsRef.current.enabled;
        updateItem(item.id, (x) => ({
          ...x,
          uploadStatus: "上传完成",
          ingestStatus: "已存在，跳过入库",
          completed: true,
          progress: 100,
          ...(wantCollect
            ? {
                collectionAttachStatus: "skipped" as const,
                collectionAttachMessage: "分片初始化前判定与库内重复，无新素材 id，无法自动收录",
              }
            : {}),
        }));
        return;
      }
      if (!initResult.ok) throw new Error(`[接口失败] 步骤=init 方法=POST 接口=${initUrl} 状态=${initResult.status} 响应=${pretty(initData)}`);
      updateItem(item.id, (x) => ({ ...x, sessionId: initData.upload_session_id }));
      const uploaded = new Set(initData.uploaded_chunks);
      const chunkPhaseStartedAt = performance.now();

      for (let i = 0; i < initData.total_chunks; i += 1) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        if (pausedRef.current) throw new Error("已暂停");
        if (uploaded.has(i)) continue;
        const start = i * DEFAULT_CHUNK_SIZE;
        const end = Math.min(item.file.size, start + DEFAULT_CHUNK_SIZE);
        const blob = item.file.slice(start, end);
        const formData = new FormData();
        formData.append("chunk_file", blob, `${item.file.name}.part.${i}`);
        const chunkUrl = `${apiBaseUrl}/uploads/${initData.upload_session_id}/chunks/${i}`;
        const partResult = await fetchJsonWithTrace(chunkUrl, {
          method: "POST",
          headers: withAuth(),
          signal,
          body: formData,
        }, `chunk-${i}`, library);
        if (!partResult.ok) throw new Error(`[接口失败] 步骤=chunk-${i} 方法=POST 接口=${chunkUrl} 状态=${partResult.status} 响应=${pretty(partResult.data)}`);
        uploaded.add(i);
        const sentBytes = Math.round((uploaded.size / initData.total_chunks) * item.file.size);
        const elapsedChunkPhase = (performance.now() - chunkPhaseStartedAt) / 1000;
        const instSpeed = sentBytes / Math.max(elapsedChunkPhase, 0.001);
        updateItem(item.id, (x) => ({
          ...x,
          progress: Math.floor((uploaded.size / initData.total_chunks) * 100),
          transferHint: `分片 ${uploaded.size}/${initData.total_chunks} · 已传约 ${formatBytes(sentBytes)} · ${elapsedChunkPhase.toFixed(0)}s · 约 ${formatSpeed(instSpeed)}`,
        }));
      }

      const completeUrl = `${apiBaseUrl}/uploads/${initData.upload_session_id}/complete`;
      const completeResult = await fetchJsonWithTrace(completeUrl, {
        method: "POST",
        headers: withAuth(),
        signal,
      }, "complete", library);
      const completeData = (completeResult.data || {}) as UploadCompleteResponse | { detail?: unknown };
      if (!completeResult.ok) throw new Error(`[接口失败] 步骤=complete 方法=POST 接口=${completeUrl} 状态=${completeResult.status} 响应=${pretty(completeData)}`);
      updateItem(item.id, (x) => ({ ...x, uploadStatus: "上传完成", ingestStatus: "入库中" }));

      const ingestUrl = `${apiBaseUrl}/uploads/${initData.upload_session_id}/ingest`;
      const ingestResult = await fetchJsonWithTrace(ingestUrl, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        signal,
        body: JSON.stringify({
          title: item.title.trim() || item.file.name.replace(/\.[^.]+$/, ""),
          description: item.description.trim() || null,
          tag_ids: item.selectedTagIds,
        }),
      }, "ingest", library);
      const ingestData = (ingestResult.data || {}) as UploadIngestResponse | { detail?: unknown };
      if (!ingestResult.ok) {
        if (ingestResult.status === 409) {
          const recovered = await fetchDedupLiveMaterialIdsIfExists(apiBaseUrl, digest, signal, library);
          if (recovered) {
            const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
            const totalFlowSec = (performance.now() - flowStartedAt) / 1000;
            updateItem(item.id, (x) => ({
              ...x,
              uploadStatus: "上传完成",
              ingestStatus: finalIngestStatus,
              completed: true,
              progress: 100,
              error: "",
              transferHint: "",
              timingSummary: `分片入库 409 已按本库同内容合并 · 全流程约 ${totalFlowSec.toFixed(1)}s`,
            }));
            return;
          }
        }
        throw new Error(`[接口失败] 步骤=ingest 方法=POST 接口=${ingestUrl} 状态=${ingestResult.status} 响应=${pretty(ingestData)}`);
      }
      const typedIngest = ingestData as UploadIngestResponse;
      const materialId = typedIngest.material_id;
      const materialFileId = typedIngest.material_file_id;
      const finalIngestStatus = item.selectedTagIds.length > 0 ? "已提交NAS同步" : "已提交NAS同步（未整理）";
      const totalFlowSec = (performance.now() - flowStartedAt) / 1000;
      const avgAll = item.file.size / Math.max(totalFlowSec, 0.001);
      const opts = collectOptsRef.current;
      const collectExtras =
        opts.enabled && materialId && materialFileId
          ? { collectionAttachStatus: "pending" as const, collectionAttachMessage: "等待素材可用后自动收录…" }
          : opts.enabled && (!materialId || !materialFileId)
            ? {
                collectionAttachStatus: "failed" as const,
                collectionAttachMessage: "入库响应缺少 material_id/material_file_id，无法自动收录",
              }
            : {};
      updateItem(item.id, (x) => ({
        ...x,
        ingestStatus: finalIngestStatus,
        completed: true,
        progress: 100,
        error: "",
        transferHint: "",
        timingSummary: `全流程约 ${totalFlowSec.toFixed(1)}s · 平均约 ${formatSpeed(avgAll)}（含 hash/请求/分片/入库）`,
        ...collectExtras,
      }));
      if (opts.enabled && materialId && materialFileId) {
        void waitMaterialAvailableThenCollect({
          itemId: item.id,
          materialId,
          materialFileId,
          collectionId: opts.collectionId,
          note: opts.note,
          apiBaseUrl,
          token,
          libraryCode: library,
          signal,
          updateItem,
        });
      }
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message)));
      const msg = aborted ? "用户已取消上传" : error instanceof Error ? error.message : String(error);
      updateItem(item.id, (x) => ({
        ...x,
        uploadStatus: "上传失败",
        ingestStatus: "入库失败",
        completed: true,
        error: msg,
        transferHint: "",
        collectionAttachStatus: undefined,
        collectionAttachMessage: undefined,
      }));
    } finally {
      if (uploadAbortControllerRef.current === ac) {
        uploadAbortControllerRef.current = null;
      }
    }
  }

  async function startAll() {
    if (!apiResolved) {
      setResult("正在检测上传接口连通性，请稍后再试。");
      return;
    }
    if (!canUpload) {
      setResult("当前账号没有上传权限（asset.upload）。");
      return;
    }
    const healthy = await checkApiHealth(apiBaseUrl, 0);
    if (!healthy) {
      setResult(
        `[上传前检查失败] 上传接口不可用：${apiBaseUrl}\n` +
          "请先确认 ECS 后端服务状态（例如 /health），再重试上传。"
      );
      return;
    }
    setPaused(false);
    pausedRef.current = false;
    setBusy(true);
    try {
      while (true) {
        if (pausedRef.current) {
          setResult("已暂停。失败项不会自动重试，可点「重试」或再次「开始上传并入库」。");
          break;
        }
        const item = queueRef.current.find(
          (x) => !x.completed && x.uploadStatus !== "上传失败" && x.ingestStatus !== "入库失败"
        );
        if (!item) break;
        if (item.file.size <= 0) {
          updateItem(item.id, (x) => ({
            ...x,
            uploadStatus: "上传失败",
            ingestStatus: "入库失败",
            completed: true,
            error: "文件大小为 0 KB，无法上传。",
          }));
          continue;
        }
        await uploadOne(item);
      }
      const final = queueRef.current;
      const successNew = final.filter(
        (x) =>
          x.completed &&
          (x.ingestStatus === "已提交NAS同步" || x.ingestStatus === "已提交NAS同步（未整理）")
      ).length;
      const skippedDup = final.filter((x) => x.completed && x.ingestStatus === "已存在，跳过入库").length;
      const failed = final.filter((x) => x.uploadStatus === "上传失败" || x.ingestStatus === "入库失败").length;
      const hasNasWork = final.some(
        (x) =>
          x.completed &&
          (x.ingestStatus === "已提交NAS同步" ||
            x.ingestStatus === "已提交NAS同步（未整理）" ||
            x.ingestStatus === "入库中")
      );
      const nasHint = hasNasWork
        ? "已有新入库条目进入 NAS 作业阶段，可在 worker 轮询中看到任务。"
        : skippedDup > 0 && successNew === 0 && failed === 0
          ? "本次均为「与库内重复」跳过，未产生新 NAS 搬运作业（属正常，不会重复占库）。"
          : "尚未进入 NAS 作业阶段（通常卡在 ingest 前），所以 worker 轮询拿不到作业。";
      setResult(
        `[上传流程结束] 新入库成功=${successNew} 重复跳过=${skippedDup} 失败=${failed}\n` +
          `${nasHint}\n` +
          `当前局域网传输服务：${lanTransferBaseUrl || "未设置"}`
      );
    } finally {
      setBusy(false);
    }
  }

  function clearCompleted() {
    setQueue((prev) => {
      const next = prev.filter((x) => !x.completed);
      queueRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    if (queue.length === 0) {
      if (activeId) setActiveId("");
      return;
    }
    if (!activeId || !queue.some((x) => x.id === activeId)) {
      setActiveId(queue[0].id);
    }
  }, [queue, activeId]);

  const activeItem = queue.find((x) => x.id === activeId) || null;
  const selectedCount = queue.length;
  const uploadingCount = queue.filter((x) => x.uploadStatus === "上传中").length;
  const completedCount = queue.filter((x) => x.completed).length;
  const failedCount = queue.filter((x) => x.uploadStatus === "上传失败" || x.ingestStatus === "入库失败").length;
  const queueProgressPct =
    selectedCount > 0 ? Math.min(100, Math.round((completedCount / selectedCount) * 1000) / 10) : 0;
  const uploadDisabledReason =
    !apiResolved
      ? "上传接口未就绪，请先确认“当前接口”已解析成功。"
      : canUpload === false
        ? "当前账号没有上传权限（asset.upload）。"
        : queue.length === 0
          ? "请先选择文件。"
          : busy
            ? "正在上传中，请稍候。"
            : "";

  function applyTagsToCurrent() {
    if (!activeItem) return;
    mergeTagSlashRecentStorage(selectedPanelTagIds);
    updateItem(activeItem.id, (x) => ({
      ...x,
      selectedTagIds: selectedPanelTagIds,
      tagStatus: selectedPanelTagIds.length > 0 ? "已选择标签" : "将进入未整理",
    }));
  }

  function applyTagsToAll() {
    mergeTagSlashRecentStorage(selectedPanelTagIds);
    setQueue((prev) => {
      const tagStatus: QueueItem["tagStatus"] =
        selectedPanelTagIds.length > 0 ? "已选择标签" : "将进入未整理";
      const next = prev.map((x) => ({
        ...x,
        selectedTagIds: selectedPanelTagIds,
        tagStatus,
      }));
      queueRef.current = next;
      return next;
    });
  }

  function retryItem(item: QueueItem) {
    updateItem(item.id, (x) => ({
      ...x,
      uploadStatus: "待上传",
      ingestStatus: "待入库",
      progress: 0,
      error: "",
      completed: false,
      transferHint: "",
      timingSummary: "",
      collectionAttachStatus: undefined,
      collectionAttachMessage: undefined,
    }));
  }

  return (
    <main className="mx-auto grid w-full min-w-0 max-w-none gap-5 px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <MaintenanceBanner token={token} />
        <h1 className="text-2xl font-semibold text-slate-900">上传队列</h1>
        <p className="mt-1 text-sm font-medium text-slate-800">
          当前入库到：{ASSET_LIBRARY_OPTIONS.find((x) => x.code === library)?.label || library}
          {isPersonalVideo ? "（跟随顶栏素材库，不会静默进汽车库）" : ""}
        </p>
        <p data-tour="upload-status" className="mt-1 text-sm text-slate-600">
          已选 {selectedCount} 个文件｜上传中 {uploadingCount}｜已完成 {completedCount}｜失败 {failedCount}
        </p>
        {selectedCount > 0 ? (
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-slate-600">
              <span>整体进度（已完成 / 已选）</span>
              <span className="tabular-nums font-semibold text-slate-800">
                {completedCount} / {selectedCount}（{queueProgressPct}%）
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={selectedCount}
              aria-valuenow={completedCount}
              aria-label={`上传队列已完成 ${completedCount} 项，共 ${selectedCount} 项`}
            >
              <div
                className="h-full min-w-0 rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
                style={{ width: `${queueProgressPct}%` }}
              />
            </div>
          </div>
        ) : null}
        {pickNotice ? (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">{pickNotice}</div>
        ) : null}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!canCollectionView ? (
            <>
              <div className="text-sm font-semibold text-slate-900">上传完成后收录到集合（可选）</div>
              <p className="mt-2 text-xs text-amber-800">需要 collection.view 权限才能加载集合列表并启用自动收录。</p>
            </>
          ) : (
            <div className="grid gap-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={postUploadAutoCollect}
                  onChange={(e) => setPostUploadAutoCollect(e.target.checked)}
                  disabled={busy}
                />
                <span className="min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">上传完成后收录到集合（可选）</span>
              </label>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                <select
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:opacity-50 sm:min-w-[8rem] sm:max-w-[12rem]"
                  value={postUploadGroupFilter}
                  onChange={(e) => setPostUploadGroupFilter(e.target.value)}
                  disabled={busy || !postUploadAutoCollect || collectionsLoading}
                  aria-label="选择分组"
                >
                  <option value="">全部分组</option>
                  {pickableGroups.map((g) => (
                    <option key={`${g.scope}-${g.id}`} value={g.id}>
                      {g.scope === "personal" ? "[个人]" : "[项目]"} {g.name}
                    </option>
                  ))}
                </select>
                <select
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:opacity-50 sm:min-w-[10rem] sm:max-w-[16rem]"
                  value={postUploadCollectionId}
                  onChange={(e) => setPostUploadCollectionId(e.target.value)}
                  disabled={
                    busy || !postUploadAutoCollect || collectionsLoading || uploadFilteredPickableCollections.length === 0
                  }
                  aria-label="选择目标集合"
                >
                  <option value="">
                    {uploadFilteredPickableCollections.length === 0 ? "当前筛选下无集合" : "请选择目标集合…"}
                  </option>
                  {uploadFilteredPickableCollections.map((c) => {
                    const gn = c.group_id ? uploadPickGroupNameById.get(c.group_id) : null;
                    const scopeTag = c.scope === "personal" ? "[个人]" : "[项目]";
                    const label = gn ? `${scopeTag} ${gn} / ${c.name}` : `${scopeTag} ${c.name}`;
                    return (
                      <option key={`${c.scope}-${c.id}`} value={c.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                <input
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                  value={postUploadCollectNote}
                  onChange={(e) => setPostUploadCollectNote(e.target.value)}
                  placeholder="集合内备注（可选）"
                  disabled={busy || !postUploadAutoCollect}
                />
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-400 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 whitespace-nowrap disabled:opacity-40"
                    disabled={busy || collectionsLoading}
                    onClick={() => void loadPickableCollections()}
                  >
                    刷新列表
                  </button>
                  {collectionsLoading ? <span className="text-xs text-slate-500">加载中…</span> : null}
                </div>
              </div>
              {collectionsLoadError ? <p className="text-xs text-red-700">{collectionsLoadError}</p> : null}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" data-tour="upload-file-picker">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onChooseFile} disabled={busy} />
          <button
            type="button"
            className={`rounded px-3 py-2 text-sm ${(canUpload === false) ? "bg-slate-600 text-slate-300" : "bg-blue-600 text-white"}`}
            onClick={onClickChooseFile}
            disabled={busy}
          >
            选择文件
          </button>
          <button
            data-tour="upload-start-button"
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={busy || queue.length === 0 || canUpload === false || !apiResolved}
            onClick={() => void startAll()}
          >
            开始上传并入库
          </button>
          {uploadDisabledReason ? (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{uploadDisabledReason}</div>
          ) : null}
          <button className="rounded bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!busy} onClick={() => setPaused(true)}>
            暂停全部
          </button>
          <button
            type="button"
            className="rounded border border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-950 disabled:opacity-40"
            disabled={!busy}
            onClick={() => uploadAbortControllerRef.current?.abort()}
            title="立即中断当前网络请求（与「暂停」不同）"
          >
            取消当前上传
          </button>
          <button className="rounded bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={completedCount === 0} onClick={clearCompleted}>
            清空已完成
          </button>
          {canUpload === false ? (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              当前账号没有上传权限（asset.upload）
            </div>
          ) : null}
          <div className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-200">
            当前接口：{apiBaseUrl}
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(7rem,1fr)_minmax(0,5fr)]">
        <aside
          className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-[box-shadow,background-color] ${
            queueDropActive ? "bg-sky-100 shadow-[inset_0_0_0_2px_rgb(2,132,199)]" : ""
          }`}
          data-tour="upload-queue-list"
          onDragEnter={onQueueAsideDragEnter}
          onDragLeave={onQueueAsideDragLeave}
          onDragOver={onQueueAsideDragOver}
          onDrop={onQueueAsideDrop}
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">文件队列</div>
            <span data-tour="upload-retry-button" className="max-w-[min(100%,20rem)] text-right text-xs leading-snug text-slate-500">
              失败项可点「重试」；可将本地文件拖入本卡片任意区域（含标题）添加
            </span>
          </div>
          <div className="max-h-[62vh] min-h-[7rem] space-y-2 overflow-auto rounded-md px-1 py-2">
            {queue.length === 0 ? (
              <div className="flex min-h-[5rem] items-center justify-center px-2 text-center text-xs text-slate-400">
                将本地文件拖放到此处即可加入队列（多选与「选择文件」一致）
              </div>
            ) : null}
            {queue.map((item) => (
              <div
                key={item.id}
                className={`cursor-pointer rounded border p-2 ${
                  activeId === item.id ? "border-sky-600 bg-slate-700 text-slate-50" : "border-slate-200 bg-white text-slate-900"
                }`}
                onClick={() => setActiveId(item.id)}
              >
                <div className="truncate text-sm font-medium">{item.file.name}</div>
                <div className={`text-xs ${activeId === item.id ? "text-slate-300" : "text-slate-500"}`}>{formatBytes(item.file.size)}</div>
                <div className={`text-xs ${activeId === item.id ? "text-slate-200" : ""}`}>
                  上传：{item.uploadStatus}（{item.progress}%）
                </div>
                <div
                  className={`text-xs ${
                    item.ingestStatus === "已存在，跳过入库"
                      ? activeId === item.id
                        ? "font-semibold text-red-300"
                        : "font-semibold text-red-600"
                      : activeId === item.id
                        ? "text-slate-200"
                        : ""
                  }`}
                >
                  入库：{item.ingestStatus}
                </div>
                <div className={`text-xs ${activeId === item.id ? "text-slate-200" : ""}`}>标签：{item.tagStatus}</div>
                {item.collectionAttachMessage ? (
                  <div className={`mt-1 text-xs ${activeId === item.id ? "text-sky-200" : "text-sky-800"}`}>收录：{item.collectionAttachMessage}</div>
                ) : null}
                <div className="mt-1 flex gap-2">
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQueue((prev) => {
                        const next = prev.filter((x) => x.id !== item.id);
                        queueRef.current = next;
                        return next;
                      });
                    }}
                  >
                    移除
                  </button>
                  {(item.uploadStatus === "上传失败" || item.ingestStatus === "入库失败") ? (
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        retryItem(item);
                      }}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
                {item.error ? (
                  <div className={`mt-1 text-xs ${activeId === item.id ? "text-red-200" : "text-red-600"}`}>{item.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <section data-tour="upload-current-file-panel" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">当前文件信息</div>
          {!activeItem ? (
            <div className="mt-3 text-sm text-slate-500">请先从左侧选择文件。</div>
          ) : (
            <div className="mt-3 grid gap-3">
              <div className="rounded border p-3 text-sm">
                <div className="font-medium">{activeItem.file.name}</div>
                <div className="text-xs text-slate-500">大小：{formatBytes(activeItem.file.size)}</div>
                <div className="text-xs text-slate-500">类型：{activeItem.file.type || "unknown"}</div>
              </div>
              <input
                className="rounded border px-3 py-2 text-sm"
                value={activeItem.title}
                onChange={(e) => updateItem(activeItem.id, (x) => ({ ...x, title: e.target.value }))}
                placeholder="入库标题"
              />
              <textarea
                className="min-h-24 rounded border px-3 py-2 text-sm"
                value={activeItem.description}
                onChange={(e) => updateItem(activeItem.id, (x) => ({ ...x, description: e.target.value }))}
                placeholder="入库描述"
              />
              <div className="rounded border p-2 text-xs text-slate-500">
                上传状态：{activeItem.uploadStatus} / 入库状态：
                {activeItem.ingestStatus === "已存在，跳过入库" ? (
                  <span className="font-semibold text-red-600">{activeItem.ingestStatus}</span>
                ) : (
                  <span>{activeItem.ingestStatus}</span>
                )}
              </div>
              {activeItem.transferHint ? (
                <div className="rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-950">{activeItem.transferHint}</div>
              ) : null}
              {activeItem.timingSummary ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-950">{activeItem.timingSummary}</div>
              ) : null}
              {activeItem.collectionAttachMessage ? (
                <div className="rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-950">
                  收录：{activeItem.collectionAttachMessage}
                </div>
              ) : null}
              <div className="rounded border p-2 text-xs text-slate-500">
                已选标签：
                {activeItem.selectedTagIds.length === 0
                  ? " 无"
                  : ` ${Object.values(tagGroups)
                      .flat()
                      .filter((tag) => activeItem.selectedTagIds.includes(tag.id))
                      .map((tag) => tag.name)
                      .join(" / ")}`}
              </div>
            </div>
          )}
        </section>

        <aside className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">操作面板</div>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            <button
              type="button"
              className="w-full rounded bg-blue-600 px-2 py-2 text-center text-sm text-white disabled:opacity-40"
              disabled={!activeItem}
              onClick={applyTagsToCurrent}
            >
              应用到当前文件
            </button>
            <button
              type="button"
              className="w-full rounded bg-slate-700 px-2 py-2 text-center text-sm text-white disabled:opacity-40"
              disabled={queue.length === 0}
              onClick={applyTagsToAll}
            >
              应用到全部文件
            </button>
          </div>
        </aside>

        <aside data-tour="upload-tag-panel" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">标签选择面板</div>
          {tagLoading ? <div className="mt-2 text-xs text-slate-500">标签加载中...</div> : null}
          {!tagLoading && tagLoadError ? <div className="mt-2 text-xs text-amber-700">{tagLoadError}</div> : null}
          {!tagLoading && !tagLoadError ? (
            <TagSlashPicker
              className="mt-3"
              theme="light"
              tagGroups={tagGroups}
              selectedTagIds={selectedPanelTagIds}
              onSelectedTagIdsChange={setSelectedPanelTagIds}
            />
          ) : null}
          <div className="mt-3 grid gap-3">
            {orderedTagGroupKeys.map((group) => (
              <div key={group}>
                <div className="mb-1 text-xs font-medium" title={tagCategoryHoverTitle(group)}>
                  {tagCategoryShort(group)}
                </div>
                <div className="max-h-20 overflow-auto rounded border p-2">
                  {(tagGroups[group] || []).map((tag) => (
                    <label
                      key={tag.id}
                      className="mr-2 inline-flex items-center gap-1 text-xs"
                      title={
                        (tag.description || "").trim()
                          ? `${tag.name} — ${(tag.description || "").trim()}`
                          : tag.name
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedPanelTagIds.includes(tag.id)}
                        onChange={() =>
                          setSelectedPanelTagIds((prev) => (prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]))
                        }
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!tagLoading && orderedTagGroupKeys.length === 0 ? (
              <div className="rounded border px-3 py-2 text-xs text-slate-500">暂无可用标签分组。</div>
            ) : null}
          </div>
        </aside>
      </section>

      <pre className="min-h-[140px] whitespace-pre-wrap rounded-xl bg-slate-900 p-4 text-xs text-emerald-100">{result}</pre>
      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="upload" />
      </Suspense>
    </main>
  );
}
