import { authorizedFetch, readDetail, readableError } from "@/services/api/canvas-channels";

import { saveStudioMedia } from "../media";
import type { IntakeShot, ReplicationSource } from "./document";

const BASE = "/api-proxy/studio-jobs";
const POLL_MS = 3000;

type IntakeResult = {
    duration: number;
    source_duration: number;
    truncated: boolean;
    width: number;
    height: number;
    fps: number;
    shots: Array<{ index: number; start: number; end: number; frame: string }>;
    files: { video: string; audio: string };
};

export type StudioJobStatus<T> = { job_id: string; status: string; message: string; error_message?: string | null; result?: T | null };
type JobStatus = StudioJobStatus<IntakeResult>;
export type StudioFlow = "replication-intake" | "replacement-intake" | "replacement-compose" | "replacement-media";

async function ensureOk(response: Response, fallback: string) {
    if (response.ok) return response;
    const detail = await readDetail(response);
    if (response.status === 403) throw new Error("没有使用画布工作室的权限，请联系管理员在角色权限里开通「使用画布工作室」");
    throw new Error(readableError(detail, fallback));
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        });
    });
}

export async function uploadStudioFile(flow: StudioFlow, file: Blob, filename: string, completeBody: Record<string, unknown>, onProgress: (ratio: number) => void, signal?: AbortSignal) {
    const init = await ensureOk(
        await authorizedFetch(`${BASE}/${flow}/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, size: file.size }), signal }),
        "上传初始化失败",
    );
    const { upload_id: uploadId, chunk_size: chunkSize } = (await init.json()) as { upload_id: string; chunk_size: number };
    const total = Math.ceil(file.size / chunkSize);
    for (let index = 0; index < total; index += 1) {
        const body = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
        await ensureOk(await authorizedFetch(`${BASE}/${flow}/uploads/${uploadId}/chunks/${index}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, signal }), "上传文件失败");
        onProgress((index + 1) / total);
    }
    const done = await ensureOk(
        await authorizedFetch(`${BASE}/${flow}/uploads/${uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(completeBody), signal }),
        "提交文件机任务失败",
    );
    return ((await done.json()) as { job_id: string }).job_id;
}

export function uploadSourceVideo(file: File, projectId: string, onProgress: (ratio: number) => void, signal?: AbortSignal) {
    return uploadStudioFile("replication-intake", file, file.name, { project_id: projectId }, onProgress, signal);
}

export async function waitForStudioJob<T>(jobId: string, onStatus: (status: StudioJobStatus<T>) => void, signal?: AbortSignal) {
    for (;;) {
        const response = await ensureOk(await authorizedFetch(`${BASE}/${jobId}`, { signal }), "读取文件机任务进度失败");
        const status = (await response.json()) as StudioJobStatus<T>;
        onStatus(status);
        if (status.status === "success") {
            if (status.result != null && typeof status.result === "object") return status.result;
            throw new Error("文件机任务已完成，但没有返回可用结果。请重试或检查文件机日志。");
        }
        if (status.status === "failed") throw new Error(status.error_message || status.message || "文件机任务失败");
        await sleep(POLL_MS, signal);
    }
}

export function waitForIntake(jobId: string, onStatus: (status: JobStatus) => void, signal?: AbortSignal) {
    return waitForStudioJob<IntakeResult>(jobId, onStatus, signal);
}

export async function downloadStudioJobFile(jobId: string, name: string, kind: "image" | "video" | "audio", signal?: AbortSignal) {
    const fallback = `下载 ${name} 失败`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const response = await authorizedFetch(`${BASE}/${jobId}/files/${encodeURIComponent(name)}`, { signal });
            // Pool exhaustion / transient gateway errors: retry a few times.
            if ((response.status >= 500 || response.status === 429) && attempt < 3) {
                await sleep(400 * (attempt + 1) ** 2, signal);
                continue;
            }
            await ensureOk(response, fallback);
            return saveStudioMedia(await response.blob(), kind);
        } catch (error) {
            if (signal?.aborted) throw error;
            lastError = error instanceof Error ? error : new Error(fallback);
            if (attempt >= 3) break;
            await sleep(400 * (attempt + 1) ** 2, signal);
        }
    }
    throw lastError || new Error(fallback);
}

const downloadFile = downloadStudioJobFile;

/** Copy intake outputs into the browser studio store; the server copy expires with the LAN job directory. */
export async function importIntakeResult(jobId: string, result: IntakeResult, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Partial<ReplicationSource>> {
    const total = result.shots.length + (result.files.audio ? 2 : 1);
    let done = 0;
    const tick = () => onProgress((done += 1), total);
    const videoKey = await downloadFile(jobId, result.files.video, "video", signal);
    tick();
    const audioKey = result.files.audio ? await downloadFile(jobId, result.files.audio, "audio", signal) : "";
    if (result.files.audio) tick();
    const shots: IntakeShot[] = [];
    const queue = [...result.shots];
    const worker = async () => {
        for (let shot = queue.shift(); shot; shot = queue.shift()) {
            const frameKey = await downloadFile(jobId, shot.frame, "image", signal);
            shots.push({ index: shot.index, startSec: shot.start, endSec: shot.end, frameKey });
            tick();
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    shots.sort((a, b) => a.index - b.index);
    return {
        durationSec: result.duration,
        sourceDurationSec: result.source_duration,
        truncated: result.truncated,
        width: result.width,
        height: result.height,
        fps: result.fps,
        videoKey,
        audioKey,
        shots,
    };
}
