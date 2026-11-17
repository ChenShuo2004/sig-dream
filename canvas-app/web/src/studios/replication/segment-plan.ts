import { buildAudioLanguageRule, isContinuousTimelineMode } from "../prompts/replication-policy";
import type { StudioAsset } from "../types";
import type { ReplicationPromptMode, ReplicationStudioDocument, SegmentPlanClip, SourceAnalysis, SourceDialogue, SourceEvent, SourceVoiceover } from "./document";

const round3 = (value: number) => Number(value.toFixed(3));
const round1 = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

type SpeechKey = string;
type Utterance = { key: SpeechKey; kind: "dialogue" | "voiceover"; item: SourceDialogue | SourceVoiceover };

function eventSpeech(event: SourceEvent): Utterance[] {
    const order = event.speechOrder.length ? event.speechOrder : [...event.dialogue.map((_, index) => `dialogue:${index}`), ...event.voiceover.map((_, index) => `voiceover:${index}`)];
    return order.flatMap((key) => {
        const [kind, rawIndex] = key.split(":");
        const item = kind === "dialogue" ? event.dialogue[Number(rawIndex)] : kind === "voiceover" ? event.voiceover[Number(rawIndex)] : undefined;
        return item ? [{ key, kind: kind as Utterance["kind"], item }] : [];
    });
}

function utteranceStart(event: SourceEvent, utterance: Utterance) {
    if (Number.isFinite(utterance.item.startSec)) return Number(utterance.item.startSec);
    const shots = event.shots.filter((shot) => shot.speechRefs.includes(utterance.key));
    return shots.length ? Math.min(...shots.map((shot) => shot.startSec)) : event.startSec;
}

/** Fixed clip ranges cut at event ends (then shot ends) within the per-clip limit, like SHUO's segment planner. */
export function buildSegmentPlan(analysis: SourceAnalysis, { durationSec, maxSeconds, promptMode }: { durationSec: number; maxSeconds: number; promptMode: ReplicationPromptMode }): SegmentPlanClip[] {
    const total = Number(durationSec);
    const limit = isContinuousTimelineMode(promptMode) ? Math.floor(maxSeconds) : maxSeconds;
    if (!(total > 0 && limit > 0) || !analysis.events.length) throw new Error("原片缺少可分段的时间证据。");
    const eventEnds = [...new Set(analysis.events.map((event) => event.endSec))].sort((a, b) => a - b);
    const shotEnds = [...new Set(analysis.events.flatMap((event) => event.shots.map((shot) => shot.endSec)))].sort((a, b) => a - b);
    const plan: SegmentPlanClip[] = [];
    let start = 0;
    while (start < total - 0.001) {
        const cap = Math.min(total, start + limit);
        const within = (values: number[]) => values.filter((value) => value > start + 0.001 && value <= cap + 0.001).at(-1);
        const end = cap === total ? total : (within(eventEnds) ?? within(shotEnds) ?? cap);
        const events = analysis.events.filter((event) => event.endSec > start && event.startSec < end).map((event) => sliceEvent(event, start, end));
        const span = round3(end - start);
        plan.push({ ref: `clip-${plan.length + 1}`, sourceStartSec: round3(start), sourceEndSec: round3(end), durationSec: isContinuousTimelineMode(promptMode) ? Math.ceil(span) : span, events });
        start = end;
    }
    return plan;
}

function sliceEvent(event: SourceEvent, start: number, end: number): SourceEvent {
    const kept = eventSpeech(event).filter((utterance) => {
        const at = utteranceStart(event, utterance);
        return at >= start - 0.001 && at < end - 0.001;
    });
    const dialogue: SourceDialogue[] = [];
    const voiceover: SourceVoiceover[] = [];
    const remap = new Map<string, string>();
    const speechOrder = kept.map((utterance) => {
        const list = utterance.kind === "dialogue" ? dialogue : voiceover;
        const key = `${utterance.kind}:${list.length}`;
        (list as Array<SourceDialogue | SourceVoiceover>).push(utterance.item);
        remap.set(utterance.key, key);
        return key;
    });
    const shots = event.shots
        .filter((shot) => shot.endSec > start && shot.startSec < end)
        .map((shot) => ({
            ...shot,
            startSec: Math.max(start, shot.startSec),
            endSec: Math.min(end, shot.endSec),
            ...(shot.startSec < start ? { spatialStart: [] } : {}),
            ...(shot.endSec > end ? { spatialEnd: [] } : {}),
            speechRefs: shot.speechRefs.flatMap((ref) => (remap.has(ref) ? [remap.get(ref)!] : [])),
        }));
    return { ...event, startSec: Math.max(start, event.startSec), endSec: Math.min(end, event.endSec), dialogue, voiceover, speechOrder, shots, timingEstimated: event.startSec < start || event.endSec > end };
}

