import { nanoid } from "nanoid";

import type { StudioDocumentBase, StudioTaskLog } from "../types";

export type ReplacementStep = "assets" | "image" | "video" | "voice" | "compose";

export type ReplacementPromptMode = "regular" | "positioning" | "manual";

export type ReplacementScope = "full-person" | "visible-part" | "clothing" | "arm-hand" | "face-hair" | "feet";

export const SCOPE_OPTIONS: Array<{ value: ReplacementScope; label: string }> = [
    { value: "full-person", label: "完整人物" },
    { value: "visible-part", label: "当前可见部分" },
    { value: "clothing", label: "服装" },
    { value: "arm-hand", label: "手臂和手部" },
    { value: "face-hair", label: "脸部和头发" },
    { value: "feet", label: "脚部" },
];

export const PROMPT_MODE_OPTIONS: Array<{ value: ReplacementPromptMode; label: string; hint: string }> = [
    { value: "positioning", label: "定位", hint: "附带人物定位图，用字母框指认要替换的人物" },
    { value: "regular", label: "常规", hint: "用左侧/中间/右侧描述要替换的人物" },
    { value: "manual", label: "手动", hint: "自己填写提示词，可用 @ 引用图片" },
];

/** Normalised box relative to the keyframe: x/y is the top-left corner. */
export type ReplacementBox = { x: number; y: number; width: number; height: number };

/** Person target: "" follows the identity mapping, KEEP_PERSON keeps the original person. */
export const KEEP_PERSON = "__keep__";

export type ReplacementPerson = {
    id: string;
    bbox: ReplacementBox;
    score: number;
    cropKey: string;
    identity: string;
    similarity: number;
    review: boolean;
    promptMarkerIndex: number;
    targetCharacterId: string;
    targetAppearanceId?: string;
    scope: ReplacementScope;
    manual?: boolean;
};

export type ReplacementSourceDescription = { personId: string; markerLabel: string; description: string };

export type ReplacementResult = { id: string; key: string; prompt: string; model: string; at: string };

export type TaskStatus = "running" | "done" | "failed";

export type ReplacementShot = {
    id: string;
    sourceId: string;
    index: number;
    startSec: number;
    endSec: number;
    keyframeKey: string;
    keyframeTime: number;
    clipKey: string;
    /** Reference video for video replacement after trim / reverse; empty uses clipKey. */
    referenceKey?: string;
    referenceDurationSec?: number;
    reversed?: boolean;
    persons: ReplacementPerson[];
    promptMode: ReplacementPromptMode;
    manualPrompt: string;
    /** "@名称" -> studio media key for library images mentioned in the manual prompt. */
    mentions?: Record<string, string>;
    sceneId: string;
    sourceDescriptions?: ReplacementSourceDescription[];
    enhancement?: string;
    imageResults: ReplacementResult[];
    imageIndex: number;
    imageStatus?: TaskStatus;
    imageError?: string;
    videoPrompt?: string;
    videoResults: ReplacementResult[];
    videoIndex: number;
    videoStatus?: TaskStatus;
    videoError?: string;
    /** Compose with the original clip instead of the replaced video. */
    useOriginal?: boolean;
};

export type ReplacementIdentity = {
    id: string;
    sourceId: string;
    name: string;
    count: number;
    shots: string[];
    /** Representative crop from intake (identification only; not used as outfit reference for three-view gen). */
    coverKey: string;
    review: boolean;
    suggested: string;
    targetCharacterId: string;
    /** Appearance text for three-view generation (like replication `visualPrompt`). */
    visualPrompt?: string;
    /** User-uploaded face/reference image for generation. */
    faceKey?: string;
};

export type ReplacementAppearance = { id: string; imageKey: string; prompt: string; origin: "upload" | "generate" | "library" | "edit" };

export type ReplacementCharacter = {
    id: string;
    kind: "character" | "scene";
    name: string;
    prompt: string;
    appearances: ReplacementAppearance[];
    baseAppearanceId: string;
    voiceAudioId?: string;
    imageStatus?: TaskStatus;
    imageError?: string;
};

