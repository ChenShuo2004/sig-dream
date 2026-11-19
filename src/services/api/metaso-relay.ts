import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
import { noteApiUsage } from "@/services/api/api-call-log";

/** Metaso (秘塔) MiniMax v2 video API — https://metaso.cn/minimax-h3 */

function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

async function readPayload(response: Response) {
    const raw = await response.text();
    if (!raw.trim()) return {} as Record<string, unknown>;
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error(raw.trim().slice(0, 180) || "秘塔请求失败");
    }
}

function detailOf(payload: Record<string, unknown>) {
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) return payload.errorMessage.trim();
    if (typeof payload.msg === "string" && payload.msg.trim() && payload.msg !== "success") return payload.msg.trim();
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    const err = payload.error;
    if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
        return String((err as { message: string }).message).trim();
    }
    if (typeof err === "string" && err.trim()) return err.trim();
    const base = payload.base_resp && typeof payload.base_resp === "object" ? (payload.base_resp as Record<string, unknown>) : null;
    if (base && typeof base.status_msg === "string" && base.status_msg.trim()) return base.status_msg.trim();
    return "";
}

async function metasoFetch(path: string, init: RequestInit = {}) {
    const headers = applyLocalRelayHeaders(new Headers(init.headers), "metaso");
    const response = await fetch(`/api-proxy/canvas-api/metaso${path}`, { ...init, headers });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "秘塔请求失败");
    noteApiUsage(payload);
    return payload;
}

/** Publish a reference so Metaso servers can fetch it (public canvas-api media path). */
export async function publishMetasoMedia(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api-proxy/canvas-api/metaso/media", {
        method: "POST",
        headers: applyLocalRelayHeaders(new Headers(), "metaso"),
        body,
        signal,
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "参考文件上传失败");
    const path = String(payload.path || "").trim();
    if (!path.startsWith("/canvas-api/")) throw new Error("参考文件路径无效");
    // /api-proxy so Next rewrites to FastAPI. Bare /canvas-api/ is not a public route.
    return new URL(`/api-proxy${path}`, window.location.origin).href;
}

export async function createMetasoVideo(body: Record<string, unknown>, signal?: AbortSignal) {
    return metasoFetch("/video_generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
}

export async function queryMetasoVideo(taskId: string, signal?: AbortSignal) {
    return metasoFetch(`/query/video_generation/${encodeURIComponent(taskId)}`, { method: "GET", signal });
}

export function metasoTaskId(payload: Record<string, unknown>) {
    const nested = payload.task && typeof payload.task === "object" ? (payload.task as Record<string, unknown>) : null;
    return String(payload.task_id || payload.taskId || nested?.id || payload.id || "").trim();
}

export function metasoTaskStatus(payload: Record<string, unknown>) {
    const task = payload.task && typeof payload.task === "object" ? (payload.task as Record<string, unknown>) : null;
    // Some Metaso/list responses wrap tasks in items[].
    if (!task && Array.isArray(payload.items)) {
        const first = payload.items.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
        if (first) {
            return {
                status: String(first.status || first.task_status || "").toLowerCase(),
                message: String((first.error as { message?: string } | undefined)?.message || first.error || first.errorMessage || "").trim(),
                url: metasoResultUrl(first),
            };
        }
    }
    const errObj = task?.error && typeof task.error === "object" ? (task.error as Record<string, unknown>) : null;
    return {
        status: String(task?.status || payload.status || payload.task_status || "").toLowerCase(),
        message: String(errObj?.message || task?.error || payload.errorMessage || detailOf(payload) || "").trim(),
        url: metasoResultUrl(task || payload),
    };
}

export function metasoResultUrl(payload: Record<string, unknown>) {
    const content = payload.content && typeof payload.content === "object" ? (payload.content as Record<string, unknown>) : null;
    const candidates = [content?.url, payload.file_url, payload.video_url, payload.url, payload.download_url];
    for (const value of candidates) {
        if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    }
    return "";
}
