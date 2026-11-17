import { useCallback, useRef, useState } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { getStudioMediaBlob, resolveStudioMedia, saveStudioMedia } from "@/studios/media";
import {
    orderedShots,
    retryCount,
    shotDuration,
    shotImageKey,
    shotVideoKey,
    sourceOffsets,
    type ReplacementCharacter,
    type ReplacementLine,
    type ReplacementResult,
    type ReplacementShot,
    type ReplacementSource,
    type ReplacementStudioDocument,
} from "@/studios/replacement/document";
import { downloadStudioJobFile, importReplacementIntake, runMediaJob, submitCompose, uploadReplacementSource, waitForCompose, waitForReplacementIntake, type IntakeOptions } from "@/studios/replacement/intake";
import { exportProjectPackage } from "@/studios/replacement/project-package";
import {
    audioDuration,
    buildBedAudio,
    buildReplacementMix,
    cloneLine,
    convertSingingLine,
    remakeSingingLine,
    downloadBlob,
    exportAllAssets,
    exportPremiereProject,
    extensionOf,
    describeIdentityLooks,
    generateCharacterImage,
    replaceShotImage,
    replaceShotVideo,
    transcribeSource,
    translateLines,
    type CharacterGenerationOptions,
    type ReplacementContext,
} from "@/studios/replacement/stages";
import type { StudioProjectHandle } from "@/studios/use-studio-project";

type Handle = StudioProjectHandle<ReplacementStudioDocument>;

/** Files picked on the project home, handed to the project page that processes them (not persisted). */
export const pendingSourceFiles = new Map<string, File>();

function isAbort(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function withMeta(document: ReplacementStudioDocument): ReplacementStudioDocument {
    const images = document.shots.filter((shot) => shot.imageResults.length).length;
    const videos = document.shots.filter((shot) => shot.videoResults.length).length;
    const total = document.shots.length;
    const stage = document.compose?.videoKey ? "compose" : videos ? "video" : images ? "image" : "assets";
    const processing = document.sources.some((source) => source.status !== "done" && source.status !== "failed");
    const stageLabel = document.compose?.videoKey ? "已合成" : videos ? `视频替换 ${videos}/${total}` : images ? `图像替换 ${images}/${total}` : processing ? "处理中" : total ? `${total} 个镜头` : "未开始";
    return { ...document, meta: { ...document.meta, stage, stageLabel, clipCount: total, retryCount: retryCount(document) } };
}

async function makeCover(key: string) {
    const url = await resolveStudioMedia(key);
    if (!url) return "";
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = url;
    });
    const canvas = window.document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round((image.naturalHeight / image.naturalWidth) * 320) || 180;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
}

function pushResult(results: ReplacementResult[], key: string, prompt: string, model: string) {
    return [...results, { id: nanoid(8), key, prompt, model, at: new Date().toISOString() }];
}

