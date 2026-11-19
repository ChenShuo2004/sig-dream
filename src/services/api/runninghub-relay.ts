import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
import { noteApiUsage } from "@/services/api/api-call-log";
import { downloadAuthorizedPath } from "@/services/api/generated-media";

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
        throw new Error(raw.trim().slice(0, 180) || "RunningHub 请求失败");
    }
}

function detailOf(payload: Record<string, unknown>) {
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) return payload.errorMessage.trim();
    if (typeof payload.msg === "string" && payload.msg.trim() && payload.msg !== "success") return payload.msg.trim();
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    const nested = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
    if (nested && typeof nested.errorMessage === "string" && nested.errorMessage.trim()) return nested.errorMessage.trim();
    const error = payload.error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
        return ((error as { message: string }).message || "").trim();
    }
    if (typeof error === "string" && error.trim()) return error.trim();
    const errorCode = String(payload.errorCode || nested?.errorCode || "").trim();
    if (errorCode && errorCode !== "0") return `RunningHub 错误 ${errorCode}`;
    return "";
}

/** Parse taskId from legacy {code,data.taskId} or OpenAPI v2 flat {taskId,errorCode,errorMessage}. */
export function extractRunningHubTaskId(payload: Record<string, unknown>) {
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    const taskId = String(data.taskId ?? data.task_id ?? payload.taskId ?? "").trim();
    if (taskId) return taskId;
    throw new Error(detailOf(payload) || "RunningHub 没有返回 taskId");
}

async function runninghubFetch(path: string, init: RequestInit = {}) {
    const headers = applyLocalRelayHeaders(new Headers(init.headers), "runninghub");
    const response = await fetch(`/api-proxy/canvas-api/runninghub${path}`, { ...init, headers });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(detailOf(payload) || "RunningHub 请求失败");
    noteApiUsage(payload);
    return payload;
}

export async function uploadRunningHubFile(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file, file.name || "asset.bin");
    const payload = await runninghubFetch("/upload", { method: "POST", body, signal });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    const fileName = typeof data.fileName === "string" ? data.fileName : typeof data.filename === "string" ? data.filename : "";
    if (!fileName.trim()) throw new Error("RunningHub 上传后没有返回文件名");
    return fileName.trim();
}

export async function runRunningHubAiApp(
    body: {
        webappId: string;
        nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
        instanceType?: "default" | "plus" | "ultra";
    },
    signal?: AbortSignal,
) {
    return runninghubFetch("/ai-app/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
}

export async function runRunningHubWorkflow(
    body: { workflowId: string; nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>; instanceType?: "default" | "plus" | "ultra" },
    signal?: AbortSignal,
) {
    return runninghubFetch("/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
}

export async function queryRunningHubTask(taskId: string, signal?: AbortSignal) {
    return runninghubFetch("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
        signal,
    });
}

/** Cache RH result on ECS, then GET the cached file. The browser retries, then falls back to ranged reads. */
export async function downloadRunningHubResultFile(url: string, signal?: AbortSignal) {
    const token = "local";
    let last: unknown;
    let path = "";
    for (let attempt = 0; attempt < 3 && !path; attempt += 1) {
        try {
            const cacheResponse = await fetch("/api-proxy/canvas-api/runninghub/result-file", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ url }),
                signal,
            });
            const cachePayload = await readPayload(cacheResponse);
            if (!cacheResponse.ok) throw new Error(detailOf(cachePayload) || "下载 RunningHub 视频失败");
            const nextPath = String(cachePayload.path || "").trim();
            if (!nextPath.startsWith("/canvas-api/")) throw new Error("RunningHub 成片缓存路径无效");
            path = nextPath;
        } catch (error) {
            if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
            last = error;
            if (error instanceof Error && /请先登录|路径无效/.test(error.message)) throw error;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    if (!path) throw last instanceof Error ? last : new Error("下载 RunningHub 视频失败");
    const blob = await downloadAuthorizedPath(path, token, signal);
    if (blob.size < 64) throw new Error("RunningHub 成片为空");
    return blob;
}

/** Cancel a RunningHub ComfyUI / AI App task (POST /task/openapi/cancel). */
export async function cancelRunningHubTask(taskId: string, signal?: AbortSignal) {
    const id = String(taskId || "").trim();
    if (!id) throw new Error("taskId 无效");
    return runninghubFetch("/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: id }),
        signal,
    });
}

