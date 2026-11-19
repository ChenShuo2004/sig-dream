import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, matchCatalogResolution, parseVideoResolution, videoSecondsMaxForModel } from "@/lib/media-size";
import { archiveGeneratedBlob } from "@/services/api/save-to-unorganized";
import { downloadGeneratedMedia } from "@/services/api/generated-media";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { downloadAi007JobFile, forwardAi007, publishAi007Media } from "./ai007-relay";
import { createGeeknowVideo, downloadGeeknowVideo, geeknowTaskStatus, readGeeknowVideo, uploadGeeknowFile } from "./geeknow-relay";
import { buildGeeknowVideoBody } from "./geeknow-video";
import { createOnionVideo, downloadOnionVideo, fetchOnionModels, listOnionTasks, onionFailureText, uploadOnionAsset } from "./onion-relay";
import { clampH3DeOilStrength, isAi007BaseUrl, isApimartBaseUrl, isCrunBaseUrl, isGeeknowBaseUrl, isMetasoBaseUrl, isOnionBaseUrl, isRunningHubBaseUrl, isRunningHubComfyGenWorkflow, isRunningHubH3FaceGen, isRunningHubH3FamilyGen, isVolcengineBaseUrl, mergeOnionProfiles, normalizeRunningHubInstanceType } from "@/lib/relay-stations";
import { clipText, extractUsage, providerOf, rememberTaskStart, reportApiCall, takeTaskDuration, trackApiCall, usageNotedSince, type ApiCallUsage } from "@/services/api/api-call-log";
import { assertCurrentUserCanUseModel, boolConfig, buildApiUrl, channelModelOf, isLanComfyModel, lanComfyWorkflow, modelOptionName, replaceConfigChannels, resolveModelRequestConfig, resolveModelScript, useConfigStore, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { createApimartVideoTask as submitApimartVideo, downloadApimartUrl, pollApimartTask } from "./apimart-relay";
import { requestLanComfy } from "./lan-bridge";
import { createMetasoVideo, metasoResultUrl, metasoTaskId, metasoTaskStatus, publishMetasoMedia, queryMetasoVideo } from "./metaso-relay";
import { buildCrunVideoBody, createCrunTask, crunTaskView, queryCrunTask, uploadCrunFile } from "./crun-relay";
import { arkAudioDataUrl, arkImageDataUrl, createVolcanoVideo, publishVolcanoMedia, queryVolcanoVideo, volcanoResultUrl, volcanoTaskId, volcanoTaskStatus } from "./volcano-relay";
import { runModelPlugin } from "./model-plugin";
import { cancelRunningHubTask } from "./runninghub-relay";
import { createRunningHubAiAppGenTask, createRunningHubComfyGenTask, createRunningHubVideoEditTask, isRunningHubWorkflowModel, pollRunningHubVideoEditTask, resolveRunningHubVideoConfig } from "./runninghub-video";

export { cancelRunningHubTask };
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin" | "lan" | "ai007" | "onion" | "geeknow" | "runninghub" | "apimart" | "metaso" | "volcengine" | "crun"; model: string };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult; usage?: ApiCallUsage } | { status: "failed"; error: string; usage?: ApiCallUsage };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();
const lanVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

/** Poll cadence / wall-clock budget per provider. RunningHub tasks may run up to 60 minutes. */
export function videoPollPlan(provider: VideoGenerationTask["provider"]) {
    if (provider === "runninghub") return { intervalMs: 5_000, timeoutMs: 60 * 60_000 };
    if (provider === "crun") return { intervalMs: 15_000, timeoutMs: 20 * 60_000 };
    if (provider === "ai007" || provider === "onion" || provider === "geeknow" || provider === "apimart" || provider === "metaso" || provider === "volcengine") {
        return { intervalMs: 5_000, timeoutMs: 20 * 60_000 };
    }
    return { intervalMs: 2_500, timeoutMs: 5 * 60_000 };
}

/** Ark Seedance video tasks: at most 3 running for the account. Extra submits wait for a free slot. */
const VOLCANO_SEEDANCE_CONCURRENCY = 3;
let volcanoSeedanceInFlight = 0;
const volcanoSeedanceTasks = new Set<string>();
const volcanoSeedanceWatchers = new Set<string>();
type VolcanoSeedanceWaiter = { resolve: () => void; reject: (error: unknown) => void; signal?: AbortSignal };
const volcanoSeedanceWaiters: VolcanoSeedanceWaiter[] = [];

function grantVolcanoSeedanceSlots() {
    while (volcanoSeedanceInFlight < VOLCANO_SEEDANCE_CONCURRENCY && volcanoSeedanceWaiters.length) {
        const waiter = volcanoSeedanceWaiters.shift();
        if (!waiter) break;
        if (waiter.signal?.aborted) {
            waiter.reject(new DOMException("Aborted", "AbortError"));
            continue;
        }
        volcanoSeedanceInFlight += 1;
        waiter.resolve();
    }
}

function acquireVolcanoSeedanceSlot(signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (volcanoSeedanceInFlight < VOLCANO_SEEDANCE_CONCURRENCY && !volcanoSeedanceWaiters.length) {
        volcanoSeedanceInFlight += 1;
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        const waiter: VolcanoSeedanceWaiter = { resolve, reject, signal };
        const onAbort = () => {
            const index = volcanoSeedanceWaiters.indexOf(waiter);
            if (index >= 0) volcanoSeedanceWaiters.splice(index, 1);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const grant = waiter.resolve;
        waiter.resolve = () => {
            signal?.removeEventListener("abort", onAbort);
            grant();
        };
        volcanoSeedanceWaiters.push(waiter);
    });
}

function bindVolcanoSeedanceTask(taskId: string) {
    if (taskId) volcanoSeedanceTasks.add(taskId);
}

function trackResumedVolcanoSeedanceTask(taskId: string) {
    if (!taskId || volcanoSeedanceTasks.has(taskId)) return;
    volcanoSeedanceTasks.add(taskId);
    volcanoSeedanceInFlight += 1;
}

function releaseVolcanoSeedanceSlot(taskId?: string) {
    if (taskId) {
        if (!volcanoSeedanceTasks.delete(taskId)) return;
    }
    volcanoSeedanceInFlight = Math.max(0, volcanoSeedanceInFlight - 1);
    grantVolcanoSeedanceSlots();
}

function volcanoSeedanceTerminal(status: string) {
    const normalized = status.replace(/[\s_-]+/g, "");
    return ["success", "succeeded", "completed", "done", "finish", "finished", "fail", "failed", "failure", "error", "cancelled", "canceled", "rejected", "expired"].includes(normalized) || status.includes("fail");
}

/** Keep the account slot until Ark finishes, even if the page stopped watching the task. */
export function holdVolcanoSeedanceUntilDone(taskId: string) {
    watchVolcanoSeedanceUntilDone(taskId);
}

function watchVolcanoSeedanceUntilDone(taskId: string) {
    if (!taskId || !volcanoSeedanceTasks.has(taskId) || volcanoSeedanceWatchers.has(taskId)) return;
    volcanoSeedanceWatchers.add(taskId);
    void (async () => {
        const deadline = Date.now() + 20 * 60_000;
        try {
            while (volcanoSeedanceTasks.has(taskId) && Date.now() < deadline) {
                try {
                    const payload = await queryVolcanoVideo(taskId);
                    const { status, url } = volcanoTaskStatus(payload);
                    if (volcanoSeedanceTerminal(status) || url) break;
                } catch {
                    // Keep the slot until Ark reports a terminal status or the deadline passes.
                }
                await delay(5_000);
            }
        } finally {
            volcanoSeedanceWatchers.delete(taskId);
            releaseVolcanoSeedanceSlot(taskId);
        }
    })();
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const { intervalMs, timeoutMs } = videoPollPlan(task.provider);
    const deadline = Date.now() + timeoutMs;
    const cancelRemote = () => {
        if (task.provider === "runninghub" && task.id) void cancelRunningHubTask(task.id).catch(() => undefined);
    };
    options?.signal?.addEventListener("abort", cancelRemote, { once: true });
    try {
        while (true) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const state = await pollVideoGenerationTask(config, task, options);
            if (state.status === "completed") return state.result;
            if (state.status === "failed") throw videoTaskFailed(state.error);
            if (Date.now() >= deadline) throw new Error(apiText("videoTimeout", { provider: "" }));
            await delay(intervalMs, options?.signal);
        }
    } finally {
        options?.signal?.removeEventListener("abort", cancelRemote);
        if (task.provider === "volcengine") watchVolcanoSeedanceUntilDone(task.id);
    }
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const model = (config.model || config.videoModel || "").trim();
    const requestConfig = resolveModelRequestConfig(config, model);
    return trackApiCall(
        {
            capability: "video",
            action: "submit",
            provider: providerOf(requestConfig.baseUrl, model),
            model,
            endpoint: "/video/generations",
            parameters: {
                model,
                prompt: clipText(prompt),
                size: config.size,
                seconds: config.videoSeconds,
                quality: config.vquality,
                videoMode: config.videoMode,
                referenceCount: references.length + (options?.videos?.length || 0) + (options?.audios?.length || 0),
            },
        },
        () => createVideoGenerationTaskBody(config, prompt, references, options),
        (task) => {
            rememberTaskStart(task.provider, task.id);
            return { taskId: task.id, provider: task.provider, model: task.model || model };
        },
    );
}

