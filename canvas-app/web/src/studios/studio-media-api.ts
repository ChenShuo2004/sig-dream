import { authorizedFetch, readDetail, readableError } from "@/services/api/canvas-channels";

const BASE = "/api-proxy/studio-media";

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (kind === "video") return "video.mp4";
    return "audio.wav";
}

export async function uploadStudioMedia(mediaKey: string, blob: Blob, kind: "image" | "video" | "audio") {
    const body = new FormData();
    body.set("media_key", mediaKey);
    body.set("kind", kind);
    body.set("file", blob, filenameFor(kind, blob));
    const response = await authorizedFetch(`${BASE}/file`, { method: "POST", body });
    if (!response.ok) {
        throw new Error(readableError(await readDetail(response), "上传工作室媒体失败"));
    }
    return (await response.json()) as { mediaKey?: string; status?: string };
}

export async function studioMediaExists(mediaKey: string) {
    const response = await authorizedFetch(`${BASE}/${encodeURIComponent(mediaKey)}`);
    if (response.status === 404) return false;
    if (!response.ok) return false;
    const meta = (await response.json().catch(() => ({}))) as { status?: string };
    return meta.status !== "failed";
}

/** Fetch blob from ECS staging or NAS prepare_download cache; polls on 202. */
export async function fetchStudioMediaBlob(mediaKey: string, opts?: { signal?: AbortSignal; maxWaitMs?: number }) {
    const maxWaitMs = opts?.maxWaitMs ?? 90_000;
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
        if (opts?.signal?.aborted) return null;
        const response = await authorizedFetch(`${BASE}/${encodeURIComponent(mediaKey)}/file`);
        if (response.status === 404) return null;
        if (response.status === 202) {
            await sleep(1500);
            continue;
        }
        if (!response.ok) {
            // Not ready yet or transient error — keep polling briefly
            if (response.status >= 500 || response.status === 502) {
                await sleep(2000);
                continue;
            }
            return null;
        }
        const blob = await response.blob();
        if (!blob || blob.size <= 0) return null;
        return blob;
    }
    return null;
}
