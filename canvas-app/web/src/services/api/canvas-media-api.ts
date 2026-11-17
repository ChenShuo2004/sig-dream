import { authorizedFetch } from "@/services/api/canvas-channels";

const BASE = "/api-proxy/canvas-workspace/media";
const KEY_RE = /^(image|video|audio|file):[A-Za-z0-9_-]{6,80}$/;
const known = new Set<string>();

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canvasMediaKind(key: string, blob?: Blob): "image" | "video" | "audio" {
    if (key.startsWith("image:")) return "image";
    if (key.startsWith("audio:")) return "audio";
    if (key.startsWith("video:")) return "video";
    const mime = blob?.type || "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    return "video";
}

function filenameFor(kind: "image" | "video" | "audio", blob: Blob) {
    const mime = (blob.type || "").toLowerCase();
    if (mime.includes("png")) return `${kind}.png`;
    if (mime.includes("jpeg") || mime.includes("jpg")) return `${kind}.jpg`;
    if (mime.includes("webp")) return `${kind}.webp`;
    if (mime.includes("gif")) return `${kind}.gif`;
    if (mime.includes("webm")) return `${kind}.webm`;
    if (mime.includes("mp4")) return `${kind}.mp4`;
    if (mime.includes("wav")) return `${kind}.wav`;
    if (mime.includes("mpeg") || mime.includes("mp3")) return `${kind}.mp3`;
    if (kind === "image") return "image.png";
    if (kind === "audio") return "audio.wav";
    return "video.mp4";
}

export function collectCanvasMediaKeys(value: unknown, out = new Set<string>(), depth = 0) {
    if (depth > 14 || value == null) return out;
    if (typeof value === "string") {
        if (KEY_RE.test(value)) out.add(value);
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectCanvasMediaKeys(item, out, depth + 1));
        return out;
    }
    if (typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach((item) => collectCanvasMediaKeys(item, out, depth + 1));
    }
    return out;
}

export async function uploadCanvasMedia(mediaKey: string, blob: Blob, kind: "image" | "video" | "audio" = canvasMediaKind(mediaKey, blob)) {
    const body = new FormData();
    body.set("media_key", mediaKey);
    body.set("kind", kind);
    body.set("file", blob, filenameFor(kind, blob));
    const response = await authorizedFetch(`${BASE}/file`, { method: "POST", body });
    if (!response.ok) throw new Error("upload");
    known.add(mediaKey);
}

export async function canvasMediaExists(mediaKey: string) {
    if (known.has(mediaKey)) return true;
    try {
        const response = await authorizedFetch(`${BASE}/${encodeURIComponent(mediaKey)}`);
        if (!response.ok) return false;
        known.add(mediaKey);
        return true;
    } catch {
        return false;
    }
}

/** Local bytes are already cached. Mirror them to the feature NAS area. Duplicate uploads are skipped. */
export async function mirrorBlobToCanvasMedia(mediaKey: string, blob: Blob) {
    if (!mediaKey || !blob || blob.size < 32) return "成品为空，没有上传到 NAS";
    try {
        if (await canvasMediaExists(mediaKey)) return "";
        await uploadCanvasMedia(mediaKey, blob);
        return "";
    } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (reason.includes("登录")) return "成品已保存在本地，登录平台后才会上传到 NAS";
        return "成品已保存在本地，上传 NAS 失败";
    }
}

export async function pinCanvasMedia(mediaKey: string) {
    const response = await authorizedFetch(`${BASE}/${encodeURIComponent(mediaKey)}/pin`, { method: "POST" });
    if (!response.ok) throw new Error("pin");
    known.add(mediaKey);
}

export async function fetchCanvasMediaBlob(mediaKey: string, opts?: { maxWaitMs?: number }) {
    if (!KEY_RE.test(mediaKey)) return null;
    const maxWaitMs = opts?.maxWaitMs ?? 45_000;
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
        let response: Response;
        try {
            response = await authorizedFetch(`${BASE}/${encodeURIComponent(mediaKey)}/file`);
        } catch {
            return null;
        }
        if (response.status === 404) return null;
        if (response.status === 202) {
            await sleep(1500);
            continue;
        }
        if (!response.ok) {
            if (response.status >= 500) {
                await sleep(2000);
                continue;
            }
            return null;
        }
        const blob = await response.blob();
        if (!blob || blob.size < 32) return null;
        known.add(mediaKey);
        return blob;
    }
    return null;
}