async function createVideoGenerationTaskBody(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    assertCurrentUserCanUseModel(config, selectedModel);
    if (isLanComfyModel(selectedModel)) return createLanVideoTask(config, selectedModel, prompt, references, options);
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    // Station base URL wins. RunningHub workflow ids are numeric; never steal Metaso / Volcano / etc.
    if (isMetasoBaseUrl(requestConfig.baseUrl)) return createMetasoVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isVolcengineBaseUrl(requestConfig.baseUrl)) return createVolcengineVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isCrunBaseUrl(requestConfig.baseUrl)) return createCrunVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isRunningHubBaseUrl(requestConfig.baseUrl) || isRunningHubWorkflowModel(selectedModel)) {
        const rhConfig = resolveRunningHubVideoConfig(config, selectedModel);
        assertVideoConfig(rhConfig, rhConfig.model || selectedModel);
        return createRunningHubVideoTask(rhConfig, selectedModel, prompt, references, options);
    }
    if (isAi007BaseUrl(requestConfig.baseUrl)) return createAi007VideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isApimartBaseUrl(requestConfig.baseUrl)) return createApimartVideoGenerationTask(requestConfig, selectedModel, prompt, references, options);
    if (isOnionBaseUrl(requestConfig.baseUrl)) return createOnionVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isGeeknowBaseUrl(requestConfig.baseUrl)) return createGeeknowVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

async function createLanVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const workflow = lanComfyWorkflow(model);
    const imageLimit = workflow ? 9 : 2;
    const files = (
        await Promise.all(
            references.slice(0, imageLimit).map(async (image, index) => {
                const dataUrl = await imageToDataUrl(image);
                return dataUrl ? dataUrlToFile({ ...image, dataUrl, name: image.name || `image-${index + 1}.png` }) : null;
            }),
        )
    ).filter((file): file is File => Boolean(file));
    const referenceMode = resolveVideoMode(config.videoMode, references.length) === "reference" || references.length > 2;
    const mode = files.length === 0 ? "t2v" : referenceMode || workflow ? "r2v" : "i2v";
    const extras = config as AiConfig & { videoMegapixels?: string; videoSeed?: string };
    const megapixels = Number(extras.videoMegapixels);
    const seedRaw = String(extras.videoSeed || "").trim();
    const seed = seedRaw ? Number(seedRaw) : undefined;
    const videos = workflow ? await Promise.all((options?.videos || []).slice(0, 3).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options))) : [];
    const audios = workflow ? await Promise.all((options?.audios || []).slice(0, 3).map((audio) => referenceMediaToFile(audio, "ref.wav", "invalidReferenceAudio", options))) : [];
    const blob = await requestLanComfy(
        {
            prompt,
            mode,
            workflow: workflow || undefined,
            duration: Math.max(1, Math.min(15, Number(config.videoSeconds) || 5)),
            aspect: lanComfyAspect(config.size || ""),
            megapixels: Number.isFinite(megapixels) && megapixels > 0 ? megapixels : 0.4,
            seed: seed != null && Number.isFinite(seed) && seed >= 0 ? seed : undefined,
            quality: workflow ? parseVideoResolution(config.vquality) : undefined,
            deoil: workflow === "h3-face" ? clampH3DeOilStrength(config.h3DeOilStrength) : undefined,
            images: workflow ? files : undefined,
            image: workflow ? undefined : files[0],
            image2: !workflow && mode === "r2v" ? files[1] : undefined,
            lastFrame: !workflow && mode === "i2v" ? files[1] : undefined,
            videos,
            audios,
        },
        options?.signal,
    );
    const id = nanoid();
    lanVideoResults.set(id, { blob, mimeType: blob.type || "video/mp4" });
    return { id, provider: "lan", model };
}

