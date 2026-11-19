import { nanoid } from "nanoid";

import { SCRIPT_TEMPLATES } from "../prompts/script.generated";
import {
    REPLICATION_CONTENT_TYPES,
    REPLICATION_PROMPTS,
    REPLICATION_SHOT_OUTPUT_TAIL,
    isContinuousTimelineMode,
    normalizeContentType,
    replicationEvidenceInstructions,
    replicationGenerationRequirements,
    replicationGenerationSystemPrompt,
    replicationOutputFormat,
    replicationRepairInstruction,
    replicationReviewCriteria,
    replicationReviewSystemPrompt,
    replicationRoutePolicy,
    replicationTargetStyleInstruction,
    replicationVisualSchema,
    type ReplicationContentType,
} from "../prompts/replication-policy";
import { StrictResultError, expectArray, expectObject, readText, requestStrictResult } from "../runtime/strict-request";
import type { SpatialRelation, StudioAppearance, StudioAsset, StudioAssetKind, StudioClip, StudioShot } from "../types";
import { SOURCE_STYLE_ID, type ReplicationStudioDocument, type SegmentPlanClip } from "./document";
import { buildPromptEvidence, buildTimingContract, clipTiming, generationAssets, sceneCodes } from "./segment-plan";

export type StageContext = { signal?: AbortSignal; log: (message: string, level?: "info" | "warn" | "error") => void; onDelta?: (text: string) => void };
type AnyRecord = Record<string, unknown>;

const EPISODE_REF = "episode-1";
const VIDEO_STYLES = REPLICATION_PROMPTS.videoStyleSummaries as Record<string, string>;

export function targetVisualStyle(document: ReplicationStudioDocument) {
    const id = document.settings.styleId;
    return id && id !== SOURCE_STYLE_ID ? VIDEO_STYLES[id] || "" : "";
}

export const VIDEO_STYLE_OPTIONS = Object.entries(VIDEO_STYLES).map(([id, summary]) => ({ id, label: summary.split("。")[0], summary }));

function textModel(document: ReplicationStudioDocument) {
    return document.settings.textModel || document.settings.analysisModel;
}

function contentType(document: ReplicationStudioDocument): ReplicationContentType {
    return document.contentType !== "unknown" ? document.contentType : document.analysis?.contentType || "unknown";
}

// ---------- text assets ----------

function textAssetEpisode(document: ReplicationStudioDocument) {
    const analysis = document.analysis!;
    return {
        id: EPISODE_REF,
        title: analysis.title || document.source?.fileName || "原片",
        synopsis: analysis.synopsis,
        sourceLanguage: analysis.sourceLanguage,
        characters: analysis.characters.map((character) => ({
            key: character.id,
            id: character.id,
            name: character.name,
            description: character.description,
            visualPrompt: character.visualPrompt,
            identityNotes: character.identityNotes,
            roleEvidence: character.roleEvidence,
            role: character.role,
            subjectType: character.subjectType,
        })),
        events: analysis.events.map((event) => ({
            id: event.id,
            startSec: event.startSec,
            endSec: event.endSec,
            visual: event.visual,
            sound: event.sound,
            characterKeys: event.characterIds,
            speech: event.speechOrder.map((ref) => {
                const [kind, index] = ref.split(":");
                const item = kind === "dialogue" ? event.dialogue[Number(index)] : event.voiceover[Number(index)];
                return { id: ref, kind, speakerKey: item?.speakerId || "", text: item?.text || "" };
            }),
            shots: event.shots.map((shot) => ({ id: shot.id, visual: shot.visual })),
        })),
    };
}

type TextAssets = { characters: Array<{ subjectKey: string; name: string; description: string; appearance: string }>; scenes: Array<{ name: string; description: string }>; props: Array<{ name: string; description: string }> };

