/**
 * 与素材库页一致的「下载选路」：LAN → WAN → ECS 缓存。
 * - `resolveMaterialDownload`：返回最终 URL 等元数据，供「选择保存方式」弹窗。
 * - `downloadMaterialFileBrowserDefault`：直接触发浏览器默认下载（批量等场景）。
 */

export function toAbsoluteUrl(apiBaseUrl: string, maybeRelativeUrl: string): string {
  if (!maybeRelativeUrl) return "";
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  return `${apiBaseUrl.replace(/\/$/, "")}${maybeRelativeUrl}`;
}

function fmtJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 网关/异常时常返回 HTML（如 Internal Server Error），`resp.json()` 会抛出难懂的 SyntaxError */
async function readJsonBodyOrThrow(resp: Response): Promise<unknown> {
  const text = await resp.text();
  const t = text.trim();
  if (!t) {
    throw new Error(!resp.ok ? `HTTP ${resp.status}（无响应体）` : "响应体为空");
  }
  try {
    return JSON.parse(t) as unknown;
  } catch {
    const oneLine = t.replace(/\s+/g, " ");
    const snippet = oneLine.length > 180 ? `${oneLine.slice(0, 180)}…` : oneLine;
    throw new Error(
      !resp.ok
        ? `HTTP ${resp.status}，响应不是 JSON（多为服务异常或网关错误页）：${snippet}`
        : `服务器返回非 JSON：${snippet}`
    );
  }
}

