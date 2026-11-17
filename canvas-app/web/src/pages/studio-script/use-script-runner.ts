import { useCallback, useRef, useState } from "react";
import { App } from "antd";

import type { StageReviewOutcome } from "@/studios/runtime/stage-review";
import type { ScriptStudioDocument, StageReviewRecord } from "@/studios/script/document";
import { DEFAULT_IMAGE_CONCURRENCY, DEFAULT_VIDEO_CONCURRENCY, resolveMediaConcurrency, shouldDigestSource } from "@/studios/script/document";
import { importUploadedEpisodes } from "@/studios/script/import-uploaded";
import { applyAppearanceImage } from "@/studios/script/appearance-images";
import { downloadStudioClipVideo, generateAppearanceImage, generateClipVideo, syncScriptToCanvas } from "@/studios/script/media-jobs";
import {
    adjustClipPrompt,
    applyAssetPromptPreset,
    digestSource,
    extractAssets,
    generateEpisodeScript,
    generateOutline,
    generateSummary,
    repairEpisodeSplit,
    reviseAppearancePromptForError,
    reviseEpisodeScriptContent,
    reviewEpisodeScript,
    reviewEpisodeSplit,
    reviewOutline,
    reviewSummary,
    splitEpisode,
    validateSettings,
    visualStyleText,
    type StageContext,
} from "@/studios/script/stages";
import { translateMinimaxH3Prompt } from "@/lib/minimax-h3-prompt";
import { assertClipReadyForVideo, bindClipAppearanceRefs, buildClipVideoPrompt } from "@/studios/script/video-prompt";
import type { StudioClip, StudioEpisode } from "@/studios/types";
import type { StudioProjectHandle } from "@/studios/use-studio-project";
import { useConfigStore } from "@/stores/use-config-store";

type Handle = StudioProjectHandle<ScriptStudioDocument>;

function isAbort(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
}

type ImageGenTarget = { assetId: string; appearanceId: string; presetId?: string };
type VideoGenTarget = { episodeId: string; clipId: string };

/** Drain a shared mutable queue with up to `concurrency` workers (safe to push more items while running). */
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

function withMeta(document: ScriptStudioDocument): ScriptStudioDocument {
    const clipCount = document.episodes.reduce((sum, episode) => sum + episode.clips.length, 0);
    const stage = clipCount ? "episodes" : document.assets.length ? "assets" : "script";
    const stageLabel = clipCount ? "分集视频" : document.assets.length ? "素材设定" : document.episodes.some((episode) => episode.script) ? "剧本" : document.summary ? "大纲" : "未开始";
    return { ...document, sourceDigests: document.sourceDigests || [], meta: { ...document.meta, stage, stageLabel, episodeCount: document.episodes.length, clipCount } };
}

function reviewRecord(stage: string, outcome: StageReviewOutcome, targetId?: string): StageReviewRecord {
    return { stage, verdict: outcome.verdict, issues: outcome.issues, rounds: outcome.reviewRounds, at: new Date().toISOString(), targetId, confirmed: outcome.verdict === "pass" };
}

export function buildPrompts(document: ScriptStudioDocument, episode: StudioEpisode): StudioClip[] {
    return episode.clips.map((clip) =>
        clip.promptEdited && clip.prompt ? clip : { ...clip, prompt: buildClipVideoPrompt({ clip, assets: document.assets, promptMode: document.settings.promptMode, visualStyle: visualStyleText(document.settings) }) },
    );
}

