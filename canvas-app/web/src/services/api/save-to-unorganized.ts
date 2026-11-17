import { downloadGeneratedMedia } from "@/services/api/generated-media";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const CHUNK_SIZE = 8 * 1024 * 1024;

function platformSession() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        if (!raw) return { token: "", username: "" };
        const parsed = JSON.parse(raw) as { access_token?: unknown; username?: unknown };
        return {
            token: typeof parsed.access_token === "string" ? parsed.access_token : "",
            username: typeof parsed.username === "string" ? parsed.username : "",
        };
    } catch {
        return { token: "", username: "" };
    }
}

function currentLibrary() {
    const raw = localStorage.getItem("lcp_asset_library");
    return raw === "personal_video" ? "personal_video" : "auto";
}

async function readDetail(response: Response) {
    try {
        const payload = (await response.json()) as { detail?: unknown };
        if (typeof payload.detail === "string" && payload.detail) return payload.detail;
    } catch {
        return "";
    }
    return "";
}

async function sha256Hex(blob: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mime: string, kind: "image" | "video" | "audio") {
    if (kind === "audio") {
        if (mime.includes("wav")) return "wav";
        if (mime.includes("ogg")) return "ogg";
        if (mime.includes("flac")) return "flac";
        if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
        return "mp3";
    }
    if (mime.includes("png")) return "png";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("quicktime")) return "mov";
    return kind === "video" ? "mp4" : "png";
}

function fileStem(node: CanvasNodeData) {
    const raw = (node.title || node.metadata?.prompt || "画布").replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim();
    return (raw || "画布").slice(0, 80);
}

function mediaKind(node: CanvasNodeData): "image" | "video" | "audio" {
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    return "image";
}

export async function saveBlobToUnorganized(file: File, meta: { title: string; description?: string | null }) {
    const { token, username } = platformSession();
    if (!token || !username) throw new Error("login");
    const library = currentLibrary();
    const sha256 = await sha256Hex(file);
    const headers = { Authorization: `Bearer ${token}`, "X-Asset-Library": library };
    const dedup = await fetch(`/api-proxy/uploads/dedup?sha256=${encodeURIComponent(sha256)}&library=${encodeURIComponent(library)}`, { headers, cache: "no-store" });
    if (!dedup.ok) throw new Error((await readDetail(dedup)) || "dedup");
    const existing = (await dedup.json()) as { exists?: boolean };
    if (existing.exists) throw new Error("duplicate");

    const init = await fetch("/api-proxy/uploads/init", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
            file_name: file.name,
            file_size: file.size,
            chunk_size: CHUNK_SIZE,
            sha256,
            library,
        }),
    });
    if (init.status === 409) throw new Error("duplicate");
    if (!init.ok) throw new Error((await readDetail(init)) || "init");
    const session = (await init.json()) as { upload_session_id?: string; uploaded_chunks?: number[] };
    if (!session.upload_session_id) throw new Error("init");
    const uploaded = new Set(session.uploaded_chunks || []);
    const total = Math.ceil(file.size / CHUNK_SIZE);
    for (let index = 0; index < total; index += 1) {
        if (uploaded.has(index)) continue;
        const body = new FormData();
        body.append("chunk_file", file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE)), file.name);
        const chunk = await fetch(`/api-proxy/uploads/${session.upload_session_id}/chunks/${index}`, { method: "POST", headers, body });
        if (!chunk.ok) throw new Error((await readDetail(chunk)) || "chunk");
    }
    const complete = await fetch(`/api-proxy/uploads/${session.upload_session_id}/complete`, { method: "POST", headers });
    if (!complete.ok) throw new Error((await readDetail(complete)) || "complete");
    const ingest = await fetch(`/api-proxy/uploads/${session.upload_session_id}/ingest`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
            title: meta.title,
            description: meta.description?.trim() || null,
            tag_ids: [],
        }),
    });
    if (ingest.status === 409) throw new Error("duplicate");
    if (!ingest.ok) throw new Error((await readDetail(ingest)) || "ingest");
}

/** Local bytes are already cached. Upload into the current library's unorganized inbox, which queues NAS storage. Duplicate files count as done. */
export async function archiveGeneratedBlob(blob: Blob, kind: "image" | "video", meta?: { title?: string; prompt?: string }) {
    if (!blob || blob.size < 32) return "成品为空，没有上传到 NAS";
    const prompt = meta?.prompt?.trim() || "";
    const title = (prompt || meta?.title || (kind === "video" ? "生成视频" : "生成图片")).replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || (kind === "video" ? "生成视频" : "生成图片");
    const mime = blob.type || (kind === "video" ? "video/mp4" : "image/png");
    const file = new File([blob], `${title}.${extensionFor(mime, kind)}`, { type: mime });
    try {
        await saveBlobToUnorganized(file, { title, description: prompt || null });
        return "";
    } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (reason === "duplicate") return "";
        if (reason === "login") return "成品已保存在本地，登录平台后才会上传到 NAS";
        if (reason && !["dedup", "init", "chunk", "complete", "ingest", "empty"].includes(reason)) return `成品已保存在本地，上传 NAS 失败：${reason}`;
        return "成品已保存在本地，上传 NAS 失败";
    }
}

async function nodeFile(node: CanvasNodeData) {
    const kind = mediaKind(node);
    const storageKey = node.metadata?.storageKey;
    let blob: Blob | null = null;
    if (storageKey) blob = kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob && node.metadata?.content) {
        if (kind === "audio") {
            const response = await fetch(node.metadata.content);
            if (response.ok) blob = await response.blob();
        } else {
            blob = await downloadGeneratedMedia(node.metadata.content);
        }
    }
    if (!blob || blob.size < 32) throw new Error("empty");
    const mime = blob.type || node.metadata?.mimeType || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png");
    const name = `${fileStem(node)}.${extensionFor(mime, kind)}`;
    return new File([blob], name, { type: mime });
}

export async function saveCanvasNodeToUnorganized(node: CanvasNodeData) {
    const file = await nodeFile(node);
    await saveBlobToUnorganized(file, { title: fileStem(node), description: node.metadata?.prompt?.trim() || null });
}