function lanComfyAspect(size: string) {
    // UI stores WxH (e.g. 1080x1920); match by inferred ratio, not substring "9:16".
    const ratio = inferVideoRatio(size || "16:9");
    if (ratio === "9:16") return "9:16 (Portrait Widescreen)";
    if (ratio === "3:4") return "3:4 (Portrait Standard)";
    if (ratio === "1:1") return "1:1 (Square)";
    if (ratio === "4:3") return "4:3 (Standard)";
    if (ratio === "21:9") return "21:9 (Ultrawide)";
    if (ratio === "3:2") return "3:2 (Photo)";
    if (ratio === "2:3") return "2:3 (Portrait Photo)";
    return "16:9 (Widescreen)";
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const started = Date.now();
    let state: VideoGenerationTaskState;
    try {
        state = await pollVideoGenerationTaskInner(config, task, options);
    } catch (error) {
        if (task.provider === "volcengine" && (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError"))) watchVolcanoSeedanceUntilDone(task.id);
        throw error;
    }
    if (state.status === "completed" || state.status === "failed") {
        const noted = usageNotedSince(started);
        const usage: ApiCallUsage | undefined = state.usage || (noted ? { ...noted } : undefined);
        reportApiCall({
            capability: "video",
            action: "complete",
            provider: task.provider,
            model: task.model,
            endpoint: task.provider === "volcengine" ? "/contents/generations/tasks" : task.provider === "runninghub" ? "/openapi/v2/query" : "/video/generations",
            status: state.status === "completed" ? "success" : "failed",
            durationMs: takeTaskDuration(task.provider, task.id),
            taskId: task.id,
            errorMessage: state.status === "failed" ? state.error : "",
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            credits: usage?.credits,
            parameters: {
                taskId: task.id,
                provider: task.provider,
                model: task.model,
                ...(usage?.totalTokens ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } : {}),
                ...(usage?.credits ? { credits: usage.credits } : {}),
            },
        });
    }
    return state;
}

async function pollVideoGenerationTaskInner(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    if (task.provider === "lan") {
        const result = lanVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("lanComfyFailed") };
    }
    if (task.provider === "runninghub") return pollRunningHubVideoTask(task, options);
    if (task.provider === "metaso") return pollMetasoVideoTask(task, options);
    if (task.provider === "volcengine") return pollVolcengineVideoTask(task, options);
    if (task.provider === "crun") return pollCrunVideoTask(task, options);
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "ai007") return pollAi007VideoTask(requestConfig, task, options);
    if (task.provider === "apimart") return pollApimartVideoTask(requestConfig, task, options);
    if (task.provider === "onion") return pollOnionVideoTask(task, options);
    if (task.provider === "geeknow") return pollGeeknowVideoTask(task, options);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createCrunVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const catalogModel = modelOptionName(model);
    const profile = channelModelOf(config, model);
    const maxImages = profile?.maxImages ?? 9;
    const maxVideos = profile?.maxVideos ?? 3;
    const maxAudios = profile?.maxAudios ?? 3;
    if (references.length > maxImages) throw new Error(`CRUN 模型最多 ${maxImages} 张参考图`);
    if ((options?.videos || []).length > maxVideos) throw new Error(`CRUN 模型最多 ${maxVideos} 段参考视频`);
    if ((options?.audios || []).length > maxAudios) throw new Error(`CRUN 模型最多 ${maxAudios} 段参考音频`);
    const imageFiles = (
        await Promise.all(
            references.slice(0, maxImages).map(async (image, index) => {
                const dataUrl = await imageToDataUrl(image);
                return dataUrl ? dataUrlToFile({ ...image, dataUrl, name: image.name || `ref-${index + 1}.png` }) : null;
            }),
        )
    ).filter((file): file is File => Boolean(file));
    const videoFiles = await Promise.all((options?.videos || []).slice(0, maxVideos).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audioFiles = await Promise.all((options?.audios || []).slice(0, maxAudios).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(imageFiles.map((file) => uploadCrunFile(file, options?.signal))),
        Promise.all(videoFiles.map((file) => uploadCrunFile(file, options?.signal))),
        Promise.all(audioFiles.map((file) => uploadCrunFile(file, options?.signal))),
    ]);
    const body = buildCrunVideoBody({
        catalogModel,
        prompt,
        size: config.size || "16:9",
        seconds: config.videoSeconds,
        quality: config.vquality || "",
        resolutions: profile?.resolutions || [],
        audio: boolConfig(config.videoGenerateAudio, true),
        imageUrls,
        videoUrls,
        audioUrls,
        reference: resolveVideoMode(config.videoMode, references.length) === "reference",
    });
    const taskId = await createCrunTask(body, options?.signal);
    return { id: taskId, provider: "crun", model };
}

