import { loadDesktopSettings } from "@/lib/settingsStore";

export type LcpBootPayload = {
  apiBaseUrl: string;
  cacheRoot: string;
  jsonPath?: string;
  settingsFileMissing?: boolean;
  /** 与 Web 一致：请求发往 Next 的 /api-proxy */
  usesNextApiProxy?: boolean;
};

let resolved: LcpBootPayload | null = null;
let inflight: Promise<LcpBootPayload> | null = null;

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * 解析本机 API / 缓存配置：Electron 主进程（local.settings.json + 环境变量）优先，
 * 其次 Vite 注入（无 Electron 时纯浏览器打开 dev server），最后 localStorage（旧版迁移）。
 */
export function resolveBootConfig(): Promise<LcpBootPayload> {
  if (resolved) return Promise.resolve(resolved);
  if (inflight) return inflight;

  inflight = (async () => {
    let api = "";
    let cache = "";
    let jsonPath: string | undefined;
    let settingsFileMissing: boolean | undefined;
    let usesNextApiProxy: boolean | undefined;

    if (typeof window !== "undefined" && window.desktopClient?.getBootConfig) {
      try {
        const r = (await window.desktopClient.getBootConfig()) as LcpBootPayload | undefined;
        api = r?.apiBaseUrl ?? "";
        cache = r?.cacheRoot ?? "";
        jsonPath = r?.jsonPath;
        settingsFileMissing = r?.settingsFileMissing;
        usesNextApiProxy = r?.usesNextApiProxy;
      } catch {
        /* ignore */
      }
    }

    const viteApi = String(import.meta.env.VITE_LCP_API_BASE_URL || "").trim();
    const viteCache = String(import.meta.env.VITE_LCP_CACHE_ROOT || "").trim();
    if (!api) api = viteApi;
    if (!cache) cache = viteCache;

    const ls = loadDesktopSettings();
    if (!api) api = ls.apiBaseUrl;
    if (!cache) cache = ls.cacheRoot;

    const normApi = normalizeBase(api);
    if (usesNextApiProxy == null) {
      usesNextApiProxy = normApi.includes("/api-proxy");
    }

    resolved = {
      apiBaseUrl: normApi,
      cacheRoot: cache.trim(),
      jsonPath,
      settingsFileMissing,
      usesNextApiProxy: Boolean(usesNextApiProxy),
    };
    return resolved;
  })();

  return inflight;
}

/** 须在 `resolveBootConfig()` 完成后使用 */
export function getBootApiBaseUrl(): string {
  return resolved?.apiBaseUrl ?? "";
}

export function getBootCacheRoot(): string {
  return resolved?.cacheRoot ?? "";
}

export function usesNextApiProxyMode(): boolean {
  return Boolean(resolved?.usesNextApiProxy);
}
