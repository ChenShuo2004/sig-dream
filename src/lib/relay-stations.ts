import { createModelChannel, guessCapability, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import type { OnionModelProfile } from "@/services/api/onion-relay";

export type RelayStationId = "openlux" | "ai007" | "onion" | "geeknow" | "runninghub" | "apimart" | "deepseek" | "metaso" | "volcengine" | "crun";

export const RELAY_STATIONS: Array<{ id: RelayStationId; label: string; baseUrl: string }> = [
    { id: "openlux", label: "OpenLux", baseUrl: "https://api.openlux.ai" },
    { id: "ai007", label: "AI007", baseUrl: "https://api.ai007.my" },
    { id: "onion", label: "OnionCreate", baseUrl: "https://ai.onioncreate.xyz" },
    { id: "geeknow", label: "Geeknow", baseUrl: "https://www.geeknow.top" },
    { id: "runninghub", label: "RunningHub", baseUrl: "https://www.runninghub.cn" },
    { id: "metaso", label: "秘塔 Metaso", baseUrl: "https://metaso.cn/api/minimax" },
    { id: "volcengine", label: "火山引擎", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    { id: "crun", label: "CRUN", baseUrl: "https://api.crun.ai/api/v1" },
    { id: "apimart", label: "APIMart", baseUrl: "https://api.apimart.ai" },
    { id: "deepseek", label: "DeepSeek 官方", baseUrl: "https://api.deepseek.com" },
];

/** Volcano Ark Seedance 2.0 — https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks */
const VOLCENGINE_MODELS: Array<{
    name: string;
    capability: ModelCapability;
    label: string;
    allowedDurations?: number[];
    resolutions?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
}> = [
    {
        name: "doubao-seedance-2-0-260128",
        capability: "video",
        label: "Seedance 2.0",
        allowedDurations: [4, 15],
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
    {
        name: "doubao-seedance-2-0-fast-260128",
        capability: "video",
        label: "Seedance 2.0 Fast",
        allowedDurations: [4, 15],
        // Official: Fast 仅 480p / 720p（无 1080p / 4k）
        resolutions: ["480p", "720p"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
    {
        name: "doubao-seedance-2-0-mini-260615",
        capability: "video",
        label: "Seedance 2.0 Mini",
        allowedDurations: [4, 15],
        // Official: Mini 仅 480p / 720p（无 1080p / 4k）
        resolutions: ["480p", "720p"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
];

/** Volcano / Metaso Seedance 2.0 系列（含 Fast / Mini），用于 UI 参数对齐。 */
export function isSeedance20Model(model: string) {
    const name = (model.split("::").pop() || model).trim().toLowerCase();
    return name.includes("doubao-seedance-2-0") || name.includes("seedance-2.0") || name === "kontony-seedance-2.0";
}

/** Metaso MiniMax v2 models — https://metaso.cn/minimax-h3 / API 调用文档 */
const METASO_MODELS: Array<{
    name: string;
    capability: ModelCapability;
    label: string;
    allowedDurations?: number[];
    resolutions?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
}> = [
    {
        name: "seedance-2.0",
        capability: "video",
        label: "Seedance 2.0 标准版",
        allowedDurations: [4, 15],
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
    {
        name: "seedance-2.0-mini",
        capability: "video",
        label: "Seedance 2.0 Mini",
        allowedDurations: [4, 15],
        resolutions: ["480p", "720p"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
    {
        name: "MiniMax-H3",
        capability: "video",
        label: "MiniMax-H3",
        allowedDurations: [4, 30],
        resolutions: ["480p", "768p", "1080p", "2k"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
];

/**
 * CRUN unified task API — https://docs.crun.ai/zh
 * Video names are families. The caller picks t2v / i2v / r2v from the references.
 * LLM ids come from GET /api/v1/models after the key is saved.
 */
const CRUN_MODELS: Array<{
    name: string;
    capability: ModelCapability;
    label: string;
    allowedDurations?: number[];
    resolutions?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
}> = [
    { name: "openai/gpt-image-2", capability: "image", label: "GPT Image 2", maxImages: 16 },
    { name: "google/nano-banana-2", capability: "image", label: "Nano Banana 2", maxImages: 14 },
    { name: "google/nano-banana-pro", capability: "image", label: "Nano Banana Pro", maxImages: 14 },
    {
        name: "bytedance/seedance2-0",
        capability: "video",
        label: "Seedance 2.0",
        allowedDurations: [4, 15],
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
    {
        name: "minimax/h3",
        capability: "video",
        label: "MiniMax-H3",
        allowedDurations: [4, 15],
        resolutions: ["480P", "768P", "2K"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    },
];

/** Official DeepSeek OpenAI-compatible chat models — https://api-docs.deepseek.com/ */
const DEEPSEEK_MODELS: Array<{ name: string; capability: ModelCapability; label?: string }> = [
    { name: "deepseek-flash", capability: "text", label: "DeepSeek Flash" },
    { name: "deepseek-v4-pro", capability: "text", label: "DeepSeek V4 Pro" },
    { name: "deepseek-v4-flash", capability: "text", label: "DeepSeek V4 Flash（兼容）" },
];

/** Curated catalog from https://apimart.ai/zh/model — fill more via GET /v1/models?expand=category. */
const APIMART_MODELS: Array<{ name: string; capability: ModelCapability; label?: string }> = [
    // text / LLM (大语言) — common chat ids on APIMart
    { name: "gpt-5", capability: "text", label: "GPT-5" },
    { name: "gpt-4o", capability: "text", label: "GPT-4o" },
    { name: "gpt-4o-mini", capability: "text", label: "GPT-4o Mini" },
    { name: "gpt-4.1", capability: "text", label: "GPT-4.1" },
    { name: "gpt-4.1-mini", capability: "text", label: "GPT-4.1 Mini" },
    { name: "gpt-4.1-nano", capability: "text", label: "GPT-4.1 Nano" },
    { name: "o3", capability: "text", label: "o3" },
    { name: "o3-mini", capability: "text", label: "o3 Mini" },
    { name: "o4-mini", capability: "text", label: "o4 Mini" },
    { name: "chatgpt-4o-latest", capability: "text", label: "ChatGPT-4o Latest" },
    { name: "claude-fable-5.1", capability: "text", label: "Claude Fable 5.1" },
    { name: "claude-fable-5", capability: "text", label: "Claude Fable 5" },
    { name: "claude-opus-5", capability: "text", label: "Claude Opus 5" },
    { name: "claude-sonnet-5", capability: "text", label: "Claude Sonnet 5" },
    { name: "claude-opus-4.5", capability: "text", label: "Claude Opus 4.5" },
    { name: "claude-sonnet-4.5", capability: "text", label: "Claude Sonnet 4.5" },
    { name: "claude-haiku-4.5", capability: "text", label: "Claude Haiku 4.5" },
    { name: "claude-opus-4", capability: "text", label: "Claude Opus 4" },
    { name: "claude-sonnet-4", capability: "text", label: "Claude Sonnet 4" },
    { name: "claude-3-7-sonnet-latest", capability: "text", label: "Claude 3.7 Sonnet" },
    { name: "claude-3-5-sonnet-latest", capability: "text", label: "Claude 3.5 Sonnet" },
    { name: "claude-3-5-haiku-latest", capability: "text", label: "Claude 3.5 Haiku" },
    { name: "deepseek-v4.1-flash", capability: "text", label: "DeepSeek V4.1 Flash" },
    { name: "deepseek-v4-flash", capability: "text", label: "DeepSeek V4 Flash" },
    { name: "deepseek-v4-pro", capability: "text", label: "DeepSeek V4 Pro" },
    { name: "deepseek-v3", capability: "text", label: "DeepSeek V3" },
    { name: "deepseek-v3.1", capability: "text", label: "DeepSeek V3.1" },
    { name: "deepseek-r1", capability: "text", label: "DeepSeek R1" },
    { name: "deepseek-chat", capability: "text", label: "DeepSeek Chat" },
    { name: "gemini-2.5-pro", capability: "text", label: "Gemini 2.5 Pro" },
    { name: "gemini-2.5-flash", capability: "text", label: "Gemini 2.5 Flash" },
    { name: "gemini-2.5-flash-lite", capability: "text", label: "Gemini 2.5 Flash Lite" },
    { name: "gemini-2.5-flash-nothinking", capability: "text", label: "Gemini 2.5 Flash No Thinking" },
    { name: "gemini-2.0-flash", capability: "text", label: "Gemini 2.0 Flash" },
    { name: "gemini-2.0-flash-thinking", capability: "text", label: "Gemini 2.0 Flash Thinking" },
    { name: "gemini-1.5-pro", capability: "text", label: "Gemini 1.5 Pro" },
    { name: "qwen3.8-max", capability: "text", label: "Qwen3.8 Max" },
    { name: "qwen-max", capability: "text", label: "Qwen Max" },
    { name: "qwen-plus", capability: "text", label: "Qwen Plus" },
    { name: "qwen-turbo", capability: "text", label: "Qwen Turbo" },
    { name: "qwen2.5-72b-instruct", capability: "text", label: "Qwen2.5 72B" },
    { name: "qwq-plus", capability: "text", label: "QwQ Plus" },
    { name: "grok-4", capability: "text", label: "Grok 4" },
    { name: "grok-3", capability: "text", label: "Grok 3" },
    { name: "grok-3-mini", capability: "text", label: "Grok 3 Mini" },
    { name: "grok-2", capability: "text", label: "Grok 2" },
    { name: "doubao-1.5-pro-32k", capability: "text", label: "Doubao 1.5 Pro" },
    { name: "doubao-pro-32k", capability: "text", label: "Doubao Pro 32k" },
    { name: "doubao-lite-32k", capability: "text", label: "Doubao Lite 32k" },
    { name: "glm-4.5", capability: "text", label: "GLM-4.5" },
    { name: "glm-4-plus", capability: "text", label: "GLM-4 Plus" },
    { name: "glm-z1-flash", capability: "text", label: "GLM-Z1 Flash" },
    { name: "kimi-k2", capability: "text", label: "Kimi K2" },
    { name: "moonshot-v1-128k", capability: "text", label: "Moonshot v1 128k" },
    { name: "minimax-m3", capability: "text", label: "MiniMax M3" },
    { name: "minimax-m2.7", capability: "text", label: "MiniMax M2.7" },
    { name: "MiniMax-Text-01", capability: "text", label: "MiniMax Text 01" },
    // image
    { name: "gpt-image-2", capability: "image", label: "GPT Image 2" },
    { name: "gpt-image-2.5-flare", capability: "image", label: "GPT Image 2.5 Flare" },
    { name: "gpt-image-2.5-sunburst", capability: "image", label: "GPT Image 2.5 Sunburst" },
    { name: "seedream-4.5", capability: "image", label: "Seedream 4.5" },
    { name: "seedream-5.0-lite", capability: "image", label: "Seedream 5.0 Lite" },
    { name: "seedream-5.0-pro", capability: "image", label: "Seedream 5.0 Pro" },
    { name: "seedream-5.0-flash", capability: "image", label: "Seedream 5.0 Flash" },
    { name: "nano-banana", capability: "image", label: "Nano Banana" },
    { name: "nano-banana-2", capability: "image", label: "Nano Banana 2" },
    { name: "nano-banana-pro", capability: "image", label: "Nano Banana Pro" },
    { name: "flux-kontext-pro", capability: "image", label: "Flux Kontext Pro" },
    { name: "flux-2-pro", capability: "image", label: "Flux 2 Pro" },
    { name: "qwen-image-3.0", capability: "image", label: "Qwen Image 3.0" },
    { name: "z-image-turbo", capability: "image", label: "Z Image Turbo" },
    // video
    { name: "seedance-2.0", capability: "video", label: "Seedance 2.0" },
    { name: "seedance-2.0-fast", capability: "video", label: "Seedance 2.0 Fast" },
    { name: "seedance-2.5", capability: "video", label: "Seedance 2.5" },
    { name: "kling-v3", capability: "video", label: "Kling V3" },
    { name: "kling-v2.6", capability: "video", label: "Kling V2.6" },
    { name: "kling-3.0-turbo", capability: "video", label: "Kling 3.0 Turbo" },
    { name: "veo3.1", capability: "video", label: "Veo 3.1" },
    { name: "wan2.6", capability: "video", label: "Wan 2.6" },
    { name: "wan2.7", capability: "video", label: "Wan 2.7" },
    { name: "minimax-hailuo-2.3", capability: "video", label: "MiniMax Hailuo 2.3" },
    { name: "MiniMax-H3", capability: "video", label: "MiniMax H3" },
    { name: "pixverse-v6", capability: "video", label: "Pixverse V6" },
    { name: "skyreels-v4-fast", capability: "video", label: "SkyReels V4 Fast" },
    { name: "grok-imagine-video", capability: "video", label: "Grok Imagine Video" },
    // audio
    { name: "tts-1", capability: "audio", label: "TTS-1" },
    { name: "tts-1-hd", capability: "audio", label: "TTS-1 HD" },
    { name: "whisper-1", capability: "audio", label: "Whisper-1" },
];

const AI007_MODELS: Array<{ name: string; capability: ModelCapability }> = [
    { name: "seedream-4-5", capability: "image" },
    { name: "seedream-4-5-1k", capability: "image" },
    { name: "seedream-4-5-2k", capability: "image" },
    { name: "seedream-4-5-4k", capability: "image" },
    { name: "seedream-5-0-pro", capability: "image" },
    { name: "seedream-5-0-pro-1k", capability: "image" },
    { name: "seedream-5-0-pro-2k", capability: "image" },
    { name: "seedream-5-0-pro-4k", capability: "image" },
    { name: "doubao-seedream-4-0-1k", capability: "image" },
    { name: "hailuo-image", capability: "image" },
    { name: "H3", capability: "video" },
    { name: "H3-max", capability: "video" },
    { name: "hailuo-2.3", capability: "video" },
    { name: "seedance-2.5", capability: "video" },
    { name: "seedance-2.5-5s", capability: "video" },
    { name: "seedance-2.5-10s", capability: "video" },
    { name: "seedance-2.5-30s", capability: "video" },
    { name: "seedance-2.0-fast", capability: "video" },
    { name: "seedance-2.0-fast-5s", capability: "video" },
    { name: "seedance-2.0-fast-10s", capability: "video" },
    { name: "seedance-2.0-fast-15s", capability: "video" },
    { name: "doubao-lite-32k", capability: "text" },
    { name: "doubao-pro-32k", capability: "text" },
    { name: "minimax-m2.7", capability: "text" },
    { name: "minimax-m3", capability: "text" },
];

/** SHUO 替换工作室视频编辑用的 RunningHub AI App workflowId（页面：/ai-detail/{id}）。 */
export const RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID = "2064961300823896065";

/** YZ金鱼 MiniMax H3 终极篇-文武双全（Comfy 工作流 /post|/run/workflow）。 */
export const RUNNINGHUB_H3_WENWU_WORKFLOW_ID = "2109907990638850050";

/**
 * Minimax_H3 人脸优化版（Comfy 工作流 /openapi/v2/run/workflow/{id}）。
 * 旧 AI App id 仅作兼容别名，提交时一律解析到本 workflowId。
 */
export const RUNNINGHUB_H3_FACE_WORKFLOW_ID = "2111749073912025090";
/** @deprecated 旧 AI App id（2111770992677838849）；请用 RUNNINGHUB_H3_FACE_WORKFLOW_ID。 */
export const RUNNINGHUB_H3_FACE_APP_ID = "2111770992677838849";

/**
 * Minimax_H3 电影质感打斗流畅（Comfy /run/workflow）。
 * 与人脸版同裁剪/清晰度/比例；最多 9 图参考；无视频/音频参考、无去油腻。
 */
export const RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID = "2112022441269747713";

export type RunningHubVideoKind = "edit" | "comfy-gen" | "ai-app-gen";

type RunningHubModel = {
    name: string;
    capability: ModelCapability;
    label: string;
    kind: RunningHubVideoKind;
    /** When set, video seconds slider uses min/max of this list (continuous between). */
    allowedDurations?: number[];
};

const RUNNINGHUB_MODELS: RunningHubModel[] = [
    { name: RUNNINGHUB_DEFAULT_VIDEO_WORKFLOW_ID, capability: "video", label: "视频编辑 Scail V1", kind: "edit" },
    { name: "2065463417577762818", capability: "video", label: "视频编辑 Scail V2", kind: "edit" },
    { name: "2041741496667348994", capability: "video", label: "视频编辑 V5.4", kind: "edit" },
    { name: "2086051371794657282", capability: "video", label: "视频编辑 Animate2", kind: "edit" },
    { name: "2062515720147259393", capability: "video", label: "视频编辑 Bernini V1", kind: "edit" },
    { name: "2091090228656680961", capability: "video", label: "视频编辑 Hailuo H3 Edit", kind: "edit" },
    { name: RUNNINGHUB_H3_WENWU_WORKFLOW_ID, capability: "video", label: "YZ金鱼 · MiniMax H3 终极篇-文武双全", kind: "comfy-gen", allowedDurations: [4, 30] },
    // Face / cinematic: duration max 30s; tiers 480/720/1080; ratios 9:16|16:9 only. kind kept for AV-slot routing.
    { name: RUNNINGHUB_H3_FACE_WORKFLOW_ID, capability: "video", label: "Minimax_H3 人脸优化版", kind: "ai-app-gen", allowedDurations: [4, 30] },
    { name: RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID, capability: "video", label: "Minimax_H3 电影质感打斗流畅", kind: "ai-app-gen", allowedDurations: [4, 30] },
];

/** Channel model resolutions for H3 face / cinematic family (UI + modelResolutions). */
export const RUNNINGHUB_H3_FACE_RESOLUTIONS = ["480", "720", "1080"] as const;

/** H3 face / cinematic UI ratios only (no auto / 3:4 / …). */
export const RUNNINGHUB_H3_FACE_RATIOS = ["9:16", "16:9"] as const;

export function runninghubVideoCatalog(kind?: RunningHubVideoKind) {
    const list = kind ? RUNNINGHUB_MODELS.filter((model) => model.kind === kind) : RUNNINGHUB_MODELS;
    return list.map((model) => ({ name: model.name, capability: model.capability, label: model.label, kind: model.kind }));
}

export function runninghubModelKind(name: string): RunningHubVideoKind | null {
    return RUNNINGHUB_MODELS.find((model) => model.name === name)?.kind || null;
}

function runningHubBareId(name: string) {
    const bare = name.trim().replace(/^runninghub\//i, "");
    return bare.includes("::") ? bare.slice(bare.lastIndexOf("::") + 2) : bare;
}

export function isRunningHubComfyGenWorkflow(name: string) {
    const id = runningHubBareId(name);
    if (resolveRunningHubH3FamilyWorkflowId(id)) return false;
    return runninghubModelKind(id) === "comfy-gen" || id === RUNNINGHUB_H3_WENWU_WORKFLOW_ID;
}

/** Resolve face model (workflow id or legacy AI App id) → workflow id for /run/workflow. */
export function resolveRunningHubH3FaceWorkflowId(name: string) {
    const id = runningHubBareId(name);
    if (id === RUNNINGHUB_H3_FACE_WORKFLOW_ID || id === RUNNINGHUB_H3_FACE_APP_ID) return RUNNINGHUB_H3_FACE_WORKFLOW_ID;
    return "";
}

/** Resolve cinematic fight workflow → workflow id for /run/workflow. */
export function resolveRunningHubH3CinematicWorkflowId(name: string) {
    const id = runningHubBareId(name);
    if (id === RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID) return RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID;
    return "";
}

/** Face or cinematic → Comfy workflow id. */
export function resolveRunningHubH3FamilyWorkflowId(name: string) {
    return resolveRunningHubH3FaceWorkflowId(name) || resolveRunningHubH3CinematicWorkflowId(name);
}

/** Minimax_H3 人脸优化版（图/音/视频槽位 + 去油腻）；走 Comfy /run/workflow。 */
export function isRunningHubH3FaceGen(name: string) {
    return Boolean(resolveRunningHubH3FaceWorkflowId(name));
}

/** Minimax_H3 电影质感打斗流畅（仅图参考，无音视频/去油腻）。 */
export function isRunningHubH3CinematicGen(name: string) {
    return Boolean(resolveRunningHubH3CinematicWorkflowId(name));
}

/**
 * H3 人脸 / 电影质感家族：同裁剪档位与比例、最多 9 图、Comfy /run/workflow。
 * 音视频槽位与去油腻仅人脸版有。
 */
export function isRunningHubH3FamilyGen(name: string) {
    return Boolean(resolveRunningHubH3FamilyWorkflowId(name)) || runninghubModelKind(runningHubBareId(name)) === "ai-app-gen";
}

/** RunningHub 上的 MiniMax-H3（人脸 / 电影质感 / 文武双全，以及该渠道里名称含 MiniMax H3 的视频模型）。时长上限 30 秒。 */
export function isRunningHubMinimaxH3Video(model: string, extra?: { label?: string; baseUrl?: string }) {
    const bare = runningHubBareId(model);
    if (
        bare === RUNNINGHUB_H3_FACE_WORKFLOW_ID ||
        bare === RUNNINGHUB_H3_FACE_APP_ID ||
        bare === RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID ||
        bare === RUNNINGHUB_H3_WENWU_WORKFLOW_ID ||
        isRunningHubH3FamilyGen(bare)
    ) {
        return true;
    }
    if (!extra?.baseUrl || !isRunningHubBaseUrl(extra.baseUrl)) return false;
    return /minimax[\s_-]*h3/i.test(`${extra.label || ""} ${bare}`);
}

/** @deprecated 使用 isRunningHubH3FamilyGen；历史命名保留给创作台 / 剧本工作室判断。 */
export function isRunningHubAiAppGen(name: string) {
    return isRunningHubH3FamilyGen(name);
}

/** H3 家族：分辨率强制 480P / 720P / 1080P（映射 ResolutionSelector megapixels）。 */
export function isRunningHubFixedQualityTiers(name: string) {
    return isRunningHubH3FamilyGen(name);
}

/** 480P→0.4MP，720P→0.9MP，1080P→2.0MP（生成略大于标准像素，再由 ImageCrop 裁到精确 WxH）。 */
export function runningHubQualityToMegapixels(quality: string | undefined) {
    const n = Number.parseInt(String(quality || "720").replace(/p$/i, ""), 10);
    if (Number.isFinite(n) && n >= 1080) return 2.0;
    if (Number.isFinite(n) && n > 0 && n <= 480) return 0.4;
    return 0.9;
}

export const RUNNINGHUB_FIXED_QUALITY_OPTIONS = [
    { value: "480", label: "480P" },
    { value: "720", label: "720P" },
    { value: "1080", label: "1080P" },
] as const;

/** RunningHub 运行模式 → 显存档位（API instanceType）。 ultra/84G 产品侧停用（不更快、更贵）。 */
export type RunningHubInstanceType = "default" | "plus" | "ultra";

export const RUNNINGHUB_INSTANCE_OPTIONS = [
    { value: "default" as const, vram: "24G", disabled: false },
    { value: "plus" as const, vram: "48G", disabled: false },
    { value: "ultra" as const, vram: "84G", disabled: true },
] as const;

/** Face workflow LoRA「去油腻」(node 400 strength_model): 0–1, default 0.4. */
export const H3_FACE_DEOIL_DEFAULT = 0.4;

export function clampH3DeOilStrength(value: string | number | undefined | null) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").trim());
    if (!Number.isFinite(n)) return H3_FACE_DEOIL_DEFAULT;
    return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export function normalizeRunningHubInstanceType(value: string | undefined | null): RunningHubInstanceType {
    // RH OpenAPI: default=24G, plus=48G, ultra=84G — ultra is disabled in UI and coerced to plus.
    const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    if (raw === "plus" || raw === "48" || raw === "48g" || raw === "48gb") return "plus";
    if (raw === "ultra" || raw === "84" || raw === "84g" || raw === "84gb") return "plus";
    if (raw.includes("plus") || /(^|[^0-9])48g?\b/.test(raw)) return "plus";
    if (raw.includes("ultra") || /(^|[^0-9])84g?\b/.test(raw)) return "plus";
    return "default";
}

export function ai007CatalogNames() {
    return AI007_MODELS.map((model) => model.name);
}

export function runninghubCatalogNames() {
    return RUNNINGHUB_MODELS.map((model) => model.name);
}

export function runninghubModelLabel(name: string) {
    return RUNNINGHUB_MODELS.find((model) => model.name === name)?.label || "";
}

export function relayStationOf(channel: Pick<ModelChannel, "baseUrl" | "name"> | null | undefined): RelayStationId | null {
    const host = channelHost(channel?.baseUrl || "");
    if (host.includes("openlux.ai")) return "openlux";
    if (host.includes("ai007.my")) return "ai007";
    if (host.includes("onioncreate.xyz")) return "onion";
    if (host.includes("geeknow.top")) return "geeknow";
    if (host.includes("runninghub.cn") || host.includes("runninghub.ai")) return "runninghub";
    if (host.includes("metaso.cn")) return "metaso";
    if (host.includes("volces.com") || host.includes("volcengine.com") || host.includes("volcengineapi.com")) return "volcengine";
    if (host.includes("apimart.ai")) return "apimart";
    if (host.includes("deepseek.com")) return "deepseek";
    if (host.includes("crun.ai")) return "crun";
    const name = (channel?.name || "").trim().toLowerCase();
    if (name === "openlux") return "openlux";
    if (name === "ai007") return "ai007";
    if (name === "onioncreate") return "onion";
    if (name === "geeknow") return "geeknow";
    if (name === "runninghub") return "runninghub";
    if (name === "metaso" || name === "秘塔" || name === "秘塔 metaso") return "metaso";
    if (name === "volcengine" || name === "火山引擎" || name === "火山方舟") return "volcengine";
    if (name === "apimart") return "apimart";
    if (name === "deepseek" || name === "deepseek 官方") return "deepseek";
    if (name === "crun") return "crun";
    return null;
}

export function isAi007BaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("ai007.my");
}

export function isOnionBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("onioncreate.xyz");
}

export function isGeeknowBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("geeknow.top");
}

export function isRunningHubBaseUrl(baseUrl: string) {
    const host = channelHost(baseUrl);
    return host.includes("runninghub.cn") || host.includes("runninghub.ai");
}

export function isMetasoBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("metaso.cn");
}

export function isVolcengineBaseUrl(baseUrl: string) {
    const host = channelHost(baseUrl);
    return host.includes("volces.com") || host.includes("volcengine.com") || host.includes("volcengineapi.com");
}

export function isApimartBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("apimart.ai");
}

export function metasoCatalogNames() {
    return METASO_MODELS.map((model) => model.name);
}

export function volcengineCatalogNames() {
    return VOLCENGINE_MODELS.map((model) => model.name);
}

export function createMetasoChannel(): ModelChannel {
    return createModelChannel({
        id: "metaso",
        name: "秘塔 Metaso",
        baseUrl: "https://metaso.cn/api/minimax",
        apiKey: "",
        apiFormat: "openai",
        models: METASO_MODELS.map((model) => ({ ...model })),
    });
}

export function createVolcengineChannel(): ModelChannel {
    return createModelChannel({
        id: "volcengine",
        name: "火山引擎",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "",
        apiFormat: "openai",
        models: VOLCENGINE_MODELS.map((model) => ({ ...model })),
    });
}

export function ensureVolcengineChannel(channels: ModelChannel[]) {
    const existing = findRelayChannel(channels, "volcengine");
    if (!existing) return { channels: [...channels, createVolcengineChannel()], changed: true };
    let changed = false;
    let models = existing.models.map((model) => {
        const preset = VOLCENGINE_MODELS.find((item) => item.name === model.name);
        if (!preset) return model;
        let next = model;
        if (!(model.label || "").trim() && preset.label) {
            next = { ...next, label: preset.label };
            changed = true;
        }
        const presetRes = preset.resolutions || [];
        const currentRes = model.resolutions || [];
        const presetDur = preset.allowedDurations || [];
        const currentDur = model.allowedDurations || [];
        // Force-sync catalog specs so Fast/Mini 分辨率修正能落到已保存渠道。
        if (JSON.stringify(presetRes) !== JSON.stringify(currentRes) || JSON.stringify(presetDur) !== JSON.stringify(currentDur)) {
            next = {
                ...next,
                resolutions: presetRes.length ? [...presetRes] : undefined,
                allowedDurations: presetDur.length ? [...presetDur] : undefined,
                maxImages: preset.maxImages ?? next.maxImages,
                maxVideos: preset.maxVideos ?? next.maxVideos,
                maxAudios: preset.maxAudios ?? next.maxAudios,
            };
            changed = true;
        } else if (next.maxImages == null || next.maxVideos == null || next.maxAudios == null) {
            next = {
                ...next,
                maxImages: next.maxImages ?? preset.maxImages,
                maxVideos: next.maxVideos ?? preset.maxVideos,
                maxAudios: next.maxAudios ?? preset.maxAudios,
            };
            changed = true;
        }
        return next;
    });
    // Do not re-add catalog models the admin deleted — only refresh specs on already-selected rows.
    if (!changed) return { channels, changed: false };
    return {
        channels: channels.map((channel) => (relayStationOf(channel) === "volcengine" ? { ...channel, models } : channel)),
        changed: true,
    };
}

export function ensureMetasoChannel(channels: ModelChannel[]) {
    const existing = findRelayChannel(channels, "metaso");
    if (!existing) return { channels: [...channels, createMetasoChannel()], changed: true };
    let changed = false;
    let models = existing.models.map((model) => {
        const preset = METASO_MODELS.find((item) => item.name === model.name);
        if (!preset) return model;
        let next = model;
        if (!(model.label || "").trim() && preset.label) {
            next = { ...next, label: preset.label };
            changed = true;
        }
        const needRes = !(model.resolutions || []).length && (preset.resolutions || []).length;
        const needDur = !(model.allowedDurations || []).length && (preset.allowedDurations || []).length;
        if (needRes || needDur) {
            next = {
                ...next,
                ...(needRes ? { resolutions: [...(preset.resolutions || [])] } : {}),
                ...(needDur ? { allowedDurations: [...(preset.allowedDurations || [])] } : {}),
            };
            changed = true;
        }
        return next;
    });
    // Do not re-add catalog models the admin deleted.
    if (!changed) return { channels, changed: false };
    return {
        channels: channels.map((channel) => (relayStationOf(channel) === "metaso" ? { ...channel, models } : channel)),
        changed: true,
    };
}

export function isDeepSeekBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("deepseek.com");
}

export function isCrunBaseUrl(baseUrl: string) {
    return channelHost(baseUrl).includes("crun.ai");
}

export function crunCatalogNames() {
    return CRUN_MODELS.map((model) => model.name);
}

export function createCrunChannel(): ModelChannel {
    return createModelChannel({
        id: "crun",
        name: "CRUN",
        baseUrl: "https://api.crun.ai/api/v1",
        apiKey: "",
        apiFormat: "openai",
        models: CRUN_MODELS.map((model) => ({ ...model })),
    });
}

export function ensureCrunChannel(channels: ModelChannel[]) {
    const existing = findRelayChannel(channels, "crun");
    if (!existing) return { channels: [...channels, createCrunChannel()], changed: true };
    let changed = false;
    let models = existing.models.map((model) => {
        const preset = CRUN_MODELS.find((item) => item.name === model.name);
        if (!preset) return model;
        let next = model;
        if (!(model.label || "").trim() && preset.label) {
            next = { ...next, label: preset.label };
            changed = true;
        }
        if (!(model.resolutions || []).length && (preset.resolutions || []).length) {
            next = { ...next, resolutions: [...(preset.resolutions || [])] };
            changed = true;
        }
        if (!(model.allowedDurations || []).length && (preset.allowedDurations || []).length) {
            next = { ...next, allowedDurations: [...(preset.allowedDurations || [])] };
            changed = true;
        }
        return next;
    });
    // Do not re-add catalog models the admin deleted.
    if (!changed) return { channels, changed: false };
    return {
        channels: channels.map((channel) => (relayStationOf(channel) === "crun" ? { ...channel, models } : channel)),
        changed: true,
    };
}

export function apimartCatalogNames() {
    return APIMART_MODELS.map((model) => model.name);
}

export function deepseekCatalogNames() {
    return DEEPSEEK_MODELS.map((model) => model.name);
}

export function findRelayChannel(channels: ModelChannel[], station: RelayStationId) {
    return channels.find((channel) => relayStationOf(channel) === station) || null;
}

export function createAi007Channel(): ModelChannel {
    return createModelChannel({
        id: "ai007",
        name: "AI007",
        baseUrl: "https://api.ai007.my",
        apiKey: "",
        apiFormat: "openai",
        models: AI007_MODELS.map((model) => ({ ...model })),
    });
}

/**
 * OnionCreate video models (https://ai.onioncreate.xyz).
 * id = API model_id；label = 网站展示名。Live `/v1/models` 会刷新时长/价格/分辨率。
 */
const ONION_MODELS: Array<{
    name: string;
    capability: ModelCapability;
    label: string;
    allowedDurations?: number[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
}> = [
    { name: "wanzhou-seedance-2.0", capability: "video", label: "原生SD2.0 720P 933（推荐）" },
    { name: "wanzhou-seedance-2.5", capability: "video", label: "原生SD2.5 720P 50参 只能15s" },
    { name: "BT-2.5-720p", capability: "video", label: "官转SD2.5 720p 30图10音" },
    { name: "seedance-2.5-lh", capability: "video", label: "F1 Seedance 2.5 50全参" },
    { name: "ai-video-v3", capability: "video", label: "F2 seedance2.5 9图", allowedDurations: [5, 10, 15, 30], maxImages: 9 },
    { name: "kontony-seedance-2.0", capability: "video", label: "W1 SD2.0 720P 9图3视频（便宜）", allowedDurations: [5, 10, 15], maxImages: 9, maxVideos: 3, maxAudios: 3 },
    { name: "mj-720-933", capability: "video", label: "W2 seedance2.0原生720P 9图3音", allowedDurations: [5, 10, 15], maxImages: 9 },
    { name: "w3-c1", capability: "video", label: "R1 wan3.0 1080 10图5音5视频(快速版)", allowedDurations: [5, 15, 20, 25, 30], maxImages: 9 },
    { name: "wan3-prime", capability: "video", label: "R2 wan3.0 10图5音5视频（按s）" },
    { name: "ai-video-v1", capability: "video", label: "seedance 2.0 720P mini 9图" },
    { name: "H3video-768", capability: "video", label: "MiniMax-H3" },
];

export function onionModelPatch(profile: OnionModelProfile): Partial<ChannelModel> {
    return {
        capability: "video",
        label: profile.label,
        price: profile.price,
        billingMode: profile.billingMode,
        allowedDurations: profile.allowedDurations,
        allowedRatios: profile.allowedRatios,
        resolutions: profile.resolutions,
        maxImages: profile.maxImages,
        maxVideos: profile.maxVideos,
        maxAudios: profile.maxAudios,
    };
}

export function onionCatalogNames() {
    return ONION_MODELS.map((model) => model.name);
}

export function createOnionChannel(): ModelChannel {
    return createModelChannel({
        id: "onion",
        name: "OnionCreate",
        baseUrl: "https://ai.onioncreate.xyz",
        apiKey: "",
        apiFormat: "openai",
        models: ONION_MODELS.map((model) => ({ ...model })),
    });
}

export function createGeeknowChannel(): ModelChannel {
    return createModelChannel({
        id: "geeknow",
        name: "Geeknow",
        baseUrl: "https://www.geeknow.top",
        apiKey: "",
        apiFormat: "openai",
        models: [],
    });
}

function runningHubChannelModel(model: (typeof RUNNINGHUB_MODELS)[number]) {
    return {
        name: model.name,
        capability: model.capability,
        label: model.label,
        allowedDurations: model.allowedDurations,
        ...(model.name === RUNNINGHUB_H3_FACE_WORKFLOW_ID || model.name === RUNNINGHUB_H3_FACE_APP_ID || model.name === RUNNINGHUB_H3_CINEMATIC_WORKFLOW_ID
            ? { resolutions: [...RUNNINGHUB_H3_FACE_RESOLUTIONS] }
            : {}),
    };
}

export function createRunningHubChannel(): ModelChannel {
    return createModelChannel({
        id: "runninghub",
        name: "RunningHub",
        baseUrl: "https://www.runninghub.cn",
        apiKey: "",
        apiFormat: "openai",
        models: RUNNINGHUB_MODELS.map((model) => runningHubChannelModel(model)),
    });
}

export function createApimartChannel(): ModelChannel {
    return createModelChannel({
        id: "apimart",
        name: "APIMart",
        baseUrl: "https://api.apimart.ai",
        apiKey: "",
        apiFormat: "openai",
        models: APIMART_MODELS.map((model) => ({ ...model })),
    });
}

export function createDeepSeekChannel(): ModelChannel {
    return createModelChannel({
        id: "deepseek",
        name: "DeepSeek 官方",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiFormat: "openai",
        models: DEEPSEEK_MODELS.map((model) => ({ ...model })),
    });
}

export function createRelayChannel(station: RelayStationId): ModelChannel {
    if (station === "ai007") return createAi007Channel();
    if (station === "onion") return createOnionChannel();
    if (station === "geeknow") return createGeeknowChannel();
    if (station === "runninghub") return createRunningHubChannel();
    if (station === "metaso") return createMetasoChannel();
    if (station === "volcengine") return createVolcengineChannel();
    if (station === "crun") return createCrunChannel();
    if (station === "apimart") return createApimartChannel();
    if (station === "deepseek") return createDeepSeekChannel();
    return createOpenLuxChannel();
}

export function createOpenLuxChannel(): ModelChannel {
    return createModelChannel({
        id: "openlux",
        name: "OpenLux",
        baseUrl: "https://api.openlux.ai",
        apiKey: "",
        apiFormat: "openai",
        models: [],
    });
}

/** Add the AI007 station when it is not already saved. Existing OpenLux channels stay as they are. */
export function ensureAi007Channel(channels: ModelChannel[]) {
    if (findRelayChannel(channels, "ai007")) return { channels, changed: false };
    return { channels: [...channels, createAi007Channel()], changed: true };
}

export function ensureOnionChannel(channels: ModelChannel[]) {
    // Only create the channel once. Never re-add plaza models the admin removed.
    if (findRelayChannel(channels, "onion")) return { channels, changed: false };
    return { channels: [...channels, createOnionChannel()], changed: true };
}

export function ensureGeeknowChannel(channels: ModelChannel[]) {
    if (findRelayChannel(channels, "geeknow")) return { channels, changed: false };
    return { channels: [...channels, createGeeknowChannel()], changed: true };
}

export function ensureRunningHubChannel(channels: ModelChannel[]) {
    const existing = findRelayChannel(channels, "runninghub");
    if (!existing) return { channels: [...channels, createRunningHubChannel()], changed: true };
    let changed = false;
    // Never overwrite admin-edited labels; only fill blank labels from the curated catalog.
    // Sync allowedDurations from catalog so duration caps (e.g. H3 workflows at 30s) stay current.
    let models = existing.models.map((model) => {
        // Migrate legacy AI App id → Comfy workflow id before catalog sync.
        if (model.name === RUNNINGHUB_H3_FACE_APP_ID) {
            changed = true;
            return {
                ...model,
                name: RUNNINGHUB_H3_FACE_WORKFLOW_ID,
                allowedDurations: [4, 30],
            };
        }
        const preset = RUNNINGHUB_MODELS.find((item) => item.name === model.name);
        if (!preset) return model;
        let next = model;
        if (!(model.label || "").trim() && preset.label) {
            next = { ...next, label: preset.label };
            changed = true;
        }
        const presetDurations = preset.allowedDurations || [];
        const currentDurations = model.allowedDurations || [];
        if (JSON.stringify(presetDurations) !== JSON.stringify(currentDurations)) {
            next = { ...next, allowedDurations: presetDurations.length ? [...presetDurations] : undefined };
            changed = true;
        }
        return next;
    });
    // Drop duplicate face rows if both legacy app id and workflow id were present.
    const seen = new Set<string>();
    models = models.filter((model) => {
        if (seen.has(model.name)) {
            changed = true;
            return false;
        }
        seen.add(model.name);
        return true;
    });
    // Do not re-add curated RH models the admin deleted — only refresh specs on existing rows.
    for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        if (!isRunningHubMinimaxH3Video(model.name, { label: model.label, baseUrl: existing.baseUrl })) continue;
        const durations = model.allowedDurations || [];
        const needDur = Math.max(0, ...durations) !== 30 || Math.min(...(durations.length ? durations : [4]), 30) !== 4;
        if (!needDur) continue;
        models[index] = {
            ...model,
            allowedDurations: [4, 30],
        };
        changed = true;
    }
    if (!changed) return { channels, changed: false };
    return {
        channels: channels.map((channel) => (relayStationOf(channel) === "runninghub" ? { ...channel, models } : channel)),
        changed: true,
    };
}

export function ensureApimartChannel(channels: ModelChannel[]) {
    // Only create once; never force-enable catalog models the admin deleted.
    if (findRelayChannel(channels, "apimart")) return { channels, changed: false };
    return { channels: [...channels, createApimartChannel()], changed: true };
}

export function ensureDeepSeekChannel(channels: ModelChannel[]) {
    if (findRelayChannel(channels, "deepseek")) return { channels, changed: false };
    return { channels: [...channels, createDeepSeekChannel()], changed: true };
}

/** Map APIMart /v1/models category -> canvas capability. */
export function apimartCapabilityFromCategory(category: string | undefined): ModelCapability {
    const value = (category || "").trim().toLowerCase();
    if (value === "image") return "image";
    if (value === "video") return "video";
    if (value === "audio") return "audio";
    return "text";
}

export function mergeOnionProfiles(channels: ModelChannel[], profiles: OnionModelProfile[]) {
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    let changed = false;
    const next = channels.map((channel) => {
        if (!isOnionBaseUrl(channel.baseUrl)) return channel;
        let channelChanged = false;
        const models = channel.models.map((model) => {
            const profile = byId.get(model.name);
            if (!profile) return model;
            const merged: ChannelModel = { ...model, ...onionModelPatch(profile), name: model.name, script: model.script };
            if (JSON.stringify(merged) !== JSON.stringify(model)) channelChanged = true;
            return merged;
        });
        // Refresh live specs on selected models only — do not re-add plaza rows the admin deleted.
        if (channelChanged) changed = true;
        return channelChanged ? { ...channel, models } : channel;
    });
    return { channels: next, changed };
}

export function channelModelsFromNames(names: string[], previous: ChannelModel[]) {
    const map = new Map(previous.map((model) => [model.name, model]));
    return names.map((name) => {
        const existing = map.get(name);
        if (existing) return existing;
        const preset =
            AI007_MODELS.find((model) => model.name === name) ||
            RUNNINGHUB_MODELS.find((model) => model.name === name) ||
            APIMART_MODELS.find((model) => model.name === name) ||
            DEEPSEEK_MODELS.find((model) => model.name === name) ||
            ONION_MODELS.find((model) => model.name === name) ||
            CRUN_MODELS.find((model) => model.name === name);
        if (preset) return { ...preset };
        // Lazy import avoided: capability cache filled by fetchApimartCatalog in image.ts
        return { name, capability: guessCapability(name) };
    });
}

function channelHost(baseUrl: string) {
    try {
        return new URL(baseUrl).hostname.toLowerCase();
    } catch {
        return baseUrl.trim().toLowerCase();
    }
}