async function pollCrunVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const view = crunTaskView(await queryCrunTask(task.id, options?.signal));
        if (view.status === "success") {
            const resultUrl = view.urls[0] || "";
            if (!resultUrl) return { status: "failed", error: apiText("noPlayableVideo") };
            const blob = await downloadGeneratedMedia(resultUrl, options?.signal);
            const usage = view.credits ? { promptTokens: 0, completionTokens: 0, totalTokens: 0, credits: view.credits } : undefined;
            return { status: "completed", result: { blob, mimeType: blob.type || "video/mp4" }, ...(usage ? { usage } : {}) };
        }
        if (view.status === "failed") return { status: "failed", error: view.message || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text)) return { status: "pending" };
        throw error instanceof Error ? error : new Error(apiText("videoTaskQueryFailed"));
    }
}

async function createMetasoVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const profile = channelModelOf(config, model);
    const maxImages = profile?.maxImages ?? 9;
    const maxVideos = profile?.maxVideos ?? 3;
    const maxAudios = profile?.maxAudios ?? 3;
    if (references.length > maxImages) throw new Error(`秘塔模型最多 ${maxImages} 张参考图`);
    if ((options?.videos || []).length > maxVideos) throw new Error(`秘塔模型最多 ${maxVideos} 段参考视频`);
    if ((options?.audios || []).length > maxAudios) throw new Error(`秘塔模型最多 ${maxAudios} 段参考音频`);

    const allowedResolutions = (profile?.resolutions || []).map((item) => item.trim()).filter(Boolean);
    const resolution = metasoResolution(config.vquality || "", allowedResolutions);
    const durationMax = modelName.toLowerCase() === "minimax-h3" && /^2k$/i.test(resolution) ? 15 : videoSecondsMaxForModel(modelName);
    const durationMin = 4;
    const duration = Math.max(durationMin, Math.min(durationMax, Math.floor(Number(config.videoSeconds) || durationMin)));
    const ratio = videoAspectRatio(config.size);

    const imageUrls = (
        await Promise.all(
            (
                await Promise.all(
                    references.slice(0, maxImages).map(async (image, index) => {
                        const dataUrl = await imageToDataUrl(image);
                        return dataUrl ? dataUrlToFile({ ...image, dataUrl, name: image.name || `ref-${index + 1}.png` }) : null;
                    }),
                )
            )
                .filter((file): file is File => Boolean(file))
                .map((file) => publishMetasoMedia(file, options?.signal)),
        )
    ).filter(Boolean);

    const videoUrls = (
        await Promise.all(
            (await Promise.all((options?.videos || []).slice(0, maxVideos).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)))).map((file) =>
                publishMetasoMedia(file, options?.signal),
            ),
        )
    ).filter(Boolean);

    const audioUrls = (
        await Promise.all(
            (await Promise.all((options?.audios || []).slice(0, maxAudios).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)))).map((file) =>
                publishMetasoMedia(file, options?.signal),
            ),
        )
    ).filter(Boolean);

    const content: Array<Record<string, unknown>> = [
        { type: "text", text: prompt },
        ...imageUrls.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
        ...videoUrls.map((url) => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
        ...audioUrls.map((url) => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
    ];

    const body: Record<string, unknown> = {
        model: modelName,
        content,
        resolution,
        duration,
        ratio,
        aigc_watermark: false,
    };
    if (modelName.toLowerCase() === "minimax-h3") {
        body.fast_mode = false;
    }

    const created = await createMetasoVideo(body, options?.signal);
    const taskId = metasoTaskId(created);
    if (!taskId) throw new Error(apiText("noVideoTaskId"));
    return { id: taskId, provider: "metaso", model };
}

async function createVolcengineVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const profile = channelModelOf(config, model);
    const maxImages = profile?.maxImages ?? 9;
    const maxVideos = profile?.maxVideos ?? 3;
    const maxAudios = profile?.maxAudios ?? 3;
    if (references.length > maxImages) throw new Error(`火山引擎模型最多 ${maxImages} 张参考图`);
    if ((options?.videos || []).length > maxVideos) throw new Error(`火山引擎模型最多 ${maxVideos} 段参考视频`);
    if ((options?.audios || []).length > maxAudios) throw new Error(`火山引擎模型最多 ${maxAudios} 段参考音频`);

    const allowedResolutions = (profile?.resolutions || []).map((item) => item.trim()).filter(Boolean);
    const resolution = metasoResolution(config.vquality || "", allowedResolutions);
    const durationMin = 4;
    const durationMax = Math.min(15, videoSecondsMaxForModel(modelName));
    const duration = Math.max(durationMin, Math.min(durationMax, Math.floor(Number(config.videoSeconds) || durationMin)));
    // Seedance 2.0：auto → adaptive（官方枚举）
    const ratioRaw = inferVideoRatio(config.size || "auto");
    const ratio = ratioRaw === "auto" ? "adaptive" : ratioRaw;

    // 创建任务 API：图片/音频用 data:<type>/<format>;base64,...。本站地址方舟无权限拉取，会报 image_url resource not found。
    const imageUrls = (
        await Promise.all(
            references.slice(0, maxImages).map(async (image) => {
                const dataUrl = await imageToDataUrl(image);
                return dataUrl ? arkImageDataUrl(dataUrl) : "";
            }),
        )
    ).filter(Boolean);

    const videoUrls = (
        await Promise.all(
            (await Promise.all((options?.videos || []).slice(0, maxVideos).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)))).map((file) =>
                publishVolcanoMedia(file, options?.signal),
            ),
        )
    ).filter(Boolean);

    const audioUrls = (
        await Promise.all(
            (
                await Promise.all((options?.audios || []).slice(0, maxAudios).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)))
            ).map(async (file) => arkAudioDataUrl(await readFileAsDataUrl(file))),
        )
    ).filter(Boolean);

    const payloadBytes = [...imageUrls, ...audioUrls].reduce((sum, value) => sum + value.length, 0);
    if (payloadBytes > 60 * 1024 * 1024) throw new Error("参考图和参考音频的 Base64 合计超过方舟 64MB 请求体限制");

    if (!prompt.trim() && !imageUrls.length && !videoUrls.length) {
        throw new Error("请填写提示词或上传参考图/视频");
    }
    // Seedance 2.0: audio alone is not enough — need at least one image or video when using audio.
    if (audioUrls.length && !imageUrls.length && !videoUrls.length) {
        throw new Error("火山 Seedance 2.0 不能单独用音频，请再加参考图或参考视频");
    }

    const content: Array<Record<string, unknown>> = [];
    if (prompt.trim()) content.push({ type: "text", text: prompt });
    // 首尾帧模式：仅 1–2 张图且无音视频参考时用 first_frame / last_frame；否则走全能参考。
    const mode = resolveVideoMode(config.videoMode, imageUrls.length);
    const useFrames = !videoUrls.length && !audioUrls.length && mode === "frames" && imageUrls.length >= 1 && imageUrls.length <= 2;
    if (useFrames) {
        content.push({ type: "image_url", image_url: { url: imageUrls[0] }, role: "first_frame" });
        if (imageUrls[1]) content.push({ type: "image_url", image_url: { url: imageUrls[1] }, role: "last_frame" });
    } else {
        content.push(
            ...imageUrls.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
            ...videoUrls.map((url) => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
            ...audioUrls.map((url) => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
        );
    }

    const body: Record<string, unknown> = {
        model: modelName,
        content,
        resolution,
        duration,
        ratio,
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    await acquireVolcanoSeedanceSlot(options?.signal);
    let taskId = "";
    try {
        const created = await createVolcanoVideo(body, options?.signal);
        taskId = volcanoTaskId(created);
        if (!taskId) throw new Error(apiText("noVideoTaskId"));
        bindVolcanoSeedanceTask(taskId);
        return { id: taskId, provider: "volcengine", model };
    } catch (error) {
        if (!taskId) releaseVolcanoSeedanceSlot();
        throw error;
    }
}

async function pollVolcengineVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    trackResumedVolcanoSeedanceTask(task.id);
    try {
        const payload = await queryVolcanoVideo(task.id, options?.signal);
        const { status, message, url } = volcanoTaskStatus(payload);
        const normalized = status.replace(/[\s_-]+/g, "");
        if (["success", "succeeded", "completed", "done", "finish", "finished"].includes(normalized) || (url && normalized === "succeeded")) {
            releaseVolcanoSeedanceSlot(task.id);
            const resultUrl = url || volcanoResultUrl(payload);
            if (!resultUrl) return { status: "failed", error: apiText("noPlayableVideo") };
            const nested = payload.data;
            const usage = extractUsage(payload) || extractUsage(nested);
            return { status: "completed", result: await videoResultFromUrl(resultUrl, options), ...(usage ? { usage } : {}) };
        }
        if (["fail", "failed", "failure", "error", "cancelled", "canceled", "rejected", "expired"].includes(normalized) || status.includes("fail")) {
            releaseVolcanoSeedanceSlot(task.id);
            return { status: "failed", error: message || apiText("videoGenerationFailed") };
        }
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text)) return { status: "pending" };
        throw error instanceof Error ? error : new Error(apiText("videoTaskQueryFailed"));
    }
}