export function isInsecureHttpFromSecurePage(targetBaseOrFullUrl: string): boolean {
  /**
   * Electron 壳内常为 http://127.0.0.1（亦为安全上下文），文件机为 http://192.168.*；
   * 若按 Web 混合内容规则跳过，则永远不探测 LAN，始终落 ECS。
   */
  if (typeof window !== "undefined" && window.desktopClient) return false;
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

const FILE_MACHINE_PROBE_LAN_MS = 800;
const FILE_MACHINE_PROBE_WAN_MS = 1500;
const FILE_MACHINE_HEALTH_DEFAULT_MS = 2800;
/** `POST .../download-route` 无超时时会永久卡住 UI；与 Web 同源加硬上限 */
const DOWNLOAD_ROUTE_FETCH_TIMEOUT_MS = 60_000;

/** 将用户取消与单次请求超时合并（优先使用标准 API，旧环境退化为仅用户信号）。 */
function combineUserAndTimeout(userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const AnyCtor = typeof AbortSignal !== "undefined" && (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal && typeof AnyCtor === "function") {
    const t = AbortSignal.timeout(timeoutMs);
    return userSignal ? AnyCtor([userSignal, t]) : t;
  }
  const c = new AbortController();
  const timer = window.setTimeout(() => c.abort(), timeoutMs);
  const stop = () => {
    window.clearTimeout(timer);
    if (!c.signal.aborted) c.abort();
  };
  if (userSignal) {
    if (userSignal.aborted) {
      stop();
      return c.signal;
    }
    userSignal.addEventListener("abort", stop, { once: true });
  }
  return c.signal;
}

function buildTicketDownloadUrl(baseUrl: string, ticket: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/download?ticket=${encodeURIComponent(ticket)}`;
}

async function probeFileMachineHealth(
  baseUrl: string,
  externalSignal: AbortSignal,
  timeoutMs: number = FILE_MACHINE_HEALTH_DEFAULT_MS
): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "");
  if (!base) return false;
  const healthUrl = `${base}/health`;

  const mainProbe = typeof window !== "undefined" ? window.desktopClient?.probeHttpGet : undefined;
  if (typeof mainProbe === "function") {
    try {
      if (externalSignal.aborted) return false;
      const r = await mainProbe(healthUrl, timeoutMs);
      return Boolean(r?.ok);
    } catch {
      return false;
    }
  }

  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  externalSignal.addEventListener("abort", onAbort);
  try {
    if (externalSignal.aborted) return false;
    const resp = await fetch(healthUrl, { method: "GET", mode: "cors", signal: ctl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
    externalSignal.removeEventListener("abort", onAbort);
  }
}

export function collectLanDownloadBases(route: {
  lan_download_base_url?: string | null;
  lan_download_base_urls?: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    for (const part of String(raw).split(/[,;\s]+/)) {
      const u = part.trim().replace(/\/$/, "");
      if (!u) continue;
      const key = u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
    }
  };
  for (const u of route.lan_download_base_urls || []) add(u);
  add(route.lan_download_base_url);
  return out;
}

let cachedLanOrigin: { origin: string; at: number } | null = null;
const LAN_ORIGIN_CACHE_MS = 30_000;

function urlOrigin(raw: string): string | null {
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

export async function pickReachableMediaUrl(
  candidates: Array<string | null | undefined>,
  signal?: AbortSignal,
  timeoutMs: number = FILE_MACHINE_PROBE_LAN_MS
): Promise<string | null> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const u = (raw || "").trim();
    if (!u || isInsecureHttpFromSecurePage(u)) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(u);
  }
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  const sig = signal ?? new AbortController().signal;
  const byOrigin = new Map<string, string>();
  for (const u of unique) {
    const origin = urlOrigin(u);
    if (!origin) continue;
    if (!byOrigin.has(origin)) byOrigin.set(origin, u);
  }
  const origins = [...byOrigin.keys()];
  if (cachedLanOrigin && Date.now() - cachedLanOrigin.at < LAN_ORIGIN_CACHE_MS) {
    const hit = byOrigin.get(cachedLanOrigin.origin);
    if (hit) return hit;
  }
  const results = await Promise.all(
    origins.map(async (origin) => ({
      origin,
      ok: await probeFileMachineHealth(origin, sig, timeoutMs),
    }))
  );
  const winner = results.find((r) => r.ok);
  if (winner) {
    cachedLanOrigin = { origin: winner.origin, at: Date.now() };
    return byOrigin.get(winner.origin) || unique[0];
  }
  return unique[0];
}

export async function resolveDirectMediaUrl(
  apiBaseUrl: string,
  data: { url?: string | null; alternate_urls?: string[] | null },
  signal?: AbortSignal
): Promise<string> {
  const primary = data.url ? toAbsoluteUrl(apiBaseUrl, data.url) : "";
  const alts = (data.alternate_urls || []).map((u) => toAbsoluteUrl(apiBaseUrl, u));
  return (await pickReachableMediaUrl([primary, ...alts], signal)) || "";
}

type DownloadPrepareStatusJson = {
  job_id?: string;
  status?: string;
  error_message?: string | null;
  download_url?: string | null;
  detail?: unknown;
};

async function pollEcsDownloadCacheFallback(
  apiBaseUrl: string,
  materialId: string,
  fileId: string,
  buildHeaders: () => Record<string, string>,
  signal: AbortSignal,
  onPhase?: (message: string) => void
): Promise<string> {
  onPhase?.("正在提交 ECS 缓存下载准备任务…");
  const prep = await fetch(`${apiBaseUrl}/materials/${materialId}/files/${fileId}/download-prepare`, {
    method: "POST",
    headers: buildHeaders(),
    signal,
  });
  const prepJson = (await readJsonBodyOrThrow(prep)) as DownloadPrepareStatusJson;
  if (!prep.ok) throw new Error(fmtJson(prepJson));
  const jobId = prepJson.job_id;
  if (!jobId) throw new Error("download-prepare 未返回 job_id");

  const deadline = Date.now() + 20 * 60 * 1000;
  let round = 0;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    round += 1;
    onPhase?.(`ECS 缓存准备中（第 ${round} 次查询，大文件可能需数分钟）…`);
    const st = await fetch(`${apiBaseUrl}/materials/download-prepare/${jobId}`, {
      headers: buildHeaders(),
      signal,
    });
    const stj = (await readJsonBodyOrThrow(st)) as DownloadPrepareStatusJson;
    if (!st.ok) throw new Error(fmtJson(stj));
    const status = String(stj.status || "");
    if (status === "failed" || status === "error") {
      throw new Error(stj.error_message || "prepare_download 失败");
    }
    if (status === "success" && stj.download_url) {
      return toAbsoluteUrl(apiBaseUrl, stj.download_url);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("ECS 缓存下载准备超时");
}

export function triggerBrowserDownload(url: string): void {
  if (typeof window === "undefined" || !url) return;
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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

export type DownloadTransportRoute = "lan_direct" | "wan_direct" | "ecs_fallback" | "nas_smb";

export type MaterialResolvedDownload = {
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
};

type ResolveOpts = {
  apiBaseUrl: string;
  materialId: string;
  fileId: string;
  filename: string;
  authHeaders: () => Record<string, string>;
  signal?: AbortSignal;
  /** 选路各阶段文案，供桌面拖出保存等场景刷新 UI（与 Web 同源）。 */
  onPhase?: (message: string) => void;
};

/**
 * 解析出与素材库「选路完成」一致的下载结果；HTTPS 站点下 **不探测** `http://` 文件机 `/health`（避免混合内容拦截），直接走 WAN / ECS。
 */
export async function resolveMaterialDownload(opts: ResolveOpts): Promise<MaterialResolvedDownload> {
  const { apiBaseUrl, materialId, fileId, filename, authHeaders, signal: userSignal, onPhase } = opts;
  const localAc = userSignal ? null : new AbortController();
  const sig = userSignal ?? localAc!.signal;
  const flowStartedAt = performance.now();

  onPhase?.("正在请求下载票据（POST download-route）…");
  const routeSignal = combineUserAndTimeout(userSignal, DOWNLOAD_ROUTE_FETCH_TIMEOUT_MS);
  const routeResp = await fetch(`${apiBaseUrl}/materials/${materialId}/files/${fileId}/download-route`, {
    method: "POST",
    headers: authHeaders(),
    signal: routeSignal,
  });
  const routeJson = (await readJsonBodyOrThrow(routeResp)) as MaterialDownloadRouteResponse | { detail?: unknown };
  if (!routeResp.ok) throw new Error(fmtJson(routeJson));
  const route = routeJson as MaterialDownloadRouteResponse;
  const ticket = route.ticket;

  const tryDirect = async (
    base: string | null,
    label: string,
    transportRoute: DownloadTransportRoute,
    outcomeKind: "lan_machine" | "wan_machine"
  ): Promise<MaterialResolvedDownload | null> => {
    if (!base || !String(base).trim()) return null;
    /** HTTPS 页面对 `http://` 文件机的 fetch 会被混合内容策略拦截，跳过直连探测 */
    if (isInsecureHttpFromSecurePage(base)) return null;
    const directUrl = buildTicketDownloadUrl(base, ticket);
    if (label.includes("公网") && isInsecureHttpFromSecurePage(directUrl)) return null;
    onPhase?.(`正在探测${label}文件机 /health（约 ${label.includes("公网") ? FILE_MACHINE_PROBE_WAN_MS : FILE_MACHINE_PROBE_LAN_MS}ms）…`);
    const probeMs = label.includes("公网") ? FILE_MACHINE_PROBE_WAN_MS : FILE_MACHINE_PROBE_LAN_MS;
    const ok = await probeFileMachineHealth(base, sig, probeMs);
    if (!ok || sig.aborted) return null;
    return {
      absoluteUrl: directUrl,
      transportRoute,
      filename,
      materialId,
      fileId,
      expiresAt: route.expires_at || "",
      recommendedOrder: route.recommended_order,
      flowStartedAt,
      outcomeKind,
      directLabel: label,
    };
  };

  const lanBases = collectLanDownloadBases(route);
  for (const [idx, base] of lanBases.entries()) {
    const label = lanBases.length > 1 ? `局域网(${idx + 1}/${lanBases.length})` : "局域网";
    const directLan = await tryDirect(base, label, "lan_direct", "lan_machine");
    if (directLan) return directLan;
  }

  const directWan = await tryDirect(route.public_download_base_url, "公网", "wan_direct", "wan_machine");
  if (directWan) return directWan;

  const hasLan = lanBases.length > 0;
  const hasPub = !!(route.public_download_base_url && String(route.public_download_base_url).trim());
  const routeHint =
    !hasLan && !hasPub
      ? "ECS 未返回文件机基址。"
      : hasLan && !hasPub
        ? "外网可能无法访问局域网文件机。"
        : "文件机不可用或 HTTPS 下无法使用 http 文件机直连，已走 ECS 缓存。";

  onPhase?.("直连不可用，改用 ECS 缓存兜底…");
  const fallbackUrl = await pollEcsDownloadCacheFallback(apiBaseUrl, materialId, fileId, authHeaders, sig, onPhase);
  return {
    absoluteUrl: fallbackUrl,
    transportRoute: "ecs_fallback",
    filename,
    materialId,
    fileId,
    expiresAt: route.expires_at || "",
    recommendedOrder: route.recommended_order,
    flowStartedAt,
    outcomeKind: "ecs_fallback",
    ecsNote: routeHint,
  };
}

/**
 * 触发浏览器下载（默认新标签打开下载链），不弹「选择目录」。
 */
export async function downloadMaterialFileBrowserDefault(opts: {
  apiBaseUrl: string;
  materialId: string;
  fileId: string;
  authHeaders: () => Record<string, string>;
  signal?: AbortSignal;
  /** 用于日志/展示；缺省为 download.bin */
  filename?: string;
}): Promise<void> {
  const filename = (opts.filename || "").trim() || "download.bin";
  const resolved = await resolveMaterialDownload({
    apiBaseUrl: opts.apiBaseUrl,
    materialId: opts.materialId,
    fileId: opts.fileId,
    filename,
    authHeaders: opts.authHeaders,
    signal: opts.signal,
  });
  triggerBrowserDownload(resolved.absoluteUrl);
}