export function useScriptRunner(handle: Handle) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState("");
    const [stream, setStream] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const busyRef = useRef("");
    /** Live queues so extra 生图/生视频 clicks can append while workers are still running. */
    const imageQueueRef = useRef<ImageGenTarget[] | null>(null);
    const videoQueueRef = useRef<VideoGenTarget[] | null>(null);
    const imageEnqueuedRef = useRef(0);
    const videoEnqueuedRef = useRef(0);

    const update = useCallback((mutate: (document: ScriptStudioDocument) => ScriptStudioDocument) => handle.update((document) => withMeta(mutate(document))), [handle]);

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

    const writeEpisodeScript = useCallback(
        async (index: number, context: StageContext) => {
            const document = handle.getDocument();
            const summary = document.summary;
            if (!summary) throw new Error("请先生成剧本摘要和分集大纲。");
            const script = await generateEpisodeScript(document.settings, summary, document.storyFacts, document.episodes, index, context);
            const episodeId = document.episodes[index].id;
            update((current) => ({
                ...current,
                episodes: current.episodes.map((episode) => (episode.id === episodeId ? { ...episode, title: script.title || episode.title, script: { scenes: script.scenes, continuityFacts: script.continuityFacts, endingState: script.endingState } } : episode)),
            }));
            if (handle.getDocument().settings.autoReview) {
                const outcome = await reviewEpisodeScript(
                    document.settings,
                    summary,
                    handle.getDocument,
                    episodeId,
                    (episode) => update((current) => ({ ...current, episodes: current.episodes.map((item) => (item.id === episode.id ? episode : item)) })),
                    context,
                );
                update((current) => ({ ...current, reviews: [...current.reviews, reviewRecord(`第${index + 1}集剧本`, outcome, episodeId)] }));
                if (outcome.verdict !== "pass") log(`第 ${index + 1} 集剧本审核结果：${outcome.verdict === "needs_confirmation" ? "需要确认" : "仍有问题"}，请人工查看。`, "warn");
            }
        },
        [handle, log, update],
    );

    const generateStory = useCallback(
        (from: "summary" | "outline" | "scripts" = "summary") =>
            run(from === "summary" ? "生成剧本" : from === "outline" ? "重新生成大纲和剧本" : "生成分集剧本", async (context) => {
                const settings = handle.getDocument().settings;
                const invalid = validateSettings(settings);
                if (invalid) throw new Error(invalid);

                // SHUO upload-original: local chapter parse → keep original as scripts → extract assets (no AI expansion).
                if (settings.sourceMode === "upload" && from === "summary") {
                    const episodes = importUploadedEpisodes(settings);
                    update((current) => ({ ...current, summary: null, storyFacts: [], sourceDigests: [], episodes, reviews: [], assets: [] }));
                    context.log(`已按原剧本结构导入 ${episodes.length} 集，正文未扩写`);
                    const assets = await extractAssets(settings, handle.project?.title || settings.fileName || "上传剧本", episodes, context);
                    update((current) => ({ ...current, assets, step: "assets" }));
                    return;
                }
                if (settings.sourceMode === "upload") {
                    throw new Error("上传剧本保持原稿，不支持 AI 扩写分集正文。如需改写请用「快速创作」。");
                }

                if (from === "summary") {
                    let digests = handle.getDocument().sourceDigests || [];
                    if (shouldDigestSource(settings)) {
                        digests = await digestSource(settings, context);
                        update((current) => ({ ...current, sourceDigests: digests }));
                    } else {
                        update((current) => ({ ...current, sourceDigests: [] }));
                        digests = [];
                    }
                    const summary = await generateSummary(settings, context, digests);
                    update((current) => ({ ...current, summary, storyFacts: [], episodes: [], reviews: [] }));
                    if (settings.autoReview) {
                        const outcome = await reviewSummary(settings, () => handle.getDocument().summary!, (next) => update((current) => ({ ...current, summary: next })), context);
                        update((current) => ({ ...current, reviews: [...current.reviews, reviewRecord("剧本摘要", outcome, "summary")] }));
                    }
                }
                if (from !== "scripts") {
                    const summary = handle.getDocument().summary;
                    if (!summary) throw new Error("请先生成剧本摘要。");
                    const outline = await generateOutline(settings, summary, context);
                    update((current) => ({ ...current, storyFacts: outline.storyFacts, episodes: outline.episodes }));
                    if (settings.autoReview) {
                        const outcome = await reviewOutline(settings, summary, handle.getDocument, (episodes) => update((current) => ({ ...current, episodes })), context);
                        update((current) => ({ ...current, reviews: [...current.reviews, reviewRecord("分集大纲", outcome, "outline")] }));
                    }
                }
                const total = handle.getDocument().episodes.length;
                for (let index = 0; index < total; index += 1) {
                    if (from === "scripts" && handle.getDocument().episodes[index].script) continue;
                    await writeEpisodeScript(index, context);
                }
            }),
        [handle, run, update, writeEpisodeScript],
    );

    const regenerateEpisode = useCallback((index: number) => run(`重写第 ${index + 1} 集剧本`, (context) => writeEpisodeScript(index, context)), [run, writeEpisodeScript]);

    const confirmReview = useCallback(
        (at: string) =>
            update((current) => ({
                ...current,
                reviews: current.reviews.map((review) => (review.at === at ? { ...review, confirmed: true, verdict: review.verdict === "needs_confirmation" ? "pass" : review.verdict } : review)),
            })),
        [update],
    );

    const reviseEpisodeFromReview = useCallback(
        (episodeId: string) =>
            run("按审核意见修订剧本", async (context) => {
                const document = handle.getDocument();
                const summary = document.summary;
                const episode = document.episodes.find((item) => item.id === episodeId);
                const review = [...document.reviews].reverse().find((item) => item.targetId === episodeId && item.verdict === "needs_confirmation" && !item.confirmed);
                if (!summary || !episode?.script) throw new Error("找不到可修订的分集剧本。");
                if (!review?.issues.length) throw new Error("没有待处理的审核意见。");
                const script = await reviseEpisodeScriptContent(document.settings, summary, document.storyFacts, episode, review.issues, context);
                update((current) => ({
                    ...current,
                    episodes: current.episodes.map((item) => (item.id === episodeId ? { ...item, title: script.title || item.title, script: { scenes: script.scenes, continuityFacts: script.continuityFacts, endingState: script.endingState } } : item)),
                    reviews: current.reviews.map((item) => (item.at === review.at ? { ...item, confirmed: true, verdict: "pass" as const } : item)),
                }));
            }),
        [handle, run, update],
    );

    const extract = useCallback(
        () =>
            run("提取素材", async (context) => {
                const document = handle.getDocument();
                const assets = await extractAssets(document.settings, document.summary?.title || handle.project?.title || "", document.episodes, context);
                update((current) => ({ ...current, assets, step: "assets" }));
            }),
        [handle, run, update],
    );

    const markImagesRunning = useCallback(
        (targets: ImageGenTarget[]) => {
            if (!targets.length) return;
            const keys = new Set(targets.map((item) => `${item.assetId}:${item.appearanceId}`));
            update((current) => ({
                ...current,
                assets: current.assets.map((asset) => ({
                    ...asset,
                    appearances: asset.appearances.map((look) => (keys.has(`${asset.id}:${look.id}`) ? { ...look, imageStatus: "running" as const, imageError: "" } : look)),
                })),
            }));
        },
        [update],
    );

    const generateImages = useCallback(
        (targets: ImageGenTarget[]) => {
            if (!targets.length) return;
            const targetKey = (item: ImageGenTarget) => `${item.assetId}:${item.appearanceId}`;
            if (imageQueueRef.current) {
                const seen = new Set(imageQueueRef.current.map(targetKey));
                const addedTargets: ImageGenTarget[] = [];
                for (const target of targets) {
                    if (seen.has(targetKey(target))) continue;
                    seen.add(targetKey(target));
                    imageQueueRef.current.push(target);
                    imageEnqueuedRef.current += 1;
                    addedTargets.push(target);
                }
                // Always refresh running state for clicked targets (incl. re-queue / already queued).
                markImagesRunning(targets);
                if (addedTargets.length) {
                    message.success(`已追加 ${addedTargets.length} 张到生图队列（并发进行中）`);
                    setBusy(`生成素材图 · 队列 ${imageQueueRef.current.length}`);
                    busyRef.current = `生成素材图 · 队列 ${imageQueueRef.current.length}`;
                } else {
                    message.info("这些素材已在生图队列中");
                }
                return;
            }
            if (busyRef.current) {
                message.warning(`正在执行：${busyRef.current}`);
                return;
            }
            const total = targets.length;
            const queue = [...targets];
            imageQueueRef.current = queue;
            imageEnqueuedRef.current = total;
            markImagesRunning(targets);
            void run(total > 1 ? `生成 ${total} 张素材图` : "生成素材图", async (context) => {
                const setStatus = (assetId: string, appearanceId: string, patch: Record<string, unknown>) =>
                    update((current) => ({
                        ...current,
                        assets: current.assets.map((asset) => (asset.id === assetId ? { ...asset, appearances: asset.appearances.map((look) => (look.id === appearanceId ? { ...look, ...patch } : look)) } : asset)),
                    }));
                try {
                    const concurrency = resolveMediaConcurrency(handle.getDocument().settings.imageConcurrency, DEFAULT_IMAGE_CONCURRENCY);
                    context.log(`生图并发 ${concurrency}，共 ${total} 张`);
                    do {
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
                                    const body = target.presetId && target.presetId !== "none" ? applyAssetPromptPreset(target.presetId, asset.kind, look.prompt) : look.prompt;
                                    const imageKey = await generateAppearanceImage(document.settings, asset, look, context.signal, body);
                                    update((current) => ({
                                        ...current,
                                        assets: current.assets.map((item) =>
                                            item.id === asset.id
                                                ? {
                                                      ...item,
                                                      appearances: item.appearances.map((entry) => (entry.id === look.id ? applyAppearanceImage(entry, imageKey) : entry)),
                                                  }
                                                : item,
                                        ),
                                    }));
                                } catch (error) {
                                    if (isAbort(error)) throw error;
                                    const text = error instanceof Error ? error.message : String(error);
                                    setStatus(asset.id, look.id, { imageStatus: "failed", imageError: text });
                                    context.log(`「${asset.name}」图片生成失败：${text}`, "error");
                                }
                            },
                            context.signal,
                        );
                    } while (queue.length && !context.signal?.aborted);
                } finally {
                    imageQueueRef.current = null;
                }
            });
        },
        [handle, markImagesRunning, message, run, update],
    );

    const splitEpisodes = useCallback(
        (episodeIds: string[]) =>
            run(episodeIds.length > 1 ? "拆分全部分镜" : "拆分分镜", async (context) => {
                for (const episodeId of episodeIds) {
                    const document = handle.getDocument();
                    const episode = document.episodes.find((item) => item.id === episodeId);
                    if (!episode) continue;
                    let clips = await splitEpisode(document.settings, episode, document.assets, context);
                    const replaceClips = (next: StudioClip[]) => update((current) => ({ ...current, episodes: current.episodes.map((item) => (item.id === episodeId ? { ...item, clips: next } : item)) }));
                    replaceClips(clips);
                    if (document.settings.autoReview) {
                        const reviewed = handle.getDocument().episodes.find((item) => item.id === episodeId)!;
                        const assessments = await reviewEpisodeSplit(document.settings, reviewed, document.assets, context);
                        clips = clips.map((clip) => {
                            const assessment = assessments.find((item) => item.clipRef === clip.id);
                            return assessment ? { ...clip, review: { verdict: assessment.verdict, issues: assessment.issues } } : clip;
                        });
                        replaceClips(clips);
                        if (assessments.some((item) => item.verdict === "repair")) {
                            clips = await repairEpisodeSplit(document.settings, { ...reviewed, clips }, document.assets, assessments, context);
                            replaceClips(clips);
                        }
                    }
                    if (document.settings.characterRefExperiment) {
                        const characters = document.assets.filter((asset) => asset.kind === "character" && asset.appearances.some((look) => look.imageKey));
                        clips = clips.map((clip) => {
                            const mentioned = characters.filter(
                                (character) =>
                                    clip.assetRefs.includes(character.id) ||
                                    clip.prompt.includes(character.name) ||
                                    clip.shots.some((shot) => shot.visual.includes(character.name) || shot.dialogue.includes(character.name) || shot.voiceover.includes(character.name)),
                            );
                            const refs = mentioned.length ? mentioned : characters.slice(0, 2);
                            const assetRefs = [...new Set([...clip.assetRefs, ...refs.map((item) => item.id)])];
                            return bindClipAppearanceRefs({ ...clip, assetRefs }, document.assets);
                        });
                        replaceClips(clips);
                        context.log("已按人物参考绑定角色形象到分镜");
                    }
                    // Always point bound character/scene/prop at appearances that already have images.
                    clips = clips.map((clip) => bindClipAppearanceRefs(clip, document.assets));
                    replaceClips(clips);
                    const latest = handle.getDocument();
                    replaceClips(buildPrompts(latest, latest.episodes.find((item) => item.id === episodeId)!));
                }
                update((current) => ({ ...current, step: "episodes" }));
            }),
        [handle, run, update],
    );

    const rebuildPrompts = useCallback(
        (episodeId: string, force = false) =>
            update((current) => ({
                ...current,
                episodes: current.episodes.map((episode) => {
                    if (episode.id !== episodeId) return episode;
                    const clips = force ? episode.clips.map((clip) => ({ ...clip, promptEdited: false })) : episode.clips;
                    return { ...episode, clips: buildPrompts(current, { ...episode, clips }) };
                }),
            })),
        [update],
    );

    const adjustClip = useCallback(
        (episodeId: string, clipId: string, instruction: string) =>
            run("AI 调整提示词", async (context) => {
                const document = handle.getDocument();
                const episode = document.episodes.find((item) => item.id === episodeId);
                const clip = episode?.clips.find((item) => item.id === clipId);
                if (!episode || !clip) return;
                const prompt = await adjustClipPrompt(document.settings, document.summary, episode, clip, instruction, context);
                update((current) => ({
                    ...current,
                    episodes: current.episodes.map((item) => (item.id === episodeId ? { ...item, clips: item.clips.map((entry) => (entry.id === clipId ? { ...entry, prompt, promptEdited: true } : entry)) } : item)),
                }));
            }),
        [handle, run, update],
    );

    const reviseAppearancePrompt = useCallback(
        (assetId: string, appearanceId: string) =>
            run("按错误改提示词", async (context) => {
                const document = handle.getDocument();
                const asset = document.assets.find((item) => item.id === assetId);
                const look = asset?.appearances.find((item) => item.id === appearanceId);
                if (!asset || !look) throw new Error("找不到要改写的形象。");
                if (!look.imageError?.trim()) throw new Error("没有生图错误信息，无法按错误改写。");
                const prompt = await reviseAppearancePromptForError(document.settings, asset, look, look.imageError, context);
                update((current) => ({
                    ...current,
                    assets: current.assets.map((item) =>
                        item.id === assetId
                            ? {
                                  ...item,
                                  appearances: item.appearances.map((entry) =>
                                      entry.id === appearanceId ? { ...entry, prompt, imageStatus: "idle" as const, imageError: "" } : entry,
                                  ),
                              }
                            : item,
                    ),
                }));
                context.log(`「${asset.name}」提示词已按审核错误改写，可重新生成`);
            }),
        [handle, run, update],
    );

    const processVideoTarget = useCallback(
        async (target: VideoGenTarget, context: StageContext) => {
            const setClip = (clipId: string, patch: Partial<StudioClip>) =>
                update((current) => ({
                    ...current,
                    episodes: current.episodes.map((item) => (item.id === target.episodeId ? { ...item, clips: item.clips.map((entry) => (entry.id === clipId ? { ...entry, ...patch } : entry)) } : item)),
                }));
            const document = handle.getDocument();
            const episode = document.episodes.find((item) => item.id === target.episodeId);
            const clip = episode?.clips.find((item) => item.id === target.clipId);
            if (!episode || !clip) return;
            const ready = bindClipAppearanceRefs(clip, document.assets);
            try {
                assertClipReadyForVideo(ready, document.assets);
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                setClip(target.clipId, { videoStatus: "failed", videoError: text, appearanceRefs: ready.appearanceRefs });
                context.log(`第${episode.number}集第 ${clip.number} 段未就绪：${text}`, "error");
                return;
            }
            let prompt =
                ready.promptEdited && ready.prompt.trim()
                    ? ready.prompt
                    : buildClipVideoPrompt({ clip: ready, assets: document.assets, promptMode: document.settings.promptMode, visualStyle: visualStyleText(document.settings) });
            // H3 pair: always submit English. If Chinese was edited last, sync first.
            if (ready.promptH3En?.trim() && ready.promptH3Zh?.trim()) {
                if (ready.promptH3Dirty === "zh") {
                    const textModel = document.settings.textModel || useConfigStore.getState().config.textModel || useConfigStore.getState().config.model;
                    if (!textModel) throw new Error("请先在设置里选择文本模型");
                    const en = await translateMinimaxH3Prompt({
                        source: ready.promptH3Zh,
                        from: "zh",
                        to: "en",
                        textModel,
                        signal: context.signal,
                    });
                    setClip(target.clipId, { promptH3En: en, promptH3Dirty: undefined });
                    prompt = en;
                } else {
                    prompt = ready.promptH3En.trim();
                }
            }
            setClip(target.clipId, { videoStatus: "running", videoError: "", prompt: ready.promptH3Zh || prompt, appearanceRefs: ready.appearanceRefs, promptEdited: ready.promptEdited });
            try {
                const videoKey = await generateClipVideo(document.settings, { ...ready, prompt }, document.assets, prompt, context.signal);
                setClip(target.clipId, { videoStatus: "done", videoKey });
            } catch (error) {
                if (isAbort(error)) throw error;
                const text = error instanceof Error ? error.message : String(error);
                setClip(target.clipId, { videoStatus: "failed", videoError: text });
                context.log(`第${episode.number}集第 ${clip.number} 段视频生成失败：${text}`, "error");
            }
        },
        [handle, update],
    );

    const enqueueOrRunVideos = useCallback(
        (targets: VideoGenTarget[], label: string) => {
            if (!targets.length) return;
            const targetKey = (item: VideoGenTarget) => `${item.episodeId}:${item.clipId}`;
            if (videoQueueRef.current) {
                const seen = new Set(videoQueueRef.current.map(targetKey));
                let added = 0;
                for (const target of targets) {
                    if (seen.has(targetKey(target))) continue;
                    seen.add(targetKey(target));
                    videoQueueRef.current.push(target);
                    videoEnqueuedRef.current += 1;
                    added += 1;
                }
                if (added) {
                    message.success(`已追加 ${added} 段到生视频队列（并发进行中）`);
                    setBusy(`生成视频 · 队列 ${videoQueueRef.current.length}`);
                    busyRef.current = `生成视频 · 队列 ${videoQueueRef.current.length}`;
                } else {
                    message.info("这些片段已在生视频队列中");
                }
                return;
            }
            if (busyRef.current) {
                message.warning(`正在执行：${busyRef.current}`);
                return;
            }
            const queue = [...targets];
            videoQueueRef.current = queue;
            videoEnqueuedRef.current = targets.length;
            void run(label, async (context) => {
                try {
                    const requested = resolveMediaConcurrency(handle.getDocument().settings.videoConcurrency, DEFAULT_VIDEO_CONCURRENCY);
                    const videoModel = handle.getDocument().settings.videoModel || "";
                    const volcanoSeedance = /volcengine|ark\.cn-beijing|doubao-seedance/i.test(videoModel);
                    const concurrency = volcanoSeedance ? Math.min(3, requested) : requested;
                    context.log(volcanoSeedance ? `生视频并发 ${concurrency}（火山 Seedance 最多 3 个），共 ${targets.length} 段` : `生视频并发 ${concurrency}，共 ${targets.length} 段`);
                    do {
                        await runConcurrentQueue(queue, concurrency, (target) => processVideoTarget(target, context), context.signal);
                    } while (queue.length && !context.signal?.aborted);
                } finally {
                    videoQueueRef.current = null;
                }
            });
        },
        [handle, message, processVideoTarget, run],
    );

    const generateVideos = useCallback(
        (episodeId: string, clipIds: string[]) => {
            const targets = clipIds.map((clipId) => ({ episodeId, clipId }));
            enqueueOrRunVideos(targets, clipIds.length > 1 ? `生成 ${clipIds.length} 段视频` : "生成视频");
        },
        [enqueueOrRunVideos],
    );

    const generateAllMissingVideos = useCallback(() => {
        const document = handle.getDocument();
        const targets: VideoGenTarget[] = [];
        for (const episode of document.episodes) {
            for (const clip of episode.clips) {
                if (!clip.videoKey) targets.push({ episodeId: episode.id, clipId: clip.id });
            }
        }
        enqueueOrRunVideos(targets, targets.length > 1 ? `批量生成 ${targets.length} 段视频` : "生成视频");
    }, [enqueueOrRunVideos, handle]);

    const syncCanvas = useCallback(
        async (options?: { episodeIds?: string[]; includeAssets?: boolean }) => {
            let canvasId = "";
            await run(options?.episodeIds?.length ? "同步本集到画布" : "同步到画布", async () => {
                canvasId = await syncScriptToCanvas(handle.project?.title || "剧本工作室", handle.getDocument(), options);
            });
            return canvasId;
        },
        [handle, run],
    );

    const downloadClip = useCallback(
        async (episode: StudioEpisode, clip: StudioClip) => {
            try {
                await downloadStudioClipVideo(clip, `第${episode.number}集-第${clip.number}段`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : String(error));
            }
        },
        [message],
    );

    return {
        busy,
        stream,
        cancel,
        update,
        generateStory,
        regenerateEpisode,
        confirmReview,
        reviseEpisodeFromReview,
        extract,
        generateImages,
        splitEpisodes,
        rebuildPrompts,
        adjustClip,
        reviseAppearancePrompt,
        generateVideos,
        generateAllMissingVideos,
        syncCanvas,
        downloadClip,
    };
}

export type ScriptRunner = ReturnType<typeof useScriptRunner>;
