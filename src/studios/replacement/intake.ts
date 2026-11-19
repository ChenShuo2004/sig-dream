import { downloadStudioJobFile, uploadStudioFile, waitForStudioJob, type StudioJobStatus } from "../replication/intake";
import { getStudioMediaBlob } from "../media";
import type { ReplacementIdentity, ReplacementShot, ReplacementSource } from "./document";

type IntakePerson = { id: string; box: [number, number, number, number]; score: number; crop: string; identity?: string; similarity?: number; review?: boolean };

export type ReplacementIntakeResult = {
    duration: number;
    source_duration: number;
    truncated: boolean;
    width: number;
    height: number;
    fps: number;
    cuts?: number[];
    shots: Array<{ index: number; start: number; end: number; keyframe: string; keyframeTime: number; clip?: string; persons: IntakePerson[] }>;
    identities: Array<{ id: string; count: number; shots: number[]; cover: string; review: boolean; suggested: string }>;
    files: { video: string; audio: string };
};

export type IntakeOptions = { skip_cuts?: boolean; bounds?: number[] };

export function uploadReplacementSource(blob: Blob, filename: string, projectId: string, intake: IntakeOptions, onProgress: (ratio: number) => void, signal?: AbortSignal) {
    return uploadStudioFile("replacement-intake", blob, filename, { project_id: projectId, intake }, onProgress, signal);
}

export function waitForReplacementIntake(jobId: string, onStatus: (status: StudioJobStatus<ReplacementIntakeResult>) => void, signal?: AbortSignal) {
    return waitForStudioJob<ReplacementIntakeResult>(jobId, onStatus, signal);
}

/** Copy intake outputs into the browser studio store; the server copy expires with the LAN job directory. */
export async function importReplacementIntake(jobId: string, sourceId: string, result: ReplacementIntakeResult, onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
    if (!result?.files?.video) throw new Error("原片处理完成但没有返回视频文件，请重试。");
    const tasks: Array<{ name: string; kind: "image" | "video" | "audio" }> = [{ name: result.files.video, kind: "video" }];
    if (result.files.audio) tasks.push({ name: result.files.audio, kind: "audio" });
    for (const shot of result.shots) {
        tasks.push({ name: shot.keyframe, kind: "image" });
        if (shot.clip) tasks.push({ name: shot.clip, kind: "video" });
        for (const person of shot.persons) tasks.push({ name: person.crop, kind: "image" });
    }
    const keys = new Map<string, string>();
    let done = 0;
    const queue = [...tasks];
    const worker = async () => {
        for (let task = queue.shift(); task; task = queue.shift()) {
            keys.set(task.name, await downloadStudioJobFile(jobId, task.name, task.kind, signal));
            onProgress((done += 1), tasks.length);
        }
    };
    // Keep concurrency modest: each download used to hold a DB connection while streaming.
    await Promise.all([worker(), worker()]);

    const identityId = (id: string) => (id ? `${sourceId}:${id}` : "");
    const shotId = (index: number) => `${sourceId}-${index}`;
    const shots: ReplacementShot[] = result.shots.map((shot) => {
        const byPosition = [...shot.persons].sort((a, b) => a.box[0] + a.box[2] / 2 - (b.box[0] + b.box[2] / 2));
        return {
            id: shotId(shot.index),
            sourceId,
            index: shot.index,
            startSec: shot.start,
            endSec: shot.end,
            keyframeKey: keys.get(shot.keyframe) || "",
            keyframeTime: shot.keyframeTime,
            clipKey: shot.clip ? keys.get(shot.clip) || "" : "",
            persons: shot.persons.map((person) => ({
                id: `${sourceId}-${person.id}`,
                bbox: { x: person.box[0], y: person.box[1], width: person.box[2], height: person.box[3] },
                score: person.score,
                cropKey: keys.get(person.crop) || "",
                identity: identityId(person.identity || ""),
                similarity: person.similarity ?? 0,
                review: Boolean(person.review),
                promptMarkerIndex: byPosition.indexOf(person),
                targetCharacterId: "",
                scope: "full-person" as const,
            })),
            promptMode: "positioning" as const,
            manualPrompt: "",
            sceneId: "",
            imageResults: [],
            imageIndex: 0,
            videoResults: [],
            videoIndex: 0,
        };
    });
    const identities: ReplacementIdentity[] = result.identities.map((identity, index) => ({
        id: identityId(identity.id),
        sourceId,
        name: `人物${index + 1}`,
        count: identity.count,
        shots: identity.shots.map(shotId),
        coverKey: keys.get(identity.cover) || "",
        review: identity.review,
        suggested: identity.suggested,
        targetCharacterId: "",
        visualPrompt: "",
        faceKey: "",
    }));
    const durationSec = Number(result.duration) || 0;
    const sourceDurationSec = Number(result.source_duration) || durationSec;
    const source: Partial<ReplacementSource> = {
        durationSec,
        sourceDurationSec,
        truncated: Boolean(result.truncated),
        width: Number(result.width) || 0,
        height: Number(result.height) || 0,
        fps: Number(result.fps) || 0,
        cuts: result.cuts || result.shots.slice(1).map((shot) => shot.start),
        videoKey: keys.get(result.files.video) || "",
        audioKey: result.files.audio ? keys.get(result.files.audio) || "" : "",
    };
    return { source, shots, identities };
}

