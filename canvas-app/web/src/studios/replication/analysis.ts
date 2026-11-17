import { resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";

import { studioMediaDataUrl } from "../media";
import { REPLICATION_PROMPTS, normalizeContentType } from "../prompts/replication-policy";
import { StrictResultError, expectArray, expectObject, readText, requestStrictResult } from "../runtime/strict-request";
import type { SpatialRelation, StudioShot } from "../types";
import type { ReplicationSettings, ReplicationSource, SourceAnalysis, SourceCharacter, SourceDialogue, SourceEvent, SourceShot, SourceVoiceover } from "./document";

const R = REPLICATION_PROMPTS.rules;
const MAX_FRAMES = 80;
type AnyRecord = Record<string, unknown>;

export type AnalysisContext = { signal?: AbortSignal; log: (text: string, level?: "info" | "warn" | "error") => void; onDelta?: (text: string) => void };

// SHUO 在其服务器上完成这一步，原文不可得；以下提示词按其 sourceAnalysis 结构自行编写，并引用其公开的观察规则原文。
const ANALYSIS_SYSTEM_PROMPT = [
    "你是原片复刻的观察记录员。根据提供的逐镜截图（每张对应一个已由切镜检测确定的镜头）和原片音轨（若提供），完整记录原片里实际看到和听到的内容，供后续分镜复刻使用。只返回指定结构的严格 JSON，不添加解释。",
    "只记录有证据的内容：看不清、听不清或无法确认的写入 uncertainties，不按剧情猜测补写。镜头切点已由程序检测，shots 必须逐字使用输入的 shot id 和起止秒数，不得合并、拆分或改时间。",
    R.REPLICATION_SOURCE_SPEECH_RULE,
    R.REPLICATION_ORIENTATION_OBSERVATION_RULE,
    R.REPLICATION_CONTENT_ROUTING_RULE,
    R.REPLICATION_VISUAL_ELEMENTS_RULE,
    R.REPLICATION_VISUAL_STATE_RULE,
].join("\n");

const OUTPUT_FORMAT = {
    videoObserved: true,
    observationError: "",
    title: "原片标题或概括",
    synopsis: "按时间顺序的剧情概述",
    contentType: "story/narrated_story/advertisement/unknown",
    contentTypeReason: "画面依据",
    sourceLanguage: "人声语言，如 zh-CN；无人声留空",
    characters: [
        {
            id: "c1",
            name: "原片称呼或外观称呼",
            description: "身份与稳定特征",
            visualPrompt: "可直接用于生成该人物定妆图的外貌、发型、服装、体型描述",
            role: "main/supporting/background/uncertain",
            subjectType: "person/animal/uncertain",
            roleEvidence: "判断依据",
            identityNotes: "身份疑点，没有留空",
            representativeTimeSec: 1.5,
        },
    ],
    events: [
        {
            id: "e1",
            startSec: 0,
            endSec: 4.2,
            visual: "本事件画面概述",
            camera: "主要拍法",
            visualStyle: "色调、光影与画面质感",
            sound: "音乐、音效与环境声，不含人声原文",
            characterIds: ["c1"],
            dialogue: [{ speakerId: "c1", text: "原话", uncertain: false, startSec: 0.5, endSec: 2.1 }],
            voiceover: [{ kind: "narration/inner_monologue/uncertain", speakerId: "", text: "原话", uncertain: false, startSec: 2.2, endSec: 4.0 }],
            speechOrder: ["dialogue:0", "voiceover:0"],
            shots: [
                {
                    id: "shot-1",
                    startSec: 0,
                    endSec: 2.0,
                    visual: "本镜实际可见的主体、位置朝向、动作和表情",
                    camera: "景别、机位、方向与运动",
                    sceneKey: "scene-1",
                    textElements: [{ kind: "physical/graphic/speech_subtitle/uncertain", text: "原文", carrier: "承载物", placement: "位置" }],
                    spatialStart: [{ subject: "人物", landmark: "地标或另一主体", relation: "相对位置", facing: "朝向/视线", pose: "姿态", heldObject: "持物" }],
                    spatialEnd: [],
                    speechRefs: ["dialogue:0"],
                },
            ],
            uncertainties: [],
        },
    ],
};

function sampleShots<T>(shots: T[], limit: number) {
    if (shots.length <= limit) return shots;
    return Array.from({ length: limit }, (_, index) => shots[Math.round((index * (shots.length - 1)) / (limit - 1))]);
}

export function analysisSupportsAudio(model: string) {
    const config = useConfigStore.getState().config;
    return resolveModelRequestConfig(config, model || config.textModel).apiFormat === "gemini";
}

const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round3 = (value: number) => Math.round(value * 1000) / 1000;

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
    return value
        .map((item) => {
            const record = (item && typeof item === "object" ? item : {}) as AnyRecord;
            const kind = kinds.find((entry) => entry === record.kind) || "uncertain";
            return { kind, text: readText(record.text), carrier: readText(record.carrier), placement: readText(record.placement) };
        })
        .filter((item) => item.text);
}