export function useReplacementRunner(handle: Handle) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState("");
    const [stream, setStream] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const busyRef = useRef("");

    const update = useCallback((mutate: (document: ReplacementStudioDocument) => ReplacementStudioDocument) => handle.update((document) => withMeta(mutate(document))), [handle]);

    const log = useCallback(
        (text: string, level: "info" | "warn" | "error" = "info") =>
            handle.update((document) => ({ ...document, logs: [...document.logs.slice(-199), { at: new Date().toISOString(), stage: busyRef.current, message: text, level }] })),
        [handle],
    );

    const run = useCallback(
        async (label: string, task: (context: ReplacementContext) => Promise<void>) => {
            if (busyRef.current) {
                message.warning(`正在执行：${busyRef.current}`);
                return;
            }
            const controller = new AbortController();
            abortRef.current = controller;
            busyRef.current = label;
            setBusy(label);
            setStream("");
            const context: ReplacementContext = { signal: controller.signal, log, onDelta: (delta) => setStream((current) => (current + delta).slice(-4000)) };
            try {
                await task(context);
                log(`${label}完成`);
            } catch (error) {
                if (isAbort(error) || controller.signal.aborted) log(`${label}已取消`, "warn");
                else {
                    log(`${label}失败：${errorText(error)}`, "error");
                    message.error(errorText(error));
                }
            } finally {
                busyRef.current = "";
                abortRef.current = null;
                setBusy("");
                setStream("");
                void handle.flush();
            }
        },
        [handle, log, message],
    );

    const cancel = useCallback(() => abortRef.current?.abort(), []);

    const patchSource = useCallback((id: string, patch: Partial<ReplacementSource>) => update((current) => ({ ...current, sources: current.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)) })), [update]);
    const patchShot = useCallback((id: string, patch: Partial<ReplacementShot> | ((shot: ReplacementShot) => Partial<ReplacementShot>)) => update((current) => ({ ...current, shots: current.shots.map((shot) => (shot.id === id ? { ...shot, ...(typeof patch === "function" ? patch(shot) : patch) } : shot)) })), [update]);
    const patchCharacter = useCallback((id: string, patch: Partial<ReplacementCharacter> | ((character: ReplacementCharacter) => Partial<ReplacementCharacter>)) => update((current) => ({ ...current, characters: current.characters.map((item) => (item.id === id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item)) })), [update]);
    const patchLine = useCallback((id: string, patch: Partial<ReplacementLine>) => update((current) => ({ ...current, lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) })), [update]);

    // ---------- sources ----------

    const intakeSource = useCallback(
        async (sourceId: string, blob: Blob | null, options: IntakeOptions, context: ReplacementContext) => {
            const projectId = handle.project?.id;
            if (!projectId) throw new Error("项目尚未加载。");
            const source = handle.getDocument().sources.find((item) => item.id === sourceId);
            if (!source) return;
            try {
                let jobId = source.jobId;
                if (blob) {
                    patchSource(sourceId, { status: "uploading", message: "正在上传", error: "" });
                    jobId = await uploadReplacementSource(blob, source.fileName || "source.mp4", projectId, options, (ratio) => patchSource(sourceId, { message: `正在上传 ${Math.round(ratio * 100)}%` }), context.signal);
                    patchSource(sourceId, { jobId, status: "pending", message: "排队等待文件机处理" });
                    await handle.flush();
                }
                const result = await waitForReplacementIntake(jobId, (status) => patchSource(sourceId, { status: status.status === "running" ? "running" : "pending", message: status.message || "排队等待文件机处理" }), context.signal);
                const imported = await importReplacementIntake(jobId, sourceId, result, (done, total) => patchSource(sourceId, { message: `导入处理结果 ${done}/${total}` }), context.signal);
                update((current) => ({
                    ...current,
                    sources: current.sources.map((item) =>
                        item.id === sourceId ? { ...item, ...imported.source, status: "done", message: `${imported.shots.length} 个镜头，${imported.identities.length} 个人物${imported.source.truncated ? `，只取前 ${Math.round(imported.source.durationSec || 0)} 秒` : ""}` } : item,
                    ),
                    shots: [...current.shots.filter((shot) => shot.sourceId !== sourceId), ...imported.shots],
                    identities: [...current.identities.filter((identity) => identity.sourceId !== sourceId), ...imported.identities],
                    lines: current.lines.filter((line) => line.sourceId !== sourceId),
                    compose: null,
                }));
                // Replication-style: fill visualPrompt for each detected person so assets can generate three-views from text + face ref.
                if (imported.identities.length) {
                    try {
                        patchSource(sourceId, { message: "识别人物外观描述…" });
                        const patch = await describeIdentityLooks(handle.getDocument(), imported.identities.map((item) => item.id), context);
                        update((current) => ({
                            ...current,
                            identities: current.identities.map((identity) => {
                                const next = patch.get(identity.id);
                                return next ? { ...identity, name: next.name || identity.name, visualPrompt: next.visualPrompt } : identity;
                            }),
                        }));
                        patchSource(sourceId, { message: `${imported.shots.length} 个镜头，${imported.identities.length} 个人物（已提取外观描述）` });
                    } catch (error) {
                        if (isAbort(error)) throw error;
                        context.log(`人物外观描述未完成：${errorText(error)}（可在素材设定里重试）`, "warn");
                    }
                }
                pendingSourceFiles.delete(sourceId);
                if (imported.source.truncated) context.log(`${source.fileName} 超过 300 秒，只处理了前 300 秒。`, "warn");
                if (!handle.getDocument().meta.coverUrl && imported.shots[0]?.keyframeKey) {
                    const coverUrl = await makeCover(imported.shots[0].keyframeKey).catch(() => "");
                    if (coverUrl) handle.update((current) => ({ ...current, meta: { ...current.meta, coverUrl } }));
                }
            } catch (error) {
                if (!isAbort(error)) patchSource(sourceId, { status: "failed", error: errorText(error) });
                throw error;
            }
        },
        [handle, patchSource, update],
    );

    const addSources = useCallback(
        (files: File[], skipCuts: boolean) => {
            const created = files.map((file) => {
                const source: ReplacementSource = { id: nanoid(8), fileName: file.name, jobId: "", status: "uploading", message: "等待上传", skipCuts, cuts: [], durationSec: 0, sourceDurationSec: 0, truncated: false, width: 0, height: 0, fps: 0, videoKey: "", audioKey: "" };
                pendingSourceFiles.set(source.id, file);
                return source;
            });
            update((current) => ({ ...current, sources: [...current.sources, ...created] }));
            return run(created.length > 1 ? `处理 ${created.length} 个视频` : "处理视频", async (context) => {
                for (const source of created) {
                    if (context.signal?.aborted) return;
                    try {
                        await intakeSource(source.id, pendingSourceFiles.get(source.id) || null, { skip_cuts: skipCuts }, context);
                    } catch (error) {
                        if (isAbort(error)) throw error;
                        context.log(`${source.fileName} 处理失败：${errorText(error)}`, "error");
                    }
                }
            });
        },
        [intakeSource, run, update],
    );

    /** Audio-only project: skip video intake, land on voice step for clone / ASR. */
    const addAudioSources = useCallback(
        (files: File[]) =>
            run(files.length > 1 ? `导入 ${files.length} 段声音` : "导入声音", async (context) => {
                const created: ReplacementSource[] = [];
                for (const file of files) {
                    if (context.signal?.aborted) return;
                    context.log(`正在导入 ${file.name}…`);
                    const key = await saveStudioMedia(file, "audio");
                    const durationSec = await audioDuration(key);
                    created.push({
                        id: nanoid(8),
                        fileName: file.name,
                        jobId: "",
                        status: "done",
                        message: "仅声音",
                        skipCuts: true,
                        cuts: [],
                        durationSec,
                        sourceDurationSec: durationSec,
                        truncated: false,
                        width: 0,
                        height: 0,
                        fps: 0,
                        videoKey: "",
                        audioKey: key,
                        audioOnly: true,
                    });
                }
                update((current) => ({
                    ...current,
                    step: "voice",
                    meta: { ...current.meta, stage: "voice", stageLabel: "声音克隆" },
                    sources: [...current.sources, ...created],
                }));
                context.log(`已导入 ${created.length} 段声音，可直接开始分析与克隆。`);
            }),
        [run, update],
    );

    /** Resume after reload: poll a running job, or re-upload the file picked this session. */
    const retrySource = useCallback(
        (sourceId: string) =>
            run("处理视频", async (context) => {
                const source = handle.getDocument().sources.find((item) => item.id === sourceId);
                if (!source) return;
                const file = pendingSourceFiles.get(sourceId);
                if (source.jobId && source.status !== "failed") return intakeSource(sourceId, null, {}, context);
                const blob = file || (source.videoKey ? await getStudioMediaBlob(source.videoKey) : null);
                if (!blob) throw new Error("页面刷新后原视频文件已不在内存中，请删除后重新加入视频。");
                await intakeSource(sourceId, blob, source.cuts.length || source.skipCuts ? { bounds: source.cuts } : {}, context);
            }),
        [handle, intakeSource, run],
    );

    const recutSource = useCallback(
        (sourceId: string, cuts: number[] | "detect") =>
            run(cuts === "detect" ? "智能检测切点" : "应用切点", async (context) => {
                const source = handle.getDocument().sources.find((item) => item.id === sourceId);
                const blob = source?.videoKey ? await getStudioMediaBlob(source.videoKey) : null;
                if (!source || !blob) throw new Error("原视频缺失，请重新加入视频。");
                await intakeSource(sourceId, blob, cuts === "detect" ? {} : { bounds: cuts }, context);
            }),
        [handle, intakeSource, run],
    );

    const removeSource = useCallback(
        (sourceId: string) => {
            pendingSourceFiles.delete(sourceId);
            update((current) => ({
                ...current,
                sources: current.sources.filter((source) => source.id !== sourceId),
                shots: current.shots.filter((shot) => shot.sourceId !== sourceId),
                identities: current.identities.filter((identity) => identity.sourceId !== sourceId),
                lines: current.lines.filter((line) => line.sourceId !== sourceId),
                compose: null,
            }));
        },
        [update],
    );

    const mediaJob = useCallback(
        async (blob: Blob, filename: string, op: Parameters<typeof runMediaJob>[3], onStatus: (text: string, jobId?: string) => void, context: ReplacementContext) => {
            const projectId = handle.project?.id;
            if (!projectId) throw new Error("项目尚未加载。");
            return runMediaJob(blob, filename, projectId, op, onStatus, context.signal);
        },
        [handle],
    );

    const separateSource = useCallback(
        (sourceId: string) =>
            run("提取清晰人声", async (context) => {
                const source = handle.getDocument().sources.find((item) => item.id === sourceId);
                const blob = source ? await getStudioMediaBlob(source.audioKey || source.videoKey) : null;
                if (!source || !blob) throw new Error("原视频没有音轨。");
                const setSeparation = (patch: Partial<NonNullable<ReplacementSource["separation"]>>) =>
                    update((current) => ({ ...current, sources: current.sources.map((item) => (item.id === sourceId ? { ...item, separation: { jobId: "", status: "uploading", message: "", ...item.separation, ...patch } } : item)) }));
                setSeparation({ status: "uploading", message: "正在上传", error: "", vocalsKey: "", backgroundKey: "" });
                try {
                    const result = await mediaJob(blob, source.audioKey ? "audio.mp3" : "video.mp4", { op: "separate" }, (text, jobId) => setSeparation({ message: text, status: jobId ? "running" : "uploading", ...(jobId ? { jobId } : {}) }), context);
                    const vocalsKey = result.keys?.vocals;
                    const backgroundKey = result.keys?.background;
                    if (!vocalsKey || !backgroundKey) throw new Error("人声分离完成但没有返回音轨文件。");
                    const name = source.fileName.replace(/\.[^.]+$/u, "");
                    const [vocalsDuration, backgroundDuration] = await Promise.all([audioDuration(vocalsKey), audioDuration(backgroundKey)]);
                    update((current) => ({
                        ...current,
                        sources: current.sources.map((item) => (item.id === sourceId ? { ...item, separation: { jobId: result.jobId, status: "done", message: "已分离人声和背景声", vocalsKey, backgroundKey } } : item)),
                        audios: [
                            ...current.audios,
                            { id: nanoid(8), name: `${name}-人声`, key: vocalsKey, durationSec: vocalsDuration, origin: "vocals" },
                            { id: nanoid(8), name: `${name}-背景声`, key: backgroundKey, durationSec: backgroundDuration, origin: "background" },
                        ],
                    }));
                } catch (error) {
                    if (!isAbort(error)) setSeparation({ status: "failed", error: errorText(error) });
                    throw error;
                }
            }),
        [handle, mediaJob, run, update],
    );

    const reverseShot = useCallback(
        (shotId: string) =>
            run("倒放镜头", async (context) => {
                const shot = handle.getDocument().shots.find((item) => item.id === shotId);
                const blob = shot?.clipKey ? await getStudioMediaBlob(shot.clipKey) : null;
                if (!shot || !blob) throw new Error("镜头没有原片片段。");
                const result = await mediaJob(blob, "clip.mp4", { op: "reverse" }, (text) => setStream(text), context);
                const clipKey = result.keys?.video;
                if (!clipKey) throw new Error("倒放完成但没有返回视频文件。");
                patchShot(shotId, (current) => ({ clipKey, referenceKey: "", referenceDurationSec: undefined, reversed: !current.reversed }));
            }),
        [handle, mediaJob, patchShot, run],
    );

    const trimReference = useCallback(
        (shotId: string, start: number, end: number) =>
            run("裁剪参考视频", async (context) => {
                const shot = handle.getDocument().shots.find((item) => item.id === shotId);
                const blob = shot?.clipKey ? await getStudioMediaBlob(shot.clipKey) : null;
                if (!shot || !blob) throw new Error("镜头没有原片片段。");
                if (start <= 0.01 && end >= shotDuration(shot) - 0.01) {
                    patchShot(shotId, { referenceKey: "", referenceDurationSec: undefined });
                    return;
                }
                const result = await mediaJob(blob, "clip.mp4", { op: "trim", start, end }, (text) => setStream(text), context);
                const referenceKey = result.keys?.video;
                if (!referenceKey) throw new Error("裁剪完成但没有返回视频文件。");
                const trimmed = Number(result.duration);
                patchShot(shotId, { referenceKey, referenceDurationSec: Number.isFinite(trimmed) && trimmed > 0 ? trimmed : end - start });
            }),
        [handle, mediaJob, patchShot, run],
    );

    // ---------- assets ----------

    const generateCharacter = useCallback(
        (id: string, options: CharacterGenerationOptions) =>
            run("生成形象", async (context) => {
                const document = handle.getDocument();
                const character = document.characters.find((item) => item.id === id);
                if (!character) return;
                patchCharacter(id, { imageStatus: "running", imageError: "" });
                try {
                    const imageKey = await generateCharacterImage(document, character, options, context.signal);
                    patchCharacter(id, (current) => {
                        const appearance = { id: nanoid(8), imageKey, prompt: options.prompt, origin: "generate" as const };
                        return { imageStatus: "done", prompt: options.prompt, appearances: [...current.appearances, appearance], baseAppearanceId: current.baseAppearanceId || appearance.id };
                    });
                } catch (error) {
                    if (!isAbort(error)) patchCharacter(id, { imageStatus: "failed", imageError: errorText(error) });
                    throw error;
                }
            }),
        [handle, patchCharacter, run],
    );

    const describeIdentities = useCallback(
        (identityIds?: string[]) =>
            run("识别人物外观", async (context) => {
                const patch = await describeIdentityLooks(handle.getDocument(), identityIds, context);
                update((current) => ({
                    ...current,
                    identities: current.identities.map((identity) => {
                        const next = patch.get(identity.id);
                        return next ? { ...identity, name: next.name || identity.name, visualPrompt: next.visualPrompt } : identity;
                    }),
                }));
            }),
        [handle, run, update],
    );

    // ---------- image / video ----------

    const replaceImages = useCallback(
        (ids: string[]) =>
            run(ids.length > 1 ? `生成 ${ids.length} 个关键帧` : "生成关键帧", async (context) => {
                const queue = [...ids];
                const worker = async () => {
                    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
                        if (context.signal?.aborted) return;
                        const document = handle.getDocument();
                        const shot = document.shots.find((item) => item.id === id);
                        if (!shot) continue;
                        patchShot(id, { imageStatus: "running", imageError: "" });
                        try {
                            const result = await replaceShotImage(document, shot, context);
                            patchShot(id, (current) => {
                                const imageResults = pushResult(current.imageResults, result.key, result.prompt, result.model);
                                return { imageStatus: "done", imageResults, imageIndex: imageResults.length - 1, sourceDescriptions: result.sourceDescriptions, enhancement: result.enhancement };
                            });
                        } catch (error) {
                            if (isAbort(error)) throw error;
                            patchShot(id, { imageStatus: "failed", imageError: errorText(error) });
                            context.log(`镜头 ${shot.index} 关键帧生成失败：${errorText(error)}`, "error");
                        }
                    }
                };
                await Promise.all([worker(), worker()]);
            }),
        [handle, patchShot, run],
    );

    const replaceVideos = useCallback(
        (ids: string[], overrides: { model?: string } = {}) =>
            run(ids.length > 1 ? `生成 ${ids.length} 段视频` : "生成视频", async (context) => {
                const queue = [...ids];
                const worker = async () => {
                    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
                        if (context.signal?.aborted) return;
                        const document = handle.getDocument();
                        const shot = document.shots.find((item) => item.id === id);
                        if (!shot) continue;
                        patchShot(id, { videoStatus: "running", videoError: "" });
                        try {
                            const result = await replaceShotVideo(document, shot, overrides, context.signal);
                            patchShot(id, (current) => {
                                const videoResults = pushResult(current.videoResults, result.key, result.prompt, result.model);
                                return { videoStatus: "done", videoResults, videoIndex: videoResults.length - 1, useOriginal: false };
                            });
                        } catch (error) {
                            if (isAbort(error)) throw error;
                            patchShot(id, { videoStatus: "failed", videoError: errorText(error) });
                            context.log(`镜头 ${shot.index} 视频生成失败：${errorText(error)}`, "error");
                        }
                    }
                };
                await Promise.all([worker(), worker()]);
            }),
        [handle, patchShot, run],
    );

    // ---------- voice ----------

    const transcribe = useCallback(
        (sourceId: string) =>
            run("分析原片人声", async (context) => {
                const lines = await transcribeSource(handle.getDocument(), sourceId, context);
                update((current) => ({ ...current, lines: [...current.lines.filter((line) => line.sourceId !== sourceId), ...lines] }));
            }),
        [handle, run, update],
    );

    const translate = useCallback(
        (ids: string[], language: string) =>
            run(`翻译成${language}`, async (context) => {
                const document = handle.getDocument();
                const lines = document.lines.filter((line) => ids.includes(line.id));
                if (!lines.length) throw new Error("没有可翻译的句子。");
                const result = await translateLines(document, lines, language, context);
                update((current) => ({ ...current, lines: current.lines.map((line) => (result.has(line.id) ? { ...line, translation: result.get(line.id), audioKey: undefined, status: undefined } : line)) }));
            }),
        [handle, run, update],
    );

    const cloneLines = useCallback(
        (ids: string[]) =>
            run(ids.length > 1 ? `克隆 ${ids.length} 句配音` : "克隆配音", async (context) => {
                for (const id of ids) {
                    if (context.signal?.aborted) return;
                    const document = handle.getDocument();
                    const line = document.lines.find((item) => item.id === id);
                    if (!line) continue;
                    patchLine(id, { status: "running", error: "" });
                    try {
                        patchLine(id, { status: "done", audioKey: await cloneLine(document, line, context.signal) });
                    } catch (error) {
                        if (isAbort(error)) throw error;
                        patchLine(id, { status: "failed", error: errorText(error) });
                        context.log(`配音「${line.text.slice(0, 12)}」失败：${errorText(error)}`, "error");
                    }
                }
            }),
        [handle, patchLine, run],
    );

    const convertSingingLines = useCallback(
        (ids: string[]) =>
            run(ids.length > 1 ? `歌声转换 ${ids.length} 句` : "歌声转换", async (context) => {
                for (const id of ids) {
                    if (context.signal?.aborted) return;
                    const document = handle.getDocument();
                    const line = document.lines.find((item) => item.id === id);
                    if (!line) continue;
                    patchLine(id, { status: "running", error: "" });
                    try {
                        patchLine(id, { status: "done", audioKey: await convertSingingLine(document, line, context.signal) });
                    } catch (error) {
                        if (isAbort(error)) throw error;
                        patchLine(id, { status: "failed", error: errorText(error) });
                        context.log(`歌声转换「${line.text.slice(0, 12)}」失败：${errorText(error)}`, "error");
                    }
                }
            }),
        [handle, patchLine, run],
    );

    const remakeSingingLines = useCallback(
        (ids: string[]) =>
            run(ids.length > 1 ? `改词翻唱 ${ids.length} 句` : "改词翻唱", async (context) => {
                for (const id of ids) {
                    if (context.signal?.aborted) return;
                    const document = handle.getDocument();
                    const line = document.lines.find((item) => item.id === id);
                    if (!line) continue;
                    patchLine(id, { status: "running", error: "" });
                    try {
                        patchLine(id, { status: "done", audioKey: await remakeSingingLine(document, line, context.signal) });
                    } catch (error) {
                        if (isAbort(error)) throw error;
                        patchLine(id, { status: "failed", error: errorText(error) });
                        context.log(`改词翻唱「${(line.translation || line.text).slice(0, 12)}」失败：${errorText(error)}`, "error");
                    }
                }
            }),
        [handle, patchLine, run],
    );

    // ---------- compose / export ----------

    const compose = useCallback(
        () =>
            run("合成全部视频", async (context) => {
                const projectId = handle.project?.id;
                const document = handle.getDocument();
                const first = document.sources.find((source) => source.status === "done");
                if (!projectId || !first) throw new Error("请先加入并处理视频。");
                const shots = orderedShots(document);
                const segments = shots.map((shot) => ({ mediaKey: (!shot.useOriginal && shotVideoKey(shot)) || shot.clipKey, duration: shotDuration(shot) }));
                if (segments.some((item) => !item.mediaKey)) throw new Error("有镜头缺少原片片段，请重新处理视频。");
                const voiced = document.lines.filter((line) => line.audioKey);
                const { offsets } = sourceOffsets(document);
                const volume = document.settings.originalAudioVolume;
                const bedKey = volume > 0 ? await buildBedAudio(document, voiced) : "";
                const setCompose = (patch: Partial<NonNullable<ReplacementStudioDocument["compose"]>>) =>
                    update((current) => ({ ...current, compose: { jobId: "", status: "uploading", message: "", ...current.compose, ...patch } }));
                setCompose({ jobId: "", status: "uploading", message: "正在打包上传", error: "", videoKey: "" });
                try {
                    const jobId = await submitCompose(
                        {
                            width: first.width,
                            height: first.height,
                            fps: 30,
                            segments,
                            audio: bedKey ? { mediaKey: bedKey, volume } : undefined,
                            lines: voiced.map((line) => ({ mediaKey: line.audioKey!, start: (offsets.get(line.sourceId) || 0) + line.startSec, volume: 1 })),
                        },
                        projectId,
                        (ratio) => setCompose({ message: `正在上传 ${Math.round(ratio * 100)}%` }),
                        context.signal,
                    );
                    setCompose({ jobId, status: "pending", message: "排队等待文件机处理" });
                    const result = await waitForCompose(jobId, (status) => setCompose({ status: status.status === "running" ? "running" : "pending", message: status.message }), context.signal);
                    const videoName = result?.files?.video;
                    if (!videoName) throw new Error("合成完成但没有成片文件，请重试。");
                    const videoKey = await downloadStudioJobFile(jobId, videoName, "video", context.signal);
                    const seconds = Number(result.duration);
                    setCompose({ status: "done", message: Number.isFinite(seconds) && seconds > 0 ? `成片 ${seconds.toFixed(1)} 秒` : "成片已生成", videoKey });
                } catch (error) {
                    if (!isAbort(error)) setCompose({ status: "failed", error: errorText(error) });
                    throw error;
                }
            }),
        [handle, run, update],
    );

    const exportMedia = useCallback(async (key: string | undefined, name: string, fallback: string) => {
        if (!key) return message.warning("还没有可导出的内容。");
        const blob = await getStudioMediaBlob(key);
        if (blob) downloadBlob(blob, `${name}.${extensionOf(blob, fallback)}`);
    }, [message]);

    const title = handle.project?.title || "人物替换";
    const exportAll = useCallback(() => run("导出全部素材", async () => exportAllAssets(handle.getDocument(), title)), [handle, run, title]);
    const exportPremiere = useCallback(
        () =>
            run("导出 Premiere 工程", async () => {
                await exportPremiereProject(handle.getDocument(), title);
                message.success("Premiere 工程已导出。请在 Premiere 中选择“文件 → 导入”，打开导出的 .xml 工程文件。");
            }),
        [handle, message, run, title],
    );
    const exportMix = useCallback(() => run("导出替换音频", async () => downloadBlob(await buildReplacementMix(handle.getDocument()), `${title}-替换音频.wav`)), [handle, run, title]);

    /** Mix bed + cloned lines into one WAV; store on compose.audioKey and download. For audio-only projects. */
    const composeMix = useCallback(
        () =>
            run("合成最终音频", async () => {
                const document = handle.getDocument();
                const voiced = document.lines.filter((line) => line.audioKey).length;
                if (!voiced && !document.sources.some((source) => source.audioKey || source.separation?.backgroundKey)) {
                    throw new Error("还没有可合成的内容：请先克隆/改词，或至少保留原声音轨。");
                }
                const setCompose = (patch: Partial<NonNullable<ReplacementStudioDocument["compose"]>>) =>
                    update((current) => ({
                        ...current,
                        step: "compose",
                        compose: { jobId: "", status: "running", message: "", ...current.compose, videoKey: current.compose?.videoKey, ...patch },
                    }));
                setCompose({ status: "running", message: voiced ? `正在混音 ${voiced} 句…` : "正在导出原声床…", error: "", audioKey: "" });
                try {
                    const blob = await buildReplacementMix(handle.getDocument());
                    const audioKey = await saveStudioMedia(blob, "audio");
                    setCompose({ status: "done", message: voiced ? `已合成 ${voiced} 句配音` : "已导出音频", audioKey });
                    downloadBlob(blob, `${title}-最终音频.wav`);
                    message.success("最终音频已合成并下载");
                } catch (error) {
                    if (!isAbort(error)) setCompose({ status: "failed", error: errorText(error), message: "" });
                    throw error;
                }
            }),
        [handle, message, run, title, update],
    );

    const exportPackage = useCallback(() => run("导出项目", async () => downloadBlob(await exportProjectPackage(title, handle.getDocument()), `${title}.zip`)), [handle, run, title]);

    return {
        busy,
        stream,
        cancel,
        update,
        log,
        patchSource,
        patchShot,
        patchCharacter,
        patchLine,
        addSources,
        addAudioSources,
        retrySource,
        recutSource,
        removeSource,
        separateSource,
        reverseShot,
        trimReference,
        generateCharacter,
        describeIdentities,
        replaceImages,
        replaceVideos,
        transcribe,
        translate,
        cloneLines,
        convertSingingLines,
        remakeSingingLines,
        compose,
        composeMix,
        exportMedia,
        exportAll,
        exportPremiere,
        exportMix,
        exportPackage,
        shotImageKey,
    };
}

export type ReplacementRunner = ReturnType<typeof useReplacementRunner>;