function parseTextAssets(value: unknown, keys: string[]): TextAssets {
    const result = expectObject(value, "文本素材");
    const characters = expectArray(result.characters, "characters").map((item) => {
        const record = expectObject(item, "character");
        return { subjectKey: readText(record.subjectKey), name: readText(record.name), description: readText(record.description), appearance: readText(record.appearance) };
    });
    const returned = characters.map((item) => item.subjectKey);
    const missing = keys.filter((key) => !returned.includes(key));
    if (missing.length || new Set(returned).size !== returned.length || returned.length !== keys.length) throw new StrictResultError("characters 必须按输入人物 key 逐一返回，每项恰好一次。", { missing, returned });
    const named = (list: unknown, label: string) =>
        expectArray(list ?? [], label)
            .map((item) => {
                const record = expectObject(item, label);
                return { name: readText(record.name), description: readText(record.description) };
            })
            .filter((item) => item.name);
    return { characters, scenes: named(result.scenes, "scenes"), props: named(result.props, "props") };
}

function textAssetSchema(count: number) {
    const batch = REPLICATION_PROMPTS.textAssetBatch;
    const schema = JSON.parse(JSON.stringify(batch.schema)) as AnyRecord;
    const characters = (schema.properties as AnyRecord).characters as AnyRecord;
    characters.minItems = count;
    characters.maxItems = count;
    return schema;
}

function appearance(name: string, description: string, prompt: string): StudioAppearance {
    return { id: `look-${nanoid(8)}`, name, description, prompt, imageStatus: "idle" };
}

export async function extractTextAssets(document: ReplicationStudioDocument, context: StageContext) {
    const analysis = document.analysis;
    if (!analysis) throw new Error("请先完成原片分析。");
    const batch = REPLICATION_PROMPTS.textAssetBatch;
    const episode = textAssetEpisode(document);
    const keys = episode.characters.map((character) => character.key);
    const payload = { task: batch.payload.task, requirements: batch.payload.requirements, episodes: [episode], outputExample: batch.payload.outputExample };
    context.log("整理人物、场景和道具");
    const { result } = await requestStrictResult({
        model: textModel(document),
        systemPrompt: REPLICATION_PROMPTS.textAssetSystemPrompt,
        payload,
        schemaName: batch.structuredOutputName,
        schema: textAssetSchema(keys.length),
        temperature: batch.temperature,
        maxOutputTokens: batch.maxOutputTokens,
        parse: (value) => parseTextAssets(value, keys),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    const bindings: Record<string, string> = {};
    const assets: StudioAsset[] = [];
    for (const item of result.characters) {
        const source = analysis.characters.find((character) => character.id === item.subjectKey)!;
        const id = `asset-${nanoid(8)}`;
        bindings[source.id] = id;
        const look = item.appearance || source.visualPrompt;
        assets.push({ id, kind: "character", name: item.name || source.name, role: source.role, description: item.description || source.description, appearances: [appearance("原片形象", look, look)] });
    }
    const push = (kind: StudioAssetKind, list: Array<{ name: string; description: string }>) => {
        for (const item of list) assets.push({ id: `asset-${nanoid(8)}`, kind, name: item.name, role: "", description: item.description, appearances: [appearance("", item.description, item.description)] });
    };
    push("scene", result.scenes);
    push("prop", result.props);
    return { assets, bindings };
}

export function replicationAssetImagePrompt(document: ReplicationStudioDocument, asset: StudioAsset, look: StudioAppearance) {
    const style = targetVisualStyle(document) || analysisStyle(document);
    const base = asset.kind === "character" ? `角色定妆照，纯色背景，全身正面站姿，${look.prompt || look.description}` : asset.kind === "scene" ? `场景设定图，无人物，${look.prompt || look.description}` : `道具设定图，纯色背景，${look.prompt || look.description}`;
    return style ? `${base}。画面风格：${style}` : base;
}

function analysisStyle(document: ReplicationStudioDocument) {
    return [...new Set((document.analysis?.events || []).map((event) => event.visualStyle).filter(Boolean))].slice(0, 2).join("；");
}

// ---------- storyboard generation ----------

function readSpatial(value: unknown): SpatialRelation[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const record = (item && typeof item === "object" ? item : {}) as AnyRecord;
        return { subject: readText(record.subject), landmark: readText(record.landmark), relation: readText(record.relation), facing: readText(record.facing), pose: readText(record.pose), heldObject: readText(record.heldObject) };
    });
}

