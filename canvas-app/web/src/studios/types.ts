export type StudioKind = "script" | "replication" | "replacement";

export const STUDIO_KINDS: StudioKind[] = ["script", "replication", "replacement"];

export const STUDIO_LABELS: Record<StudioKind, string> = {
    script: "剧本工作室",
    replication: "复刻工作室",
    replacement: "替换工作室",
};

export const STUDIO_DESCRIPTIONS: Record<StudioKind, string> = {
    script: "从创意、原文或改写要求开始，生成剧本、素材设定和逐段分集视频。",
    replication: "上传原片，拆解镜头、台词和人物，生成可复刻的分镜脚本和视频。",
    replacement: "检测原片中的人物，用新的角色形象替换图像、视频和声音。",
};

export type StudioProjectSummary = {
    id: string;
    kind: StudioKind;
    title: string;
    meta: StudioMeta;
    createdAt: string;
    updatedAt: string;
};

export type StudioProject<TDocument = StudioDocumentBase> = StudioProjectSummary & { document: TDocument };

export type StudioMeta = {
    stage?: string;
    stageLabel?: string;
    episodeCount?: number;
    clipCount?: number;
    coverUrl?: string;
    archived?: boolean;
    retryCount?: number;
};

export type StudioDocumentBase = { meta: StudioMeta; version: number };

export type StudioAssetKind = "character" | "scene" | "prop";

export type StudioAppearanceReferenceRole = "style" | "character" | "background" | "draft";

export type StudioAppearanceReference = {
    id: string;
    role: StudioAppearanceReferenceRole;
    mediaKey: string;
    name?: string;
};

export type StudioAppearance = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    occurrences?: string;
    sourceChapterIds?: string[];
    /** Optional edit references for image generation (风格/角色/背景/草稿). */
    references?: StudioAppearanceReference[];
    /** Currently selected / primary image for this appearance. */
    imageKey?: string;
    /** Generated/uploaded image history for this appearance (includes imageKey when set). */
    imageKeys?: string[];
    imageStatus?: "idle" | "running" | "done" | "failed";
    imageError?: string;
};

export type StudioAsset = {
    id: string;
    kind: StudioAssetKind;
    name: string;
    role: string;
    description: string;
    voiceDescription?: string;
    occurrences?: string;
    sourceChapterIds?: string[];
    appearances: StudioAppearance[];
};

export type StudioShot = {
    id: string;
    duration: number;
    visual: string;
    camera: string;
    dialogue: string;
    voiceover: string;
    audio: string;
    sourceShotId?: string;
    sceneKey?: string;
    sceneVisualStyle?: string;
    textElements?: Array<{ kind: "physical" | "graphic" | "speech_subtitle" | "uncertain"; text: string; carrier: string; placement: string }>;
    spatialStart?: SpatialRelation[];
    spatialEnd?: SpatialRelation[];
};

export type SpatialRelation = { subject: string; landmark: string; relation: string; facing: string; pose: string; heldObject: string };

/** Captured still / trimmed clip saved under 片段帧 for later video-gen reference. */
export type StudioClipFrame = {
    id: string;
    mediaKey: string;
    kind: "image" | "video";
    label: string;
    timeSec?: number;
    startSec?: number;
    endSec?: number;
};

export type StudioClip = {
    id: string;
    number: number;
    sceneCode: string;
    shots: StudioShot[];
    script?: string;
    prompt: string;
    promptEdited?: boolean;
    /** After「转成 H3」: English is submitted; Chinese is for review/edit. */
    promptH3En?: string;
    promptH3Zh?: string;
    /** Which side is shown in the editor when an H3 pair exists. */
    promptH3Lang?: "en" | "zh";
    /** Which side was last edited and may need sync before submit. */
    promptH3Dirty?: "en" | "zh";
    assetRefs: string[];
    /** assetId -> appearanceId; missing entries use the asset's first appearance. */
    appearanceRefs?: Record<string, string>;
    /** Frames / trims captured from this clip's generated video (左列「片段帧」). */
    frames?: StudioClipFrame[];
    videoKey?: string;
    videoStatus?: "idle" | "running" | "done" | "failed";
    videoError?: string;
    review?: { verdict: "pass" | "repair"; issues: Array<{ code: string; reason: string; repairInstruction: string }> };
    creativeIntent?: string;
    sourceStartSec?: number;
    sourceEndSec?: number;
};

export type StudioEndingState = { characters: string[]; props: string[]; unresolvedThreads: string[] };

export type StudioScriptScene = { ref: string; heading: string; characters: string[]; body: string };

export type StudioEpisode = {
    id: string;
    number: number;
    title: string;
    coreBeat?: string;
    endingEvent?: string;
    activeCharacters?: string[];
    synopsis: string;
    hook: string;
    continuityFacts: string[];
    endingState: StudioEndingState;
    estimatedDurationSeconds?: number;
    script?: { scenes: StudioScriptScene[]; continuityFacts: string[]; endingState: StudioEndingState };
    clips: StudioClip[];
};

export type StudioTaskLog = { at: string; stage: string; message: string; level: "info" | "warn" | "error" };

export function clipDuration(clip: Pick<StudioClip, "shots">) {
    return Math.round(clip.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) * 10) / 10;
}

export function episodeScriptText(episode: StudioEpisode) {
    return (episode.script?.scenes || []).map((scene) => `${scene.heading}\n${scene.body}`).join("\n\n");
}
