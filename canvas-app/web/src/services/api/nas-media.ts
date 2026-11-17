export type NasMediaKind = "image" | "video" | "audio";

export type NasMediaItem = {
    id: string;
    fileId: string;
    title: string;
    kind: NasMediaKind;
    extension: string;
    width?: number;
    height?: number;
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"]);
const MIME: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    webm: "video/webm",
    m4v: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wma: "audio/x-ms-wma",
};

type MaterialRow = {
    id?: string;
    title?: string;
    uploader?: string | null;
    primary_file_id?: string | null;
    primary_extension?: string | null;
    primary_media_width?: number | null;
    primary_media_height?: number | null;
};

type DownloadRoute = {
    ticket?: string;
    lan_download_base_url?: string | null;
    lan_download_base_urls?: string[];
    public_download_base_url?: string | null;
};

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

export function currentNasLibrary() {
    const raw = localStorage.getItem("lcp_asset_library");
    return raw === "personal_video" ? "personal_video" : "auto";
}

function authHeaders() {
    const { token } = platformSession();
    if (!token) throw new Error("login");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "X-Asset-Library": currentNasLibrary() };
    if (typeof window !== "undefined" && window.location.protocol === "https:") headers["X-Access-Context"] = "public";
    return headers;
}

function mediaKind(extension: string): NasMediaKind | null {
    if (IMAGE_EXT.has(extension)) return "image";
    if (VIDEO_EXT.has(extension)) return "video";
    if (AUDIO_EXT.has(extension)) return "audio";
    return null;
}

function absoluteUrl(url: string) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${window.location.origin}/api-proxy${path}`;
}

function uniqueBases(values: Array<string | null | undefined>) {
    const bases: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const base = (value || "").trim().replace(/\/$/, "");
        if (!base || seen.has(base)) continue;
        seen.add(base);
        bases.push(base);
    }
    return bases;
}

/** Current library, current user's image, video, and audio. Documents and other people's files are left out. */
export async function listMyNasMedia(keyword: string) {
    const { username } = platformSession();
    if (!username) throw new Error("login");
    const headers = authHeaders();
    const items: NasMediaItem[] = [];
    let page = 1;
    let total = 0;
    let truncated = false;
    while (page <= 20) {
        const params = new URLSearchParams({ quick_view: "my_upload", page: String(page), page_size: "100", sort_by: "created_at", sort_order: "desc" });
        if (keyword.trim()) params.set("keyword", keyword.trim());
        const response = await fetch(`/api-proxy/materials?${params.toString()}`, { headers, cache: "no-store" });
        if (response.status === 401) throw new Error("login");
        if (!response.ok) throw new Error("list");
        const data = (await response.json()) as { items?: MaterialRow[]; total?: number };
        total = Number(data.total) || 0;
        for (const row of data.items || []) {
            if (!row.id || !row.primary_file_id) continue;
            if (username && row.uploader !== username) continue;
            const extension = String(row.primary_extension || "").replace(/^\./, "").toLowerCase();
            const kind = mediaKind(extension);
            if (!kind) continue;
            items.push({
                id: row.id,
                fileId: row.primary_file_id,
                title: row.title?.trim() || extension,
                kind,
                extension,
                width: row.primary_media_width || undefined,
                height: row.primary_media_height || undefined,
            });
        }
        if (page * 100 >= total) break;
        if (page === 20) {
            truncated = true;
            break;
        }
        page += 1;
    }
    return { items, truncated };
}

async function probe(base: string) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 800);
    try {
        const response = await fetch(`${base.replace(/\/$/, "")}/health`, { method: "GET", mode: "cors", signal: controller.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timer);
    }
}

async function ecsCacheUrl(item: NasMediaItem) {
    const headers = authHeaders();
    const prepared = await fetch(`/api-proxy/materials/${item.id}/files/${item.fileId}/download-prepare`, { method: "POST", headers });
    const body = (await prepared.json()) as { job_id?: string; detail?: unknown };
    if (!prepared.ok || !body.job_id) throw new Error("prepare");
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
        const status = await fetch(`/api-proxy/materials/download-prepare/${body.job_id}`, { headers, cache: "no-store" });
        const payload = (await status.json()) as { status?: string; download_url?: string | null; error_message?: string | null };
        if (!status.ok) throw new Error("prepare");
        if (payload.status === "failed" || payload.status === "error") throw new Error(payload.error_message || "prepare");
        if (payload.status === "success" && payload.download_url) return absoluteUrl(payload.download_url);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new Error("prepare");
}

async function downloadFromFileMachine(base: string, ticket: string, extension: string) {
    if (!(await probe(base))) return null;
    try {
        const file = await fetch(`${base}/download?ticket=${encodeURIComponent(ticket)}`, { mode: "cors" });
        if (!file.ok) return null;
        const blob = await file.blob();
        if (blob.size < 32) return null;
        return typedBlob(blob, extension);
    } catch {
        return null;
    }
}

/** Original bytes. LAN file machines first, then the public file machine, then the platform cache. */
export async function fetchNasMediaBlob(item: NasMediaItem) {
    const headers = authHeaders();
    const routeResponse = await fetch(`/api-proxy/materials/${item.id}/files/${item.fileId}/download-route`, { method: "POST", headers });
    if (routeResponse.ok) {
        const route = (await routeResponse.json()) as DownloadRoute;
        if (route.ticket) {
            const lanBases = uniqueBases([...(route.lan_download_base_urls || []), route.lan_download_base_url]);
            for (const base of lanBases) {
                const blob = await downloadFromFileMachine(base, route.ticket, item.extension);
                if (blob) return blob;
            }
            const wanBases = uniqueBases([route.public_download_base_url]).filter((base) => !lanBases.includes(base));
            for (const base of wanBases) {
                const blob = await downloadFromFileMachine(base, route.ticket, item.extension);
                if (blob) return blob;
            }
        }
    }
    const cached = await ecsCacheUrl(item);
    const file = await fetch(cached);
    if (!file.ok) throw new Error("download");
    const blob = await file.blob();
    if (blob.size < 32) throw new Error("download");
    return typedBlob(blob, item.extension);
}

function typedBlob(blob: Blob, extension: string) {
    const mime = blob.type || MIME[extension] || "application/octet-stream";
    return blob.type === mime ? blob : new Blob([blob], { type: mime });
}