function readTextElements(value: unknown): NonNullable<StudioShot["textElements"]> {
    if (!Array.isArray(value)) return [];
    const kinds = ["physical", "graphic", "speech_subtitle", "uncertain"] as const;
    return value.map((item) => {
        const record = (item && typeof item === "object" ? item : {}) as AnyRecord;
        return { kind: kinds.find((kind) => kind === record.kind) || "uncertain", text: readText(record.text), carrier: readText(record.carrier), placement: readText(record.placement) };
    });
}

type ParsedClip = { ref: string; sceneCode: string; creativeIntent: string; shots: StudioShot[]; assetRefs: string[]; appearanceRefs: Record<string, string> };

function parseShot(entry: unknown, label: string, assets: StudioAsset[], usages: Map<string, string>): StudioShot {
    const shot = expectObject(entry, "shot");
    const start = Number(shot.startSec);
    const end = Number(shot.endSec);
    const duration = Number(shot.d ?? shot.durationSec) || (Number.isFinite(end - start) ? end - start : 0);
    if (!(duration > 0)) throw new StrictResultError(`${label} 的时长 d 必须大于 0。`);
    const visual = readText(shot.shootingContent ?? shot.visual ?? shot.v);
    if (!visual) throw new StrictResultError(`${label} 缺少 shootingContent。`);
    for (const usage of Array.isArray(shot.assetUsages) ? (shot.assetUsages as AnyRecord[]) : []) {
        const assetRef = readText(usage?.assetRef);
        const asset = assets.find((item) => item.id === assetRef);
        if (!asset) continue;
        const look = readText(usage.appearanceRef);
        if (!usages.has(assetRef) || asset.appearances.some((item) => item.id === look)) usages.set(assetRef, asset.appearances.some((item) => item.id === look) ? look : "");
    }
    return {
        id: `shot-${nanoid(8)}`,
        duration: Math.round(duration * 1000) / 1000,
        visual,
        camera: readText(shot.c ?? shot.camera),
        dialogue: readText(shot.q ?? shot.dialogue),
        voiceover: readText(shot.o ?? shot.voiceover),
        audio: readText(shot.a ?? shot.audio),
        sourceShotId: readText(shot.sourceShotId),
        sceneKey: readText(shot.sceneKey),
        sceneVisualStyle: readText(shot.sceneVisualStyle),
        textElements: readTextElements(shot.textElements),
        spatialStart: readSpatial(shot.spatialStart),
        spatialEnd: readSpatial(shot.spatialEnd),
    };
}

function finishClip(record: AnyRecord, ref: string, shots: StudioShot[], usages: Map<string, string>, plan: SegmentPlanClip, continuous: boolean, locked?: { durationSec: number }): ParsedClip {
    if (!shots.length) throw new StrictResultError(`${ref} 没有镜头。`);
    const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
    const expected = locked?.durationSec ?? plan.durationSec;
    if (continuous ? total > expected + 0.05 : Math.abs(total - expected) > 0.5) throw new StrictResultError(`${ref} 镜头合计 ${total.toFixed(2)} 秒，与计划时长 ${expected} 秒不符。`, { ref, total, expected });
    return {
        ref,
        sceneCode: readText(record.s) || "s1",
        creativeIntent: readText(record.creativeIntent),
        shots,
        assetRefs: [...usages.keys()],
        appearanceRefs: Object.fromEntries([...usages].filter(([, look]) => look)),
    };
}

function parseGeneration(value: unknown, plan: SegmentPlanClip[], assets: StudioAsset[], continuous: boolean) {
    const result = expectObject(value, "复刻分镜");
    const clips = expectArray(result.clips, "clips");
    const parsed = plan.map((planned) => {
        const record = clips.find((item) => readText((item as AnyRecord)?.ref) === planned.ref) as AnyRecord | undefined;
        if (!record) throw new StrictResultError(`缺少片段 ${planned.ref}，必须逐个返回 segmentPlan 中的片段。`, { missing: planned.ref });
        const usages = new Map<string, string>();
        const shots = expectArray(record.shots, "shots").map((entry, index) => parseShot(entry, `${planned.ref} 第 ${index + 1} 镜`, assets, usages));
        return finishClip(record, planned.ref, shots, usages, planned, continuous);
    });
    return { contentType: normalizeContentType(result.contentType), clips: parsed };
}

