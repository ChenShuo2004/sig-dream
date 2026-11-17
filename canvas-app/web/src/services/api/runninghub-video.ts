import { dataUrlToFile } from "@/lib/image-utils";
import { computeH3FaceOutputSize, inferVideoRatio, normalizeH3FaceRatio, parsePixelSize } from "@/lib/media-size";
import {
    RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID,
    RUNNINGHUB_H3_WENWU_WORKFLOW_ID,
    clampH3DeOilStrength,
    findRelayChannel,
    isRunningHubBaseUrl,
    isRunningHubComfyGenWorkflow,
    isRunningHubH3FaceGen,
    normalizeRunningHubInstanceType,
    resolveRunningHubH3FaceWorkflowId,
    resolveRunningHubH3FamilyWorkflowId,
    runningHubQualityToMegapixels,
    runninghubCatalogNames,
    type RunningHubInstanceType,
} from "@/lib/relay-stations";
import { imageToDataUrl } from "@/services/image-storage";
import { encodeChannelModel, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import { extractRunningHubCredits } from "@/services/api/api-call-log";
import { downloadRunningHubResultFile, extractRunningHubTaskId, queryRunningHubTask, runRunningHubAiApp, runRunningHubWorkflow, runningHubTaskState, uploadRunningHubFile } from "./runninghub-relay";

type NodeBinding = { nodeId: string; fieldName: string; role: "video" | "image" | "prompt" | "fps" | "frames" | "resolution" | "personCount" | "detectPrompt" | "replaceSubject" | "firstFrame" | "mode" };

/** YZ金鱼 H3 文武双全：参考图 LoadImage 顺序（对应 ref_image_0..5）。 */
const H3_WENWU_IMAGE_NODES = ["51", "49", "50", "43", "19", "23"] as const;

/**
 * Minimax_H3 人脸优化版：与 getJsonApiFormat(211174…) 对齐。
 *   ref_image_0..8 ← LoadImage 51/49/50/43/19/23/199/200/201
 *   ref_video_0..2 ← VHS_LoadVideo 27/25/26
 *   ref_audio_0..2 ← LoadAudio 48/14/15
 * prompt=263.text · duration=259 · RS=252 · crop=402 · deOil=400
 */
const H3_FACE_IMAGE_NODES = ["51", "49", "50", "43", "19", "23", "199", "200", "201"] as const;
const H3_FACE_AUDIO_NODES = ["48", "14", "15"] as const;
const H3_FACE_VIDEO_NODES = ["27", "25", "26"] as const;

/**
 * Minimax_H3 电影质感打斗流畅：与 getJsonApiFormat(211202…) 对齐（拓扑异于人脸版）。
 *   ref_image_0..8 ← LoadImage 6/35/36/37/38/39/40/41/42
 * prompt=28.prompt · duration=27.value · RS=29 · crop=54
 * 无音视频 Load 槽、无去油腻 node 400；勿复用人脸版 263/259/252/402。
 */
const H3_CINEMATIC_IMAGE_NODES = ["6", "35", "36", "37", "38", "39", "40", "41", "42"] as const;

function pushMediaSlot(
    list: Array<{ nodeId: string; fieldName: string; fieldValue: string }>,
    nodeId: string,
    fieldName: "image" | "audio" | "video",
    fileName: string | undefined,
    emptyValue: string,
) {
    list.push({ nodeId, fieldName, fieldValue: fileName || emptyValue });
}

/** Map UI size (`9:16` or `1080x1920`) → Comfy ResolutionSelector aspect_ratio enum. */
function resolutionSelectorAspect(size: string) {
    // Must use inferVideoRatio: UI stores WxH (e.g. 1080x1920), not the literal "9:16".
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

/** Face workflow: lock to 9:16 / 16:9 only. */
function faceResolutionSelectorAspect(size: string) {
    return normalizeH3FaceRatio(size) === "9:16" ? "9:16 (Portrait Widescreen)" : "16:9 (Widescreen)";
}

/** Comfy ResolutionSelector aspect → (w,h) ratio parts (nodes_resolution.py). */
const RESOLUTION_SELECTOR_RATIOS: Record<string, readonly [number, number]> = {
    "1:1 (Square)": [1, 1],
    "2:3 (Portrait Photo)": [2, 3],
    "3:2 (Photo)": [3, 2],
    "3:4 (Portrait Standard)": [3, 4],
    "4:3 (Standard)": [4, 3],
    "9:16 (Portrait Widescreen)": [9, 16],
    "16:9 (Widescreen)": [16, 9],
    "21:9 (Ultrawide)": [21, 9],
};

/**
 * Mirror Comfy `ResolutionSelector` (megapixels × 1024², round to `multiple`).
 * Face workflow publishes `multiple=32`.
 */
function resolutionSelectorDimensions(aspect: string, megapixels: number, multiple = 32) {
    const parts = RESOLUTION_SELECTOR_RATIOS[aspect] || RESOLUTION_SELECTOR_RATIOS["16:9 (Widescreen)"];
    const [wRatio, hRatio] = parts;
    const totalPixels = Math.max(0.1, megapixels) * 1024 * 1024;
    const scale = Math.sqrt(totalPixels / (wRatio * hRatio));
    const width = Math.round((wRatio * scale) / multiple) * multiple;
    const height = Math.round((hRatio * scale) / multiple) * multiple;
    return { width: Math.max(multiple, width), height: Math.max(multiple, height) };
}

/** Prefer explicit vquality; if missing, infer tier from WxH long edge. */
function faceWorkflowMegapixels(quality: string | undefined, size: string | undefined) {
    const fromQuality = runningHubQualityToMegapixels(quality);
    if (quality && String(quality).trim()) return fromQuality;
    const pixels = parsePixelSize(size || "");
    if (!pixels) return fromQuality;
    const longSide = Math.max(pixels.width, pixels.height);
    if (longSide >= 1600) return 2.0;
    if (longSide <= 900) return 0.4;
    return 0.9;
}

/**
 * 电影质感工作流 (211202…) 内置 LearnedLatentUpscale ≈1.5×：UI 清晰度应对齐 HIGH 短边，
 * 因此 ResolutionSelector megapixels 必须按 LOW≈HIGH/1.5 下探。
 * 若仍用人脸版 720→0.9 / 1080→2.0，HIGH 会到 ~1920×1104 / ~2880×1632，48G 极易 OOM。
 */
const CINEMATIC_LATENT_UPSCALE = 1.5;

function cinematicWorkflowMegapixels(quality: string | undefined) {
    const n = Number.parseInt(String(quality || "720").replace(/p$/i, ""), 10);
    if (Number.isFinite(n) && n >= 1080) return 0.9; // HIGH ≈1080 短边
    if (Number.isFinite(n) && n > 0 && n <= 480) return 0.2; // HIGH ≈480 短边
    return 0.4; // 720P → HIGH ≈720 短边（作者发布默认 0.7 更吃显存）
}

function cinematicHighDimensions(aspect: string, lowMegapixels: number) {
    const low = resolutionSelectorDimensions(aspect, lowMegapixels, 32);
    const multiple = 32;
    const width = Math.max(multiple, Math.round((low.width * CINEMATIC_LATENT_UPSCALE) / multiple) * multiple);
    const height = Math.max(multiple, Math.round((low.height * CINEMATIC_LATENT_UPSCALE) / multiple) * multiple);
    return { width, height };
}

/** Minimal node maps for SHUO video-edit AI Apps used by replacement studio. */
const WORKFLOW_NODES: Record<string, NodeBinding[]> = {
    // Scail V1
    "2064961300823896065": [
        { nodeId: "336", fieldName: "video", role: "video" },
        { nodeId: "338", fieldName: "image", role: "image" },
        { nodeId: "317", fieldName: "value", role: "prompt" },
        { nodeId: "336", fieldName: "force_rate", role: "fps" },
        { nodeId: "336", fieldName: "frame_load_cap", role: "frames" },
        { nodeId: "324", fieldName: "value", role: "resolution" },
        { nodeId: "383", fieldName: "value", role: "personCount" },
        { nodeId: "318", fieldName: "value", role: "detectPrompt" },
        { nodeId: "444", fieldName: "value", role: "replaceSubject" },
    ],
    // Scail V2 (same core nodes)
    "2065463417577762818": [
        { nodeId: "336", fieldName: "video", role: "video" },
        { nodeId: "338", fieldName: "image", role: "image" },
        { nodeId: "317", fieldName: "value", role: "prompt" },
        { nodeId: "336", fieldName: "force_rate", role: "fps" },
        { nodeId: "336", fieldName: "frame_load_cap", role: "frames" },
        { nodeId: "324", fieldName: "value", role: "resolution" },
        { nodeId: "383", fieldName: "value", role: "personCount" },
        { nodeId: "318", fieldName: "value", role: "detectPrompt" },
        { nodeId: "444", fieldName: "value", role: "replaceSubject" },
    ],
    // 视频编辑 V5.4
    "2041741496667348994": [
        { nodeId: "237", fieldName: "video", role: "video" },
        { nodeId: "237", fieldName: "frame_load_cap", role: "frames" },
        { nodeId: "234", fieldName: "image", role: "image" },
        { nodeId: "429", fieldName: "image", role: "firstFrame" },
        { nodeId: "235", fieldName: "value", role: "prompt" },
        { nodeId: "1077", fieldName: "value", role: "fps" },
        { nodeId: "222", fieldName: "value", role: "resolution" },
    ],
    // Animate2 V1
    "2086051371794657282": [
        { nodeId: "647", fieldName: "video", role: "video" },
        { nodeId: "655", fieldName: "image", role: "image" },
        { nodeId: "642", fieldName: "value", role: "prompt" },
        { nodeId: "647", fieldName: "force_rate", role: "fps" },
        { nodeId: "647", fieldName: "frame_load_cap", role: "frames" },
        { nodeId: "637", fieldName: "value", role: "resolution" },
    ],
    // Bernini V1 — rv2v (源视频 + 参考图主体替换)
    "2062515720147259393": [
        { nodeId: "170", fieldName: "video", role: "video" },
        { nodeId: "168", fieldName: "image", role: "image" },
        { nodeId: "164", fieldName: "value", role: "mode" },
        { nodeId: "165", fieldName: "value", role: "prompt" },
        { nodeId: "170", fieldName: "force_rate", role: "fps" },
        { nodeId: "166", fieldName: "value", role: "frames" },
    ],
    // 海螺 H3 视频编辑 V1
    "2091090228656680961": [
        { nodeId: "68", fieldName: "video", role: "video" },
        { nodeId: "60", fieldName: "image", role: "image" },
        { nodeId: "59", fieldName: "value", role: "prompt" },
        { nodeId: "68", fieldName: "force_rate", role: "fps" },
        { nodeId: "68", fieldName: "frame_load_cap", role: "frames" },
        { nodeId: "46", fieldName: "value", role: "resolution" },
    ],
};

export function normalizeRunningHubWorkflowId(model: string) {
    const raw = modelOptionName(model).trim().replace(/^runninghub\//i, "");
    const id = raw.includes("::") ? raw.slice(raw.lastIndexOf("::") + 2) : raw;
    const familyWorkflowId = resolveRunningHubH3FamilyWorkflowId(id);
    if (familyWorkflowId) return familyWorkflowId;
    if (runninghubCatalogNames().includes(id)) return id;
    if (/^\d{16,22}$/.test(id)) return id;
    return RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID;
}

export function isRunningHubWorkflowModel(model: string) {
    // Do not use normalizeRunningHubWorkflowId here: unknown names fall back to the default
    // Scail workflow, which would mark every Seedance / Metaso / Volcano model as RunningHub.
    const raw = modelOptionName(model).trim().replace(/^runninghub\//i, "");
    const id = raw.includes("::") ? raw.slice(raw.lastIndexOf("::") + 2) : raw;
    if (resolveRunningHubH3FamilyWorkflowId(id)) return true;
    if (runninghubCatalogNames().includes(id)) return true;
    return /^\d{16,22}$/.test(id);
}

export function resolveRunningHubVideoConfig(config: AiConfig, model: string): AiConfig {
    const request = resolveModelRequestConfig(config, model);
    if (isRunningHubBaseUrl(request.baseUrl)) return request;
    const channel = findRelayChannel(config.channels, "runninghub");
    if (!channel) return request;
    return {
        ...request,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat || request.apiFormat,
        model: encodeChannelModel(channel.id, normalizeRunningHubWorkflowId(model)),
        videoModel: encodeChannelModel(channel.id, normalizeRunningHubWorkflowId(model)),
    };
}

export function defaultRunningHubVideoModel(config: AiConfig) {
    const channel = findRelayChannel(config.channels, "runninghub");
    const workflowId = RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID;
    return channel ? encodeChannelModel(channel.id, workflowId) : workflowId;
}

async function referenceVideoToFile(video: ReferenceVideo, signal?: AbortSignal) {
    if (!video.url) throw new Error("缺少参考视频");
    const response = await fetch(video.url, { signal });
    if (!response.ok) throw new Error("参考视频下载失败");
    const blob = await response.blob();
    return new File([blob], video.name || "clip.mp4", { type: blob.type || video.type || "video/mp4" });
}

async function referenceAudioToFile(audio: ReferenceAudio, signal?: AbortSignal) {
    if (!audio.url) throw new Error("缺少参考音频");
    const response = await fetch(audio.url, { signal });
    if (!response.ok) throw new Error("参考音频下载失败");
    const blob = await response.blob();
    return new File([blob], audio.name || "ref.mp3", { type: blob.type || audio.type || "audio/mpeg" });
}

function buildNodeInfoList(
    workflowId: string,
    values: { videoFile: string; imageFile: string; prompt: string; fps: number; frames: number; resolution: number; personCount: number },
) {
    const nodes = WORKFLOW_NODES[workflowId] || WORKFLOW_NODES[RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID];
    const list: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [];
    for (const node of nodes) {
        let fieldValue = "";
        if (node.role === "video") fieldValue = values.videoFile;
        else if (node.role === "image" || node.role === "firstFrame") fieldValue = values.imageFile;
        else if (node.role === "prompt") fieldValue = values.prompt;
        else if (node.role === "fps") fieldValue = String(values.fps);
        else if (node.role === "frames") fieldValue = String(values.frames);
        else if (node.role === "resolution") fieldValue = String(values.resolution);
        else if (node.role === "personCount") fieldValue = String(values.personCount);
        else if (node.role === "detectPrompt") fieldValue = "person";
        else if (node.role === "replaceSubject") fieldValue = "false";
        else if (node.role === "mode") fieldValue = "rv2v";
        if (fieldValue === "" && node.role !== "prompt") continue;
        list.push({ nodeId: node.nodeId, fieldName: node.fieldName, fieldValue });
    }
    return list;
}

export async function createRunningHubVideoEditTask(input: {
    model: string;
    prompt: string;
    references: ReferenceImage[];
    videos?: ReferenceVideo[];
    signal?: AbortSignal;
    instanceType?: RunningHubInstanceType;
}) {
    const workflowId = normalizeRunningHubWorkflowId(input.model);
    const image = input.references[0];
    const video = input.videos?.[0];
    if (!image) throw new Error("RunningHub 视频编辑需要一张参考图（替换后的关键帧）");
    if (!video) throw new Error("RunningHub 视频编辑需要一段源视频（镜头片段）");

    const imageDataUrl = await imageToDataUrl(image);
    if (!imageDataUrl) throw new Error("参考图无效");
    const imageFile = dataUrlToFile({ ...image, dataUrl: imageDataUrl, name: image.name || "keyframe.png" });
    const videoFile = await referenceVideoToFile(video, input.signal);

    const [imageName, videoName] = await Promise.all([uploadRunningHubFile(imageFile, input.signal), uploadRunningHubFile(videoFile, input.signal)]);
    const nodeInfoList = buildNodeInfoList(workflowId, {
        videoFile: videoName,
        imageFile: imageName,
        prompt: input.prompt.trim(),
        fps: 24,
        frames: 0,
        resolution: 1024,
        personCount: 2,
    });

    const instanceType = normalizeRunningHubInstanceType(input.instanceType);
    const payload = await runRunningHubAiApp({ webappId: workflowId, nodeInfoList, instanceType }, input.signal);
    return { taskId: extractRunningHubTaskId(payload), workflowId };
}

/** Minimax_H3 人脸 / 电影质感家族生视频（Comfy /run/workflow；旧人脸 AI App id 会解析到人脸 workflow）。 */
export async function createRunningHubAiAppGenTask(input: {
    model: string;
    prompt: string;
    references: ReferenceImage[];
    videos?: ReferenceVideo[];
    audios?: ReferenceAudio[];
    signal?: AbortSignal;
    quality?: string;
    durationSec?: number;
    size?: string;
    instanceType?: RunningHubInstanceType;
    /** LoRA「去油腻」→ node 400 strength_model (0–1)；仅人脸版。 */
    deOilStrength?: number;
}) {
    const workflowId = resolveRunningHubH3FamilyWorkflowId(input.model);
    if (!workflowId) {
        throw new Error("当前 RunningHub 模型不是 Minimax_H3 人脸/电影质感工作流");
    }
    const faceWorkflow = isRunningHubH3FaceGen(input.model);
    const imageNodes = faceWorkflow ? H3_FACE_IMAGE_NODES : H3_CINEMATIC_IMAGE_NODES;
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("请先填写视频提示词");

    const imageFiles: File[] = [];
    for (const [index, image] of input.references.slice(0, imageNodes.length).entries()) {
        const dataUrl = await imageToDataUrl(image);
        if (!dataUrl) continue;
        imageFiles.push(dataUrlToFile({ ...image, dataUrl, name: image.name || `ref-${index + 1}.png` }));
    }
    const videoFiles = faceWorkflow
        ? await Promise.all(
              (input.videos || []).slice(0, H3_FACE_VIDEO_NODES.length).map((video, index) => referenceVideoToFile({ ...video, name: video.name || `ref-video-${index + 1}.mp4` }, input.signal)),
          )
        : [];
    const audioFiles = faceWorkflow
        ? await Promise.all(
              (input.audios || []).slice(0, H3_FACE_AUDIO_NODES.length).map((audio, index) => referenceAudioToFile({ ...audio, name: audio.name || `ref-audio-${index + 1}.mp3` }, input.signal)),
          )
        : [];

    const [uploadedImages, uploadedVideos, uploadedAudios] = await Promise.all([
        Promise.all(imageFiles.map((file) => uploadRunningHubFile(file, input.signal))),
        Promise.all(videoFiles.map((file) => uploadRunningHubFile(file, input.signal))),
        Promise.all(audioFiles.map((file) => uploadRunningHubFile(file, input.signal))),
    ]);

    // H3 family duration max is 30s.
    const duration = Math.max(1, Math.min(30, Math.round(Number(input.durationSec) || 5)));
    const size = input.size || "16:9";
    const megapixels = faceWorkflow ? faceWorkflowMegapixels(input.quality, size) : cinematicWorkflowMegapixels(input.quality);
    const aspect = faceResolutionSelectorAspect(size);
    // Product crop targets (short edge = quality tier): 720×1280 / 1280×720 / 1080×1920 / …
    const outputSize = computeH3FaceOutputSize(input.quality, size);
    const crop = parsePixelSize(outputSize) || { width: 1280, height: 720 };
    // Face: crop after RS. Cinematic: crop after 1.5× latent upscale (HIGH), center on HIGH WxH.
    const generated = faceWorkflow ? resolutionSelectorDimensions(aspect, megapixels, 32) : cinematicHighDimensions(aspect, megapixels);
    const cropX = Math.max(0, Math.floor((generated.width - crop.width) / 2));
    const cropY = Math.max(0, Math.floor((generated.height - crop.height) / 2));

    const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [];
    if (faceWorkflow) {
        nodeInfoList.push(
            { nodeId: "263", fieldName: "text", fieldValue: prompt },
            { nodeId: "259", fieldName: "value", fieldValue: String(duration) },
            { nodeId: "252", fieldName: "aspect_ratio", fieldValue: aspect },
            { nodeId: "252", fieldName: "megapixels", fieldValue: String(megapixels) },
            { nodeId: "400", fieldName: "strength_model", fieldValue: String(clampH3DeOilStrength(input.deOilStrength)) },
            { nodeId: "402", fieldName: "width", fieldValue: String(crop.width) },
            { nodeId: "402", fieldName: "height", fieldValue: String(crop.height) },
            { nodeId: "402", fieldName: "x", fieldValue: String(cropX) },
            { nodeId: "402", fieldName: "y", fieldValue: String(cropY) },
            { nodeId: "261", fieldName: "steps", fieldValue: "12" },
            { nodeId: "261", fieldName: "scheduler", fieldValue: "simple" },
        );
    } else {
        // Cinematic fight workflow (211202…): CR Prompt Text + RS 29 + ImageCrop 54.
        nodeInfoList.push(
            { nodeId: "28", fieldName: "prompt", fieldValue: prompt },
            { nodeId: "27", fieldName: "value", fieldValue: String(duration) },
            { nodeId: "29", fieldName: "aspect_ratio", fieldValue: aspect },
            { nodeId: "29", fieldName: "megapixels", fieldValue: String(megapixels) },
            { nodeId: "54", fieldName: "width", fieldValue: String(crop.width) },
            { nodeId: "54", fieldName: "height", fieldValue: String(crop.height) },
            { nodeId: "54", fieldName: "x", fieldValue: String(cropX) },
            { nodeId: "54", fieldName: "y", fieldValue: String(cropY) },
        );
    }
    // Fill real refs; unused slots → None to clear published demo images.
    imageNodes.forEach((nodeId, index) => {
        pushMediaSlot(nodeInfoList, nodeId, "image", uploadedImages[index], "None");
    });
    if (faceWorkflow) {
        H3_FACE_VIDEO_NODES.forEach((nodeId, index) => {
            pushMediaSlot(nodeInfoList, nodeId, "video", uploadedVideos[index], "");
        });
        H3_FACE_AUDIO_NODES.forEach((nodeId, index) => {
            pushMediaSlot(nodeInfoList, nodeId, "audio", uploadedAudios[index], "None");
        });
    }

    const instanceType = normalizeRunningHubInstanceType(input.instanceType);
    const payload = await runRunningHubWorkflow({ workflowId, nodeInfoList, instanceType }, input.signal);
    return { taskId: extractRunningHubTaskId(payload), webappId: workflowId, workflowId };
}

/** YZ金鱼 MiniMax H3 文武双全等 Comfy 生视频工作流。 */
export async function createRunningHubComfyGenTask(input: {
    model: string;
    prompt: string;
    references: ReferenceImage[];
    signal?: AbortSignal;
    megapixels?: number;
    seed?: number;
    durationSec?: number;
    size?: string;
    instanceType?: RunningHubInstanceType;
}) {
    const workflowId = normalizeRunningHubWorkflowId(input.model);
    if (workflowId !== RUNNINGHUB_H3_WENWU_WORKFLOW_ID && !isRunningHubComfyGenWorkflow(workflowId)) {
        throw new Error("当前 RunningHub 模型不是可直接生视频的 Comfy 工作流");
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("请先填写视频提示词");

    const imageFiles: File[] = [];
    for (const [index, image] of input.references.slice(0, H3_WENWU_IMAGE_NODES.length).entries()) {
        const dataUrl = await imageToDataUrl(image);
        if (!dataUrl) continue;
        imageFiles.push(dataUrlToFile({ ...image, dataUrl, name: image.name || `ref-${index + 1}.png` }));
    }
    const uploaded = await Promise.all(imageFiles.map((file) => uploadRunningHubFile(file, input.signal)));

    const duration = Math.max(1, Math.min(30, Math.round(Number(input.durationSec) || 12)));
    const megapixels = Number.isFinite(input.megapixels) && (input.megapixels || 0) > 0 ? Number(input.megapixels) : 1.5;
    const aspect = resolutionSelectorAspect(input.size || "16:9");
    const seed = input.seed != null && Number.isFinite(input.seed) && input.seed >= 0 ? Math.floor(input.seed) : Math.floor(Math.random() * 1_000_000_000);

    const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [
        { nodeId: "263", fieldName: "text", fieldValue: prompt },
        { nodeId: "259", fieldName: "value", fieldValue: String(duration) },
        { nodeId: "252", fieldName: "aspect_ratio", fieldValue: aspect },
        { nodeId: "252", fieldName: "megapixels", fieldValue: String(megapixels) },
        { nodeId: "397", fieldName: "seed", fieldValue: String(seed) },
    ];
    // Fill real refs; unused LoadImage → "None" (clear demo assets). No mode field.
    H3_WENWU_IMAGE_NODES.forEach((nodeId, index) => {
        pushMediaSlot(nodeInfoList, nodeId, "image", uploaded[index], "None");
    });

    const instanceType = input.instanceType ? normalizeRunningHubInstanceType(input.instanceType) : megapixels >= 1.0 ? "plus" : "default";
    const payload = await runRunningHubWorkflow(
        {
            workflowId,
            nodeInfoList,
            instanceType,
        },
        input.signal,
    );
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
    const taskId = extractRunningHubTaskId(payload);
    const tips = typeof data.promptTips === "string" ? data.promptTips : "";
    if (tips && /node_errors|error/i.test(tips) && !/\"node_errors\":\s*\{\}/.test(tips)) {
        throw new Error(`RunningHub 工作流参数校验失败：${tips.slice(0, 400)}`);
    }
    return { taskId, workflowId };
}

/** Best-effort cache download; must not block SUCCESS completion (RH contract: SUCCESS is terminal). */
async function tryCacheRunningHubVideo(url: string, signal?: AbortSignal, timeoutMs = 600_000) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await downloadRunningHubResultFile(url, controller.signal);
    } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}

export async function pollRunningHubVideoEditTask(taskId: string, signal?: AbortSignal) {
    const payload = await queryRunningHubTask(taskId, signal);
    const state = runningHubTaskState(payload);
    const credits = extractRunningHubCredits(payload);
    const usage = credits ? { promptTokens: 0, completionTokens: 0, totalTokens: 0, credits } : undefined;
    if (state.status === "failed") return { status: "failed" as const, error: state.message || "RunningHub 任务失败", usage };
    if (state.status === "completed") {
        // Official v2: SUCCESS + results[].url. Prefer mp4/webm/mov when multiple outputs exist.
        const url =
            state.results.find((item) => /\.(mp4|webm|mov)(\?|$)/i.test(item)) ||
            state.results.find((item) => /outputType["']?\s*:\s*["']?(mp4|webm|mov)/i.test(item)) ||
            state.results[0];
        if (!url) return { status: "failed" as const, error: "RunningHub 完成但没有返回视频地址" };
        // Do not keep UI on「生成中」while caching: SUCCESS already means done.
        try {
            const blob = await tryCacheRunningHubVideo(url, signal);
            return { status: "completed" as const, result: { blob, url, mimeType: blob.type || "video/mp4" }, usage };
        } catch (error) {
            if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
                // Parent abort → propagate; download timeout alone → still complete with remote URL.
                if (signal?.aborted) throw error;
            }
            return { status: "completed" as const, result: { url, mimeType: "video/mp4" }, usage };
        }
    }
    return { status: "pending" as const };
}
