import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
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
    if (!raw.trim()) return {} as { detail?: unknown; data?: unknown; error?: unknown };
    try {
        return JSON.parse(raw) as { detail?: unknown; data?: unknown; error?: unknown };
    } catch {
        const text = raw.trim().slice(0, 180);
        if (text === "Internal Server Error") throw new Error("上传参考文件超时，请稍后重试");
        throw new Error(text || "OnionCreate 请求失败");
    }
}

function detailOf(payload: { detail?: unknown; error?: unknown }) {
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    return "";
}

async function onionFetch(path: string, init: RequestInit = {}) {
    const headers = applyLocalRelayHeaders(new Headers(init.headers), "onion");
    const response = await fetch(`/api-proxy/canvas-api/onion${path}`, { ...init, headers });
    if (path.endsWith("/content")) {
        if (!response.ok) {
            const payload = await readPayload(response);
            throw new Error(detailOf(payload) || "视频还没有准备好");
        }
        return response;
    }
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "OnionCreate 请求失败");
    noteApiUsage(payload);
    return payload;
}

export type OnionModelProfile = {
    id: string;
    label: string;
    price?: number;
    billingMode?: "per_task" | "per_second";
    allowedDurations: number[];
    allowedRatios: string[];
    resolutions: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
};

function numberList(value: unknown) {
    return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [];
}

function textList(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function optionalPrice(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < 0) return undefined;
    return Math.round(number * 100) / 100;
}

function billingModeOf(value: unknown): OnionModelProfile["billingMode"] {
    return value === "per_second" || value === "per_task" ? value : undefined;
}

function optionalCount(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function fetchOnionModels(apiKey = ""): Promise<OnionModelProfile[]> {
    const payload = (await onionFetch("/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    })) as { data?: unknown };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : typeof row.model === "string" ? row.model.trim() : "";
            if (!id) return null;
            const rawLabel = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
            const label = rawLabel.replace(/\s+/g, " ");
            return {
                id,
                label,
                price: optionalPrice(row.price),
                billingMode: billingModeOf(row.billing_mode),
                allowedDurations: numberList(row.allowed_durations),
                allowedRatios: textList(row.allowed_ratios),
                resolutions: textList(row.resolutions),
                maxImages: optionalCount(row.max_images),
                maxVideos: optionalCount(row.max_videos),
                maxAudios: optionalCount(row.max_audios),
            };
        })
        .filter((item): item is OnionModelProfile => Boolean(item));
}

export async function fetchOnionModelNames(apiKey = "") {
    return (await fetchOnionModels(apiKey)).map((model) => model.id);
}

export function onionFailureText(message: string) {
    if (message.includes("MEDIA_PARAMETER_ENUM_MISMATCH")) return "生成失败：当前分辨率或画面参数不在这个模型允许的范围内。请按模型列出的分辨率重新生成。积分已退回。";
    return message.replace(/\s*\(request_id:[^)]*\)/g, "").trim();
}

export async function uploadOnionAsset(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file);
    const payload = (await onionFetch("/assets", { method: "POST", body, signal })) as { data?: { id?: unknown }; id?: unknown };
    const id = typeof payload.data?.id === "string" ? payload.data.id : typeof payload.id === "string" ? payload.id : "";
    if (!id) throw new Error("参考素材上传后没有拿到编号");
    return id;
}

export async function createOnionVideo(body: Record<string, unknown>, signal?: AbortSignal) {
    return (await onionFetch("/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    })) as { data?: { id?: unknown; logical_task_id?: unknown }; id?: unknown; logical_task_id?: unknown };
}

export type OnionTaskRow = {
    id?: string;
    logical_task_id?: string;
    status?: string;
    error_message?: string;
    has_video?: boolean;
};

export async function listOnionTasks(signal?: AbortSignal) {
    const payload = (await onionFetch("/tasks", { signal })) as { data?: unknown };
    return Array.isArray(payload.data) ? (payload.data as OnionTaskRow[]) : [];
}

export async function downloadOnionVideo(taskId: string, signal?: AbortSignal) {
    const response = (await onionFetch(`/videos/${encodeURIComponent(taskId)}/content`, { signal })) as Response;
    return response.blob();
}