async function pollMetasoVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const payload = await queryMetasoVideo(task.id, options?.signal);
        const { status, message, url } = metasoTaskStatus(payload);
        const normalized = status.replace(/[\s_-]+/g, "");
        if (["success", "succeeded", "completed", "done", "finish", "finished"].includes(normalized) || (url && ["success", "succeeded", "completed"].some((token) => status.includes(token)))) {
            const resultUrl = url || metasoResultUrl(payload);
            if (!resultUrl) return { status: "failed", error: apiText("noPlayableVideo") };
            return { status: "completed", result: await videoResultFromUrl(resultUrl, options) };
        }
        if (["fail", "failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(normalized) || status.includes("fail")) {
            return { status: "failed", error: message || apiText("videoGenerationFailed") };
        }
        // MiniMax-style: preparing / queueing / processing / running
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text)) return { status: "pending" };
        throw error instanceof Error ? error : new Error(apiText("videoTaskQueryFailed"));
    }
}

function metasoResolution(selected: string, allowed: string[]) {
    return matchCatalogResolution(selected, allowed.length ? allowed : ["480p", "720p", "1080p"]);
}

async function createRunningHubVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selected = config.model || model;
    const instanceType = normalizeRunningHubInstanceType(config.runningHubInstanceType);
    // Check both resolved config.model and the original picker value — normalize must not
    // silently fall back to the default *edit* workflow and demand a source video.
    if (isRunningHubH3FamilyGen(selected) || isRunningHubH3FamilyGen(model)) {
        const familyModel = isRunningHubH3FamilyGen(selected) ? selected : model;
        const faceModel = isRunningHubH3FaceGen(familyModel);
        const created = await createRunningHubAiAppGenTask({
            model: familyModel,
            prompt,
            references,
            videos: faceModel ? options?.videos : undefined,
            audios: faceModel ? options?.audios : undefined,
            signal: options?.signal,
            quality: config.vquality || "720",
            durationSec: Number(config.videoSeconds) || 5,
            size: config.size || "16:9",
            instanceType,
            deOilStrength: faceModel ? clampH3DeOilStrength(config.h3DeOilStrength) : undefined,
        });
        return { id: created.taskId, provider: "runninghub", model };
    }
    if (isRunningHubComfyGenWorkflow(selected) || isRunningHubComfyGenWorkflow(model)) {
        const extras = config as AiConfig & { videoMegapixels?: string; videoSeed?: string };
        const megapixels = Number(extras.videoMegapixels);
        const seedRaw = String(extras.videoSeed || "").trim();
        const seed = seedRaw ? Number(seedRaw) : undefined;
        const created = await createRunningHubComfyGenTask({
            model: selected,
            prompt,
            references,
            signal: options?.signal,
            megapixels: Number.isFinite(megapixels) && megapixels > 0 ? megapixels : 1.5,
            seed: seed != null && Number.isFinite(seed) && seed >= 0 ? seed : undefined,
            durationSec: Number(config.videoSeconds) || 12,
            size: config.size || "16:9",
            instanceType,
        });
        return { id: created.taskId, provider: "runninghub", model };
    }
    const created = await createRunningHubVideoEditTask({
        model: selected,
        prompt,
        references,
        videos: options?.videos,
        signal: options?.signal,
        instanceType,
    });
    return { id: created.taskId, provider: "runninghub", model };
}

