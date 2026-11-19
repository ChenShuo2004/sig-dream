import { useCallback, useRef, useState } from "react";
import { App } from "antd";

import { REPLICATION_PROMPTS } from "@/studios/prompts/replication-policy";
import { analyzeSource } from "@/studios/replication/analysis";
import type { ReplicationSource, ReplicationStudioDocument } from "@/studios/replication/document";
import { importIntakeResult, uploadSourceVideo, waitForIntake } from "@/studios/replication/intake";
import { buildSegmentPlan } from "@/studios/replication/segment-plan";
import { clipPlanRef, extractTextAssets, generateStoryboardBatch, renumberClips, repairStoryboard, replicationAssetImagePrompt, reviewStoryboard, targetVisualStyle, type StageContext } from "@/studios/replication/stages";
import { DEFAULT_IMAGE_CONCURRENCY, DEFAULT_VIDEO_CONCURRENCY, resolveMediaConcurrency } from "@/studios/script/document";
import { generateAppearanceImage, generateClipVideo, syncScriptToCanvas } from "@/studios/script/media-jobs";
import { buildClipVideoPrompt } from "@/studios/script/video-prompt";
import type { StudioClip } from "@/studios/types";
import type { StudioProjectHandle } from "@/studios/use-studio-project";

type Handle = StudioProjectHandle<ReplicationStudioDocument>;
const STORYBOARD_BATCH = 4;

function isAbort(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
}

async function runConcurrentQueue<T>(queue: T[], concurrency: number, worker: (item: T) => Promise<void>, signal?: AbortSignal) {
    const n = Math.max(1, Math.min(concurrency, Math.max(queue.length, 1)));
    await Promise.all(
        Array.from({ length: n }, async () => {
            for (;;) {
                if (signal?.aborted) return;
                const item = queue.shift();
                if (item === undefined) return;
                await worker(item);
            }
        }),
    );
}

function withMeta(document: ReplicationStudioDocument): ReplicationStudioDocument {
    const clipCount = document.clips.length;
    const stage = clipCount ? "storyboard" : document.assets.length ? "assets" : document.analysis ? "analysis" : "source";
    const stageLabel = clipCount ? "分镜与视频" : document.assets.length ? "素材设定" : document.analysis ? "原片分析" : document.source?.status === "done" ? "已切镜" : "未开始";
    return { ...document, meta: { ...document.meta, stage, stageLabel, clipCount } };
}

export function clipVideoPrompt(document: ReplicationStudioDocument, clip: StudioClip) {
    const visualStyle = targetVisualStyle(document) || clip.shots.find((shot) => shot.sceneVisualStyle)?.sceneVisualStyle || "";
    return buildClipVideoPrompt({ clip, assets: document.assets, promptMode: document.settings.promptMode, visualStyle, constraints: REPLICATION_PROMPTS.videoExecutionConstraints });
}

function withPrompts(document: ReplicationStudioDocument, clips: StudioClip[]) {
    return clips.map((clip) => (clip.promptEdited && clip.prompt ? clip : { ...clip, prompt: clipVideoPrompt(document, clip) }));
}

