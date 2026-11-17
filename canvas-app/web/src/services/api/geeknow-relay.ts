import { noteApiUsage } from "@/services/api/api-call-log";

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
    if (!raw.trim()) return {} as { detail?: unknown; data?: unknown; error?: unknown; id?: unknown; task_id?: unknown; task?: unknown };
    try {
        return JSON.parse(raw) as { detail?: unknown; data?: unknown; error?: unknown; id?: unknown; task_id?: unknown; task?: unknown; status?: unknown; video_url?: unknown; url?: unknown };
    } catch {
        throw new Error(raw.trim().slice(0, 180) || "Geeknow 请求失败");
    }
}

function detailOf(payload: { detail?: unknown; error?: unknown; message?: unknown }) {
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    if (payload.error && typeof payload.error === "object" && typeof (payload.error as { message?: unknown }).message === "string") {
        return (payload.error as { message: string }).message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    return "";
}

async function geeknowFetch(path: string, init: RequestInit = {}) {
    const token = platformToken();
    if (!token) throw new Error("请先登录平台后再使用 Geeknow");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`/api-proxy/canvas-api/geeknow${path}`, { ...init, headers });
    if (path.endsWith("/content")) {
        if (!response.ok) {
            const payload = await readPayload(response);
            throw new Error(detailOf(payload) || "视频还没有准备好");
        }
        return response;
    }
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "Geeknow 请求失败");
    noteApiUsage(payload);
    return payload;
}

export async function uploadGeeknowFile(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file);
    const payload = (await geeknowFetch("/uploads", { method: "POST", body, signal })) as { url?: unknown; data?: { url?: unknown } };
    const url = typeof payload.url === "string" ? payload.url : typeof payload.data?.url === "string" ? payload.data.url : "";
    if (!url.startsWith("https://")) throw new Error("参考文件上传后没有拿到公网地址");
    return url;
}

export async function createGeeknowVideo(body: Record<string, unknown>, signal?: AbortSignal) {
    return (await geeknowFetch("/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    })) as { id?: unknown; task_id?: unknown; data?: { id?: unknown; task_id?: unknown } };
}

export async function readGeeknowVideo(taskId: string, signal?: AbortSignal) {
    return (await geeknowFetch(`/videos/${encodeURIComponent(taskId)}`, { signal })) as Record<string, unknown>;
}

export async function downloadGeeknowVideo(taskId: string, signal?: AbortSignal) {
    const response = (await geeknowFetch(`/videos/${encodeURIComponent(taskId)}/content`, { signal })) as Response;
    return response.blob();
}

export function geeknowTaskStatus(payload: Record<string, unknown>) {
    const task = payload.task && typeof payload.task === "object" ? (payload.task as Record<string, unknown>) : payload;
    const status = String(task.status || payload.status || "").toLowerCase();
    const error = task.error && typeof task.error === "object" ? (task.error as { message?: unknown }).message : payload.error && typeof payload.error === "object" ? (payload.error as { message?: unknown }).message : "";
    const message = typeof error === "string" && error.trim() ? error.trim() : typeof task.error === "string" ? task.error : "";
    return { status, message };
}