async function pollRunningHubVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = await pollRunningHubVideoEditTask(task.id, options?.signal);
        if (state.status === "completed") {
            // RH contract: SUCCESS + results[].url is enough. Blob cache is optional.
            if (state.result.blob) await assertVideoBlob(state.result.blob);
            return { status: "completed", result: state.result, ...(state.usage ? { usage: state.usage } : {}) };
        }
        if (state.status === "failed") return { status: "failed", error: state.error || apiText("videoGenerationFailed"), ...(state.usage ? { usage: state.usage } : {}) };
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const text = error instanceof Error ? error.message : "";
        // Only transient query-layer network blips stay pending. Never hold SUCCESS behind download errors.
        if (isTransientStatusQueryError(text) && !/下载|成片|没有返回视频|已成功/i.test(text)) {
            return { status: "pending" };
        }
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult, meta?: { title?: string; prompt?: string }): Promise<UploadedFile & { nasWarning?: string }> {
    const blob = result.blob || (result.url ? await downloadGeneratedMedia(result.url) : null);
    if (!blob || blob.size < 32) throw new Error(apiText("noPlayableVideo"));
    const stored = await uploadMediaFile(blob, "video");
    const nasWarning = await archiveGeneratedBlob(blob, "video", meta);
    return nasWarning ? { ...stored, nasWarning } : stored;
}

const storedVideoByTask = new Map<string, Promise<UploadedFile & { nasWarning?: string }>>();

/** Share one download and one NAS archive for the same provider task. */
export function storeGeneratedVideoOnce(taskId: string, result: VideoGenerationResult, meta?: { title?: string; prompt?: string }) {
    const key = taskId.trim();
    if (!key) return storeGeneratedVideo(result, meta);
    const pending = storedVideoByTask.get(key);
    if (pending) return pending;
    const job = storeGeneratedVideo(result, meta).catch((error) => {
        storedVideoByTask.delete(key);
        throw error;
    });
    storedVideoByTask.set(key, job);
    return job;
}

