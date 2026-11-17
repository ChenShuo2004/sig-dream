import type { ReplicationContentType } from "../prompts/replication-policy";
import type { SpatialRelation, StudioAsset, StudioClip, StudioDocumentBase, StudioShot, StudioTaskLog } from "../types";

export type ReplicationStep = "source" | "analysis" | "assets" | "storyboard";

export type IntakeShot = { index: number; startSec: number; endSec: number; frameKey: string };

export type ReplicationSource = {
    fileName: string;
    jobId: string;
    status: "uploading" | "pending" | "running" | "done" | "failed";
    message: string;
    error?: string;
    durationSec: number;
    sourceDurationSec: number;
    truncated: boolean;
    width: number;
    height: number;
    fps: number;
    videoKey: string;
    audioKey: string;
    shots: IntakeShot[];
};

export type SourceCharacter = {
    id: string;
    name: string;
    description: string;
    visualPrompt: string;
    role: "main" | "supporting" | "background" | "uncertain";
    subjectType: "person" | "animal" | "uncertain";
    roleEvidence: string;
    identityNotes: string;
    representativeTimeSec: number;
};

export type SourceDialogue = { speakerId: string; text: string; uncertain: boolean; startSec?: number; endSec?: number };
export type SourceVoiceover = { kind: "narration" | "inner_monologue" | "uncertain"; speakerId: string; text: string; uncertain: boolean; startSec?: number; endSec?: number };

export type SourceShot = {
    id: string;
    startSec: number;
    endSec: number;
    visual: string;
    camera: string;
    sceneKey: string;
    textElements: NonNullable<StudioShot["textElements"]>;
    spatialStart: SpatialRelation[];
    spatialEnd: SpatialRelation[];
    speechRefs: string[];
};

export type SourceEvent = {
    id: string;
    startSec: number;
    endSec: number;
    visual: string;
    camera: string;
    visualStyle: string;
    sound: string;
    characterIds: string[];
    dialogue: SourceDialogue[];
    voiceover: SourceVoiceover[];
    speechOrder: string[];
    shots: SourceShot[];
    uncertainties: string[];
    timingEstimated?: boolean;
};

export type SourceAnalysis = {
    title: string;
    synopsis: string;
    contentType: ReplicationContentType;
    contentTypeReason: string;
    sourceLanguage: string;
    audioHeard: boolean;
    characters: SourceCharacter[];
    events: SourceEvent[];
};

export type SegmentPlanClip = { ref: string; sourceStartSec: number; sourceEndSec: number; durationSec: number; events: SourceEvent[] };

export type ReplicationPromptMode = "seedance-2.0" | "seedance-2.5";

export type ReplicationSettings = {
    analysisModel: string;
    textModel: string;
    imageModel: string;
    videoModel: string;
    aspectRatio: string;
    promptMode: ReplicationPromptMode;
    clipMaxSeconds: number;
    targetLocale: string;
    styleId: string;
    autoReview: boolean;
};

export type ReplicationReviewRecord = { at: string; clipRefs: string[]; repaired: string[]; issues: number };

export type ReplicationStudioDocument = StudioDocumentBase & {
    step: ReplicationStep;
    settings: ReplicationSettings;
    source: ReplicationSource | null;
    analysis: SourceAnalysis | null;
    segmentPlan: SegmentPlanClip[];
    assets: StudioAsset[];
    /** source character id -> character asset id */
    characterBindings: Record<string, string>;
    contentType: ReplicationContentType;
    clips: StudioClip[];
    reviews: ReplicationReviewRecord[];
    logs: StudioTaskLog[];
};

export const REPLICATION_STEPS: Array<{ key: ReplicationStep; label: string }> = [
    { key: "source", label: "上传原片" },
    { key: "analysis", label: "原片分析" },
    { key: "assets", label: "素材设定" },
    { key: "storyboard", label: "分镜与视频" },
];

export const SOURCE_STYLE_ID = "source";

export const TARGET_LOCALES = [
    { value: "source", label: "保留原片语言" },
    { value: "简体中文", label: "简体中文" },
    { value: "English", label: "English" },
    { value: "日本語", label: "日本語" },
    { value: "한국어", label: "한국어" },
];

export const PROMPT_MODE_LIMITS: Record<ReplicationPromptMode, number> = { "seedance-2.0": 15, "seedance-2.5": 30 };

export function createReplicationDocument(): ReplicationStudioDocument {
    return {
        version: 1,
        meta: { stage: "source", stageLabel: "未开始" },
        step: "source",
        settings: {
            analysisModel: "",
            textModel: "",
            imageModel: "",
            videoModel: "",
            aspectRatio: "9:16",
            promptMode: "seedance-2.0",
            clipMaxSeconds: 15,
            targetLocale: "source",
            styleId: SOURCE_STYLE_ID,
            autoReview: true,
        },
        source: null,
        analysis: null,
        segmentPlan: [],
        assets: [],
        characterBindings: {},
        contentType: "unknown",
        clips: [],
        reviews: [],
        logs: [],
    };
}
