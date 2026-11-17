import { loadAuthSession } from "@/lib/auth";
import { getBootApiBaseUrl } from "@/lib/bootConfig";
import { loadAssetLibraryCode } from "@/lib/assetLibrary";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 当前 API 根地址（来自本机配置文件 / 环境变量 / 旧版 localStorage）；空表示未配置 */
export function getApiBaseUrl(): string {
  return normalizeBase(getBootApiBaseUrl());
}

export function requireApiBaseUrl(): string {
  const b = getApiBaseUrl();
  if (!b)
    throw new Error(
      "未配置请求根：请设置 LCP_WEB_ORIGIN（与 Web 一致走 Next 的 /api-proxy）或 LCP_API_BASE_URL（直连 FastAPI），见 desktop-client/local-env.example.bat。"
    );
  return b;
}

function mergeUrl(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBase(base)}${p}`;
}

function buildAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers();
  headers.set("X-Access-Context", "internal");
  headers.set("X-Asset-Library", loadAssetLibraryCode());
  const session = loadAuthSession();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (extra instanceof Headers) {
    extra.forEach((v, k) => headers.set(k, v));
  } else if (Array.isArray(extra)) {
    extra.forEach(([k, v]) => headers.set(k, v));
  } else if (extra && typeof extra === "object") {
    Object.entries(extra as Record<string, string>).forEach(([k, v]) => {
      if (v != null) headers.set(k, String(v));
    });
  }
  return headers;
}

/** 已配置 API 根时携带鉴权头；用于登录前探测等场景请自行传 `base`。 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = requireApiBaseUrl();
  const url = mergeUrl(base, path);
  const headers = buildAuthHeaders(init.headers);
  return fetch(url, { ...init, headers });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await apiFetch(path, init);
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const d = data as { detail?: unknown } | null;
    let msg = `${resp.status} ${resp.statusText}`;
    if (d?.detail != null) {
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
    }
    throw new Error(msg);
  }
  return data as T;
}

/** 使用指定根地址发请求（登录前写入 `settings` 前可用 `base` 拉取 `/auth/me` 校验）。 */
export async function fetchWithBase(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = mergeUrl(baseUrl, path);
  const headers = buildAuthHeaders(init.headers);
  return fetch(url, { ...init, headers });
}