function parseAnalysis(value: unknown, source: ReplicationSource, audioHeard: boolean): SourceAnalysis {
    const result = expectObject(value, "原片分析");
    if (result.videoObserved !== true) throw new StrictResultError(`模型未确认读取到原片截图：${readText(result.observationError) || "请更换支持图片理解的模型后重试"}`);
    const intakeShots = new Map(source.shots.map((shot) => [`shot-${shot.index}`, shot]));
    const characterIds = new Set<string>();
    const characters: SourceCharacter[] = expectArray(result.characters ?? [], "characters").map((item) => {
        const record = expectObject(item, "character");
        const id = readText(record.id);
        if (!id || characterIds.has(id)) throw new StrictResultError(`人物编号无效或重复：${id || "空"}`);
        characterIds.add(id);
        const visualPrompt = readText(record.visualPrompt);
        if (!visualPrompt) throw new StrictResultError(`人物 ${id} 缺少 visualPrompt 生图外观描述。`);
        const role = (["main", "supporting", "background", "uncertain"] as const).find((entry) => entry === record.role) || "uncertain";
        const subjectType = (["person", "animal", "uncertain"] as const).find((entry) => entry === record.subjectType) || "uncertain";
        return {
            id,
            name: readText(record.name) || id,
            description: readText(record.description),
            visualPrompt,
            role,
            subjectType,
            roleEvidence: readText(record.roleEvidence),
            identityNotes: readText(record.identityNotes),
            representativeTimeSec: Math.min(Math.max(0, num(record.representativeTimeSec)), source.durationSec),
        };
    });
    const covered = new Set<string>();
    const events: SourceEvent[] = expectArray(result.events, "events").map((item, eventIndex) => {
        const record = expectObject(item, "event");
        const id = readText(record.id) || `e${eventIndex + 1}`;
        const dialogue: SourceDialogue[] = expectArray(record.dialogue ?? [], "dialogue").map((entry) => {
            const speech = expectObject(entry, "dialogue");
            const speakerId = readText(speech.speakerId);
            return { speakerId: characterIds.has(speakerId) ? speakerId : "", text: readText(speech.text), uncertain: speech.uncertain === true || !characterIds.has(speakerId), ...timing(speech) };
        });
        const voiceover: SourceVoiceover[] = expectArray(record.voiceover ?? [], "voiceover").map((entry) => {
            const speech = expectObject(entry, "voiceover");
            const kind = (["narration", "inner_monologue", "uncertain"] as const).find((value) => value === speech.kind) || "uncertain";
            const speakerId = readText(speech.speakerId);
            return { kind, speakerId: characterIds.has(speakerId) ? speakerId : "", text: readText(speech.text), uncertain: speech.uncertain === true || kind === "uncertain", ...timing(speech) };
        });
        const validRefs = new Set([...dialogue.map((_, index) => `dialogue:${index}`), ...voiceover.map((_, index) => `voiceover:${index}`)]);
        const declaredOrder = Array.isArray(record.speechOrder) ? record.speechOrder.map(readText).filter((ref) => validRefs.has(ref)) : [];
        const speechOrder = [...new Set([...declaredOrder, ...validRefs])];
        const shots: SourceShot[] = expectArray(record.shots ?? [], "shots").flatMap((entry) => {
            const shot = expectObject(entry, "shot");
            const shotId = readText(shot.id);
            const intake = intakeShots.get(shotId);
            if (!intake || covered.has(shotId)) return [];
            covered.add(shotId);
            return [
                {
                    id: shotId,
                    startSec: intake.startSec,
                    endSec: intake.endSec,
                    visual: readText(shot.visual),
                    camera: readText(shot.camera),
                    sceneKey: readText(shot.sceneKey),
                    textElements: readTextElements(shot.textElements),
                    spatialStart: readSpatial(shot.spatialStart),
                    spatialEnd: readSpatial(shot.spatialEnd),
                    speechRefs: (Array.isArray(shot.speechRefs) ? shot.speechRefs.map(readText) : []).filter((ref) => validRefs.has(ref)),
                },
            ];
        });
        shots.sort((a, b) => a.startSec - b.startSec);
        const startSec = shots.length ? shots[0].startSec : round3(num(record.startSec));
        const endSec = shots.length ? shots[shots.length - 1].endSec : round3(Math.min(num(record.endSec), source.durationSec));
        return {
            id,
            startSec,
            endSec,
            visual: readText(record.visual),
            camera: readText(record.camera),
            visualStyle: readText(record.visualStyle),
            sound: readText(record.sound),
            characterIds: (Array.isArray(record.characterIds) ? record.characterIds.map(readText) : []).filter((ref) => characterIds.has(ref)),
            dialogue,
            voiceover,
            speechOrder,
            shots,
            uncertainties: Array.isArray(record.uncertainties) ? record.uncertainties.map(readText).filter(Boolean) : [],
        };
    });
    const missing = source.shots.filter((shot) => !covered.has(`shot-${shot.index}`)).map((shot) => `shot-${shot.index}`);
    if (missing.length) throw new StrictResultError(`以下镜头没有归入任何事件：${missing.slice(0, 20).join("、")}`, { missingShotIds: missing });
    if (!events.length) throw new StrictResultError("原片分析缺少事件时间轴。");
    events.sort((a, b) => a.startSec - b.startSec);
    if (!audioHeard) for (const event of events) if (!event.uncertainties.some((text) => /音轨|音频|人声/u.test(text))) event.uncertainties.push("本次分析没有音轨，人声为空或仅依据字幕推测，请核对原片。");
    return {
        title: readText(result.title),
        synopsis: readText(result.synopsis),
        contentType: normalizeContentType(result.contentType),
        contentTypeReason: readText(result.contentTypeReason),
        sourceLanguage: readText(result.sourceLanguage),
        audioHeard,
        characters,
        events,
    };
}

