import { nanoid } from "nanoid";

import { SCRIPT_PRESETS, SCRIPT_SYSTEM_PROMPTS, SCRIPT_TEMPLATES } from "../prompts/script.generated";
import { runStageReview, writePath, type ReviewPatch, type ReviewTarget, type StageReviewOutcome } from "../runtime/stage-review";
import { expectArray, expectObject, fillTemplate, readText, readTextList, requestStrictResult, StrictResultError, type TemplateVars } from "../runtime/strict-request";
import type { StudioAppearance, StudioAppearanceReferenceRole, StudioAsset, StudioAssetKind, StudioClip, StudioEndingState, StudioEpisode, StudioScriptScene, StudioShot } from "../types";
import { episodeScriptText } from "../types";
import type { ScriptSettings, ScriptStudioDocument, SourceDigestChunk, StoryCharacter, StorySummary } from "./document";
import { shouldUseSkeletonOutline } from "./document";

export type StageContext = { signal?: AbortSignal; log: (message: string, level?: "info" | "warn" | "error") => void; onDelta?: (text: string) => void };

type AnyRecord = Record<string, unknown>;

function insertBefore(source: AnyRecord, beforeKey: string, entries: AnyRecord): AnyRecord {
    const result: AnyRecord = {};
    let inserted = false;
    for (const [key, value] of Object.entries(source)) {
        if (key === beforeKey && !inserted) {
            Object.assign(result, entries);
            inserted = true;
        }
        if (!(key in entries)) result[key] = value;
    }
    if (!inserted) Object.assign(result, entries);
    return result;
}

function templateVars(settings: ScriptSettings, extra: TemplateVars = {}): TemplateVars {
    const episodeCount = Math.max(1, Math.round(settings.episodeCount || 1));
    return { episodeCount, episodeMin: Math.ceil(episodeCount * 0.9), style: settings.visualStyle.trim(), clipMaxSeconds: settings.clipMaxSeconds, ...extra };
}

export function visualStyleText(settings: ScriptSettings) {
    const stylePrompt = (settings.stylePrompt || "").trim();
    if (stylePrompt) return stylePrompt;
    const label = (settings.visualStyle || "").trim();
    if (!label) return "";
    // Expand short custom labels (e.g. SHUO「真人写实 · 电影感 · 冷色调」) to full preset text when possible.
    const presets = SCRIPT_PRESETS.stylePresets as ReadonlyArray<{ label: string; prompt?: string; assetPrompt?: string }>;
    const matched = presets.find((preset) => preset.label === label) || presets.find((preset) => label.includes(preset.label) || preset.label.includes(label.split(/[·•|｜]/u)[0]?.trim() || label));
    return (matched?.prompt || matched?.assetPrompt || label).trim();
}

function requireTextModel(settings: ScriptSettings) {
    return settings.textModel;
}

function readEndingState(value: unknown): StudioEndingState {
    const state = value && typeof value === "object" ? (value as AnyRecord) : {};
    return { characters: readTextList(state.characters), props: readTextList(state.props), unresolvedThreads: readTextList(state.unresolvedThreads) };
}

// ---------- summary ----------

function parseSummary(value: unknown): StorySummary {
    const result = expectObject(value, "剧本摘要");
    const title = readText(result.title);
    const storySummary = readText(result.storySummary);
    if (!title || !storySummary) throw new StrictResultError("title 和 storySummary 不能为空。");
    const contract = result.storyContract && typeof result.storyContract === "object" ? (result.storyContract as AnyRecord) : {};
    const characters = expectArray(result.characters ?? [], "characters").map((item, index): StoryCharacter => {
        const character = expectObject(item, "character");
        return {
            ref: readText(character.ref) || `character-${index + 1}`,
            name: readText(character.name),
            roleType: readText(character.roleType),
            fixedTraits: readText(character.fixedTraits),
            coreTags: readTextList(character.coreTags),
            profile: readText(character.profile),
            motivation: readText(character.motivation),
            relationships: readText(character.relationships),
            personality: readText(character.personality),
            arc: readText(character.arc),
        };
    });
    return {
        title,
        storyType: readText(result.storyType),
        targetAudience: readText(result.targetAudience),
        storySummary,
        storyBackground: readText(result.storyBackground),
        storySetting: readText(result.storySetting),
        coreHook: readText(result.coreHook),
        logline: readText(result.logline),
        storyContract: {
            protagonistGoal: readText(contract.protagonistGoal),
            centralConflict: readText(contract.centralConflict),
            stakes: readText(contract.stakes),
            progressionDriver: readText(contract.progressionDriver),
            constraints: readText(contract.constraints),
            climax: readText(contract.climax),
            ending: readText(contract.ending),
        },
        plotBeats: expectArray(result.plotBeats ?? [], "plotBeats").map((item) => {
            const beat = expectObject(item, "plotBeat");
            return { stage: readText(beat.stage), event: readText(beat.event), consequence: readText(beat.consequence) };
        }),
        continuityFacts: readTextList(result.continuityFacts),
        characters: characters.filter((character) => character.name),
    };
}

function summaryInput(settings: ScriptSettings, digests: SourceDigestChunk[] = []) {
    if (settings.sourceMode === "generate") return { idea: settings.idea.trim() };
    const sourceText = digests.length ? settings.sourceText.slice(0, 2000) : settings.sourceText;
    if (settings.sourceMode === "upload") return { fileName: settings.fileName, sourceText, ...(digests.length ? { sourceDigests: digests } : {}) };
    return { fileName: settings.fileName, sourceText, sourceDigests: digests, rewriteInstruction: settings.rewriteInstruction.trim() };
}

const DIGEST_CHUNK = 7000;
const DIGEST_OVERLAP = 200;

function chunkSourceText(text: string): string[] {
    const source = text.trim();
    if (!source) return [];
    if (source.length <= DIGEST_CHUNK) return [source];
    const chunks: string[] = [];
    let start = 0;
    while (start < source.length) {
        let end = Math.min(source.length, start + DIGEST_CHUNK);
        if (end < source.length) {
            const breakAt = source.lastIndexOf("\n", end);
            if (breakAt > start + DIGEST_CHUNK / 2) end = breakAt;
        }
        chunks.push(source.slice(start, end));
        if (end >= source.length) break;
        start = Math.max(start + 1, end - DIGEST_OVERLAP);
    }
    return chunks;
}

function parseSourceDigest(value: unknown, chunkIndex: number, chunkTotal: number): SourceDigestChunk {
    const result = expectObject(value, "源文摘要");
    return {
        chunkIndex,
        chunkTotal,
        characters: readTextList(result.characters),
        settings: readTextList(result.settings),
        events: readTextList(result.events),
        continuity: readTextList(result.continuity),
        endingState: readText(result.endingState),
    };
}

export async function digestSource(settings: ScriptSettings, context: StageContext): Promise<SourceDigestChunk[]> {
    const chunks = chunkSourceText(settings.sourceText);
    if (!chunks.length) return [];
    const digests: SourceDigestChunk[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
        context.log(`整理源文分段 ${index + 1}/${chunks.length}`);
        const payload = {
            task: "digest_story_source",
            schemaVersion: 1,
            chunkIndex: index,
            chunkTotal: chunks.length,
            fileName: settings.fileName || "",
            sourceText: chunks[index],
            requirements: ["只提取本分段可见事实", "不续写、不评价、不改变人物关系与事件结果", "JSON 总内容控制在 1500 汉字以内"],
            outputSchema: {
                characters: ["本分段出现的人物及其身份要点"],
                settings: ["本分段出现的地点/时代/环境"],
                events: ["本分段关键事件，按发生顺序"],
                continuity: ["本分段确认且后续需保持的事实"],
                endingState: "本分段结束时的人物/道具/线索状态摘要",
            },
        };
        const { result } = await requestStrictResult({
            model: requireTextModel(settings),
            systemPrompt: SCRIPT_SYSTEM_PROMPTS.sourceDigest,
            payload,
            schemaName: "story_source_digest",
            temperature: 0.2,
            maxOutputTokens: 4000,
            parse: (value) => parseSourceDigest(value, index, chunks.length),
            signal: context.signal,
            onDelta: context.onDelta,
        });
        digests.push(result);
    }
    return digests;
}