export function useReplicationRunner(handle: Handle) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState("");
    const [stream, setStream] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const busyRef = useRef("");

    const update = useCallback((mutate: (document: ReplicationStudioDocument) => ReplicationStudioDocument) => handle.update((document) => withMeta(mutate(document))), [handle]);

    const log = useCallback(
        (text: string, level: "info" | "warn" | "error" = "info") =>
            handle.update((document) => ({ ...document, logs: [...document.logs.slice(-199), { at: new Date().toISOString(), stage: busyRef.current, message: text, level }] })),
        [handle],
    );

    const run = useCallback(
        async (label: string, task: (context: StageContext) => Promise<void>) => {
            if (busyRef.current) {
                message.warning(`正在执行：${busyRef.current}`);
                return;
            }
            const controller = new AbortController();
            abortRef.current = controller;
            busyRef.current = label;
            setBusy(label);
            setStream("");
            const context: StageContext = { signal: controller.signal, log, onDelta: (delta) => setStream((current) => (current + delta).slice(-4000)) };
            try {
                await task(context);
                log(`${label}完成`);
            } catch (error) {
                if (isAbort(error) || controller.signal.aborted) {
                    log(`${label}已取消`, "warn");
                } else {
                    const text = error instanceof Error ? error.message : String(error);
                    log(`${label}失败：${text}`, "error");
                    message.error(text);
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

    const patchSource = useCallback((patch: Partial<ReplicationSource>) => update((current) => ({ ...current, source: current.source ? { ...current.source, ...patch } : null })), [update]);

    const finishIntake = useCallback(
        async (jobId: string, context: StageContext) => {
            const result = await waitForIntake(
                jobId,
                (status) => patchSource({ status: status.status === "running" ? "running" : "pending", message: status.message || (status.status === "running" ? "文件机正在转码和切镜" : "排队等待文件机处理") }),
                context.signal,
            );
            const imported = await importIntakeResult(jobId, result, (done, total) => patchSource({ message: `导入切镜结果 ${done}/${total}` }), context.signal);
            patchSource({ ...imported, status: "done", message: `${imported.shots?.length || 0} 个镜头${imported.truncated ? `，原片 ${Math.round(imported.sourceDurationSec || 0)} 秒，只取前 ${Math.round(imported.durationSec || 0)} 秒` : ""}` });
            if (imported.truncated) context.log("原片超过 180 秒，只处理了前 180 秒。", "warn");
        },
        [patchSource],
    );

    const uploadSource = useCallback(
        (file: File) =>
            run("上传原片", async (context) => {
                const projectId = handle.project?.id;
                if (!projectId) throw new Error("项目尚未加载。");
                update((current) => ({
                    ...current,
                    source: { fileName: file.name, jobId: "", status: "uploading", message: "正在上传", durationSec: 0, sourceDurationSec: 0, truncated: false, width: 0, height: 0, fps: 0, videoKey: "", audioKey: "", shots: [] },
                    analysis: null,
                    segmentPlan: [],
                    clips: [],
                    reviews: [],
                }));
                try {
                    const jobId = await uploadSourceVideo(file, projectId, (ratio) => patchSource({ message: `正在上传 ${Math.round(ratio * 100)}%` }), context.signal);
                    patchSource({ jobId, status: "pending", message: "排队等待文件机处理" });
                    await handle.flush();
                    await finishIntake(jobId, context);
                } catch (error) {
                    if (!isAbort(error)) patchSource({ status: "failed", error: error instanceof Error ? error.message : String(error) });
                    throw error;
                }
            }),
        [finishIntake, handle, patchSource, run, update],
    );

    const resumeIntake = useCallback(
        () =>
            run("读取切镜结果", async (context) => {
                const jobId = handle.getDocument().source?.jobId;
                if (!jobId) throw new Error("没有进行中的原片任务，请重新上传。");
                try {
                    await finishIntake(jobId, context);
                } catch (error) {
                    if (!isAbort(error)) patchSource({ status: "failed", error: error instanceof Error ? error.message : String(error) });
                    throw error;
                }
            }),
        [finishIntake, handle, patchSource, run],
    );

    const replan = useCallback(
        () =>
            update((current) => {
                if (!current.analysis || !current.source) return current;
                return { ...current, segmentPlan: buildSegmentPlan(current.analysis, { durationSec: current.source.durationSec, maxSeconds: current.settings.clipMaxSeconds, promptMode: current.settings.promptMode }) };
            }),
        [update],
    );

    const analyze = useCallback(
        () =>
            run("分析原片", async (context) => {
                const document = handle.getDocument();
                if (!document.source || document.source.status !== "done") throw new Error("请先上传原片并等待切镜完成。");
                const analysis = await analyzeSource(document.settings, document.source, context);
                update((current) => ({ ...current, analysis, contentType: analysis.contentType, assets: [], characterBindings: {}, clips: [], reviews: [], step: "analysis" }));
                replan();
            }),
        [handle, replan, run, update],
    );

    const extract = useCallback(
        () =>
            run("整理素材", async (context) => {
                const { assets, bindings } = await extractTextAssets(handle.getDocument(), context);
                update((current) => ({ ...current, assets, characterBindings: bindings, step: "assets" }));
            }),
        [handle, run, update],
    );

    const generateImages = useCallback(
        (targets: Array<{ assetId: string; appearanceId: string }>) =>
            run(targets.length > 1 ? `生成 ${targets.length} 张素材图` : "生成素材图", async (context) => {
                const setStatus = (assetId: string, appearanceId: string, patch: Record<string, unknown>) =>
                    update((current) => ({
                        ...current,
                        assets: current.assets.map((asset) => (asset.id === assetId ? { ...asset, appearances: asset.appearances.map((look) => (look.id === appearanceId ? { ...look, ...patch } : look)) } : asset)),
                    }));
                const queue = [...targets];
                const concurrency = resolveMediaConcurrency(undefined, DEFAULT_IMAGE_CONCURRENCY);
                context.log(`生图并发 ${concurrency}，共 ${targets.length} 张`);
                await runConcurrentQueue(
                    queue,
                    concurrency,
                    async (target) => {
                        const document = handle.getDocument();
                        const asset = document.assets.find((item) => item.id === target.assetId);
                        const look = asset?.appearances.find((item) => item.id === target.appearanceId);
                        if (!asset || !look) return;
                        setStatus(asset.id, look.id, { imageStatus: "running", imageError: "" });
                        try {
                            const imageKey = await generateAppearanceImage(document.settings, asset, look, context.signal, replicationAssetImagePrompt(document, asset, look));
                            setStatus(asset.id, look.id, { imageStatus: "done", imageKey });
                        } catch (error) {
                            if (isAbort(error)) throw error;
                            const text = error instanceof Error ? error.message : String(error);
                            setStatus(asset.id, look.id, { imageStatus: "failed", imageError: text });
                            context.log(`「${asset.name}」图片生成失败：${text}`, "error");
                        }
                    },
                    context.signal,
                );
            }),
        [handle, run, update],
    );

    const mergeClips = useCallback(
        (next: StudioClip[]) =>
            update((current) => {
                const byRef = new Map(current.clips.map((clip) => [clipPlanRef(clip), clip]));
                for (const clip of next) byRef.set(clipPlanRef(clip), clip);
                const ordered = current.segmentPlan.flatMap((plan) => (byRef.has(plan.ref) ? [byRef.get(plan.ref)!] : []));
                return { ...current, clips: renumberClips(ordered) };
            }),
        [update],
    );

    const generateStoryboard = useCallback(
        (refs?: string[]) =>
            run(refs?.length === 1 ? `重新生成 ${refs[0]} 分镜` : "生成分镜", async (context) => {
                const start = handle.getDocument();
                if (!start.analysis || !start.segmentPlan.length) throw new Error("请先完成原片分析。");
                const plan = refs ? start.segmentPlan.filter((clip) => refs.includes(clip.ref)) : start.segmentPlan;
                if (!refs) update((current) => ({ ...current, clips: [], reviews: [] }));
                for (let index = 0; index < plan.length; index += STORYBOARD_BATCH) {
                    const batch = plan.slice(index, index + STORYBOARD_BATCH);
                    const generated = await generateStoryboardBatch(handle.getDocument(), batch, context);
                    update((current) => ({ ...current, contentType: current.contentType === "unknown" ? generated.contentType : current.contentType }));
                    mergeClips(generated.clips);
                    if (!handle.getDocument().settings.autoReview) continue;
                    const assessments = await reviewStoryboard(handle.getDocument(), generated.clips, context);
                    mergeClips(
                        generated.clips.map((clip) => {
                            const assessment = assessments.find((item) => item.clipRef === clipPlanRef(clip));
                            return assessment ? { ...clip, review: { verdict: assessment.verdict, issues: assessment.issues } } : clip;
                        }),
                    );
                    const failed = assessments.filter((item) => item.verdict === "repair");
                    let repaired: string[] = [];
                    if (failed.length) {
                        const fixed = await repairStoryboard(handle.getDocument(), assessments, context);
                        mergeClips(fixed.map((clip) => ({ ...clip, review: { verdict: "repair" as const, issues: failed.find((item) => item.clipRef === clipPlanRef(clip))?.issues || [] } })));
                        repaired = fixed.map(clipPlanRef);
                    }
                    update((current) => ({ ...current, reviews: [...current.reviews, { at: new Date().toISOString(), clipRefs: batch.map((clip) => clip.ref), repaired, issues: failed.reduce((sum, item) => sum + item.issues.length, 0) }] }));
                }
                update((current) => ({ ...current, clips: withPrompts(current, current.clips), step: "storyboard" }));
            }),
        [handle, mergeClips, run, update],
    );

    const rebuildPrompts = useCallback(
        (clipIds?: string[]) =>
            update((current) => ({
                ...current,
                clips: withPrompts(
                    current,
                    current.clips.map((clip) => (!clipIds || clipIds.includes(clip.id) ? { ...clip, promptEdited: false } : clip)),
                ),
            })),
        [update],
    );

    const generateVideos = useCallback(
        (clipIds: string[]) =>
            run(clipIds.length > 1 ? `生成 ${clipIds.length} 段视频` : "生成视频", async (context) => {
                const setClip = (clipId: string, patch: Partial<StudioClip>) => update((current) => ({ ...current, clips: current.clips.map((entry) => (entry.id === clipId ? { ...entry, ...patch } : entry)) }));
                const queue = [...clipIds];
                const videoModel = handle.getDocument().settings.videoModel || "";
                const volcanoSeedance = /volcengine|ark\.cn-beijing|doubao-seedance/i.test(videoModel);
                const concurrency = volcanoSeedance ? Math.min(3, resolveMediaConcurrency(undefined, DEFAULT_VIDEO_CONCURRENCY)) : resolveMediaConcurrency(undefined, DEFAULT_VIDEO_CONCURRENCY);
                context.log(volcanoSeedance ? `生视频并发 ${concurrency}（火山 Seedance 最多 3 个），共 ${clipIds.length} 段` : `生视频并发 ${concurrency}，共 ${clipIds.length} 段`);
                await runConcurrentQueue(
                    queue,
                    concurrency,
                    async (clipId) => {
                        const document = handle.getDocument();
                        const clip = document.clips.find((item) => item.id === clipId);
                        if (!clip) return;
                        const prompt = clip.prompt || clipVideoPrompt(document, clip);
                        setClip(clipId, { videoStatus: "running", videoError: "", prompt });
                        try {
                            const videoKey = await generateClipVideo(document.settings, clip, document.assets, prompt, context.signal);
                            setClip(clipId, { videoStatus: "done", videoKey });
                        } catch (error) {
                            if (isAbort(error)) throw error;
                            const text = error instanceof Error ? error.message : String(error);
                            setClip(clipId, { videoStatus: "failed", videoError: text });
                            context.log(`第 ${clip.number} 段视频生成失败：${text}`, "error");
                        }
                    },
                    context.signal,
                );
            }),
        [handle, run, update],
    );

    const syncCanvas = useCallback(async () => {
        let canvasId = "";
        await run("同步到画布", async () => {
            const document = handle.getDocument();
            canvasId = await syncScriptToCanvas(handle.project?.title || "复刻工作室", { assets: document.assets, episodes: [{ number: 1, clips: document.clips }] });
        });
        return canvasId;
    }, [handle, run]);

    return { busy, stream, cancel, update, uploadSource, resumeIntake, analyze, replan, extract, generateImages, generateStoryboard, rebuildPrompts, generateVideos, syncCanvas };
}

export type ReplicationRunner = ReturnType<typeof useReplicationRunner>;