async function createAi007VideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const referenceVideos = options?.videos || [];
    if (referenceVideos.length && modelName.toLowerCase() === "h3-max") {
        throw new Error("AI007 的 H3-max 不支持参考视频。需要参考视频时用 Seedance 或 H3。");
    }
    const imageLimit = modelName.toLowerCase().includes("seedance") ? 9 : 4;
    const videoLimit = modelName.toLowerCase().includes("seedance") ? 3 : 1;
    const images = (await Promise.all(references.map((image) => imageToDataUrl(image)))).filter((value): value is string => Boolean(value)).slice(0, imageLimit);
    if (modelName.toLowerCase() === "h3-max" && images.length > 2) {
        throw new Error("AI007 的 H3-max 只支持一张首帧，或首帧加尾帧。");
    }
    const seconds = ai007Seconds(modelName, config.videoSeconds);
    const aspectRatio = videoAspectRatio(config.size);
    const seedance = modelName.toLowerCase().includes("seedance");
    const body: Record<string, unknown> = {
        model: modelName,
        prompt,
        seconds,
        aspect_ratio: aspectRatio,
    };
    const mode = resolveVideoMode(config.videoMode, images.length);
    const imageUrls = images.length ? await publishReferenceImages(images, options?.signal) : [];
    const videoUrls = referenceVideos.length
        ? await Promise.all(
              (await Promise.all(referenceVideos.slice(0, videoLimit).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)))).map((file) =>
                  publishAi007Media(file, options?.signal),
              ),
          )
        : [];
    if (seedance && videoUrls.length) {
        body.duration = Number(seconds) || undefined;
        body.ratio = aspectRatio;
        body.resolution = normalizeVideoResolution(config.vquality);
        body.content = [
            { type: "text", text: prompt },
            ...imageUrls.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
            ...videoUrls.map((url) => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
        ];
    } else {
        if (imageUrls.length === 1 || (imageUrls.length === 2 && mode === "frames")) {
            body.image = imageUrls[0];
            if (imageUrls[1]) body.last_frame_image_url = imageUrls[1];
        } else if (imageUrls.length > 1) {
            body.image_urls = imageUrls;
        }
        if (videoUrls.length) body.video_urls = videoUrls;
    }
    try {
        const created = await forwardAi007("POST", "/video/generations", body, options?.signal);
        const taskId = readAi007TaskId(created);
        if (!taskId) throw new Error(apiText("noVideoTaskId"));
        return { id: taskId, provider: "ai007", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

const AI007_VIDEO_URL_KEYS = ["video_url", "url", "output_url", "download_url", "mp4_url", "file_url", "result_url"];

function extractAi007VideoUrl(payload: Record<string, unknown>) {
    const data = ai007Record(payload.data) || payload;
    const inner = ai007Record(data.data);
    for (const source of [inner, data, payload]) {
        if (!source) continue;
        for (const key of AI007_VIDEO_URL_KEYS) {
            const value = stringField(source[key]);
            if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/canvas-api/")) return value;
        }
    }
    return "";
}

async function pollAi007VideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const payload = await forwardAi007("GET", `/video/generations/${encodeURIComponent(task.id)}`, undefined, options?.signal);
        const data = ai007Record(payload.data) || payload;
        const inner = ai007Record(data.data);
        const status = String(data.status || inner?.status || "").toUpperCase();
        if (status === "SUCCESS" || status === "COMPLETED" || status === "SUCCEEDED") {
            const url = extractAi007VideoUrl(payload);
            if (!url) return { status: "failed", error: apiText("noPlayableVideo") };
            if (url.startsWith("/canvas-api/")) {
                const blob = await downloadAi007JobFile(url, options?.signal);
                await assertVideoBlob(blob);
                return { status: "completed", result: { blob } };
            }
            return { status: "completed", result: await videoResultFromUrl(url, options) };
        }
        if (status === "FAILURE" || status === "FAILED" || status.includes("CANCEL")) {
            return { status: "failed", error: stringField(data.fail_reason) || stringField(inner?.fail_reason) || apiText("videoGenerationFailed") };
        }
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const message = error instanceof Error ? error.message : "";
        if (message.includes("平台转发 AI007") || message.includes("文件机还没有完成") || isTransientStatusQueryError(message)) {
            return { status: "pending" };
        }
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function createOnionVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (prompt.length > 6000) throw new Error("OnionCreate 提示词最多 6000 字");
    const profile = await freshOnionProfile(config, model);
    const maxImages = profile?.maxImages ?? 9;
    const maxVideos = profile?.maxVideos ?? 3;
    const maxAudios = profile?.maxAudios ?? 3;
    if (maxImages === 0 && references.length) throw new Error("这个模型不支持参考图");
    if (maxVideos === 0 && (options?.videos || []).length) throw new Error("这个模型不支持参考视频");
    if (maxAudios === 0 && (options?.audios || []).length) throw new Error("这个模型不支持参考音频");
    if (references.length > maxImages) throw new Error(`这个模型最多 ${maxImages} 张参考图`);
    if ((options?.videos || []).length > maxVideos) throw new Error(`这个模型最多 ${maxVideos} 段参考视频`);
    if ((options?.audios || []).length > maxAudios) throw new Error(`这个模型最多 ${maxAudios} 段参考音频`);
    const images = (await Promise.all(references.map((image) => imageToDataUrl(image)))).filter((value): value is string => Boolean(value));
    const videos = options?.videos || [];
    const audios = options?.audios || [];
    const imageFiles = images.map((dataUrl, index) => {
        const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || "image/png";
        const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        return dataUrlToFile({ id: String(index), name: `ref-${index}.${ext}`, type: mime, dataUrl });
    });
    const videoFiles = await Promise.all(videos.map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audioFiles = await Promise.all(audios.map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const assetIds: string[] = [];
    const assetFiles = [...imageFiles, ...videoFiles, ...audioFiles];
    for (let index = 0; index < assetFiles.length; index += 2) {
        const batch = await Promise.all(assetFiles.slice(index, index + 2).map((file) => uploadOnionAsset(file, options?.signal)));
        assetIds.push(...batch);
    }
    const taskId = globalThis.crypto?.randomUUID?.() || nanoid();
    const seconds = Number(normalizeVideoSeconds(config.videoSeconds));
    const allowedDurations = profile?.allowedDurations || [];
    if (allowedDurations.length && !allowedDurations.includes(seconds)) throw new Error(`这个模型只支持 ${allowedDurations.join("、")} 秒`);
    const ratio = inferVideoRatio(config.size || "auto");
    const allowedRatios = profile?.allowedRatios || [];
    if (ratio !== "auto" && allowedRatios.length && !allowedRatios.includes(ratio)) throw new Error(`这个模型只支持画面比例 ${allowedRatios.join("、")}`);
    const resolutions = profile?.resolutions || [];
    const resolution = resolutions.length ? matchedOnionResolution(config.vquality || "", resolutions) : "";
    if (resolutions.length && !resolution) throw new Error(`这个模型只支持分辨率 ${resolutions.join("、")}`);
    const created = await createOnionVideo(
        {
            model_id: modelOptionName(model),
            prompt,
            asset_ids: assetIds,
            logical_task_id: taskId,
            duration: seconds || undefined,
            ...(ratio !== "auto" ? { aspect_ratio: ratio } : {}),
            ...(resolution ? { resolution } : {}),
        },
        options?.signal,
    );
    const createdData = created.data && typeof created.data === "object" ? (created.data as { id?: unknown; logical_task_id?: unknown }) : {};
    const createdId = stringField(createdData.logical_task_id) || stringField(created.logical_task_id) || stringField(createdData.id) || stringField(created.id) || taskId;
    return { id: createdId, provider: "onion", model };
}

async function createGeeknowVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = (await Promise.all(references.map((image) => imageToDataUrl(image)))).filter((value): value is string => Boolean(value));
    const videos = options?.videos || [];
    const audios = options?.audios || [];
    const imageFiles = images.map((dataUrl, index) => {
        const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || "image/png";
        const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        return dataUrlToFile({ id: String(index), name: `ref-${index}.${ext}`, type: mime, dataUrl });
    });
    const videoFiles = await Promise.all(videos.map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audioFiles = await Promise.all(audios.map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const imageUrls = await Promise.all(imageFiles.map((file) => uploadGeeknowFile(file, options?.signal)));
    const videoUrls = await Promise.all(videoFiles.map((file) => uploadGeeknowFile(file, options?.signal)));
    const audioUrls = await Promise.all(audioFiles.map((file) => uploadGeeknowFile(file, options?.signal)));
    const body = buildGeeknowVideoBody({
        model: modelOptionName(model),
        prompt,
        seconds: Number(normalizeVideoSeconds(config.videoSeconds)),
        size: config.size || "auto",
        resolution: normalizeVideoResolution(config.vquality || ""),
        mode: resolveVideoMode(config.videoMode, references.length),
        images: imageUrls,
        videos: videoUrls,
        audios: audioUrls,
    });
    body.idempotency_key = globalThis.crypto?.randomUUID?.() || nanoid();
    const created = await createGeeknowVideo(body, options?.signal);
    const createdData = created.data && typeof created.data === "object" ? created.data : {};
    const createdId = stringField(created.id) || stringField(created.task_id) || stringField(createdData.id) || stringField(createdData.task_id);
    if (!createdId) throw new Error("Geeknow 没有返回任务编号");
    return { id: createdId, provider: "geeknow", model };
}

async function pollGeeknowVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const payload = await readGeeknowVideo(task.id, options?.signal);
        const { status, message } = geeknowTaskStatus(payload);
        if (status === "succeeded" || status === "success" || status === "completed" || status === "finish" || status === "finished" || status === "done") {
            const blob = await downloadGeeknowVideo(task.id, options?.signal);
            await assertVideoBlob(blob);
            return { status: "completed", result: { blob } };
        }
        if (status === "failed" || status === "fail" || status === "error" || status === "cancelled" || status === "canceled" || status === "expired") {
            return { status: "failed", error: message || apiText("videoGenerationFailed") };
        }
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const text = error instanceof Error ? error.message : "";
        if (text.includes("尚未生成") || isTransientStatusQueryError(text)) return { status: "pending" };
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function pollOnionVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const rows = await listOnionTasks(options?.signal);
        const row = rows.find((item) => item.id === task.id || item.logical_task_id === task.id);
        if (!row) return { status: "pending" };
        const status = String(row.status || "").toLowerCase();
        if (status === "succeeded" || status === "completed" || status === "success" || status === "succeed") {
            if (row.has_video === false) return { status: "pending" };
            const blob = await downloadOnionVideo(row.id || row.logical_task_id || task.id, options?.signal);
            await assertVideoBlob(blob);
            return { status: "completed", result: { blob } };
        }
        if (status === "failed" || status === "cancelled" || status === "canceled" || status === "error") {
            return { status: "failed", error: onionFailureText(stringField(row.error_message) || apiText("videoGenerationFailed")) };
        }
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        const message = error instanceof Error ? error.message : "";
        if (message.includes("尚未生成") || message.includes("还没有准备好") || isTransientStatusQueryError(message)) return { status: "pending" };
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function ai007Seconds(modelName: string, fallback: string) {
    const matched = modelName.match(/-(\d+)s$/i);
    return clampVideoSeconds(matched?.[1] || fallback, videoSecondsMaxForModel(modelName));
}

async function publishReferenceImages(dataUrls: string[], signal?: AbortSignal) {
    const files = dataUrls.map((dataUrl, index) => {
        const mime = dataUrl.match(/^data:([^;]+);base64/)?.[1] || "image/png";
        const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
        return dataUrlToFile({ id: String(index), name: `ref-${index}.${ext}`, type: mime, dataUrl });
    });
    return Promise.all(files.map((file) => publishAi007Media(file, signal)));
}

function readAi007TaskId(payload: Record<string, unknown>) {
    const nested = ai007Record(payload.data);
    return stringField(payload.task_id) || stringField(payload.id) || stringField(nested?.task_id) || stringField(nested?.id);
}

function ai007Record(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function createApimartVideoGenerationTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const imageUrls = (await Promise.all(references.map((image) => imageToDataUrl(image)))).filter((value): value is string => Boolean(value)).slice(0, 9);
    const size = apimartVideoSize(config.size);
    const duration = Math.max(4, Math.min(15, Math.floor(Number(config.videoSeconds) || 5)));
    const body: Record<string, unknown> = {
        prompt,
        duration,
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        ...(size ? { size } : {}),
        ...(apimartVideoResolution(config.vquality) ? { resolution: apimartVideoResolution(config.vquality) } : {}),
    };
    if (imageUrls.length === 1) body.image_urls = imageUrls;
    else if (imageUrls.length >= 2) {
        body.image_with_roles = [
            { url: imageUrls[0], role: "first_frame" },
            { url: imageUrls[1], role: "last_frame" },
        ];
    }
    try {
        const taskId = await submitApimartVideo(config, body, options?.signal);
        return { id: taskId, provider: "apimart", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollApimartVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = await pollApimartTask(config, task.id, options?.signal);
        if (state.status === "pending") return { status: "pending" };
        if (!state.videoUrl) return { status: "failed", error: "APIMart 任务完成但没有视频地址" };
        const blob = await downloadApimartUrl(state.videoUrl, options?.signal);
        return { status: "completed", result: { blob, url: state.videoUrl, mimeType: blob.type || "video/mp4" } };
    } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text)) return { status: "pending" };
        if (error instanceof Error && /失败|failed|error/i.test(error.message)) return { status: "failed", error: error.message };
        throw error;
    }
}

function apimartVideoSize(size: string) {
    const value = (size || "").trim();
    if (/^\d+:\d+$/.test(value)) return value;
    if (/9.?16/i.test(value)) return "9:16";
    if (/16.?9/i.test(value)) return "16:9";
    if (/1.?1/i.test(value)) return "1:1";
    if (/4.?3/i.test(value)) return "4:3";
    if (/3.?4/i.test(value)) return "3:4";
    if (/21.?9/i.test(value)) return "21:9";
    return "";
}

function apimartVideoResolution(quality: string) {
    const value = (quality || "").trim().toLowerCase();
    if (value.includes("1080") || value === "high" || value === "hd") return "1080p";
    if (value.includes("480") || value === "low") return "480p";
    if (value.includes("720") || value === "medium") return "720p";
    return "720p";
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text) || (axios.isAxiosError(error) && (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504))) return { status: "pending" };
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (isTransientStatusQueryError(text) || (axios.isAxiosError(error) && (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504))) return { status: "pending" };
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

async function freshOnionProfile(config: AiConfig, model: string) {
    const current = channelModelOf(config, model);
    try {
        const profiles = await fetchOnionModels();
        if (!profiles.length) return current;
        const merged = mergeOnionProfiles(useConfigStore.getState().config.channels, profiles);
        if (merged.changed) useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, merged.channels) }));
        return channelModelOf(useConfigStore.getState().config, model) || current;
    } catch {
        return current;
    }
}

function matchedOnionResolution(selected: string, allowed: string[]) {
    const normalized = normalizeVideoResolution(selected).toLowerCase();
    const raw = selected.trim().toLowerCase();
    return allowed.find((item) => item.toLowerCase() === normalized || item.toLowerCase() === raw) || "";
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

/** A status query can see Nginx's HTML 502 while the provider task is still running. */
function isTransientStatusQueryError(message: string) {
    return /Failed to fetch|NetworkError|Load failed|502 Bad Gateway|503 Service|504 Gateway|<html[\s>]/i.test(message);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob | undefined) {
    if (!blob || !blob.type?.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