export type ReplacementAudio = { id: string; name: string; key: string; durationSec: number; origin: "upload" | "vocals" | "background" | "clip" };

export type ReplacementLine = {
    id: string;
    sourceId: string;
    startSec: number;
    endSec: number;
    speaker: string;
    text: string;
    translation?: string;
    /** Character whose voice speaks this line; empty follows the speaker identity's target. */
    characterId?: string;
    /**
     * IndexTTS / VoiceStudio reference clip.
     * - undefined: character.voiceAudioId, else original vocals clip
     * - "" or special: force original vocals clip (see ORIGINAL_VOICE_REF)
     * - audio id: uploaded / clipped sample in document.audios
     */
    voiceAudioId?: string;
    audioKey?: string;
    status?: TaskStatus;
    error?: string;
};

/** Line.voiceAudioId sentinel: always clip original vocals for TTS reference. */
export const ORIGINAL_VOICE_REF = "__original__";

export type ReplacementTtsEngine = "indextts" | "voicestudio";

export type JobState = "uploading" | "pending" | "running" | "done" | "failed";

export type ReplacementSeparation = { jobId: string; status: JobState; message: string; error?: string; vocalsKey?: string; backgroundKey?: string };

export type ReplacementSource = {
    id: string;
    fileName: string;
    jobId: string;
    status: JobState;
    message: string;
    error?: string;
    skipCuts: boolean;
    cuts: number[];
    durationSec: number;
    sourceDurationSec: number;
    truncated: boolean;
    width: number;
    height: number;
    fps: number;
    videoKey: string;
    audioKey: string;
    /** True when project was created from audio-only upload (no video intake). */
    audioOnly?: boolean;
    separation?: ReplacementSeparation;
};

export type ReplacementSettings = {
    visionModel: string;
    imageModel: string;
    imageQuality: string;
    videoModel: string;
    /** VoiceStudio OpenAI-compatible ASR model id (default whisper-1). */
    asrModel: string;
    /** Optional BCP-47 / Whisper language hint, e.g. zh. Empty = auto. */
    asrLanguage: string;
    /** Clone TTS: IndexTTS on LAN GPU (:7860) or VoiceStudio on LAN GPU (:3901 /generate). */
    ttsEngine: ReplacementTtsEngine;
    useSourceDescriptions: boolean;
    useEnhancement: boolean;
    videoPrompt: string;
    originalAudioVolume: number;
    syncIdentity: boolean;
};

export type ReplacementCompose = { jobId: string; status: JobState; message: string; error?: string; videoKey?: string; /** Final mixed WAV for audio-only (also usable as mix preview). */ audioKey?: string };

export type ReplacementStudioDocument = StudioDocumentBase & {
    step: ReplacementStep;
    settings: ReplacementSettings;
    sources: ReplacementSource[];
    shots: ReplacementShot[];
    identities: ReplacementIdentity[];
    characters: ReplacementCharacter[];
    audios: ReplacementAudio[];
    lines: ReplacementLine[];
    compose: ReplacementCompose | null;
    logs: StudioTaskLog[];
};

export const REPLACEMENT_STEPS: Array<{ key: ReplacementStep; label: string }> = [
    { key: "assets", label: "素材设定" },
    { key: "image", label: "图像替换" },
    { key: "video", label: "视频替换" },
    { key: "voice", label: "声音克隆" },
    { key: "compose", label: "合成视频" },
];

export const AUDIO_ONLY_STEPS: Array<{ key: ReplacementStep; label: string }> = [
    { key: "voice", label: "声音克隆" },
    { key: "compose", label: "合成音频" },
];

/** True when every source is audio-only (「只克隆声音」项目). */
export function isAudioOnlyDocument(document: ReplacementStudioDocument) {
    return document.sources.length > 0 && document.sources.every((source) => Boolean(source.audioOnly));
}

export function stepsForDocument(document: ReplacementStudioDocument) {
    return isAudioOnlyDocument(document) ? AUDIO_ONLY_STEPS : REPLACEMENT_STEPS;
}

export const DOCUMENT_VERSION = 3;