function summaryGrounding(settings: ScriptSettings) {
    if (settings.sourceMode === "generate") return { idea: settings.idea.trim() };
    if (settings.sourceMode === "upload") return { sourceText: settings.sourceText };
    return { sourceText: settings.sourceText, rewriteInstruction: settings.rewriteInstruction.trim() };
}

export function originalCreative(settings: ScriptSettings) {
    if (settings.sourceMode === "generate") return settings.idea.trim();
    if (settings.sourceMode === "rewrite") return settings.rewriteInstruction.trim();
    return "";
}

export function validateSettings(settings: ScriptSettings) {
    if (!settings.textModel) return "请先选择文本模型。";
    if (settings.sourceMode === "generate" && !settings.idea.trim()) return "请填写创意。";
    if (settings.sourceMode !== "generate" && !settings.sourceText.trim()) return "请上传或粘贴参考剧本。";
    if (settings.sourceMode === "rewrite" && !settings.rewriteInstruction.trim()) return "请填写改写要求。";
    return "";
}

export async function generateSummary(settings: ScriptSettings, context: StageContext, digests: SourceDigestChunk[] = []) {
    const key = `${settings.sourceMode}_${settings.scriptMode}_${settings.visualStyle.trim() ? "style" : "plain"}` as keyof typeof SCRIPT_TEMPLATES.summary;
    const template = fillTemplate(SCRIPT_TEMPLATES.summary[key] as AnyRecord, templateVars(settings));
    const payload = insertBefore(template, "outputSchema", { input: summaryInput(settings, digests) });
    context.log("生成剧本摘要");
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.summary,
        payload,
        schemaName: "story_summary",
        temperature: 0.7,
        maxOutputTokens: 12000,
        parse: parseSummary,
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

const SUMMARY_REVIEW_FIELDS = ["storySummary", "storyBackground", "storySetting", "coreHook", "logline", "continuityFacts"] as const;

export async function reviewSummary(settings: ScriptSettings, getSummary: () => StorySummary, applySummary: (summary: StorySummary) => void, context: StageContext): Promise<StageReviewOutcome> {
    return runStageReview({
        stage: "summary",
        model: requireTextModel(settings),
        grounding: summaryGrounding(settings),
        artifact: () => ({ title: getSummary().title, ...Object.fromEntries(SUMMARY_REVIEW_FIELDS.map((field) => [field, getSummary()[field]])) }),
        targets: () => [{ ref: "summary", title: getSummary().title, fields: Object.fromEntries(SUMMARY_REVIEW_FIELDS.map((field) => [field, getSummary()[field]])) }],
        applyPatches: (patches) => {
            let next = getSummary() as unknown as AnyRecord;
            for (const patch of patches) if (patch.ref === "summary") next = writePath(next, patch.field, patch.value);
            applySummary(next as unknown as StorySummary);
        },
        signal: context.signal,
        onLog: (message) => context.log(`摘要审核：${message}`),
    });
}

// ---------- outline ----------

export function storySummaryPayload(summary: StorySummary, storyFacts?: string[]) {
    return {
        title: summary.title,
        storyType: summary.storyType,
        targetAudience: summary.targetAudience,
        summary: summary.storySummary,
        background: summary.storyBackground,
        setting: summary.storySetting,
        coreHook: summary.coreHook,
        logline: summary.logline,
        storyContract: summary.storyContract,
        plotBeats: summary.plotBeats.map((beat, index) => ({ ref: `beat-${index + 1}`, ...beat })),
        storyFacts: storyFacts?.length ? storyFacts : summary.continuityFacts,
        characters: summary.characters,
    };
}

function parseOutline(value: unknown, episodeCount: number) {
    const result = expectObject(value, "分集大纲");
    const episodes = expectArray(result.episodes, "episodes");
    if (!episodes.length) throw new StrictResultError("episodes 不能为空。");
    if (episodes.length > episodeCount) throw new StrictResultError(`分集数不得超过 ${episodeCount} 集。`, { returned: episodes.length, max: episodeCount });
    const parsed = episodes.map((item, index): StudioEpisode => {
        const episode = expectObject(item, "episode");
        const synopsis = readText(episode.synopsis);
        if (!synopsis) throw new StrictResultError(`第 ${index + 1} 集缺少 synopsis。`);
        const estimate = Number(episode.estimatedDurationSeconds);
        return {
            id: `episode-${index + 1}`,
            number: index + 1,
            title: readText(episode.title) || `第${index + 1}集`,
            coreBeat: readText(episode.coreBeat),
            endingEvent: readText(episode.endingEvent),
            activeCharacters: readTextList(episode.activeCharacters),
            synopsis,
            hook: readText(episode.hook),
            continuityFacts: readTextList(episode.continuityFacts),
            endingState: readEndingState(episode.endingState),
            ...(Number.isFinite(estimate) && estimate > 0 ? { estimatedDurationSeconds: estimate } : {}),
            clips: [],
        };
    });
    return { storyFacts: readTextList(result.storyFacts), episodes: parsed };
}

type OutlineSkeletonEpisode = Pick<StudioEpisode, "id" | "number" | "title" | "coreBeat" | "endingEvent" | "activeCharacters">;

function parseOutlineSkeleton(value: unknown, episodeCount: number) {
    const result = expectObject(value, "分集骨架");
    const episodes = expectArray(result.episodes, "episodes");
    if (!episodes.length) throw new StrictResultError("episodes 不能为空。");
    if (episodes.length > episodeCount) throw new StrictResultError(`分集数不得超过 ${episodeCount} 集。`, { returned: episodes.length, max: episodeCount });
    const parsed = episodes.map((item, index): OutlineSkeletonEpisode => {
        const episode = expectObject(item, "episode");
        const coreBeat = readText(episode.coreBeat);
        const endingEvent = readText(episode.endingEvent);
        if (!coreBeat || !endingEvent) throw new StrictResultError(`第 ${index + 1} 集骨架缺少 coreBeat 或 endingEvent。`);
        return {
            id: `episode-${index + 1}`,
            number: index + 1,
            title: readText(episode.title) || `第${index + 1}集`,
            coreBeat,
            endingEvent,
            activeCharacters: readTextList(episode.activeCharacters),
        };
    });
    return { storyFacts: readTextList(result.storyFacts), episodes: parsed };
}

function parseOutlineBatch(value: unknown, batch: OutlineSkeletonEpisode[]) {
    const result = expectObject(value, "分集大纲批次");
    const episodes = expectArray(result.episodes, "episodes");
    if (episodes.length !== batch.length) throw new StrictResultError(`本批应返回 ${batch.length} 集，实际 ${episodes.length} 集。`);
    return episodes.map((item, index): StudioEpisode => {
        const episode = expectObject(item, "episode");
        const skeleton = batch[index];
        const synopsis = readText(episode.synopsis);
        if (!synopsis) throw new StrictResultError(`第 ${skeleton.number} 集缺少 synopsis。`);
        const estimate = Number(episode.estimatedDurationSeconds);
        return {
            id: skeleton.id,
            number: skeleton.number,
            title: readText(episode.title) || skeleton.title,
            coreBeat: skeleton.coreBeat,
            endingEvent: skeleton.endingEvent,
            activeCharacters: skeleton.activeCharacters?.length ? skeleton.activeCharacters : readTextList(episode.activeCharacters),
            synopsis,
            hook: readText(episode.hook),
            continuityFacts: readTextList(episode.continuityFacts),
            endingState: readEndingState(episode.endingState),
            ...(Number.isFinite(estimate) && estimate > 0 ? { estimatedDurationSeconds: estimate } : {}),
            clips: [],
        };
    });
}

async function generateOutlineComplete(settings: ScriptSettings, summary: StorySummary, context: StageContext) {
    const template = fillTemplate(SCRIPT_TEMPLATES.outline[settings.scriptMode] as AnyRecord, templateVars(settings));
    const payload = insertBefore(template, "constraints", { storySummary: storySummaryPayload(summary) });
    context.log("生成分集大纲");
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.outlineComplete,
        payload,
        schemaName: "story_episode_outlines",
        temperature: 0.35,
        maxOutputTokens: 24000,
        repairInstruction: SCRIPT_SYSTEM_PROMPTS.outlineContractRepair,
        parse: (value) => parseOutline(value, settings.episodeCount),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

async function generateOutlineSkeleton(settings: ScriptSettings, summary: StorySummary, context: StageContext) {
    const payload = {
        task: "plan_story_episode_outline_skeleton",
        schemaVersion: 2,
        phase: "skeleton",
        scriptMode: settings.scriptMode,
        constraints: { episodeCount: settings.episodeCount },
        storySummary: storySummaryPayload(summary),
        requirements: [
            `目标约 ${settings.episodeCount} 集，建议 ${Math.ceil(settings.episodeCount * 0.9)}-${settings.episodeCount} 集，不得超过上限。`,
            "只输出骨架：每集 coreBeat 与 endingEvent，不写详细 synopsis。",
            "storyFacts 登记跨集不可漂移的身份、关系、能力、道具与世界规则。",
            "最后一集必须完成摘要已确定的主要结局。",
        ],
        outputSchema: {
            storyFacts: ["跨集必须保持一致的单一事实"],
            episodes: [
                {
                    ref: "episode-1",
                    number: "从 1 开始的连续整数",
                    title: "分集标题",
                    coreBeat: "本集唯一核心推进",
                    endingEvent: "本集结尾已经发生的剧情事件",
                    activeCharacters: ["本集实际参与核心剧情的人物名"],
                },
            ],
        },
    };
    context.log("生成分集骨架");
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.outlineSkeleton,
        payload,
        schemaName: "story_episode_outline_skeleton",
        temperature: 0.3,
        maxOutputTokens: 12000,
        repairInstruction: SCRIPT_SYSTEM_PROMPTS.outlineContractRepair,
        parse: (value) => parseOutlineSkeleton(value, settings.episodeCount),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

async function generateOutlineBatches(settings: ScriptSettings, summary: StorySummary, storyFacts: string[], skeleton: OutlineSkeletonEpisode[], context: StageContext) {
    const batchSize = 4;
    const detailed: StudioEpisode[] = [];
    const totalBatches = Math.ceil(skeleton.length / batchSize);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        const batch = skeleton.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
        const template = fillTemplate(SCRIPT_TEMPLATES.outlineBatch[settings.scriptMode] as AnyRecord, templateVars(settings));
        const previous = detailed[detailed.length - 1];
        const payload = insertBefore(template, "constraints", {
            storySummary: storySummaryPayload(summary, storyFacts),
            storyFacts,
            previousEndingState: previous?.endingState || { characters: [], props: [], unresolvedThreads: [] },
            skeleton: {
                episodes: skeleton.map((episode) => ({
                    ref: episode.id,
                    number: episode.number,
                    title: episode.title,
                    coreBeat: episode.coreBeat,
                    endingEvent: episode.endingEvent,
                    activeCharacters: episode.activeCharacters,
                })),
            },
            batch: {
                index: batchIndex,
                total: totalBatches,
                episodes: batch.map((episode) => ({
                    ref: episode.id,
                    number: episode.number,
                    title: episode.title,
                    coreBeat: episode.coreBeat,
                    endingEvent: episode.endingEvent,
                    activeCharacters: episode.activeCharacters,
                })),
            },
        });
        context.log(`细化大纲批次 ${batchIndex + 1}/${totalBatches}`);
        const { result } = await requestStrictResult({
            model: requireTextModel(settings),
            systemPrompt: SCRIPT_SYSTEM_PROMPTS.outlineBatch,
            payload,
            schemaName: "story_episode_outline_batch",
            temperature: 0.35,
            maxOutputTokens: 16000,
            repairInstruction: SCRIPT_SYSTEM_PROMPTS.outlineContractRepair,
            parse: (value) => parseOutlineBatch(value, batch),
            signal: context.signal,
            onDelta: context.onDelta,
        });
        detailed.push(...result);
    }
    return detailed;
}

export async function generateOutline(settings: ScriptSettings, summary: StorySummary, context: StageContext) {
    if (!shouldUseSkeletonOutline(settings)) return generateOutlineComplete(settings, summary, context);
    const skeleton = await generateOutlineSkeleton(settings, summary, context);
    const episodes = await generateOutlineBatches(settings, summary, skeleton.storyFacts, skeleton.episodes, context);
    return { storyFacts: skeleton.storyFacts, episodes };
}

const OUTLINE_REVIEW_FIELDS = ["coreBeat", "endingEvent", "activeCharacters", "synopsis", "hook", "continuityFacts", "endingState.characters", "endingState.props", "endingState.unresolvedThreads"];

function episodeFields(episode: StudioEpisode, fields: string[]) {
    return Object.fromEntries(fields.map((field) => [field, field.split(".").reduce<unknown>((value, key) => (value as AnyRecord | undefined)?.[key], episode)]));
}

function patchEpisodes(episodes: StudioEpisode[], patches: ReviewPatch[]) {
    return episodes.map((episode) => {
        const own = patches.filter((patch) => patch.ref === episode.id);
        return own.reduce((current, patch) => writePath(current as unknown as AnyRecord, patch.field, patch.value) as unknown as StudioEpisode, episode);
    });
}

export async function reviewOutline(settings: ScriptSettings, summary: StorySummary, getDocument: () => ScriptStudioDocument, applyEpisodes: (episodes: StudioEpisode[]) => void, context: StageContext) {
    return runStageReview({
        stage: "outline",
        model: requireTextModel(settings),
        grounding: { originalCreative: originalCreative(settings), storySummary: storySummaryPayload(summary, getDocument().storyFacts) },
        artifact: () => ({ storyFacts: getDocument().storyFacts, episodes: getDocument().episodes.map((episode) => ({ ref: episode.id, number: episode.number, title: episode.title, ...episodeFields(episode, ["coreBeat", "endingEvent", "activeCharacters", "synopsis", "hook", "continuityFacts", "endingState"]) })) }),
        targets: () => getDocument().episodes.map((episode): ReviewTarget => ({ ref: episode.id, title: episode.title, fields: episodeFields(episode, OUTLINE_REVIEW_FIELDS) })),
        applyPatches: (patches) => applyEpisodes(patchEpisodes(getDocument().episodes, patches)),
        signal: context.signal,
        onLog: (message) => context.log(`大纲审核：${message}`),
    });
}

// ---------- episode script ----------

function previousEpisodePayload(episode: StudioEpisode | undefined) {
    if (!episode) return null;
    const scenes = episode.script?.scenes || [];
    const last = scenes[scenes.length - 1];
    return {
        ref: episode.id,
        number: episode.number,
        title: episode.title,
        synopsis: episode.synopsis,
        continuityFacts: episode.script?.continuityFacts?.length ? episode.script.continuityFacts : episode.continuityFacts,
        endingState: episode.script?.endingState || episode.endingState,
        ...(last ? { endingScene: { heading: last.heading, body: last.body } } : {}),
    };
}

function nextEpisodePayload(episode: StudioEpisode | undefined) {
    if (!episode) return null;
    return { ref: episode.id, number: episode.number, title: episode.title, synopsis: episode.synopsis, coreBeat: episode.coreBeat || "" };
}

function currentEpisodePayload(episode: StudioEpisode) {
    return {
        ref: episode.id,
        number: episode.number,
        title: episode.title,
        synopsis: episode.synopsis,
        hook: episode.hook,
        coreBeat: episode.coreBeat || "",
        endingEvent: episode.endingEvent || "",
        outlineEstimateSeconds: episode.estimatedDurationSeconds ?? null,
        continuityFacts: episode.continuityFacts,
        requiredEndingState: episode.endingState,
    };
}

function parseEpisodeScript(value: unknown, episode: StudioEpisode) {
    const result = expectObject(value, "分集剧本");
    const scenes = expectArray(result.scenes, "scenes").map((item, index): StudioScriptScene => {
        const scene = expectObject(item, "scene");
        const body = readText(scene.body);
        if (!body) throw new StrictResultError(`第 ${index + 1} 场缺少 body。`);
        return { ref: `${episode.id}-scene-${index + 1}`, heading: readText(scene.heading) || `第${index + 1}场`, characters: readTextList(scene.characters), body };
    });
    if (!scenes.length) throw new StrictResultError("scenes 不能为空。");
    return { title: readText(result.title) || episode.title, scenes, continuityFacts: readTextList(result.continuityFacts), endingState: readEndingState(result.endingState) };
}

export async function generateEpisodeScript(settings: ScriptSettings, summary: StorySummary, storyFacts: string[], episodes: StudioEpisode[], index: number, context: StageContext) {
    const episode = episodes[index];
    const template = fillTemplate(SCRIPT_TEMPLATES.episodeScript[settings.scriptMode] as AnyRecord, templateVars(settings, { episodeTitle: episode.title }));
    const outputSchema = JSON.parse(JSON.stringify(template.outputSchema).split("episode-1").join(episode.id)) as AnyRecord;
    // upload/rewrite = adaptation from source; generate = natural content density.
    const adapted = settings.sourceMode !== "generate";
    const runtimeGuidance = {
        ...(template.runtimeGuidance as AnyRecord),
        outlineEstimateSeconds: episode.estimatedDurationSeconds ?? null,
        ...(adapted ? { enforcement: "adaptation-budget", policy: "adaptation-budget-v1" } : {}),
    };
    let payload = insertBefore({ ...template, runtimeGuidance, outputSchema }, "runtimeGuidance", {
        storySummary: storySummaryPayload(summary, storyFacts),
        originalCreative: originalCreative(settings),
        currentEpisode: currentEpisodePayload(episode),
    });
    payload = insertBefore(payload, "requirements", { continuity: { previousEpisode: previousEpisodePayload(episodes[index - 1]), nextEpisode: nextEpisodePayload(episodes[index + 1]) } });
    context.log(`生成第 ${episode.number} 集剧本`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: adapted ? SCRIPT_SYSTEM_PROMPTS.episodeScript : SCRIPT_SYSTEM_PROMPTS.episodeScriptNatural,
        payload,
        schemaName: "story_episode_script",
        temperature: 0.7,
        maxOutputTokens: 24000,
        repairInstruction: SCRIPT_SYSTEM_PROMPTS.episodeScriptRepair,
        parse: (value) => parseEpisodeScript(value, episode),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

export async function reviseEpisodeScriptContent(
    settings: ScriptSettings,
    summary: StorySummary,
    storyFacts: string[],
    episode: StudioEpisode,
    issues: Array<{ ref: string; field: string; reason: string; instruction: string }>,
    context: StageContext,
) {
    if (!episode.script) throw new Error("本集还没有剧本可修订。");
    const payload = {
        task: "revise_story_episode_script_content",
        schemaVersion: 1,
        scriptMode: settings.scriptMode,
        grounding: {
            originalCreative: originalCreative(settings),
            storySummary: storySummaryPayload(summary, storyFacts),
            currentEpisode: currentEpisodePayload(episode),
        },
        timingReview: {
            issues: issues.map((issue) => ({ ref: issue.ref, field: issue.field, reason: issue.reason, instruction: issue.instruction })),
        },
        currentScript: episode.script,
        outputSchema: {
            episodeRef: episode.id,
            title: episode.title,
            scenes: episode.script.scenes,
            continuityFacts: episode.script.continuityFacts,
            endingState: episode.script.endingState,
        },
    };
    context.log(`按审核意见修订第 ${episode.number} 集正文`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.episodeScriptContentRevision,
        payload,
        schemaName: "story_episode_script_revision",
        temperature: 0.4,
        maxOutputTokens: 24000,
        repairInstruction: SCRIPT_SYSTEM_PROMPTS.episodeScriptRepair,
        parse: (value) => parseEpisodeScript(value, episode),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

const SCRIPT_EPISODE_FIELDS = ["continuityFacts", "endingState.characters", "endingState.props", "endingState.unresolvedThreads"];

export async function reviewEpisodeScript(settings: ScriptSettings, summary: StorySummary, getDocument: () => ScriptStudioDocument, episodeId: string, applyEpisode: (episode: StudioEpisode) => void, context: StageContext) {
    const current = () => getDocument().episodes.find((item) => item.id === episodeId)!;
    const index = getDocument().episodes.findIndex((item) => item.id === episodeId);
    return runStageReview({
        stage: "script",
        model: requireTextModel(settings),
        grounding: {
            originalCreative: originalCreative(settings),
            storySummary: storySummaryPayload(summary, getDocument().storyFacts),
            currentEpisode: currentEpisodePayload(current()),
            continuity: { previousEpisode: previousEpisodePayload(getDocument().episodes[index - 1]), nextEpisode: nextEpisodePayload(getDocument().episodes[index + 1]) },
        },
        artifact: () => ({ episodeRef: episodeId, title: current().title, ...current().script }),
        targets: () => {
            const script = current().script!;
            return [
                { ref: episodeId, title: current().title, fields: Object.fromEntries(SCRIPT_EPISODE_FIELDS.map((field) => [field, field.split(".").reduce<unknown>((value, key) => (value as AnyRecord | undefined)?.[key], script)])) },
                ...script.scenes.map((scene) => ({ ref: scene.ref, title: scene.heading, fields: { heading: scene.heading, characters: scene.characters, body: scene.body } })),
            ];
        },
        applyPatches: (patches) => {
            const episode = current();
            let script = episode.script! as unknown as AnyRecord;
            for (const patch of patches.filter((item) => item.ref === episodeId)) script = writePath(script, patch.field, patch.value);
            const scenes = (script.scenes as StudioScriptScene[]).map((scene) => patches.filter((patch) => patch.ref === scene.ref).reduce((value, patch) => writePath(value as unknown as AnyRecord, patch.field, patch.value) as unknown as StudioScriptScene, scene));
            applyEpisode({ ...episode, script: { ...(script as unknown as NonNullable<StudioEpisode["script"]>), scenes } });
        },
        signal: context.signal,
        onLog: (message) => context.log(`第 ${current().number} 集审核：${message}`),
    });
}

// ---------- asset extraction ----------

const ASSET_KINDS: StudioAssetKind[] = ["character", "scene", "prop"];

function parseAssets(value: unknown, chapterIds: string[]) {
    const result = expectObject(value, "资产提取结果");
    const assets = expectArray(result.assets, "assets");
    if (!assets.length) throw new StrictResultError("assets 不能为空。");
    return assets.map((item, index): StudioAsset => {
        const asset = expectObject(item, "asset");
        const kind = readText(asset.kind) as StudioAssetKind;
        if (!ASSET_KINDS.includes(kind)) throw new StrictResultError(`第 ${index + 1} 个资产的 kind 必须是 character、scene 或 prop。`);
        const name = readText(asset.name);
        if (!name) throw new StrictResultError(`第 ${index + 1} 个资产缺少 name。`);
        const validChapters = (ids: unknown) => readTextList(ids).filter((id) => chapterIds.includes(id));
        const appearances = expectArray(asset.appearances ?? [], "appearances").map((entry): StudioAppearance => {
            const appearance = expectObject(entry, "appearance");
            const description = readText(appearance.description);
            const rawPrompt = readText(appearance.prompt);
            if (!rawPrompt) throw new StrictResultError(`资产「${name}」的形象缺少 prompt。`);
            return {
                id: `look-${nanoid(8)}`,
                name: readText(appearance.name),
                description,
                prompt: sanitizeExtractedAppearancePrompt(kind, rawPrompt, description),
                occurrences: readText(appearance.occurrences),
                sourceChapterIds: validChapters(appearance.sourceChapterIds),
                references: [],
                imageStatus: "idle",
            };
        });
        if (!appearances.length) throw new StrictResultError(`资产「${name}」至少需要一个形象。`);
        return {
            id: `asset-${nanoid(8)}`,
            kind,
            name,
            role: readText(asset.role),
            description: readText(asset.description),
            voiceDescription: readText(asset.voiceDescription),
            occurrences: readText(asset.occurrences),
            sourceChapterIds: validChapters(asset.sourceChapterIds),
            appearances,
        };
    });
}

export async function extractAssets(settings: ScriptSettings, title: string, episodes: StudioEpisode[], context: StageContext) {
    const variant = visualStyleText(settings) ? "style" : "plain";
    const template = SCRIPT_TEMPLATES.assetExtraction[variant];
    const chapters = episodes.filter((episode) => episode.script?.scenes.length).map((episode) => ({ id: episode.id, title: `第${episode.number}集 ${episode.title}`, content: episodeScriptText(episode) }));
    if (!chapters.length) throw new Error("请先生成分集剧本。");
    const payload = insertBefore(template.payload as AnyRecord, "requirements", {
        project: { title, chapters },
        visualDirection: { aspectRatio: settings.aspectRatio, style: visualStyleText(settings) },
    });
    const prompt = `${template.prefix}${JSON.stringify(payload)}${template.suffix}`;
    context.log("提取角色、场景和道具");
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.assetExtraction,
        payload: prompt,
        outputContract: (template.payload as AnyRecord).outputSchema,
        schemaName: "story_assets",
        temperature: 0.3,
        maxOutputTokens: 24000,
        parse: (value) => parseAssets(value, chapters.map((chapter) => chapter.id)),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    try {
        return await repairExtractedAssets(settings, result, chapters, "source", context);
    } catch {
        return result;
    }
}

/** Strip repeated SHUO character sheet prefixes so client can re-apply once. */
export function stripCharacterAssetPrefix(prompt: string) {
    const prefix = SCRIPT_PRESETS.characterAssetPromptPrefix.trim();
    let body = prompt.trim();
    for (let round = 0; round < 3; round += 1) {
        if (!body.startsWith(prefix)) break;
        body = body.slice(prefix.length).replace(/^[，,。.\s\n\r]+/u, "").trim();
    }
    return body;
}

/** Draft / style / background are fixed; character line depends on base vs state variant. */
export const ASSET_REFERENCE_PROMPT_SUFFIX = {
    draft: "参考@草稿形象的构图、姿势与整体造型进行细化生成",
    style: SCRIPT_PRESETS.assetReferencePromptSuffix,
    /** Base / identity lock — keep face close to the reference. */
    characterBase: "严格参考@角色参考的人脸与五官特征，保持同一人物身份一致",
    /**
     * Non-base appearance (斗殴后伤痕 etc.): lock identity bones, but apply prompt state changes
     * (scars, bruises, nosebleed, dirt, exhaustion) instead of copying a clean face.
     */
    characterVariant:
        "以@角色参考为同一人物的身份基准：保留脸型、五官结构、瞳色与发型骨架；必须落实提示词中的伤势与状态变化（伤痕、淤青、血迹、鼻血、脏污、憔悴、表情等），不要为了贴合参考图而抹掉这些变化",
    background: "参考@背景参考的环境、光影与背景构图",
} as const;

const ASSET_REFERENCE_ROLE_ORDER: StudioAppearanceReferenceRole[] = ["draft", "style", "character", "background"];

const ASSET_REFERENCE_TAG: Record<StudioAppearanceReferenceRole, string> = {
    draft: "草稿形象",
    style: "风格参考",
    character: "角色参考",
    background: "背景参考",
};

const ASSET_REFERENCE_SUFFIX_PATTERN =
    /(?:\n)?(?:参考@草稿形象的构图、姿势与整体造型进行细化生成|参考@风格参考的图片风格生成形象|严格参考@角色参考的人脸与五官特征，保持同一人物身份一致|以@角色参考为同一人物的身份基准：保留脸型、五官结构、瞳色与发型骨架；必须落实提示词中的伤势与状态变化（伤痕、淤青、血迹、鼻血、脏污、憔悴、表情等），不要为了贴合参考图而抹掉这些变化|参考@背景参考的环境、光影与背景构图)/gu;

/** First appearance = base sheet; later looks (伤痕/虚弱…) are state variants. */
export function isBaseAppearance(asset: StudioAsset, appearance: StudioAppearance) {
    return asset.appearances[0]?.id === appearance.id;
}

function characterReferenceSuffix(asset: StudioAsset, appearance: StudioAppearance) {
    return isBaseAppearance(asset, appearance) ? ASSET_REFERENCE_PROMPT_SUFFIX.characterBase : ASSET_REFERENCE_PROMPT_SUFFIX.characterVariant;
}

function referenceSuffixForRole(role: StudioAppearanceReferenceRole, asset: StudioAsset, appearance: StudioAppearance) {
    if (role === "character") return characterReferenceSuffix(asset, appearance);
    if (role === "draft") return ASSET_REFERENCE_PROMPT_SUFFIX.draft;
    if (role === "style") return ASSET_REFERENCE_PROMPT_SUFFIX.style;
    return ASSET_REFERENCE_PROMPT_SUFFIX.background;
}

function attachedReferenceRoles(appearance: StudioAppearance, roles?: StudioAppearanceReferenceRole[]) {
    const attached = new Set((appearance.references || []).filter((item) => item.mediaKey).map((item) => item.role));
    return (roles || ASSET_REFERENCE_ROLE_ORDER).filter((role) => attached.has(role));
}

/** Rewrite @风格参考 / @角色参考 … to @图片N in the same order references are sent to the image API. */
export function compileAssetReferencePrompt(prompt: string, rolesInSendOrder: StudioAppearanceReferenceRole[]) {
    let text = prompt;
    rolesInSendOrder.forEach((role, index) => {
        const tag = ASSET_REFERENCE_TAG[role];
        text = text.replaceAll(`@${tag}`, `@图片${index + 1}`);
    });
    return text;
}

/**
 * Build the final image prompt:
 * character sheet prefix, then body, then one instruction line per attached reference slot.
 */
export function assetImagePrompt(asset: StudioAsset, appearance: StudioAppearance, options?: { roles?: StudioAppearanceReferenceRole[] }) {
    const roles = options?.roles ?? attachedReferenceRoles(appearance);
    const suffixes = roles.map((role) => referenceSuffixForRole(role, asset, appearance));
    if (asset.kind !== "character") {
        const body = appearance.prompt.trim().replace(ASSET_REFERENCE_SUFFIX_PATTERN, "").trim();
        return [body, ...suffixes].filter(Boolean).join("\n");
    }
    const body = stripCharacterAssetPrefix(appearance.prompt).replace(ASSET_REFERENCE_SUFFIX_PATTERN, "").trim();
    return [SCRIPT_PRESETS.characterAssetPromptPrefix, body, ...suffixes].filter(Boolean).join("\n");
}

/** Keep extraction prompts as visual sheets; drop narration / duplicate sheet prefixes. */
function sanitizeExtractedAppearancePrompt(kind: StudioAssetKind, prompt: string, description: string) {
    let body = kind === "character" ? stripCharacterAssetPrefix(prompt) : prompt.trim();
    if (!body) body = description.trim();
    // If the model dumped description/narration as the prompt, keep it but strip obvious plot clauses for characters.
    if (kind === "character" && body && description && (body === description || body.includes(description))) {
        body = body
            .replace(/因[^。；;\n]{0,40}[。；;\n]?/gu, "")
            .replace(/吞下[^。；;\n]{0,40}[。；;\n]?/gu, "")
            .replace(/与[^。；;\n]{0,30}形成[^。；;\n]{0,20}[。；;\n]?/gu, "")
            .replace(/拥有[^。；;\n]{0,20}[，,]/gu, "")
            .replace(/使用[^。；;\n]{0,30}追踪[^。；;\n]{0,20}[。；;\n]?/gu, "")
            .replace(/\s+/gu, " ")
            .trim();
    }
    if (kind === "character" && body && !/正面全身|全身立绘|人物设定图/u.test(body)) {
        body = `正面全身人物设定图，${body}`;
    }
    return body;
}

type AssetPromptPreset = { id: string; label: string; description: string; template: { type: string; text: string; requireInput?: boolean; emptyInputMessage?: string } | null };

export function assetPromptPresets(kind: StudioAssetKind): AssetPromptPreset[] {
    if (kind === "character") return SCRIPT_PRESETS.characterAssetPromptPresets as unknown as AssetPromptPreset[];
    if (kind === "scene") return SCRIPT_PRESETS.sceneAssetPromptPresets as unknown as AssetPromptPreset[];
    return [{ id: "none", label: "无", description: "直接使用当前提示词", template: null }];
}

/** Apply SHUO preset template: `{用户输入 || 默认}` takes user text or fallback. */
export function applyAssetPromptPreset(presetId: string, kind: StudioAssetKind, userPrompt: string) {
    const preset = assetPromptPresets(kind).find((item) => item.id === presetId);
    const template = preset?.template;
    if (!template?.text) return userPrompt;
    return template.text.replace(/\{用户输入\s*\|\|\s*([^}]*)\}/u, (_match, fallback: string) => userPrompt.trim() || fallback.trim()).replace(/\{用户输入\}/gu, userPrompt.trim());
}

const APPEARANCE_POLICY_REVISE_SYSTEM = `你是影视素材生图提示词的合规改写助手。
生图 API 因内容策略拒绝了当前提示词；你要根据 errorMessage 改写 prompt，使下次请求更可能通过审核。
硬性要求：
1. 保留视觉身份：五官骨架、发型发色、体型、服装主色与材质、场景/道具外形、构图用途（如正面全身设定图、三视图）。
2. 只改写触发审核的表述：血腥伤口→轻伤绷带/暗色污渍/衣物破损；未成年年龄→青年外貌；暴力/性暗示/过度病态→克制、可拍摄的画面描述。
3. 保留开头的视觉风格前缀（若有）；不要删成空提示词；不要新增与剧情无关的元素。
4. 不要输出解释、对比或 Markdown。只返回严格 JSON：{"prompt":"改写后的完整提示词"}`;

/** Rewrite an appearance image prompt using the image API rejection message. */
export async function reviseAppearancePromptForError(
    settings: ScriptSettings,
    asset: StudioAsset,
    appearance: StudioAppearance,
    errorMessage: string,
    context: StageContext,
) {
    const error = errorMessage.trim();
    const prompt = appearance.prompt.trim();
    if (!prompt) throw new Error("当前形象没有提示词可改写。");
    if (!error) throw new Error("没有可用的错误信息。");
    context.log(`按审核错误改写「${asset.name}」提示词`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: APPEARANCE_POLICY_REVISE_SYSTEM,
        payload: {
            task: "revise_appearance_prompt_for_policy_error",
            asset: { kind: asset.kind, name: asset.name, role: asset.role || "", description: asset.description || "" },
            appearance: { name: appearance.name || "", description: appearance.description || "" },
            errorMessage: error,
            currentPrompt: prompt,
            outputSchema: { prompt: "改写后的完整提示词字符串" },
        },
        schemaName: "appearance_prompt_policy_revise",
        temperature: 0.35,
        maxOutputTokens: 4000,
        parse: (value) => {
            const record = expectObject(value, "改写结果");
            const next = readText(record.prompt);
            if (!next) throw new StrictResultError("prompt 不能为空。");
            if (next === prompt) throw new StrictResultError("改写结果与原文相同，请换一种规避表述。");
            return next;
        },
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

export async function repairExtractedAssets(settings: ScriptSettings, assets: StudioAsset[], chapters: Array<{ id: string }>, mode: "format" | "source", context: StageContext) {
    const systemPrompt = mode === "format" ? SCRIPT_SYSTEM_PROMPTS.assetFormatRepair : SCRIPT_SYSTEM_PROMPTS.assetSourceRepair;
    const payload = {
        task: mode === "format" ? "repair_story_assets_format" : "repair_story_assets_source",
        assets,
        chapters,
        outputSchema: { assets: "与原结果同结构的 assets 数组" },
    };
    context.log(mode === "format" ? "修复素材 JSON 格式" : "核对素材来源章节");
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt,
        payload,
        schemaName: mode === "format" ? "story_assets_format_repair" : "story_assets_source_repair",
        temperature: 0.1,
        maxOutputTokens: 24000,
        parse: (value) => parseAssets(value, chapters.map((chapter) => chapter.id)),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result;
}

export function assetImageRatio(asset: StudioAsset, aspectRatio: string) {
    const value = (aspectRatio || "").trim();
    if (value && value !== "auto" && value !== "自适应") return value;
    if (asset.kind === "prop") return "1:1";
    return "16:9";
}

/** Append explicit ratio / resolution lines so copy + prompt text match UI settings (API still gets size/quality params). */
export function appendImageGeometryToPrompt(prompt: string, aspectRatio: string, imageQuality?: string) {
    const ratio = !aspectRatio || aspectRatio === "auto" || aspectRatio === "自适应" ? "自适应" : aspectRatio.trim();
    const quality = normalizeImageQualityLabel(imageQuality);
    const geometry = `画面比例：${ratio}；分辨率：${quality}。`;
    const body = prompt.trim();
    if (!body) return geometry;
    if (/画面比例\s*[：:]/u.test(body) && /分辨率\s*[：:]/u.test(body)) {
        return body
            .replace(/画面比例\s*[：:][^\n；;]*/u, `画面比例：${ratio}`)
            .replace(/分辨率\s*[：:][^\n；;]*/u, `分辨率：${quality}`);
    }
    return `${body}\n\n${geometry}`;
}

function normalizeImageQualityLabel(value?: string) {
    const raw = (value || "2K").trim();
    const upper = raw.toUpperCase();
    if (/^[14]K$/i.test(upper) || /^2K$/i.test(upper)) return upper;
    if (/high|4k/i.test(raw)) return "4K";
    if (/medium|hd|2k/i.test(raw)) return "2K";
    if (/low|1k|standard/i.test(raw)) return "1K";
    return upper || "2K";
}

// ---------- split ----------

type SpeechEntry = { ref: string; sceneRef: string; kind: "dialogue" | "voiceover"; speaker: string; text: string };

const NARRATOR = /^(?:旁白|画外音|解说|独白|内心独白)$/u;
const OFFSCREEN = /内心OS|OS|VO|画外/u;

export function buildSpeechCatalog(scenes: StudioScriptScene[]): SpeechEntry[] {
    const entries: SpeechEntry[] = [];
    for (const scene of scenes) {
        for (const raw of scene.body.split(/\n+/)) {
            const match = raw.trim().match(/^([^：:“”"]{1,24})[：:]\s*(.+)$/u);
            if (!match) continue;
            const header = match[1].trim();
            const spoken = match[2].trim();
            const quoted = spoken.match(/^[“"]([\s\S]+)[”"]/u);
            const baseName = header.replace(/[（(].*?[）)]/gu, "").trim();
            if (/^(?:屏幕字幕|字幕|画面文字)$/u.test(baseName)) continue;
            if (NARRATOR.test(baseName)) {
                entries.push({ ref: `speech-${entries.length + 1}`, sceneRef: scene.ref, kind: "voiceover", speaker: "", text: quoted ? quoted[1] : spoken });
            } else if (quoted) {
                entries.push({ ref: `speech-${entries.length + 1}`, sceneRef: scene.ref, kind: OFFSCREEN.test(header) ? "voiceover" : "dialogue", speaker: baseName, text: quoted[1] });
            }
        }
    }
    return entries;
}

export function episodeAssets(episode: StudioEpisode, assets: StudioAsset[]) {
    const text = episodeScriptText(episode);
    return assets.filter((asset) => asset.sourceChapterIds?.includes(episode.id) || asset.appearances.some((look) => look.sourceChapterIds?.includes(episode.id)) || text.includes(asset.name));
}

function assetPayload(asset: StudioAsset) {
    return {
        ref: asset.id,
        name: asset.name,
        kind: asset.kind,
        description: asset.description,
        occurrences: asset.occurrences || "",
        sourceChapterIds: asset.sourceChapterIds || [],
        appearances: asset.appearances.map((look) => ({ ref: look.id, name: look.name, description: look.description, occurrences: look.occurrences || "", sourceChapterIds: look.sourceChapterIds || [] })),
    };
}

function parseCompactSplit(value: unknown, episodeRef: string, clipMaxSeconds: number) {
    const result = expectObject(value, "分镜结果");
    const episodes = expectArray(result.episodes, "episodes");
    const episode = (episodes.find((item) => readText((item as AnyRecord)?.episodeRef) === episodeRef) || episodes[0]) as AnyRecord | undefined;
    if (!episode) throw new StrictResultError("episodes 不能为空。");
    const clips = expectArray(episode.clips, "clips");
    if (!clips.length) throw new StrictResultError("clips 不能为空。");
    return clips.map((item, clipIndex) => {
        const clip = expectObject(item, "clip");
        const shots = expectArray(clip.shots, "shots").map((entry, shotIndex): StudioShot => {
            const shot = expectObject(entry, "shot");
            const start = Number(shot.startSec);
            const end = Number(shot.endSec);
            const duration = Number(shot.d ?? shot.durationSec) || (Number.isFinite(end - start) ? end - start : 0);
            if (!(duration > 0)) throw new StrictResultError(`第 ${clipIndex + 1} 段第 ${shotIndex + 1} 镜的时长 d 必须大于 0。`);
            const visual = readText(shot.v ?? shot.visual);
            if (!visual) throw new StrictResultError(`第 ${clipIndex + 1} 段第 ${shotIndex + 1} 镜缺少画面 v。`);
            return { id: `shot-${nanoid(8)}`, duration, visual, camera: readText(shot.c ?? shot.camera), dialogue: readText(shot.q ?? shot.dialogue), voiceover: readText(shot.o ?? shot.voiceover), audio: readText(shot.a ?? shot.audio) };
        });
        if (!shots.length) throw new StrictResultError(`第 ${clipIndex + 1} 段没有镜头。`);
        const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
        if (total > clipMaxSeconds + 0.5) throw new StrictResultError(`第 ${clipIndex + 1} 段总时长 ${total} 秒，超过单片上限 ${clipMaxSeconds} 秒。`, { clipIndex: clipIndex + 1, total, clipMaxSeconds });
        return { sceneCode: readText(clip.s) || "s1", shots };
    });
}

function bindClipAssets(shots: StudioShot[], sceneHeading: string, assets: StudioAsset[]) {
    const text = shots.map((shot) => `${shot.visual}\n${shot.dialogue}\n${shot.voiceover}`).join("\n");
    const scene = assets.filter((asset) => asset.kind === "scene").find((asset) => sceneHeading.includes(asset.name) || asset.name.includes(sceneHeading.replace(/^(?:日|夜|晨|黄昏)?\s*(?:内|外)?\s*/u, "")));
    const others = assets.filter((asset) => asset.kind !== "scene" && text.includes(asset.name));
    return [...(scene ? [scene.id] : []), ...others.map((asset) => asset.id)];
}

export async function splitEpisode(settings: ScriptSettings, episode: StudioEpisode, assets: StudioAsset[], context: StageContext) {
    const scenes = episode.script?.scenes || [];
    if (!scenes.length) throw new Error(`第 ${episode.number} 集还没有剧本。`);
    const key = `${settings.promptMode}_${settings.scriptMode}` as keyof typeof SCRIPT_TEMPLATES.split;
    const template = SCRIPT_TEMPLATES.split[key] as AnyRecord;
    const cap = Number(template.clipMaxSeconds) || 15;
    const clipMaxSeconds = Math.min(cap, Math.max(4, settings.clipMaxSeconds || cap));
    const ownAssets = episodeAssets(episode, assets);
    const sceneCodes = scenes.map((scene, index) => ({ code: `s${index + 1}`, name: scene.heading }));
    const payload = insertBefore({ ...template, clipMaxSeconds }, "clipMaxSeconds", {
        episodes: [
            {
                ref: episode.id,
                title: episode.title,
                text: episodeScriptText(episode),
                speechCatalog: buildSpeechCatalog(scenes),
                assets: ownAssets.map((asset) => ({ ref: asset.id, kind: asset.kind, name: asset.name, appearances: asset.appearances.map((look) => ({ ref: look.id, name: look.name })) })),
                scenes: sceneCodes,
            },
        ],
    });
    context.log(`拆分第 ${episode.number} 集分镜`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.split[settings.promptMode],
        payload,
        outputContract: template.output,
        temperature: 0.3,
        maxOutputTokens: 32000,
        repairInstruction: SCRIPT_SYSTEM_PROMPTS.splitValidation,
        parse: (value) => parseCompactSplit(value, episode.id, clipMaxSeconds),
        signal: context.signal,
        onDelta: context.onDelta,
    });
    return result.map((clip, index): StudioClip => {
        const heading = sceneCodes.find((scene) => scene.code === clip.sceneCode)?.name || "";
        return { id: `clip-${nanoid(8)}`, number: index + 1, sceneCode: clip.sceneCode, shots: clip.shots, prompt: "", assetRefs: bindClipAssets(clip.shots, heading, ownAssets), videoStatus: "idle" };
    });
}

function clipPayload(clip: StudioClip, assets: StudioAsset[]) {
    const usages = clip.assetRefs.map((assetId) => {
        const asset = assets.find((item) => item.id === assetId);
        const look = asset ? asset.appearances.find((item) => item.id === clip.appearanceRefs?.[assetId]) || asset.appearances[0] : undefined;
        return { assetRef: assetId, appearanceRef: look?.id || "" };
    });
    return {
        ref: clip.id,
        prompt: clip.prompt,
        script: clip.script || "",
        durationSec: clip.shots.reduce((sum, shot) => sum + shot.duration, 0),
        shots: clip.shots.map((shot, index) => ({ index: index + 1, durationSec: shot.duration, assetUsages: usages, assetRefs: clip.assetRefs, visual: shot.visual, camera: shot.camera, dialogue: shot.dialogue, voiceover: shot.voiceover, audio: shot.audio })),
    };
}

type SplitAssessment = { clipRef: string; verdict: "pass" | "repair"; issues: Array<{ code: string; reason: string; repairInstruction: string }> };

function parseAssessments(value: unknown, clipRefs: string[]): SplitAssessment[] {
    const result = expectObject(value, "审片结果");
    const assessments = expectArray(result.assessments, "assessments").map((item) => {
        const entry = expectObject(item, "assessment");
        const verdict = readText(entry.verdict) as SplitAssessment["verdict"];
        if (verdict !== "pass" && verdict !== "repair") throw new StrictResultError("verdict 只能是 pass 或 repair。");
        return {
            clipRef: readText(entry.clipRef),
            verdict,
            issues: expectArray(entry.issues ?? [], "issues").map((issue) => {
                const record = expectObject(issue, "issue");
                return { code: readText(record.code), reason: readText(record.reason), repairInstruction: readText(record.repairInstruction) };
            }),
        };
    });
    const missing = clipRefs.filter((ref) => !assessments.some((item) => item.clipRef === ref));
    if (missing.length) throw new StrictResultError("每个输入片段必须恰好返回一次。", { missing });
    return assessments;
}

export async function reviewEpisodeSplit(settings: ScriptSettings, episode: StudioEpisode, assets: StudioAsset[], context: StageContext) {
    const ownAssets = episodeAssets(episode, assets);
    const clipMaxSeconds = Math.max(4, settings.clipMaxSeconds);
    const template = SCRIPT_TEMPLATES.splitReview as AnyRecord;
    const payload = insertBefore({ ...template, productionLimits: { maxClipDurationSeconds: clipMaxSeconds } }, "productionLimits", {
        episodeRef: episode.id,
        batchRef: "batch-1",
        episode: { title: episode.title, synopsis: episode.synopsis, sourceScript: episodeScriptText(episode) },
        clips: episode.clips.map((clip) => clipPayload(clip, ownAssets)),
        neighboringClips: [],
        assets: ownAssets.map(assetPayload),
        localSignals: [],
    });
    context.log(`审片第 ${episode.number} 集`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.splitQualityReview,
        payload,
        outputContract: template.outputContract,
        temperature: 0.1,
        maxOutputTokens: 12000,
        parse: (value) => parseAssessments(value, episode.clips.map((clip) => clip.id)),
        signal: context.signal,
    });
    return result;
}

function parseRepairs(value: unknown, failedRefs: string[], clipMaxSeconds: number, assets: StudioAsset[]) {
    const result = expectObject(value, "修复结果");
    const repairs = expectArray(result.repairs, "repairs").map((item) => {
        const repair = expectObject(item, "repair");
        const sourceClipRef = readText(repair.sourceClipRef);
        if (!failedRefs.includes(sourceClipRef)) throw new StrictResultError(`sourceClipRef ${sourceClipRef} 不在 failedClips 中。`);
        const clips = expectArray(repair.clips, "clips").map((entry, clipIndex) => {
            const clip = expectObject(entry, "clip");
            const shots = expectArray(clip.shots, "shots").map((shotEntry, shotIndex): StudioShot => {
                const shot = expectObject(shotEntry, "shot");
                const duration = Number(shot.durationSec ?? shot.d);
                if (!(duration > 0)) throw new StrictResultError(`修复片段 ${clipIndex + 1} 第 ${shotIndex + 1} 镜的 durationSec 必须大于 0。`);
                return { id: `shot-${nanoid(8)}`, duration, visual: readText(shot.visual), camera: readText(shot.camera), dialogue: readText(shot.dialogue), voiceover: readText(shot.voiceover), audio: readText(shot.audio) };
            });
            const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
            if (!shots.length || total > clipMaxSeconds + 0.5) throw new StrictResultError(`修复片段 ${clipIndex + 1} 时长 ${total} 秒，超过上限 ${clipMaxSeconds} 秒。`);
            const usages = expectArray((clip.shots as AnyRecord[])[0]?.assetUsages ?? [], "assetUsages") as AnyRecord[];
            const assetRefs = [...new Set([...readTextList(clip.assetRefs), ...usages.map((usage) => readText(usage.assetRef))])].filter((ref) => assets.some((asset) => asset.id === ref));
            const appearanceRefs = Object.fromEntries(usages.map((usage) => [readText(usage.assetRef), readText(usage.appearanceRef)]).filter(([assetRef, look]) => look && assets.find((asset) => asset.id === assetRef)?.appearances.some((item) => item.id === look)));
            return { script: readText(clip.script), shots, assetRefs, appearanceRefs };
        });
        return { sourceClipRef, clips };
    });
    return repairs;
}

export async function repairEpisodeSplit(settings: ScriptSettings, episode: StudioEpisode, assets: StudioAsset[], assessments: SplitAssessment[], context: StageContext) {
    const failed = assessments.filter((item) => item.verdict === "repair");
    if (!failed.length) return episode.clips;
    const ownAssets = episodeAssets(episode, assets);
    const clipMaxSeconds = Math.max(4, settings.clipMaxSeconds);
    const template = SCRIPT_TEMPLATES.splitRepair as AnyRecord;
    const instruction = (template.instruction as string[]).map((line) => (line === "当前任务未设置单片段时长上限。" ? `当前任务单片段时长上限为 ${clipMaxSeconds} 秒。` : line));
    const failedClips = failed.map((item) => {
        const clip = episode.clips.find((entry) => entry.id === item.clipRef)!;
        return { sourceClipRef: item.clipRef, issues: item.issues, clip: clipPayload(clip, ownAssets) };
    });
    const neighbors = episode.clips.filter((clip) => failed.some((item) => {
        const index = episode.clips.findIndex((entry) => entry.id === item.clipRef);
        const own = episode.clips.indexOf(clip);
        return Math.abs(own - index) === 1 && !failed.some((other) => other.clipRef === clip.id);
    }));
    const payload = insertBefore(
        { ...template, productionLimits: { maxClipDurationSeconds: clipMaxSeconds, maxSpokenUnitsPerSecond: 4 }, instruction, allowedAssetReferences: ownAssets.map((asset) => ({ assetRef: asset.id, allowedAppearanceRefs: asset.appearances.map((look) => look.id) })) },
        "repairRound",
        { episodeRef: episode.id },
    );
    const withInputs = insertBefore(payload, "productionLimits", {
        episode: { title: episode.title, sourceScript: episodeScriptText(episode) },
        failedClips,
        readOnlyNeighboringClips: neighbors.map((clip) => clipPayload(clip, ownAssets)),
        assets: ownAssets.map(assetPayload),
    });
    context.log(`修复第 ${episode.number} 集 ${failed.length} 个片段`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.split[settings.promptMode],
        payload: withInputs,
        outputContract: template.outputContract,
        temperature: 0.2,
        maxOutputTokens: 24000,
        parse: (value) => parseRepairs(value, failed.map((item) => item.clipRef), clipMaxSeconds, ownAssets),
        signal: context.signal,
    });
    const replaced: StudioClip[] = [];
    for (const clip of episode.clips) {
        const repair = result.find((item) => item.sourceClipRef === clip.id);
        if (!repair) {
            replaced.push(clip);
            continue;
        }
        for (const part of repair.clips) {
            replaced.push({ ...clip, id: `clip-${nanoid(8)}`, script: part.script, shots: part.shots, assetRefs: part.assetRefs.length ? part.assetRefs : clip.assetRefs, appearanceRefs: { ...clip.appearanceRefs, ...part.appearanceRefs }, prompt: "", promptEdited: false, videoKey: undefined, videoStatus: "idle", review: undefined });
        }
    }
    return replaced.map((clip, index) => ({ ...clip, number: index + 1 }));
}

// ---------- clip adjust ----------

export async function adjustClipPrompt(settings: ScriptSettings, summary: StorySummary | null, episode: StudioEpisode, clip: StudioClip, instruction: string, context: StageContext) {
    const template = fillTemplate(SCRIPT_TEMPLATES.clipAdjust as AnyRecord, templateVars(settings));
    const duration = `${clip.shots.reduce((sum, shot) => sum + shot.duration, 0)}s`;
    const assetTokens = [...new Set(clip.prompt.match(/@[^\s，。；：、]+(?: · [^\s，。；：、]+)?/gu) || [])];
    const payload = insertBefore(
        {
            ...template,
            locked: { ...(template.locked as AnyRecord), assetTokens, clipDuration: duration },
            timing: { ...(template.timing as AnyRecord), sourceDuration: duration },
        },
        "locked",
        { instruction, targetLanguage: "", currentPrompt: clip.prompt },
    );
    const withContext = insertBefore(payload, "requirements", {
        context: {
            projectTitle: summary?.title || "",
            storySummary: summary?.storySummary || "",
            episodeNumber: episode.number,
            episodeTitle: episode.title,
            episodeSynopsis: episode.synopsis,
            clipTitle: `第 ${clip.number} 段`,
            clipScript: clip.script || "",
            creativeIntent: "",
            transition: "",
        },
    });
    context.log(`AI 调整第 ${episode.number} 集第 ${clip.number} 段提示词`);
    const { result } = await requestStrictResult({
        model: requireTextModel(settings),
        systemPrompt: SCRIPT_SYSTEM_PROMPTS.clipAdjustment,
        payload: withContext,
        schemaName: "story_clip_prompt_adjustment",
        temperature: 0.4,
        maxOutputTokens: 6000,
        parse: (value) => {
            const record = expectObject(value, "调整结果");
            const candidate = readText(record.candidateText);
            if (!candidate) throw new StrictResultError("candidateText 不能为空。");
            const missing = assetTokens.filter((token) => !candidate.includes(token));
            if (missing.length) throw new StrictResultError("candidateText 必须逐字保留全部资产引用。", { missing });
            return candidate;
        },
        signal: context.signal,
    });
    return result;
}
