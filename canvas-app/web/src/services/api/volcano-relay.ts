import { noteApiUsage } from "@/services/api/api-call-log";

/** Volcano Ark Seedance video — https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks */

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
        throw new Error(raw.trim().slice(0, 180) || "火山引擎请求失败");
    }
}

function detailOf(payload: Record<string, unknown>) {
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) return payload.errorMessage.trim();
    if (typeof payload.msg === "string" && payload.msg.trim() && payload.msg !== "success") return payload.msg.trim();
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    const err = payload.error;
    if (err && typeof err === "object") {
        const obj = err as { message?: unknown; code?: unknown };
        if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
    }
    if (typeof err === "string" && err.trim()) return err.trim();
    return "";
}

async function volcanoFetch(path: string, init: RequestInit = {}) {
    const token = platformToken();
    if (!token) throw new Error("请先登录平台后再使用火山引擎");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`/api-proxy/canvas-api/volcano${path}`, { ...init, headers });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "火山引擎请求失败");
    noteApiUsage(payload);
    return payload;
}

const ARK_IMAGE_FORMATS: Record<string, string> = {
    jpg: "jpeg",
    jpeg: "jpeg",
    pjpeg: "jpeg",
    png: "png",
    webp: "webp",
    bmp: "bmp",
    tif: "tiff",
    tiff: "tiff",
    gif: "gif",
    heic: "heic",
    heif: "heif",
};

const ARK_AUDIO_FORMATS: Record<string, string> = {
    mpeg: "mp3",
    mp3: "mp3",
    wav: "wav",
    "x-wav": "wav",
    wave: "wav",
};

/** Official create-task field: data:image/<format>;base64,... (format lowercase). Ark does not need to fetch our site. */
export function arkImageDataUrl(dataUrl: string) {
    return arkDataUrl(dataUrl, "image", ARK_IMAGE_FORMATS, 30 * 1024 * 1024, "方舟单张参考图需小于 30MB", "方舟参考图只支持 jpeg、png、webp、bmp、tiff、gif、heic、heif");
}

/** Official create-task field: data:audio/<format>;base64,... */
export function arkAudioDataUrl(dataUrl: string) {
    return arkDataUrl(dataUrl, "audio", ARK_AUDIO_FORMATS, 15 * 1024 * 1024, "方舟单段参考音频需小于 15MB", "方舟参考音频只支持 mp3、wav");
}

function arkDataUrl(dataUrl: string, kind: "image" | "audio", formats: Record<string, string>, maxBytes: number, sizeError: string, formatError: string) {
    const match = String(dataUrl || "").match(/^data:(image|audio)\/([a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match || match[1].toLowerCase() !== kind) throw new Error(kind === "image" ? "参考图无法按方舟 Base64 格式编码" : "参考音频无法按方舟 Base64 格式编码");
    const format = formats[match[2].toLowerCase()];
    if (!format) throw new Error(formatError);
    const b64 = match[3].replace(/\s/g, "");
    const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    if (bytes > maxBytes) throw new Error(sizeError);
    return `data:${kind}/${format};base64,${b64}`;
}

/** Publish a reference video. Official video_url only accepts a public URL or asset://, not Base64. */
export async function publishVolcanoMedia(file: File, signal?: AbortSignal) {
    const token = platformToken();
    if (!token) throw new Error("请先登录平台后再使用火山引擎");
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api-proxy/canvas-api/volcano/media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal,
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "参考文件上传失败");
    const path = String(payload.path || "").trim();
    if (!path.startsWith("/canvas-api/")) throw new Error("参考文件路径无效");
    // Must be /api-proxy/... so Next rewrites to FastAPI. A bare /canvas-api/ URL 404s and Ark reports 未找到资源.
    return new URL(`/api-proxy${path}`, window.location.origin).href;
}

export async function createVolcanoVideo(body: Record<string, unknown>, signal?: AbortSignal) {
    return volcanoFetch("/video_generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
}

export async function queryVolcanoVideo(taskId: string, signal?: AbortSignal) {
    return volcanoFetch(`/query/video_generation/${encodeURIComponent(taskId)}`, { method: "GET", signal });
}

export function volcanoTaskId(payload: Record<string, unknown>) {
    const nested = payload.task && typeof payload.task === "object" ? (payload.task as Record<string, unknown>) : null;
    return String(payload.id || payload.task_id || payload.taskId || nested?.id || "").trim();
}

export function volcanoResultUrl(payload: Record<string, unknown>) {
    const content = payload.content && typeof payload.content === "object" ? (payload.content as Record<string, unknown>) : null;
    const candidates = [content?.video_url, content?.url, payload.video_url, payload.file_url, payload.url, payload.download_url];
    for (const value of candidates) {
        if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    }
    return "";
}

export function volcanoTaskStatus(payload: Record<string, unknown>) {
    const errObj = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : null;
    return {
        status: String(payload.status || payload.task_status || "").toLowerCase(),
        message: String(errObj?.message || payload.error || payload.errorMessage || detailOf(payload) || "").trim(),
        url: volcanoResultUrl(payload),
    };
}
