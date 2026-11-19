import axios from "axios";

import { isAi007BaseUrl, isApimartBaseUrl, isCrunBaseUrl, isGeeknowBaseUrl, isMetasoBaseUrl, isOnionBaseUrl, isRunningHubBaseUrl, isVolcengineBaseUrl } from "@/lib/relay-stations";
import { authorizedFetch } from "@/services/api/canvas-channels";

export type ApiCallCapability = "image" | "video" | "text" | "audio";
export type ApiCallStatus = "success" | "failed" | "cancelled";

export type TokenUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};

export type ApiCallUsage = TokenUsage & { credits?: number };

export type ApiCallReport = {
    source?: string;
    capability: ApiCallCapability;
    action: string;
    provider: string;
    model: string;
    endpoint?: string;
    status: ApiCallStatus;
    durationMs?: number;
    taskId?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    credits?: number;
    parameters?: Record<string, unknown>;
    errorMessage?: string;
};

type OpenTrack = { usage: TokenUsage | null };
const openTracks: OpenTrack[] = [];
const recentUsage: { at: number; usage: TokenUsage }[] = [];
const taskStartedAt = new Map<string, number>();

let usageCaptureReady = false;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function positiveInt(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function extractUsage(payload: unknown): TokenUsage | null {
    const root = asRecord(payload);
    if (!root) return null;
    const usage = asRecord(root.usage) || asRecord(root.usageMetadata) || asRecord(root.usage_metadata);
    if (!usage) return null;
    const promptTokens = positiveInt(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount);
    const completionTokens = positiveInt(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount);
    const totalTokens = positiveInt(usage.total_tokens ?? usage.totalTokenCount) || promptTokens + completionTokens;
    if (!promptTokens && !completionTokens && !totalTokens) return null;
    return { promptTokens, completionTokens, totalTokens: totalTokens || promptTokens + completionTokens };
}

function coinsOf(usage: unknown) {
    const record = asRecord(usage);
    if (!record) return 0;
    const coins = Number(record.consumeCoins ?? record.consume_coins);
    return Number.isFinite(coins) && coins > 0 ? coins : 0;
}

/** RunningHub query usage.consumeCoins. Prefer taskUsageList so the parent row is not added twice. */
export function extractRunningHubCredits(payload: unknown) {
    const root = asRecord(payload);
    if (!root) return 0;
    const data = asRecord(root.data) || root;
    const list = Array.isArray(data.taskUsageList) ? data.taskUsageList : [];
    if (list.length) {
        const sum = list.reduce((total, item) => total + coinsOf(asRecord(item)?.usage), 0);
        if (sum > 0) return Math.round(sum);
    }
    return Math.round(coinsOf(data.usage) || coinsOf(root.usage));
}

export function noteApiUsage(payload: unknown) {
    const usage = extractUsage(payload);
    if (!usage) return;
    recentUsage.push({ at: Date.now(), usage });
    if (recentUsage.length > 30) recentUsage.shift();
    const open = openTracks.filter((track) => track.usage == null);
    if (openTracks.length === 1) openTracks[0].usage = usage;
}

export function usageNotedSince(at: number): TokenUsage | null {
    for (let index = recentUsage.length - 1; index >= 0; index -= 1) {
        const item = recentUsage[index];
        if (item.at >= at) return item.usage;
    }
    return null;
}

function installUsageCapture() {
    if (usageCaptureReady) return;
    usageCaptureReady = true;
    axios.interceptors.response.use((response) => {
        noteApiUsage(response.data);
        return response;
    });
}

installUsageCapture();

export function providerOf(baseUrl: string, model = "") {
    if (isVolcengineBaseUrl(baseUrl)) return "volcengine";
    if (isCrunBaseUrl(baseUrl)) return "crun";
    if (isMetasoBaseUrl(baseUrl)) return "metaso";
    if (isRunningHubBaseUrl(baseUrl)) return "runninghub";
    if (isAi007BaseUrl(baseUrl)) return "ai007";
    if (isOnionBaseUrl(baseUrl)) return "onion";
    if (isGeeknowBaseUrl(baseUrl)) return "geeknow";
    if (isApimartBaseUrl(baseUrl)) return "apimart";
    if (/comfy|lan/i.test(model)) return "lan";
    if (/gemini/i.test(baseUrl) || /gemini/i.test(model)) return "gemini";
    return "openai";
}

export function callSource() {
    const path = `${window.location.hash || window.location.pathname}`.replace(/^#/, "");
    if (path.startsWith("/studio/script")) return "剧本工作室";
    if (path.startsWith("/studio/replacement")) return "替换工作室";
    if (path.startsWith("/studio/replication")) return "复刻工作室";
    if (path.startsWith("/canvas")) return "无限画布";
    if (path.startsWith("/image")) return "生图台";
    if (path.startsWith("/video")) return "视频创作台";
    if (path.startsWith("/voice")) return "声音工作室";
    if (path.startsWith("/song")) return "AI歌曲";
    return "其他";
}

export function clipText(value: unknown, limit = 500) {
    const text = typeof value === "string" ? value : "";
    return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

const sensitiveKey = /api[-_]?key|secret|password|authorization|bearer|data[-_]?url|base64|b64/i;

function cleanParameters(value: unknown, depth = 0): unknown {
    if (depth > 4 || value == null) return value ?? null;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value.startsWith("data:") ? "[省略文件]" : value.slice(0, 500);
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanParameters(item, depth + 1));
    if (typeof value === "object") {
        const next: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
            if (sensitiveKey.test(key)) continue;
            next[key] = cleanParameters(item, depth + 1);
        }
        return next;
    }
    return null;
}

export function rememberTaskStart(provider: string, taskId: string) {
    if (!taskId) return;
    taskStartedAt.set(`${provider}\0${taskId}`, Date.now());
}

export function takeTaskDuration(provider: string, taskId: string) {
    const key = `${provider}\0${taskId}`;
    const started = taskStartedAt.get(key);
    taskStartedAt.delete(key);
    return started ? Date.now() - started : 0;
}

export function reportApiCall(report: ApiCallReport) {
    const parameters = cleanParameters(report.parameters) as Record<string, unknown>;
    const body = {
        source: report.source || callSource(),
        capability: report.capability,
        action: report.action,
        provider: report.provider,
        model: report.model,
        endpoint: report.endpoint || "",
        status: report.status,
        duration_ms: Math.max(0, Math.round(report.durationMs || 0)),
        task_id: report.taskId || "",
        prompt_tokens: report.promptTokens || 0,
        completion_tokens: report.completionTokens || 0,
        total_tokens: report.totalTokens || (report.promptTokens || 0) + (report.completionTokens || 0),
        credits: report.credits || 0,
        parameters,
        error_message: clipText(report.errorMessage, 500),
    };
    void authorizedFetch("/api-proxy/canvas-api/call-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
    }).catch(() => undefined);
}