/** Collect result URLs per RH OpenAPI v2 contract: results[].url / outputUrl (also legacy fields). */
function collectRunningHubResultUrls(payload: Record<string, unknown>) {
    const results: string[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
        const url = value.trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
        seen.add(url);
        results.push(url);
    };
    const walk = (value: unknown) => {
        if (typeof value === "string") {
            push(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        // Official v2 query: results: [{ url, outputType }]
        if (Array.isArray(record.results)) {
            for (const item of record.results) {
                if (!item || typeof item !== "object") continue;
                const row = item as Record<string, unknown>;
                for (const key of ["url", "outputUrl", "fileUrl", "videoUrl", "download_url", "downloadUrl", "file_url"]) {
                    if (typeof row[key] === "string") push(row[key] as string);
                }
            }
        }
        for (const key of ["url", "outputUrl", "fileUrl", "videoUrl", "download_url", "downloadUrl", "file_url"]) {
            if (typeof record[key] === "string") push(record[key] as string);
        }
        if (record.outputs) walk(record.outputs);
        if (Array.isArray(record.data)) walk(record.data);
        else if (record.data && typeof record.data === "object") walk(record.data);
    };
    walk(payload);
    return results;
}

/**
 * Map RunningHub query payload → pending | completed | failed.
 * Status enum follows official contract (developer-kit/rh-api-contract.md + /openapi/v2/query):
 * CREATE / QUEUED / RUNNING → pending; SUCCESS → completed; FAILED / CANCEL → failed.
 * SUCCESS is terminal: never keep polling as pending once status is SUCCESS.
 */
function runningHubFailureText(message: string, fallback: string) {
    const parts = message.split("|").map((part) => part.trim()).filter(Boolean);
    const chinese = [...parts].reverse().find((part) => /[\u4e00-\u9fff]/.test(part));
    return chinese || message || fallback;
}

export function runningHubTaskState(payload: Record<string, unknown>) {
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    // Legacy status endpoint may return data as a bare status string.
    const statusFromData = typeof payload.data === "string" ? payload.data : "";
    const code = Number(payload.code);
    const statusText = String(data.status || data.taskStatus || statusFromData || payload.status || "")
        .trim()
        .toUpperCase();
    const failedReason = data.failedReason && typeof data.failedReason === "object" ? (data.failedReason as Record<string, unknown>) : null;
    const failMessage =
        (failedReason && typeof failedReason.exception_message === "string" && failedReason.exception_message) ||
        (typeof data.errorMessage === "string" && data.errorMessage) ||
        detailOf(payload) ||
        "";

    // Official non-terminal statuses (exact tokens).
    if (statusText === "CREATE" || statusText === "CREATED" || statusText === "QUEUED" || statusText === "RUNNING" || statusText === "PENDING" || statusText === "RUN") {
        return { status: "pending" as const, message: "", results: [] as string[] };
    }
    // Legacy queued/running codes from older RH APIs.
    if (code === 804 || code === 813) {
        return { status: "pending" as const, message: "", results: [] as string[] };
    }

    // Official terminal: CANCEL. Also accept CANCELED / CANCELING so a cancelled task is not polled as still running.
    const errorCode = String(data.errorCode || payload.errorCode || "");
    if (statusText.includes("CANCEL") || /取消/.test(statusText) || code === 807 || code === 423 || errorCode === "807") {
        return { status: "failed" as const, message: failMessage || "RunningHub 任务已取消", results: [] as string[] };
    }
    // Official terminal: FAILED (+ legacy ERROR / 805)
    if (statusText === "FAILED" || statusText === "ERROR" || statusText.includes("FAIL") || code === 805) {
        const cancelledHint = /cancel|取消|中断/i.test(failMessage);
        return { status: "failed" as const, message: runningHubFailureText(failMessage, cancelledHint ? "RunningHub 任务已取消" : "RunningHub 任务失败"), results: [] as string[] };
    }
    // Empty status + error (1004 = task missing or expired). This is not "still running".
    if ((errorCode && errorCode !== "0" && !["804", "813"].includes(errorCode) && !statusText) || /任务不存在|已过期|task not found|expired/i.test(failMessage)) {
        return { status: "failed" as const, message: runningHubFailureText(failMessage, "RunningHub 任务不存在或已过期"), results: [] as string[] };
    }

    const results = collectRunningHubResultUrls(payload);

    // Official terminal: SUCCESS — read results[].url; never return pending after SUCCESS.
    if (statusText === "SUCCESS" || statusText === "COMPLETED" || statusText === "SUCCEEDED" || statusText === "DONE" || statusText.includes("SUCCESS")) {
        return results.length
            ? { status: "completed" as const, message: "", results }
            : { status: "failed" as const, message: failMessage || "RunningHub 已成功但没有返回结果地址", results: [] as string[] };
    }

    // Legacy envelope: code 0 with URLs.
    if (code === 0 && results.length) return { status: "completed" as const, message: "", results };
    return { status: "pending" as const, message: "", results: [] as string[] };
}