// ---------- single-file media edits ----------

export type MediaOp = { op: "reverse" } | { op: "trim"; start: number; end: number } | { op: "separate" };
export type MediaResult = { op: string; duration?: number; files: Record<string, string> };

/** Runs reverse / trim / vocal separation on the file machine and imports the outputs into the studio store. */
export async function runMediaJob(blob: Blob, filename: string, projectId: string, media: MediaOp, onStatus: (message: string, jobId?: string) => void, signal?: AbortSignal) {
    const jobId = await uploadStudioFile("replacement-media", blob, filename, { project_id: projectId, media }, (ratio) => onStatus(`正在上传 ${Math.round(ratio * 100)}%`), signal);
    onStatus("排队等待文件机处理", jobId);
    const result = await waitForStudioJob<MediaResult>(jobId, (status) => onStatus(status.message || "文件机处理中", jobId), signal);
    if (!result?.files || typeof result.files !== "object") throw new Error("素材处理完成但没有返回文件，请重试。");
    const keys: Record<string, string> = {};
    for (const [role, name] of Object.entries(result.files)) {
        if (!name) continue;
        keys[role] = await downloadStudioJobFile(jobId, name, name.endsWith(".mp4") ? "video" : "audio", signal);
    }
    if (!Object.keys(keys).length) throw new Error("素材处理完成但没有可下载的文件，请重试。");
    const duration = Number(result.duration);
    return { jobId, keys, duration: Number.isFinite(duration) ? duration : undefined };
}

// ---------- compose ----------

export type ComposeInput = {
    width: number;
    height: number;
    fps: number;
    segments: Array<{ mediaKey: string; duration: number }>;
    audio?: { mediaKey: string; volume: number };
    lines: Array<{ mediaKey: string; start: number; volume: number }>;
};

type BundleEntry = { offset: number; size: number };

/** Packs every referenced blob back to back; the compose plan carries each file's byte range. */
export async function buildComposeBundle(input: ComposeInput) {
    const parts: Blob[] = [];
    const entries = new Map<string, BundleEntry>();
    let offset = 0;
    const add = async (key: string) => {
        const existing = entries.get(key);
        if (existing) return existing;
        const blob = await getStudioMediaBlob(key);
        if (!blob?.size) throw new Error("合成素材缺失，请重新生成对应片段。");
        const entry = { offset, size: blob.size };
        parts.push(blob);
        offset += blob.size;
        entries.set(key, entry);
        return entry;
    };
    const segments = [];
    for (const segment of input.segments) segments.push({ file: await add(segment.mediaKey), duration: segment.duration });
    const audio = input.audio ? { file: await add(input.audio.mediaKey), volume: input.audio.volume } : undefined;
    const lines = [];
    for (const line of input.lines) lines.push({ file: await add(line.mediaKey), start: line.start, volume: line.volume });
    return { bundle: new Blob(parts, { type: "application/octet-stream" }), plan: { width: input.width, height: input.height, fps: input.fps, segments, ...(audio ? { audio } : {}), lines } };
}

export async function submitCompose(input: ComposeInput, projectId: string, onProgress: (ratio: number) => void, signal?: AbortSignal) {
    const { bundle, plan } = await buildComposeBundle(input);
    return uploadStudioFile("replacement-compose", bundle, "compose.bin", { project_id: projectId, compose: plan }, onProgress, signal);
}

export type ComposeResult = { duration: number; segments: number; files: { video: string } };

export function waitForCompose(jobId: string, onStatus: (status: StudioJobStatus<ComposeResult>) => void, signal?: AbortSignal) {
    return waitForStudioJob<ComposeResult>(jobId, onStatus, signal);
}

export { downloadStudioJobFile };
