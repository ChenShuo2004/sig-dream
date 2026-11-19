import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
import { noteApiUsage } from "@/services/api/api-call-log";

function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

function sleep(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function readProxyPayload(response: Response) {
    const raw = await response.text();
    if (!raw.trim()) return {} as { detail?: unknown; pending?: unknown; job_id?: unknown };
    try {
        return JSON.parse(raw) as { detail?: unknown; pending?: unknown; job_id?: unknown };
    } catch {
        if (raw.trim().startsWith("<") || raw.includes("Internal Server Error")) {
            throw new Error("平台转发 AI007 时失败了");
        }
        throw new Error(raw.trim().slice(0, 180) || "AI007 请求失败");
    }
}

export async function forwardAi007(method: "GET" | "POST", path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
    const token = "local";
    const response = await fetch("/api-proxy/canvas-api/ai007", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body ? { method, path, body } : { method, path }),
        signal,
    });
    const payload = await readProxyPayload(response);
    if (!response.ok) {
        const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        throw new Error(detail || "AI007 请求失败");
    }
    const jobId = typeof payload.job_id === "string" ? payload.job_id : "";
    const waitMs = method === "GET" && path.startsWith("/video/generations/") ? 8 * 60_000 : 200_000;
    if (payload.pending === true && jobId) return waitAi007Job(jobId, token, signal, waitMs);
    return payload as Record<string, unknown>;
}

function relayBlip(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    return message.includes("平台转发 AI007") || message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Load failed");
}

async function waitAi007Job(jobId: string, token: string, signal?: AbortSignal, timeoutMs = 200_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(1500, signal);
        try {
            const response = await fetch(`/api-proxy/canvas-api/ai007/jobs/${encodeURIComponent(jobId)}`, {
                headers: applyLocalRelayHeaders(new Headers(), "ai007"),
                signal,
            });
            const payload = await readProxyPayload(response);
            if (!response.ok) {
                const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
                if (response.status >= 500 && !detail) continue;
                if (response.status >= 500 && (detail === "Internal Server Error" || detail.includes("平台转发 AI007"))) continue;
                throw new Error(detail || "AI007 请求失败");
            }
            if (payload.pending === true) continue;
            noteApiUsage(payload);
            return payload as Record<string, unknown>;
        } catch (error) {
            if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
            if (relayBlip(error)) continue;
            throw error;
        }
    }
    throw new Error("文件机还没有完成这次 AI007 调用，请确认全量任务进程在运行后再试");
}

export async function downloadAi007JobFile(path: string, signal?: AbortSignal) {
    const token = "local";
    const response = await fetch(`/api-proxy${path}`, {
        headers: applyLocalRelayHeaders(new Headers(), "ai007"),
        signal,
    });
    if (!response.ok) throw new Error("生成结果下载失败");
    return response.blob();
}

export async function publishAi007Media(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api-proxy/canvas-api/ai007/media", {
        method: "POST",
        headers: applyLocalRelayHeaders(new Headers(), "ai007"),
        body,
        signal,
    });
    const payload = (await response.json().catch(() => ({}))) as { detail?: unknown; path?: unknown };
    if (!response.ok || typeof payload.path !== "string" || !payload.path) {
        const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        throw new Error(detail || "参考文件上传失败");
    }
    return new URL(`/api-proxy${payload.path}`, window.location.origin).href;
}