function errorText(error: unknown) {
    if (error instanceof Error) return error.message || error.name;
    return "请求失败";
}

function isCancelled(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}

export async function trackApiCall<T>(report: Omit<ApiCallReport, "status" | "durationMs" | "errorMessage">, run: () => Promise<T>, enrich?: (result: T) => Partial<ApiCallReport>): Promise<T> {
    const track: OpenTrack = { usage: null };
    openTracks.push(track);
    const started = performance.now();
    try {
        const result = await run();
        const extra = enrich?.(result) || {};
        const usage = extra.promptTokens || extra.totalTokens ? null : track.usage;
        reportApiCall({
            ...report,
            ...extra,
            status: "success",
            durationMs: performance.now() - started,
            promptTokens: extra.promptTokens ?? usage?.promptTokens,
            completionTokens: extra.completionTokens ?? usage?.completionTokens,
            totalTokens: extra.totalTokens ?? usage?.totalTokens,
        });
        return result;
    } catch (error) {
        reportApiCall({
            ...report,
            status: isCancelled(error) ? "cancelled" : "failed",
            durationMs: performance.now() - started,
            errorMessage: errorText(error),
        });
        throw error;
    } finally {
        const index = openTracks.indexOf(track);
        if (index >= 0) openTracks.splice(index, 1);
    }
}

export type ApiCallLogItem = {
    id: string;
    username: string;
    source: string;
    capability: ApiCallCapability;
    action: string;
    provider: string;
    model: string;
    endpoint: string;
    status: ApiCallStatus;
    duration_ms: number;
    task_id: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    credits: number;
    prompt_excerpt: string;
    parameters: Record<string, unknown>;
    error_message: string;
    created_at: string;
};

export type ApiCallLogQuery = {
    username?: string;
    capability?: string;
    provider?: string;
    model?: string;
    action?: string;
    status?: string;
    q?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
};

export type ApiCallSummary = {
    total: number;
    success: number;
    failed: number;
    cancelled: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    credits: number;
    by_user: { username: string; count: number; total_tokens: number; failed: number; credits: number }[];
    by_model: { provider: string; model: string; count: number; total_tokens: number; failed: number; credits: number }[];
    by_day: { day: string; count: number; total_tokens: number; credits: number }[];
};

function queryString(query: ApiCallLogQuery) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") continue;
        params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : "";
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
    if (!response.ok) {
        let detail = fallback;
        try {
            const payload = (await response.json()) as { detail?: unknown };
            if (typeof payload.detail === "string" && payload.detail) detail = payload.detail;
        } catch {
            detail = fallback;
        }
        throw new Error(detail);
    }
    return response.json() as Promise<T>;
}

export async function fetchApiCallLogs(query: ApiCallLogQuery) {
    const response = await authorizedFetch(`/api-proxy/canvas-api/call-logs${queryString(query)}`);
    return readJson<{ items: ApiCallLogItem[]; total: number; page: number; page_size: number }>(response, "读取调用记录失败");
}

export async function fetchApiCallSummary(query: ApiCallLogQuery) {
    const response = await authorizedFetch(`/api-proxy/canvas-api/call-logs/summary${queryString(query)}`);
    return readJson<ApiCallSummary>(response, "读取调用统计失败");
}