export function defaultReplacementSettings(defaultVideoPrompt: string): ReplacementSettings {
    return {
        visionModel: "",
        imageModel: "",
        imageQuality: "auto",
        videoModel: "",
        asrModel: "whisper-1",
        asrLanguage: "zh",
        ttsEngine: "indextts",
        useSourceDescriptions: false,
        useEnhancement: false,
        videoPrompt: defaultVideoPrompt,
        originalAudioVolume: 1,
        syncIdentity: true,
    };
}

export function createReplacementDocument(defaultVideoPrompt: string): ReplacementStudioDocument {
    return {
        version: DOCUMENT_VERSION,
        meta: { stage: "assets", stageLabel: "未开始" },
        step: "assets",
        settings: defaultReplacementSettings(defaultVideoPrompt),
        sources: [],
        shots: [],
        identities: [],
        characters: [],
        audios: [],
        lines: [],
        compose: null,
        logs: [],
    };
}

export function createCharacter(kind: ReplacementCharacter["kind"], name: string, imageKey = "", origin: ReplacementAppearance["origin"] = "upload"): ReplacementCharacter {
    const appearance = imageKey ? [{ id: nanoid(8), imageKey, prompt: "", origin }] : [];
    return { id: nanoid(8), kind, name, prompt: "", appearances: appearance, baseAppearanceId: appearance[0]?.id || "" };
}

type LegacyShot = Partial<ReplacementShot> & { index: number; imageKey?: string; imagePrompt?: string; videoKey?: string };
type LegacyCharacter = Partial<ReplacementCharacter> & { id: string; imageKey?: string; voiceKey?: string };
type LegacyDocument = Partial<ReplacementStudioDocument> & StudioDocumentBase & { source?: Partial<ReplacementSource> | null };

function legacyResult(key: string | undefined, prompt = ""): ReplacementResult[] {
    return key ? [{ id: nanoid(8), key, prompt, model: "", at: new Date().toISOString() }] : [];
}

/** v1 carried no usable data; v2 had a single source and index-keyed shots, migrated in place. */
export function upgradeReplacementDocument(input: ReplacementStudioDocument, defaultVideoPrompt: string): ReplacementStudioDocument {
    const document = input as unknown as LegacyDocument;
    if (document.version >= DOCUMENT_VERSION && Array.isArray(document.sources)) return input;
    const fresh = createReplacementDocument(defaultVideoPrompt);
    if (document.version < 2 || !Array.isArray(document.identities)) return { ...fresh, logs: Array.isArray(document.logs) ? document.logs : [] };
    const sourceId = nanoid(8);
    const legacySource = document.source;
    const sources: ReplacementSource[] = legacySource
        ? [{ ...(legacySource as ReplacementSource), id: sourceId, skipCuts: false, cuts: ((document.shots || []) as LegacyShot[]).slice(1).map((shot) => shot.startSec || 0) }]
        : [];
    const shotIds = new Map<number, string>();
    const shots = ((document.shots || []) as LegacyShot[]).map((shot) => {
        const id = `${sourceId}-${shot.index}`;
        shotIds.set(shot.index, id);
        const { imageKey, imagePrompt, videoKey, ...rest } = shot;
        return { ...rest, id, sourceId, imageResults: legacyResult(imageKey, imagePrompt), imageIndex: 0, videoResults: legacyResult(videoKey, shot.videoPrompt), videoIndex: 0 } as ReplacementShot;
    });
    const voices: ReplacementAudio[] = [];
    const characters = ((document.characters || []) as LegacyCharacter[]).map((character) => {
        const { imageKey, voiceKey, ...rest } = character;
        const appearances = imageKey ? [{ id: nanoid(8), imageKey, prompt: character.prompt || "", origin: "upload" as const }] : [];
        let voiceAudioId: string | undefined;
        if (voiceKey) {
            voiceAudioId = nanoid(8);
            voices.push({ id: voiceAudioId, name: `${character.name || "角色"}声音`, key: voiceKey, durationSec: 0, origin: "upload" });
        }
        return { ...rest, kind: character.kind || "character", name: character.name || "", prompt: character.prompt || "", appearances, baseAppearanceId: appearances[0]?.id || "", voiceAudioId } as ReplacementCharacter;
    });
    const identities = (document.identities as unknown as Array<ReplacementIdentity & { shots: Array<number | string> }>).map((identity) => ({
        ...identity,
        sourceId,
        shots: identity.shots.map((index) => shotIds.get(Number(index)) || String(index)),
    }));
    return {
        ...fresh,
        meta: document.meta,
        settings: { ...fresh.settings, ...(document.settings || {}) },
        step: document.step && document.step !== ("home" as ReplacementStep) ? document.step : "assets",
        sources,
        shots,
        identities,
        characters,
        audios: voices,
        lines: (document.lines || []).map((line) => ({ ...line, sourceId })),
        compose: document.compose || null,
        logs: document.logs || [],
    };
}