function toStudioClip(parsed: ParsedClip, plan: SegmentPlanClip, previous?: StudioClip): StudioClip {
    return {
        id: previous?.id || `clip-${nanoid(8)}`,
        number: 0,
        sceneCode: parsed.sceneCode,
        shots: parsed.shots,
        creativeIntent: parsed.creativeIntent,
        sourceStartSec: plan.sourceStartSec,
        sourceEndSec: plan.sourceEndSec,
        script: plan.ref,
        prompt: "",
        promptEdited: false,
        assetRefs: parsed.assetRefs,
        appearanceRefs: parsed.appearanceRefs,
        videoStatus: "idle",
    };
}

export const clipPlanRef = (clip: StudioClip) => clip.script || "";

export async function generateStoryboardBatch(document: ReplicationStudioDocument, plan: SegmentPlanClip[], context: StageContext) {
    const { settings } = document;
    const continuous = isContinuousTimelineMode(settings.promptMode);
    const style = targetVisualStyle(document);
    const refs = new Set(plan.map((clip) => clip.ref));
    const type = contentType(document);
    const payload = {
        task: "split_story_episodes",
        promptMode: settings.promptMode,
        episode: { ref: EPISODE_REF, title: document.analysis?.title || document.source?.fileName || "原片" },
        sourceVideoEvidence: buildPromptEvidence(document, refs),
        assets: generationAssets(document.assets),
        scenes: sceneCodes(document.assets).map(({ code, name }) => ({ code, name })),
        ...(style ? { targetVisualStyle: style } : {}),
        constraints: { clipMaxSeconds: settings.clipMaxSeconds },
        timingContract: buildTimingContract(plan, settings.promptMode),
        promptRoute: replicationRoutePolicy(type),
        ...(type === "unknown" ? { availableRoutes: REPLICATION_CONTENT_TYPES.map(replicationRoutePolicy) } : {}),
        requirements: replicationGenerationRequirements({ promptMode: settings.promptMode, targetStyle: style, prepared: false }),
        evidenceInstructions: replicationEvidenceInstructions(),
        shotVisualSchema: replicationVisualSchema(),
        outputFormat: replicationOutputFormat(settings.promptMode, style),
    };
    context.log(`生成分镜：${plan.map((clip) => clip.ref).join("、")}`);
    const { result } = await requestStrictResult({
        model: textModel(document),
        systemPrompt: replicationGenerationSystemPrompt(),
        payload,
        outputContract: payload.outputFormat,
        temperature: 0.2,
        maxOutputTokens: 32000,
        parse: (value) => parseGeneration(value, plan, document.assets, continuous),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return {
        contentType: result.contentType,
        clips: result.clips.map((parsed) => {
            const planned = plan.find((clip) => clip.ref === parsed.ref)!;
            return toStudioClip(parsed, planned, document.clips.find((clip) => clipPlanRef(clip) === parsed.ref));
        }),
    };
}

// ---------- review & repair ----------

function clipPayload(clip: StudioClip) {
    return {
        ref: clipPlanRef(clip),
        creativeIntent: clip.creativeIntent || "",
        durationSec: clip.shots.reduce((sum, shot) => sum + shot.duration, 0),
        shots: clip.shots.map((shot, index) => ({
            index: index + 1,
            durationSec: shot.duration,
            sourceShotId: shot.sourceShotId || "",
            shootingContent: shot.visual,
            camera: shot.camera,
            dialogue: shot.dialogue,
            voiceover: shot.voiceover,
            audio: shot.audio,
            sceneKey: shot.sceneKey || "",
            sceneVisualStyle: shot.sceneVisualStyle || "",
            textElements: shot.textElements || [],
            spatialStart: shot.spatialStart || [],
            spatialEnd: shot.spatialEnd || [],
            assetUsages: clip.assetRefs.map((assetRef) => ({ assetRef, appearanceRef: clip.appearanceRefs?.[assetRef] || "" })),
        })),
    };
}

export type ReplicationAssessment = { clipRef: string; verdict: "pass" | "repair"; issues: Array<{ code: string; reason: string; repairInstruction: string }> };

function reviewBase(document: ReplicationStudioDocument, task: string, schemaVersion: number, outputContract: string, clips: StudioClip[], plan: SegmentPlanClip[]) {
    const style = targetVisualStyle(document);
    const refs = new Set(clips.map(clipPlanRef));
    return {
        task,
        schemaVersion,
        episodeRef: EPISODE_REF,
        ...(style ? { targetVisualStyle: style, visualStyleInstruction: replicationTargetStyleInstruction(style) } : {}),
        timingContract: buildTimingContract(plan.filter((clip) => refs.has(clip.ref)), document.settings.promptMode),
        sourceVideoEvidence: buildPromptEvidence(document, refs),
        assets: generationAssets(document.assets),
        productionLimits: { maxClipDurationSeconds: document.settings.clipMaxSeconds },
        promptRoute: replicationRoutePolicy(contentType(document)),
        outputContract: outputContract + REPLICATION_SHOT_OUTPUT_TAIL,
    };
}

function parseAssessments(value: unknown, refs: string[]): ReplicationAssessment[] {
    const result = expectObject(value, "审片结果");
    const assessments = expectArray(result.assessments, "assessments").map((item) => {
        const entry = expectObject(item, "assessment");
        const verdict = readText(entry.verdict);
        if (verdict !== "pass" && verdict !== "repair") throw new StrictResultError("verdict 只能是 pass 或 repair。");
        return {
            clipRef: readText(entry.clipRef),
            verdict: verdict as ReplicationAssessment["verdict"],
            issues: expectArray(entry.issues ?? [], "issues").map((issue) => {
                const record = expectObject(issue, "issue");
                return { code: readText(record.code), reason: readText(record.reason), repairInstruction: readText(record.repairInstruction) };
            }),
        };
    });
    const missing = refs.filter((ref) => !assessments.some((item) => item.clipRef === ref));
    if (missing.length) throw new StrictResultError("每个输入片段必须恰好返回一次。", { missing });
    return assessments;
}

export async function reviewStoryboard(document: ReplicationStudioDocument, clips: StudioClip[], context: StageContext) {
    const template = SCRIPT_TEMPLATES.splitReview as AnyRecord;
    const refs = clips.map(clipPlanRef);
    const payload = {
        ...reviewBase(document, String(template.task), Number(template.schemaVersion), String(template.outputContract), clips, document.segmentPlan),
        batchRef: `batch-${refs[0]}`,
        phase: template.phase,
        clips: clips.map(clipPayload),
        neighboringClips: [],
        localSignals: [],
        criteria: replicationReviewCriteria(),
    };
    const audioLanguage = buildPromptEvidence(document).adaptation.audioLanguage;
    context.log(`审核分镜：${refs.join("、")}`);
    const { result } = await requestStrictResult({
        model: textModel(document),
        systemPrompt: replicationReviewSystemPrompt({ repair: false, promptMode: document.settings.promptMode, audioLanguage }),
        payload,
        outputContract: payload.outputContract,
        temperature: 0.1,
        maxOutputTokens: 12000,
        parse: (value) => parseAssessments(value, refs),
        signal: context.signal,
    });
    return result;
}

function lockedTiming(clip: StudioClip, plan: SegmentPlanClip, document: ReplicationStudioDocument) {
    const timing = clipTiming(plan, document.settings.promptMode);
    const durationSec = Math.max(plan.durationSec, clip.shots.reduce((sum, shot) => sum + shot.duration, 0));
    let cursor = 0;
    const own = clip.shots.slice(0, -1).map((shot) => (cursor = Number((cursor + shot.duration).toFixed(3))));
    return { durationSec: Number(durationSec.toFixed(3)), sourceStartSec: plan.sourceStartSec, sourceEndSec: plan.sourceEndSec, shotBoundaries: [...new Set([...own, ...timing.observedBoundaries])].sort((a, b) => a - b) };
}

function parseRepairs(value: unknown, failed: Array<{ clip: StudioClip; plan: SegmentPlanClip; locked: { durationSec: number } }>, assets: StudioAsset[], continuous: boolean) {
    const result = expectObject(value, "修补结果");
    const repairs = expectArray(result.repairs, "repairs");
    return failed.map(({ clip, plan, locked }) => {
        const ref = clipPlanRef(clip);
        const repair = repairs.find((item) => readText((item as AnyRecord)?.sourceClipRef) === ref) as AnyRecord | undefined;
        if (!repair) throw new StrictResultError(`缺少 ${ref} 的修补。`);
        const parts = expectArray(repair.clips, "clips");
        if (parts.length !== 1) throw new StrictResultError("复刻修补不得改变片段数量或引用。", { ref, returned: parts.length });
        const record = expectObject(parts[0], "clip");
        const usages = new Map<string, string>();
        const shots = expectArray(record.shots, "shots").map((entry, index) => parseShot(entry, `${ref} 第 ${index + 1} 镜`, assets, usages));
        return finishClip(record, ref, shots, usages, plan, continuous, locked);
    });
}

export async function repairStoryboard(document: ReplicationStudioDocument, assessments: ReplicationAssessment[], context: StageContext) {
    const template = SCRIPT_TEMPLATES.splitRepair as AnyRecord;
    const failed = assessments
        .filter((item) => item.verdict === "repair")
        .flatMap((item) => {
            const clip = document.clips.find((entry) => clipPlanRef(entry) === item.clipRef);
            const plan = document.segmentPlan.find((entry) => entry.ref === item.clipRef);
            return clip && plan ? [{ clip, plan, issues: item.issues, locked: lockedTiming(clip, plan, document) }] : [];
        });
    if (!failed.length) return [];
    const continuous = isContinuousTimelineMode(document.settings.promptMode);
    const failedRefs = new Set(failed.map((item) => clipPlanRef(item.clip)));
    const base = reviewBase(document, String(template.task), Number(template.schemaVersion), String(template.outputContract), failed.map((item) => item.clip), document.segmentPlan);
    base.timingContract.clips = base.timingContract.clips.map((timing) => ({ ...timing, durationSec: failed.find((item) => item.plan.ref === timing.ref)?.locked.durationSec ?? timing.durationSec }));
    const neighbors = document.clips.filter((clip, index) => !failedRefs.has(clipPlanRef(clip)) && [document.clips[index - 1], document.clips[index + 1]].some((other) => other && failedRefs.has(clipPlanRef(other))));
    const payload = {
        ...base,
        repairRound: template.repairRound,
        failedClips: failed.map((item) => ({ sourceClipRef: clipPlanRef(item.clip), issues: item.issues, clip: clipPayload(item.clip), lockedTiming: item.locked })),
        readOnlyNeighboringClips: neighbors.map(clipPayload),
        allowedAssetReferences: document.assets.map((asset) => ({ assetRef: asset.id, allowedAppearanceRefs: asset.appearances.map((look) => look.id) })),
        instruction: replicationRepairInstruction(),
    };
    const audioLanguage = buildPromptEvidence(document).adaptation.audioLanguage;
    context.log(`修补分镜：${[...failedRefs].join("、")}`);
    const { result } = await requestStrictResult({
        model: textModel(document),
        systemPrompt: replicationReviewSystemPrompt({ repair: true, promptMode: document.settings.promptMode, audioLanguage }),
        payload,
        outputContract: payload.outputContract,
        temperature: 0.2,
        maxOutputTokens: 24000,
        parse: (value) => parseRepairs(value, failed, document.assets, continuous),
        signal: context.signal,
    });
    return result.map((parsed) => {
        const item = failed.find((entry) => entry.plan.ref === parsed.ref)!;
        return { ...toStudioClip(parsed, item.plan, item.clip), number: item.clip.number };
    });
}

export function renumberClips(clips: StudioClip[]) {
    return clips.map((clip, index) => ({ ...clip, number: index + 1 }));
}
