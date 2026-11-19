import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
import { inferVideoRatio, matchCatalogResolution } from "@/lib/media-size";
import { noteApiUsage } from "@/services/api/api-call-log";
import { downloadGeneratedMedia } from "@/services/api/generated-media";

/** CRUN task API — https://docs.crun.ai/zh */

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
        throw new Error(raw.trim().slice(0, 180) || "CRUN 请求失败");
    }
}

function detailOf(payload: Record<string, unknown>) {
    const errors = Array.isArray(payload.errors) ? payload.errors.map((item) => String(item)).filter(Boolean) : [];
    if (errors.length) return errors.join("；");
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.message === "string" && payload.message.trim() && payload.message !== "success") return payload.message.trim();
    return "";
}

async function crunFetch(path: string, init: RequestInit = {}) {
    const headers = applyLocalRelayHeaders(new Headers(init.headers), "crun");
    const response = await fetch(`/api-proxy/canvas-api/crun${path}`, { ...init, headers });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "CRUN 请求失败");
    noteApiUsage(payload);
    return payload;
}

export async function uploadCrunFile(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file, file.name || "upload.bin");
    const response = await fetch("/api-proxy/canvas-api/crun/uploads", {
        method: "POST",
        headers: applyLocalRelayHeaders(new Headers(), "crun"),
        body,
        signal,
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "参考文件上传失败");
    const url = String(payload.file_url || "").trim();
    if (!/^https:\/\//i.test(url)) throw new Error("CRUN 没有返回文件地址");
    return url;
}

export async function createCrunTask(body: { accessModel: string; model: string; input: Record<string, unknown> }, signal?: AbortSignal) {
    const payload = await crunFetch("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    const taskId = String(data.task_id || payload.task_id || "").trim();
    if (!taskId) throw new Error(detailOf(payload) || "CRUN 没有返回任务");
    return taskId;
}

export function crunTaskView(payload: Record<string, unknown>) {
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    const result = data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>) : null;
    const urls = Array.isArray(result?.media_urls) ? result.media_urls.map((item) => String(item || "").trim()).filter((item) => /^https?:\/\//i.test(item)) : [];
    const credits = Number(data.credits);
    return {
        status: String(data.status || "").toLowerCase(),
        message: String(result?.message || "").trim(),
        urls,
        credits: Number.isFinite(credits) && credits > 0 ? credits : 0,
    };
}

export async function queryCrunTask(taskId: string, signal?: AbortSignal) {
    return crunFetch(`/tasks/${encodeURIComponent(taskId)}`, { method: "GET", signal });
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = window.setTimeout(() => resolve(), ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

/** Poll until CRUN returns media URLs. Images finish faster than video, so the caller picks the budget. */
export async function waitCrunMedia(taskId: string, signal: AbortSignal | undefined, intervalMs: number, attempts: number) {
    let last = "";
    for (let index = 0; index < attempts; index += 1) {
        if (index) await sleep(intervalMs, signal);
        const view = crunTaskView(await queryCrunTask(taskId, signal));
        if (view.status === "success") {
            if (!view.urls.length) throw new Error("CRUN 任务完成但没有结果地址");
            return view;
        }
        if (view.status === "failed") throw new Error(view.message || "CRUN 生成失败");
        last = view.status || last;
    }
    throw new Error(last ? `CRUN 仍在生成（${last}）` : "CRUN 生成超时");
}

export async function crunMediaToDataUrl(url: string, signal?: AbortSignal) {
    const blob = await downloadGeneratedMedia(url, signal);
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("CRUN 图片无法读取"));
        reader.readAsDataURL(blob);
    });
}

export function crunImageAspect(size: string) {
    const ratio = inferVideoRatio(size || "");
    const allowed = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
    return allowed.has(ratio) ? ratio : "1:1";
}

export function crunImageResolution(model: string, quality: string, aspect: string) {
    const value = String(quality || "").trim().toLowerCase();
    let resolution = "1K";
    if (value === "high" || value === "hd" || value === "4k") resolution = "4K";
    else if (value === "medium" || value === "2k") resolution = "2K";
    const name = model.toLowerCase();
    if (name.includes("gpt-image") && aspect === "auto") resolution = "1K";
    if (name.includes("gpt-image") && resolution === "4K" && aspect === "1:1") resolution = "2K";
    return resolution;
}

function crunFamily(model: string) {
    const name = model.trim();
    if (name === "bytedance/seedance2-0" || name.startsWith("bytedance/seedance2-0-")) return "seedance";
    if (name === "minimax/h3" || name.startsWith("minimax/h3-")) return "h3";
    return "";
}

export function buildCrunVideoBody(args: {
    catalogModel: string;
    prompt: string;
    size: string;
    seconds: string;
    quality: string;
    resolutions: string[];
    audio: boolean;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    reference: boolean;
}) {
    const accessModel = args.catalogModel.trim();
    const family = crunFamily(accessModel);
    const images = args.imageUrls.filter(Boolean);
    const videos = args.videoUrls.filter(Boolean);
    const audios = args.audioUrls.filter(Boolean);
    const duration = Math.max(4, Math.min(15, Math.floor(Number(args.seconds) || 5)));
    const resolution = matchCatalogResolution(args.quality, args.resolutions);
    const ratio = inferVideoRatio(args.size || "16:9");
    const aspect = ratio === "auto" ? "16:9" : ratio;
    const useReference = args.reference || videos.length > 0 || audios.length > 0 || images.length > 2;

    if (family === "seedance") {
        const endpoint = accessModel.startsWith("bytedance/seedance2-0-")
            ? accessModel
            : useReference && (images.length || videos.length)
              ? "bytedance/seedance2-0-r2v"
              : images.length
                ? "bytedance/seedance2-0-i2v"
                : "bytedance/seedance2-0-t2v";
        const input: Record<string, unknown> = {
            prompt: args.prompt,
            resolution,
            aspect_ratio: aspect,
            duration,
            audio: args.audio,
        };
        if (endpoint.endsWith("-r2v")) {
            if (images.length) input.reference_images = images.slice(0, 9);
            if (videos.length) input.reference_videos = videos.slice(0, 3);
            if (audios.length) input.reference_audios = audios.slice(0, 3);
        } else if (endpoint.endsWith("-i2v")) {
            input.img_urls = images.slice(0, 2);
        }
        return { accessModel, model: endpoint, input };
    }

    if (family === "h3") {
        const endpoint = accessModel.startsWith("minimax/h3-")
            ? accessModel
            : useReference && (images.length || videos.length)
              ? "minimax/h3-r2v"
              : images.length
                ? "minimax/h3-i2v"
                : "minimax/h3-t2v";
        const input: Record<string, unknown> = {
            prompt: args.prompt,
            resolution,
            aspect_ratio: endpoint.endsWith("-i2v") ? "auto" : aspect,
            duration,
        };
        if (endpoint.endsWith("-r2v")) {
            if (images.length) input.reference_images = images.slice(0, 9);
            if (videos.length) input.reference_videos = videos.slice(0, 3);
            if (audios.length) input.reference_audios = audios.slice(0, 3);
        } else if (endpoint.endsWith("-i2v")) {
            input.img_urls = images.slice(0, 2);
        }
        return { accessModel, model: endpoint, input };
    }

    const input: Record<string, unknown> = {
        prompt: args.prompt,
        aspect_ratio: aspect,
        duration,
        resolution,
    };
    if (images.length) input.img_urls = images;
    return { accessModel, model: accessModel, input };
}
