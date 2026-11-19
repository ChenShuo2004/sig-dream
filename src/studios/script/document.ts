import type { StudioAsset, StudioDocumentBase, StudioEpisode, StudioTaskLog } from "../types";

export type ScriptSourceMode = "generate" | "upload" | "rewrite";
export type ScriptMode = "plot" | "narration";
export type ScriptPromptMode = "seedance-2.0" | "seedance-2.5";
export type ScriptStep = "script" | "assets" | "episodes";

export type StoryContract = {
    protagonistGoal: string;
    centralConflict: string;
    stakes: string;
    progressionDriver: string;
    constraints: string;
    climax: string;
    ending: string;
};

export type StoryCharacter = {
    ref: string;
    name: string;
    roleType: string;
    fixedTraits: string;
    coreTags: string[];
    profile: string;
    motivation: string;
    relationships: string;
    personality: string;
    arc: string;
};

export type StorySummary = {
    title: string;
    storyType: string;
    targetAudience: string;
    storySummary: string;
    storyBackground: string;
    storySetting: string;
    coreHook: string;
    logline: string;
    storyContract: StoryContract;
    plotBeats: Array<{ stage: string; event: string; consequence: string }>;
    continuityFacts: string[];
    characters: StoryCharacter[];
};

export type ScriptSettings = {
    sourceMode: ScriptSourceMode;
    scriptMode: ScriptMode;
    idea: string;
    sourceText: string;
    fileName: string;
    rewriteInstruction: string;
    /** Short style name used as the story's creative direction. */
    visualStyle: string;
    /** Full visual style text prefixed to asset and video prompts; falls back to visualStyle. */
    stylePrompt?: string;
    /** Image / video frame aspect; asset gen default 16:9 (SHUO-aligned). Use "auto" for 自适应. */
    aspectRatio: string;
    /** Image gen quality: 1K / 2K / 4K (SHUO imageSize). */
    imageQuality?: string;
    /** Video resolution / quality for the selected video model (e.g. 720 / 1080 / 720p). */
    videoQuality?: string;
    /** Video size: WxH, ratio, or auto; falls back to aspectRatio when empty. */
    videoSize?: string;
    /** Video generation mode: reference | frames. Script clips default to reference. */
    videoMode?: string;
    /** LAN MiniMax H3 / Comfy megapixels (e.g. 0.4 ≈ 480p, 1.0 ≈ 1080p). */
    videoMegapixels?: string;
    /** Fixed seed for LAN Comfy; empty means random each run. */
    videoSeed?: string;
    /** RunningHub instanceType: default(24G) | plus(48G); ultra/84G disabled. */
    runningHubInstanceType?: string;
    /** Minimax H3 人脸「去油腻」LoRA strength（0–1，默认 0.4）。 */
    h3DeOilStrength?: string;
    episodeCount: number;
    clipMaxSeconds: number;
    promptMode: ScriptPromptMode;
    textModel: string;
    imageModel: string;
    videoModel: string;
    autoReview: boolean;
    /** Parallel image API calls when batch-generating appearances (default 6). */
    imageConcurrency?: number;
    /** Parallel video API calls when batch-generating clips (default 4). */
    videoConcurrency?: number;
    /** SHUO「人物参考 · 测试中」: prefer character appearance refs when splitting / generating clips. */
    characterRefExperiment?: boolean;
};

export const DEFAULT_IMAGE_CONCURRENCY = 6;
export const DEFAULT_VIDEO_CONCURRENCY = 4;
export const MAX_MEDIA_CONCURRENCY = 12;

export function resolveMediaConcurrency(value: number | undefined, fallback: number) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(MAX_MEDIA_CONCURRENCY, n);
}

export type StageReviewRecord = {
    stage: string;
    verdict: "pass" | "repair" | "needs_confirmation" | "skipped";
    issues: Array<{ ref: string; field: string; code: string; reason: string; evidence: string; instruction: string }>;
    rounds: number;
    at: string;
    /** When set, UI can confirm / re-run this review target. */
    targetId?: string;
    confirmed?: boolean;
};

/** Long-source chunk digest used by upload/rewrite summary (SHUO sourceDigest). */
export type SourceDigestChunk = {
    chunkIndex: number;
    chunkTotal: number;
    characters: string[];
    settings: string[];
    events: string[];
    continuity: string[];
    endingState: string;
};

export type ScriptStudioDocument = StudioDocumentBase & {
    step: ScriptStep;
    settings: ScriptSettings;
    summary: StorySummary | null;
    storyFacts: string[];
    /** Filled before summary when upload/rewrite text is long. */
    sourceDigests: SourceDigestChunk[];
    episodes: StudioEpisode[];
    assets: StudioAsset[];
    reviews: StageReviewRecord[];
    logs: StudioTaskLog[];
};

export const SCRIPT_STEPS: Array<{ key: ScriptStep; label: string }> = [
    { key: "script", label: "原始剧本" },
    { key: "assets", label: "素材设定" },
    { key: "episodes", label: "分集视频" },
];

export function createScriptDocument(): ScriptStudioDocument {
    return {
        version: 1,
        meta: { stage: "script", stageLabel: "原始剧本" },
        step: "script",
        settings: {
            sourceMode: "generate",
            scriptMode: "plot",
            idea: "",
            sourceText: "",
            fileName: "",
            rewriteInstruction: "",
            visualStyle: "",
            aspectRatio: "16:9",
            imageQuality: "2K",
            videoQuality: "720",
            videoSize: "16:9",
            videoMode: "reference",
            videoMegapixels: "0.4",
            videoSeed: "",
            runningHubInstanceType: "default",
            h3DeOilStrength: "0.4",
            episodeCount: 6,
            clipMaxSeconds: 15,
            promptMode: "seedance-2.0",
            textModel: "",
            imageModel: "",
            videoModel: "",
            autoReview: true,
            imageConcurrency: DEFAULT_IMAGE_CONCURRENCY,
            videoConcurrency: DEFAULT_VIDEO_CONCURRENCY,
        },
        summary: null,
        storyFacts: [],
        sourceDigests: [],
        episodes: [],
        assets: [],
        reviews: [],
        logs: [],
    };
}

/** Prefer skeleton→batch outline when episode count or source length is large. */
export function shouldUseSkeletonOutline(settings: ScriptSettings) {
    return settings.episodeCount >= 12 || (settings.sourceMode !== "generate" && settings.sourceText.trim().length >= 8000);
}

/** Prefer sourceDigest when uploaded/rewritten text is long. */
export function shouldDigestSource(settings: ScriptSettings) {
    return settings.sourceMode !== "generate" && settings.sourceText.trim().length >= 6000;
}
