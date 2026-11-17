const KEY = "lcp_desktop_settings";

export type DesktopSettings = {
  /** 直连 FastAPI 根，如 `http://127.0.0.1:8000`，无尾部斜杠 */
  apiBaseUrl: string;
  /** 本地素材缓存根目录；空串表示使用当前平台默认路径 */
  cacheRoot: string;
};

export const DEFAULT_CACHE_ROOT_WINDOWS = "D:\\LCP-Material-Cache";
export const DEFAULT_CACHE_ROOT_MACOS = "~/Movies/LCP-Material-Cache";

export function defaultCacheRootForPlatform(platform?: string): string {
  const p = platform ?? (typeof window !== "undefined" ? window.desktopClient?.platform : undefined);
  return p === "darwin" ? DEFAULT_CACHE_ROOT_MACOS : DEFAULT_CACHE_ROOT_WINDOWS;
}

export function loadDesktopSettings(): DesktopSettings {
  if (typeof window === "undefined") {
    return { apiBaseUrl: "", cacheRoot: "" };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { apiBaseUrl: "", cacheRoot: "" };
    const o = JSON.parse(raw) as Partial<DesktopSettings>;
    return {
      apiBaseUrl: typeof o.apiBaseUrl === "string" ? o.apiBaseUrl.trim() : "",
      cacheRoot: typeof o.cacheRoot === "string" ? o.cacheRoot.trim() : "",
    };
  } catch {
    return { apiBaseUrl: "", cacheRoot: "" };
  }
}

export function saveDesktopSettings(next: DesktopSettings): void {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({
      apiBaseUrl: next.apiBaseUrl.trim().replace(/\/+$/, ""),
      cacheRoot: next.cacheRoot.trim(),
    })
  );
}

export function resolvedCacheRoot(): string {
  const s = loadDesktopSettings();
  if (s.cacheRoot) return s.cacheRoot;
  return defaultCacheRootForPlatform();
}
