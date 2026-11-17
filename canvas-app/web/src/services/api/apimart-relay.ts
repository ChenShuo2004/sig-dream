import axios from "axios";

import { apimartCapabilityFromCategory } from "@/lib/relay-stations";
import { buildApiUrl, withLocalProxy, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ApimartCatalogModel = { id: string; capability: ModelCapability; label: string; category?: string };

const apimartCapabilityById = new Map<string, ModelCapability>();
const apimartLabelById = new Map<string, string>();

export function rememberApimartCapabilities(models: ApimartCatalogModel[]) {
    models.forEach((model) => {
        apimartCapabilityById.set(model.id, model.capability);
        if (model.label) apimartLabelById.set(model.id, model.label);
    });
}

export function apimartCapabilityOf(name: string): ModelCapability | undefined {
    return apimartCapabilityById.get(name);
}

export function apimartLabelOf(name: string): string {
    return apimartLabelById.get(name) || "";
}

type ApimartTaskSubmit = {
    code?: number;
    success?: boolean;
    data?: Array<{ status?: string; task_id?: string }> | { id?: string; status?: string; task_id?: string; result?: unknown };
    error?: { message?: string; code?: number | string };
    message?: string;
};

type ApimartTaskQuery = {
    code?: number;
    success?: boolean;
    data?: {
        id?: string;
        status?: string;
        progress?: number;
        error?: { message?: string } | string;
        result?: {
            images?: Array<{ url?: string | string[] }>;
            videos?: Array<{ url?: string | string[] }>;
            video_url?: string;
            url?: string;
        };
    };
    error?: { message?: string };
};

function headers(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function apiUrl(baseUrl: string, path: string) {
    return buildApiUrl(baseUrl, path);
}

function readError(payload: { error?: { message?: string } | string; message?: string }, fallback: string) {
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    if (payload.error && typeof payload.error === "object" && typeof payload.error.message === "string" && payload.error.message.trim()) {
        return payload.error.message.trim();
    }
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    return fallback;
}

function extractTaskId(payload: ApimartTaskSubmit) {
    const data = payload.data;
    if (Array.isArray(data)) {
        const first = data[0];
        const id = typeof first?.task_id === "string" ? first.task_id.trim() : "";
        if (id) return id;
    } else if (data && typeof data === "object") {
        const id = (typeof data.task_id === "string" && data.task_id.trim()) || (typeof data.id === "string" && data.id.trim()) || "";
        if (id) return id;
    }
    throw new Error(readError(payload, "APIMart 未返回 task_id"));
}

function firstUrl(value: unknown): string {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstUrl(item);
            if (found) return found;
        }
    }
    return "";
}

export async function createApimartImageTask(config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">, body: Record<string, unknown>, signal?: AbortSignal) {
    const response = await axios.post<ApimartTaskSubmit>(apiUrl(config.baseUrl, "/images/generations"), { ...body, model: config.model }, { headers: headers(config.apiKey), signal, timeout: 120_000 });
    if (response.data.error) throw new Error(readError(response.data, "APIMart 图片任务提交失败"));
    return extractTaskId(response.data);
}

export async function createApimartVideoTask(config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">, body: Record<string, unknown>, signal?: AbortSignal) {
    const response = await axios.post<ApimartTaskSubmit>(apiUrl(config.baseUrl, "/videos/generations"), { ...body, model: config.model }, { headers: headers(config.apiKey), signal, timeout: 120_000 });
    if (response.data.error) throw new Error(readError(response.data, "APIMart 视频任务提交失败"));
    return extractTaskId(response.data);
}

export async function pollApimartTask(config: Pick<AiConfig, "baseUrl" | "apiKey">, taskId: string, signal?: AbortSignal) {
    const response = await axios.get<ApimartTaskQuery>(apiUrl(config.baseUrl, `/tasks/${encodeURIComponent(taskId)}`), { headers: headers(config.apiKey), signal, timeout: 60_000 });
    const payload = response.data;
    if (payload.error) throw new Error(readError(payload, "APIMart 任务查询失败"));
    const row = payload.data || {};
    const status = String(row.status || "").toLowerCase();
    if (status === "failed" || status === "error") {
        const err = row.error;
        const message = typeof err === "string" ? err : err && typeof err === "object" ? String(err.message || "") : "";
        throw new Error(message.trim() || "APIMart 任务失败");
    }
    if (status !== "completed" && status !== "succeeded" && status !== "success") {
        return { status: "pending" as const };
    }
    const result = row.result || {};
    const imageUrl = firstUrl(result.images?.[0]?.url) || firstUrl(result.url);
    const videoUrl = firstUrl(result.videos?.[0]?.url) || firstUrl(result.video_url) || firstUrl(result.url);
    return { status: "completed" as const, imageUrl, videoUrl };
}

export async function downloadApimartUrl(url: string, signal?: AbortSignal) {
    const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal, timeout: 300_000 });
    return response.data;
}

export async function waitApimartImageUrls(config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">, body: Record<string, unknown>, signal?: AbortSignal) {
    const taskId = await createApimartImageTask(config, body, signal);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollApimartTask(config, taskId, signal);
        if (state.status === "completed") {
            if (!state.imageUrl) throw new Error("APIMart 任务完成但没有图片地址");
            return [state.imageUrl];
        }
        await delay(2500, signal);
    }
    throw new Error("APIMart 图片生成超时");
}

export async function waitApimartVideoBlob(config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">, body: Record<string, unknown>, signal?: AbortSignal) {
    const taskId = await createApimartVideoTask(config, body, signal);
    for (let attempt = 0; attempt < 240; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollApimartTask(config, taskId, signal);
        if (state.status === "completed") {
            if (!state.videoUrl) throw new Error("APIMart 任务完成但没有视频地址");
            const blob = await downloadApimartUrl(state.videoUrl, signal);
            return { blob, url: state.videoUrl, mimeType: blob.type || "video/mp4" };
        }
        await delay(5000, signal);
    }
    throw new Error("APIMart 视频生成超时");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
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

/** Full APIMart catalog with category → capability (chat→text). */
export async function fetchApimartCatalog(apiKey: string, baseUrl = "https://api.apimart.ai", signal?: AbortSignal): Promise<ApimartCatalogModel[]> {
    const response = await axios.get(buildApiUrl(baseUrl, "/models"), {
        params: { expand: "category" },
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
        timeout: 60_000,
    });
    const payload = response.data;
    const lists: unknown[] = [];
    if (payload && typeof payload === "object") {
        const record = payload as { data?: unknown; models?: unknown };
        lists.push(record.data, record.models);
        if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
            const nested = record.data as { data?: unknown; models?: unknown };
            lists.push(nested.data, nested.models);
        }
    }
    const rows = lists.find((item) => Array.isArray(item)) as Array<Record<string, unknown>> | undefined;
    if (!rows?.length) return [];
    const out: ApimartCatalogModel[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : typeof row.model === "string" ? row.model.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const category = typeof row.category === "string" ? row.category : undefined;
        const label = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
        out.push({ id, label, category, capability: apimartCapabilityFromCategory(category) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