export function personTarget(person: ReplacementPerson, identities: ReplacementIdentity[]) {
    if (person.targetCharacterId === KEEP_PERSON) return "";
    if (person.targetCharacterId) return person.targetCharacterId;
    return identities.find((identity) => identity.id === person.identity)?.targetCharacterId || "";
}

export function shotDuration(shot: ReplacementShot) {
    return Math.max(0.1, shot.endSec - shot.startSec);
}

export function currentResult(results: ReplacementResult[], index: number) {
    return results[Math.min(Math.max(0, index), results.length - 1)];
}

export function shotImageKey(shot: ReplacementShot) {
    return currentResult(shot.imageResults, shot.imageIndex)?.key || "";
}

export function shotVideoKey(shot: ReplacementShot) {
    return currentResult(shot.videoResults, shot.videoIndex)?.key || "";
}

export function characterImageKey(character: ReplacementCharacter | undefined, appearanceId?: string) {
    if (!character) return "";
    const appearance = character.appearances.find((item) => item.id === appearanceId) || character.appearances.find((item) => item.id === character.baseAppearanceId) || character.appearances[0];
    return appearance?.imageKey || "";
}

export function lineCharacterId(document: Pick<ReplacementStudioDocument, "identities">, line: ReplacementLine) {
    if (line.characterId) return line.characterId === KEEP_PERSON ? "" : line.characterId;
    return document.identities.find((identity) => identity.id === line.speaker)?.targetCharacterId || "";
}

/** Global timeline offset of each source when sources are concatenated in order. */
export function sourceOffsets(document: Pick<ReplacementStudioDocument, "sources" | "shots">) {
    const offsets = new Map<string, number>();
    let total = 0;
    for (const source of document.sources) {
        offsets.set(source.id, total);
        const shots = document.shots.filter((shot) => shot.sourceId === source.id);
        total += shots.length ? shots.reduce((sum, shot) => sum + shotDuration(shot), 0) : source.durationSec;
    }
    return { offsets, total };
}

/** Shots in timeline order (by source order, then index). */
export function orderedShots(document: Pick<ReplacementStudioDocument, "sources" | "shots">) {
    const order = new Map(document.sources.map((source, index) => [source.id, index]));
    return [...document.shots].sort((a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.index - b.index);
}

export function shotNumber(document: Pick<ReplacementStudioDocument, "sources" | "shots">, shotId: string) {
    return orderedShots(document).findIndex((shot) => shot.id === shotId) + 1;
}

/** Re-number marker indexes left to right after manual box edits. */
export function renumberMarkers(persons: ReplacementPerson[]) {
    const ordered = [...persons].sort((a, b) => a.bbox.x + a.bbox.width / 2 - (b.bbox.x + b.bbox.width / 2));
    return persons.map((person) => ({ ...person, promptMarkerIndex: ordered.indexOf(person) }));
}

export function retryCount(document: ReplacementStudioDocument) {
    return (
        document.sources.filter((source) => source.status === "failed").length +
        document.shots.filter((shot) => shot.imageStatus === "failed" || shot.videoStatus === "failed").length +
        document.lines.filter((line) => line.status === "failed").length +
        (document.compose?.status === "failed" ? 1 : 0)
    );
}