export function clipTiming(clip: SegmentPlanClip, promptMode: ReplicationPromptMode) {
    const local = (value: number) => (isContinuousTimelineMode(promptMode) ? round1(value) : Number(value.toFixed(3)));
    const boundaries = [...new Set(clip.events.flatMap((event) => event.shots.flatMap((shot) => [shot.startSec, shot.endSec])).map((value) => local(value - clip.sourceStartSec)))]
        .filter((value) => value > 0 && value < clip.durationSec)
        .sort((a, b) => a - b);
    const covered = clip.events.flatMap((event) => event.shots).sort((a, b) => a.startSec - b.startSec);
    let cursor = clip.sourceStartSec;
    let gap = false;
    for (const shot of covered) {
        if (shot.startSec - cursor > 0.1) gap = true;
        cursor = Math.max(cursor, shot.endSec);
    }
    if (clip.sourceEndSec - cursor > 0.1) gap = true;
    return {
        ref: clip.ref,
        durationSec: clip.durationSec,
        sourceStartSec: clip.sourceStartSec,
        sourceEndSec: clip.sourceEndSec,
        sourceShotsComplete: clip.events.length > 0 && clip.events.every((event) => event.shots.length) && !gap,
        observedBoundaries: boundaries,
    };
}

export function buildTimingContract(plan: SegmentPlanClip[], promptMode: ReplicationPromptMode) {
    return { unit: "seconds", ...(isContinuousTimelineMode(promptMode) ? { precision: 0.1 } : {}), origin: "clip-start", clips: plan.map((clip) => clipTiming(clip, promptMode)) };
}

const hasSpeech = (item: SourceDialogue | SourceVoiceover) => Boolean(item.text || item.uncertain || ("kind" in item && item.kind === "uncertain"));
const isUncertain = (item: SourceDialogue | SourceVoiceover) => item.uncertain || ("kind" in item && item.kind === "uncertain") || /听不清|无法听清|无法辨认/u.test(item.text);

export function buildSpeechPolicy(analysis: SourceAnalysis) {
    return {
        schemaVersion: 1,
        events: analysis.events.map((event) => {
            const dialogue = event.dialogue.filter(hasSpeech);
            const voiceover = event.voiceover.filter(hasSpeech);
            const uncertain = [...dialogue, ...voiceover].some(isUncertain) || event.uncertainties.some((text) => /人声|台词|对白|旁白|音频|speech|audio/iu.test(text));
            const mode = uncertain ? "uncertain" : dialogue.length && voiceover.length ? "mixed" : dialogue.length ? "dialogue_only" : voiceover.length ? "voiceover_only" : "no_speech";
            return { eventId: event.id, startSec: event.startSec, endSec: event.endSec, mode, dialogueCount: dialogue.length, voiceoverCount: voiceover.length, voiceoverKinds: [...new Set(voiceover.map((item) => item.kind))] };
        }),
    };
}

export function generationAssets(assets: StudioAsset[]) {
    return assets.map((asset) => ({
        ref: asset.id,
        kind: asset.kind,
        name: asset.name,
        description: asset.description,
        appearances: asset.appearances.map((look) => ({ ref: look.id, name: look.name, description: look.description })),
    }));
}

export function sceneCodes(assets: StudioAsset[]) {
    return assets.filter((asset) => asset.kind === "scene").map((asset, index) => ({ code: `s${index + 1}`, name: asset.name, assetRef: asset.id }));
}

/** projectReplicationPromptEvidence(buildVideoReplicationSourceEvidence(...)) restricted to the requested clips. */
export function buildPromptEvidence(document: ReplicationStudioDocument, refs?: Set<string>) {
    const analysis = document.analysis!;
    const plan = document.segmentPlan.filter((clip) => !refs || refs.has(clip.ref));
    return {
        sourceDurationSec: document.source?.durationSec,
        sourceLanguage: analysis.sourceLanguage,
        contentType: document.contentType !== "unknown" ? document.contentType : analysis.contentType,
        contentTypeReason: analysis.contentTypeReason,
        characters: analysis.characters.map(({ id, name, description, identityNotes, role, subjectType, roleEvidence }) => ({ id, name, description, identityNotes, role, subjectType, roleEvidence })),
        speechPolicy: buildSpeechPolicy(analysis),
        segmentPlan: plan,
        adaptation: {
            targetLocale: document.settings.targetLocale || "source",
            audioLanguage: buildAudioLanguageRule(document.settings.targetLocale || "source", analysis.sourceLanguage),
            characterBindings: analysis.characters.map((character) => ({ sourceCharacterId: character.id, targetAssetId: document.characterBindings[character.id] || "" })),
            replacements: document.assets
                .filter((asset) => asset.kind === "character")
                .map((asset) => {
                    const sourceId = Object.keys(document.characterBindings).find((id) => document.characterBindings[id] === asset.id);
                    const original = analysis.characters.find((character) => character.id === sourceId);
                    return { assetId: asset.id, assetRef: asset.id, targetName: asset.name, original: original ? { id: original.id, name: original.name } : null };
                }),
        },
    };
}