function timing(record: AnyRecord) {
    const startSec = Number(record.startSec);
    const endSec = Number(record.endSec);
    return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec ? { startSec: round3(startSec), endSec: round3(endSec) } : {};
}

export async function analyzeSource(settings: ReplicationSettings, source: ReplicationSource, context: AnalysisContext): Promise<SourceAnalysis> {
    if (!source.shots.length) throw new Error("原片还没有切镜结果，请先完成上传和切镜。");
    const model = settings.analysisModel || settings.textModel;
    const withAudio = Boolean(source.audioKey) && analysisSupportsAudio(model);
    const framed = sampleShots(source.shots, MAX_FRAMES);
    const images: string[] = [];
    for (const shot of framed) {
        const dataUrl = await studioMediaDataUrl(shot.frameKey);
        if (dataUrl) images.push(dataUrl);
    }
    if (withAudio) {
        const audio = await studioMediaDataUrl(source.audioKey);
        if (audio) images.push(audio.replace(/^data:[^;,]*/u, "data:audio/mpeg"));
    } else {
        context.log(source.audioKey ? "当前分析模型不是 Gemini 接口，无法直接听原片音轨，人声只能依据画面字幕推测。" : "原片没有音轨。", "warn");
    }
    const payload = {
        task: "observe_source_video",
        sourceDurationSec: source.durationSec,
        frame: { width: source.width, height: source.height, fps: source.fps },
        shots: source.shots.map((shot) => ({ id: `shot-${shot.index}`, startSec: shot.startSec, endSec: shot.endSec })),
        shotFrames: framed.map((shot) => `shot-${shot.index}`),
        attachments: `前 ${images.length - (withAudio ? 1 : 0)} 张图片依次对应 shotFrames 中每个镜头开头的截图${framed.length < source.shots.length ? "（镜头较多，只抽取了部分镜头截图，其余镜头依据相邻截图和音轨谨慎记录）" : ""}。${withAudio ? "最后一个附件是原片完整音轨（16kHz 单声道），时间与 shots 一致。" : "没有提供音轨，听不到人声时如实在 uncertainties 说明。"}`,
        requirements: [
            "events 按时间顺序覆盖整片；每个输入 shot 恰好归入一个 event 的 shots，同一 event 的镜头时间连续。",
            "characters 只登记画面中实际出现的人物或动物，id 使用 c1、c2…，visualPrompt 必须填写可生成定妆图的外貌、发型、服装与体型。",
            "人声逐句记录在所属 event 的 dialogue / voiceover，startSec/endSec 填原片绝对秒数；speechOrder 按实际发声顺序引用 dialogue:序号 或 voiceover:序号；shots[].speechRefs 指向该镜头内开始发声的人声。",
            "同一连续时空的镜头使用相同 sceneKey；textElements 与 spatialStart/spatialEnd 只填有画面依据的内容，无法确认的留空。",
        ],
        outputFormat: OUTPUT_FORMAT,
    };
    context.log(`观察原片：${source.shots.length} 个镜头，发送 ${framed.length} 张截图${withAudio ? "和音轨" : ""}`);
    const { result } = await requestStrictResult({
        model,
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        payload,
        images,
        temperature: 0.2,
        maxOutputTokens: 32000,
        parse: (value) => parseAnalysis(value, source, withAudio),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}
