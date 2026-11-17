import type { ModelChannel } from "@/stores/use-config-store";

/** Vite / local preview hosts — skip the login gate so UI work doesn't need a platform session. */
export function isLocalCanvasPreview() {
    if (typeof window === "undefined") return false;
    if (import.meta.env.DEV) return true;
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function platformRole() {
    try {
        const raw = window.localStorage.getItem("lcp_auth_session");
        if (raw) {
            const parsed = JSON.parse(raw) as { role?: unknown };
            if (typeof parsed.role === "string" && parsed.role) return parsed.role;
        }
    } catch {
        // fall through
    }
    // Local Vite preview: treat as super_admin so the shell renders without logging into the main site.
    if (isLocalCanvasPreview()) return "super_admin";
    return "";
}

export function canUseCanvas(role: string) {
    return role === "super_admin" || role === "material_admin";
}

function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

export async function readDetail(response: Response) {
    try {
        const payload = (await response.json()) as { detail?: unknown };
        if (typeof payload.detail === "string" && payload.detail) return payload.detail;
    } catch {
        return "";
    }
    return "";
}

export function readableError(detail: string, fallback: string) {
    if (detail === "Token expired" || detail === "Missing bearer token" || detail === "Invalid token signature") return "登录已过期，请重新登录";
    return detail || fallback;
}

function storePlatformToken(accessToken: string, role?: string) {
    const raw = localStorage.getItem("lcp_auth_session");
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed.access_token = accessToken;
    if (role) parsed.role = role;
    localStorage.setItem("lcp_auth_session", JSON.stringify(parsed));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `lcp_auth_token=${encodeURIComponent(accessToken)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`;
}

async function refreshPlatformToken(token: string) {
    const response = await fetch("/api-proxy/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { access_token?: string; role?: string };
    if (!payload.access_token) return "";
    storePlatformToken(payload.access_token, payload.role);
    return payload.access_token;
}

export async function authorizedFetch(url: string, init: RequestInit = {}) {
    const token = platformToken();
    if (!token) throw new Error("请先登录");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(url, { ...init, headers, cache: "no-store" });
    if (response.status !== 401) return response;
    const refreshed = await refreshPlatformToken(token);
    if (!refreshed) throw new Error(readableError(await readDetail(response), "登录已过期，请重新登录"));
    headers.set("Authorization", `Bearer ${refreshed}`);
    return fetch(url, { ...init, headers, cache: "no-store" });
}

export async function fetchCanvasChannels() {
    if (!platformToken()) return [] as ModelChannel[];
    const response = await authorizedFetch("/api-proxy/canvas-api/channels");
    if (!response.ok) throw new Error(readableError(await readDetail(response), "读取画布 API 失败"));
    const payload = (await response.json()) as { channels?: ModelChannel[] };
    return Array.isArray(payload.channels) ? payload.channels : [];
}

export async function saveCanvasChannels(channels: ModelChannel[]) {
    const response = await authorizedFetch("/api-proxy/canvas-api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
    });
    if (!response.ok) throw new Error(readableError(await readDetail(response), "保存画布 API 失败"));
}
