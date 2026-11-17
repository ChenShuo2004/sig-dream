function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

async function detailOf(response: Response) {
    try {
        const payload = (await response.json()) as { detail?: unknown };
        if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    } catch {
        return "";
    }
    return "";
}

const DOWNLOAD_ATTEMPTS = 4;
const RANGE_BYTES = 8 * 1024 * 1024;

function isAbort(error: unknown, signal?: AbortSignal) {
    return Boolean(signal?.aborted || (error instanceof DOMException && error.name === "AbortError"));
}

function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
        }
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function readWholeFile(path: string, token: string, signal?: AbortSignal) {
    const response = await fetch(path, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal,
    });
    if (!response.ok) throw new Error((await detailOf(response)) || "成品无法下载");
    const blob = await response.blob();
    if (blob.size < 32) throw new Error("成品为空");
    return blob;
}

function totalFromContentRange(header: string | null) {
    const match = header?.match(/\/(\d+)\s*$/);
    const total = match ? Number(match[1]) : 0;
    return Number.isFinite(total) ? total : 0;
}

async function readRange(path: string, token: string, start: number, end: number, signal?: AbortSignal) {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(path, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}`, Range: `bytes=${start}-${end}` },
                signal,
            });
            if (response.status !== 206 && response.status !== 200) throw new Error((await detailOf(response)) || "成品无法下载");
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!bytes.byteLength) throw new Error("成品无法下载");
            if (response.status === 200 && start === 0) return { bytes, total: bytes.byteLength, whole: true };
            return { bytes, total: totalFromContentRange(response.headers.get("content-range")), whole: false };
        } catch (error) {
            if (isAbort(error, signal)) throw error;
            last = error;
            if (attempt < 2) await wait(500 * (attempt + 1), signal);
        }
    }
    throw last instanceof Error ? last : new Error("成品无法下载");
}

/** Whole-file reads fail on some browsers; pull the same cached file in slices. */
async function readFileByRanges(path: string, token: string, signal?: AbortSignal) {
    const first = await readRange(path, token, 0, RANGE_BYTES - 1, signal);
    if (first.whole) return new Blob([first.bytes]);
    if (first.total < 32) throw new Error("成品无法下载");
    const parts: BlobPart[] = [first.bytes];
    let received = first.bytes.byteLength;
    while (received < first.total) {
        const end = Math.min(first.total - 1, received + RANGE_BYTES - 1);
        const next = await readRange(path, token, received, end, signal);
        parts.push(next.bytes);
        received += next.bytes.byteLength;
    }
    if (received < first.total) throw new Error("成片已经生成，但浏览器没有把视频下载下来");
    const blob = new Blob(parts);
    if (blob.size < 32) throw new Error("成品为空");
    return blob;
}

/** GET a same-origin cached file. Retries the full file, then downloads it in ranges. */
export async function downloadAuthorizedPath(path: string, token: string, signal?: AbortSignal) {
    let last: unknown;
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
            return await readWholeFile(path, token, signal);
        } catch (error) {
            if (isAbort(error, signal)) throw error;
            last = error;
            if (attempt < DOWNLOAD_ATTEMPTS - 1) await wait(800 * (attempt + 1), signal);
        }
    }
    try {
        return await readFileByRanges(path, token, signal);
    } catch (error) {
        if (isAbort(error, signal)) throw error;
        if (last instanceof Error && /登录|无效|为空/.test(last.message)) throw last;
        throw new Error("成片已经生成，但浏览器没有把视频下载下来");
    }
}

/** Bytes of a generated image or video. Cross-origin platform URLs are fetched by the server. */
export async function downloadGeneratedMedia(url: string, signal?: AbortSignal): Promise<Blob> {
    const target = url.trim();
    if (!target) throw new Error("成品地址为空");
    if (target.startsWith("blob:") || target.startsWith("data:") || target.startsWith("/")) return readBlob(target, signal);
    try {
        const parsed = new URL(target);
        if (parsed.origin === window.location.origin) return readBlob(target, signal);
    } catch {
        throw new Error("成品地址无效");
    }
    try {
        const response = await fetch(target, { signal });
        if (response.ok) {
            const blob = await response.blob();
            if (blob.size >= 32) return blob;
        }
    } catch (error) {
        if (signal?.aborted) throw error;
    }
    return downloadViaPlatform(target, signal);
}

async function readBlob(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("成品无法下载");
    const blob = await response.blob();
    if (blob.size < 32) throw new Error("成品为空");
    return blob;
}

async function downloadViaPlatform(url: string, signal?: AbortSignal) {
    const token = platformToken();
    if (!token) throw new Error("请先登录平台后再保存成品");
    let last: unknown;
    let path = "";
    for (let attempt = 0; attempt < 3 && !path; attempt += 1) {
        try {
            const cacheResponse = await fetch("/api-proxy/canvas-api/generated-media", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
                signal,
            });
            if (!cacheResponse.ok) throw new Error((await detailOf(cacheResponse)) || "成品无法下载");
            const payload = (await cacheResponse.json()) as { path?: unknown };
            const nextPath = typeof payload.path === "string" ? payload.path.trim() : "";
            if (!nextPath.startsWith("/canvas-api/generated-media/")) throw new Error("成品缓存路径无效");
            path = nextPath;
        } catch (error) {
            if (isAbort(error, signal)) throw error;
            last = error;
            if (error instanceof Error && /登录|路径无效/.test(error.message)) throw error;
            if (attempt < 2) await wait(1000 * (attempt + 1), signal);
        }
    }
    if (!path) throw last instanceof Error ? last : new Error("成品无法下载");
    return downloadAuthorizedPath(path, token, signal);
}
