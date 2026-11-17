// Usage: node tools/shuo-prompt-extract/build-ts.mjs  (run extract.mjs and harvest-literals.mjs first)
// Generates canvas-app/web/src/studios/prompts/*.generated.ts from SHUO's original prompt
// constants and builder outputs. Builders are called twice with different parameters so the
// varying spots become {{placeholders}}; everything else is kept verbatim.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const work = path.join(os.tmpdir(), "shuo-prompt-work");
const outDir = path.join(repo, "canvas-app", "web", "src", "studios", "prompts");
const load = (rel) => import(pathToFileURL(path.join(work, rel)).href);
const constants = JSON.parse(fs.readFileSync(path.join(here, "out", "shuo-prompts.json"), "utf8"));
const literals = JSON.parse(fs.readFileSync(path.join(here, "out", "shuo-literal-prompts.json"), "utf8"));
const samples = JSON.parse(fs.readFileSync(path.join(here, "out", "shuo-prompt-samples.json"), "utf8"));

const story = await load("api/storyGenerationApi.js");
const demo = await load("src/modules/storyWorkspace/storyWorkspaceData.js");
const splitReview = await load("api/story-generation/storyEpisodeSplitQualityReview.js");
const replicationPolicy = await load("src/domain/storyGeneration/videoReplicationPromptPolicy.js");
const textAssets = await load("api/story-generation/storyReplicationTextAssets.js");
const enhancementApi = await load("api/personReplacementPromptEnhancementApi.js");

function constant(file, name) {
    const value = constants[file]?.[name];
    if (value === undefined) throw new Error(`missing constant ${file} :: ${name}`);
    return value;
}
function literal(file, binding) {
    const item = literals[file]?.find((entry) => entry.binding === binding);
    if (!item) throw new Error(`missing literal ${file} :: ${binding}`);
    return item.text;
}
const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);

// Parameter sets: A and B differ only in the parameter values.
const PARAMS = {
    A: { episodeCount: 37, style: "〖风格甲〗", clipMaxSeconds: 13 },
    B: { episodeCount: 38, style: "〖风格乙〗", clipMaxSeconds: 14 },
};
const PLACEHOLDERS = [
    ["episodeCount", (p) => String(p.episodeCount)],
    ["style", (p) => p.style],
    ["clipMaxSeconds", (p) => String(p.clipMaxSeconds)],
    ["episodeMin", (p) => String(Math.ceil(p.episodeCount * 0.9))],
];
const unresolved = [];

function templatize(a, b, where) {
    if (typeof a === "string") {
        if (a === b) return a;
        let template = a;
        for (const [key, value] of PLACEHOLDERS) template = template.split(value(PARAMS.A)).join(`{{${key}}}`);
        let check = template;
        for (const [key, value] of PLACEHOLDERS) check = check.split(`{{${key}}}`).join(value(PARAMS.B));
        if (check !== b) unresolved.push(where);
        return template;
    }
    if (typeof a === "number" && typeof b === "number" && a !== b) {
        for (const [key, value] of PLACEHOLDERS) if (String(a) === value(PARAMS.A) && String(b) === value(PARAMS.B)) return `{{${key}:number}}`;
        unresolved.push(where);
        return a;
    }
    if (Array.isArray(a)) return a.map((item, index) => templatize(item, b?.[index], `${where}[${index}]`));
    if (a && typeof a === "object") {
        const out = {};
        for (const key of Object.keys(a)) out[key] = templatize(a[key], b?.[key], `${where}.${key}`);
        return out;
    }
    return a;
}

function variant(build, where) {
    return templatize(build(PARAMS.A), build(PARAMS.B), where);
}

function sampleProject(p, scriptMode = "plot") {
    return {
        title: "〔标题〕",
        storyType: "〔类型〕",
        targetAudience: "〔受众〕",
        summary: "〔摘要〕",
        background: "〔背景〕",
        setting: "〔设定〕",
        coreHook: "〔卖点〕",
        logline: "〔一句话故事〕",
        plotBeats: [{ ref: "beat-1", stage: "开端", event: "〔事件〕", consequence: "〔结果〕" }],
        characters: [{ ref: "character-1", name: "〔角色〕", roleType: "主角", profile: "〔小传〕" }],
        scriptMode,
        aspectRatio: "9:16",
        visualStyle: p.style,
        planning: { episodeCount: p.episodeCount, clipMaxSeconds: p.clipMaxSeconds, promptMode: "seedance-2.0" },
        chapters: [{ id: "chapter-1", title: "〔章节标题〕", content: "〔章节正文〕" }],
    };
}

const sampleEpisode = { ref: "episode-1", id: "episode-1", number: 1, title: "〔分集标题〕", synopsis: "〔分集简介〕", text: "〔分集正文〕", script: "〔分集正文〕" };

// ---- Script studio payload templates ----
const STRIP = {
    summary: ["input"],
    outline: ["storySummary"],
    outlineBatch: ["storyContext", "storyFacts", "storyArc", "batch", "continuity"],
    script: ["storySummary", "originalCreative", "currentEpisode", "continuity"],
    split: ["episodes"],
    clipAdjust: ["instruction", "currentPrompt", "context", "targetLanguage"],
    splitReview: ["episodeRef", "batchRef", "episode", "clips", "neighboringClips", "assets", "localSignals", "source"],
    splitRepair: ["episodeRef", "episode", "failedClips", "readOnlyNeighboringClips", "assets", "previousErrorsByRef", "previousClipsByRef"],
};
const strip = (value, keys) => {
    const out = { ...value };
    for (const key of keys) delete out[key];
    return out;
};

const summaryTemplates = {};
for (const mode of ["generate", "upload", "rewrite"]) {
    for (const scriptMode of ["plot", "narration"]) {
        for (const withStyle of [true, false]) {
            const key = `${mode}_${scriptMode}_${withStyle ? "style" : "plain"}`;
            summaryTemplates[key] = variant((p) => strip(parse(story.buildStorySummaryPrompt({
                mode,
                scriptMode,
                idea: "〔创意〕",
                sourceText: "〔原文〕",
                rewriteInstruction: "〔改写要求〕",
                visualStyle: withStyle ? p.style : "",
                planning: { episodeCount: p.episodeCount },
            })), STRIP.summary), `summary.${key}`);
        }
    }
}

const outlineTemplates = {};
const outlineBatchTemplates = {};
const scriptTemplates = {};
for (const scriptMode of ["plot", "narration"]) {
    outlineTemplates[scriptMode] = variant((p) => strip(parse(story.buildStoryEpisodeOutlinePrompt({ project: sampleProject(p, scriptMode), constraints: { episodeCount: p.episodeCount } })), STRIP.outline), `outline.${scriptMode}`);
    outlineBatchTemplates[scriptMode] = variant((p) => strip(parse(story.buildStoryEpisodeOutlineBatchPrompt({
        project: sampleProject(p, scriptMode),
        constraints: { episodeCount: p.episodeCount },
        skeleton: { episodes: [{ number: 1, title: "〔分集〕" }] },
        batchEpisodes: [{ number: 1, title: "〔分集〕" }],
        batchIndex: 0,
        batchTotal: 1,
    })), STRIP.outlineBatch), `outlineBatch.${scriptMode}`);
    scriptTemplates[scriptMode] = variant((p) => strip(parse(story.buildStoryEpisodeScriptPrompt({ project: sampleProject(p, scriptMode), episode: sampleEpisode })), STRIP.script), `script.${scriptMode}`);
}

function splitAssetPrompt(raw) {
    const open = "<story_input_json>\n";
    const close = "\n</story_input_json>";
    const start = raw.indexOf(open);
    const end = raw.indexOf(close);
    const inner = JSON.parse(raw.slice(start + open.length, end));
    delete inner.project;
    delete inner.visualDirection;
    return { prefix: raw.slice(0, start + open.length), suffix: raw.slice(end), payload: inner };
}
const assetTemplates = {};
for (const withStyle of [true, false]) {
    assetTemplates[withStyle ? "style" : "plain"] = variant((p) => splitAssetPrompt(story.buildStoryAssetExtractionPrompt({
        project: sampleProject(p),
        aspectRatio: "9:16",
        visualStyle: withStyle ? p.style : "",
    })), `assets.${withStyle ? "style" : "plain"}`);
}

const splitTemplates = {};
const splitSystemPrompts = {};
for (const promptMode of ["seedance-2.0", "seedance-2.5"]) {
    splitSystemPrompts[promptMode] = story.getStoryEpisodeSplitRequestSystemPrompt({ compactPrompt: true, promptMode });
    for (const scriptMode of ["plot", "narration"]) {
        splitTemplates[`${promptMode}_${scriptMode}`] = variant((p) => {
            const project = sampleProject(p, scriptMode);
            project.planning.promptMode = promptMode;
            const assets = demo.DEMO_ASSETS;
            const episode = { ...sampleEpisode, assetRefs: demo.DEMO_ASSETS.map((asset) => asset.id) };
            return strip(parse(story.buildStoryEpisodesSplitPrompt({ project, episodes: [episode], assets, constraints: { clipMaxSeconds: p.clipMaxSeconds, promptMode } })), STRIP.split);
        }, `split.${promptMode}.${scriptMode}`);
    }
}

const clipAdjustTemplate = variant((p) => strip(parse(story.buildStoryClipAdjustmentPrompt({
    scope: "prompt",
    instruction: "〔调整说明〕",
    currentPrompt: "〔当前提示词〕",
    duration: "4s",
    maxDurationSeconds: p.clipMaxSeconds,
})), STRIP.clipAdjust), "clipAdjust");

const splitValidationPrompt = String(story.buildStoryEpisodesSplitValidationPrompt({ project: sampleProject(PARAMS.A), episodes: [sampleEpisode], assets: [], constraints: {} }));

const reviewClips = [{ ref: "clip-1", duration: "4s", prompt: "〔片段提示词〕", shots: [{ ref: "shot-1", duration: 4, visual: "〔画面〕", camera: "〔镜头〕", dialogue: "", voiceover: "", audio: "" }] }];
const splitReviewTemplate = variant((p) => strip(parse(splitReview.buildReviewPrompt({ episodeRef: "episode-1", episode: sampleEpisode, batchRef: "batch-1", clips: reviewClips, neighboringClips: [], assets: [], localSignals: [], phase: "review", constraints: { clipMaxSeconds: p.clipMaxSeconds } })), STRIP.splitReview), "splitReview");
const splitRepairTemplate = variant((p) => strip(parse(splitReview.buildRepairPrompt({ episodeRef: "episode-1", episode: sampleEpisode, failedClips: reviewClips, assessments: [{ clipRef: "clip-1", verdict: "repair", issues: [] }], neighbors: [], assets: [], constraints: { clipMaxSeconds: p.clipMaxSeconds }, repairRound: 1 })), STRIP.splitRepair), "splitRepair");

function stageReviewTemplates() {
    const out = {};
    for (const stage of ["summary", "outline", "script"]) {
        const calls = samples[stage === "summary" ? "stage_review_calls" : `stage_review_${stage}`]?.value || [];
        const review = calls.find((call) => call.prompt && JSON.parse(call.prompt).task === "review_story_stage_content");
        const resolve = calls.find((call) => call.prompt && JSON.parse(call.prompt).task === "resolve_story_stage_findings");
        if (!review) continue;
        const reviewPayload = strip(JSON.parse(review.prompt), ["grounding", "artifact", "issues", "reviewRound", "repairRound"]);
        out[stage] = {
            reviewSystemPrompt: review.systemPrompt,
            review: reviewPayload,
            ...(resolve ? { resolveSystemPrompt: resolve.systemPrompt, resolve: strip(JSON.parse(resolve.prompt), ["grounding", "artifact", "claims", "targetContext", "structure", "reviewRound", "repairRound"]) } : {}),
        };
    }
    return out;
}

const SCRIPT_SYSTEM_PROMPTS = {
    summary: constant("api/storyGenerationApi.js", "STORY_SUMMARY_SYSTEM_PROMPT"),
    sourceDigest: constant("api/storyGenerationApi.js", "STORY_SOURCE_DIGEST_SYSTEM_PROMPT"),
    outlineComplete: literal("api/story-generation/storyEpisodeOutlinePlanning.js", "_0x19f096"),
    outlineSkeleton: literal("api/story-generation/storyEpisodeOutlinePlanning.js", "_0x3a0116"),
    outlineBatch: literal("api/story-generation/storyEpisodeOutlinePlanning.js", "_0x39f944"),
    outlineContractRepair: literal("api/story-generation/storyEpisodeOutlinePlanning.js", "systemPrompt"),
    episodeScript: constant("api/story-generation/storyEpisodeScriptPrompt.js", "STORY_EPISODE_SCRIPT_SYSTEM_PROMPT"),
    episodeScriptNatural: constant("api/story-generation/storyEpisodeScriptPrompt.js", "STORY_EPISODE_SCRIPT_NATURAL_SYSTEM_PROMPT"),
    episodeScriptRepair: constant("api/story-generation/storyEpisodeScriptPrompt.js", "STORY_EPISODE_SCRIPT_REPAIR_SYSTEM_PROMPT"),
    episodeScriptContentRevision: constant("api/story-generation/storyEpisodeScriptPrompt.js", "STORY_EPISODE_SCRIPT_CONTENT_REVISION_SYSTEM_PROMPT"),
    assetExtraction: constant("api/storyGenerationApi.js", "STORY_ASSET_EXTRACTION_SYSTEM_PROMPT"),
    assetFormatRepair: constant("api/storyGenerationApi.js", "STORY_ASSET_FORMAT_REPAIR_SYSTEM_PROMPT"),
    assetSourceRepair: constant("api/storyGenerationApi.js", "STORY_ASSET_SOURCE_REPAIR_SYSTEM_PROMPT"),
    splitValidation: constant("api/storyGenerationApi.js", "STORY_EPISODES_SPLIT_VALIDATION_SYSTEM_PROMPT"),
    splitQualityReview: constant("api/story-generation/storyEpisodeSplitQualityReview.js", "REVIEW_SYSTEM_PROMPT"),
    clipAdjustment: constant("api/storyGenerationApi.js", "STORY_CLIP_ADJUSTMENT_SYSTEM_PROMPT"),
    split: splitSystemPrompts,
};

const SCRIPT_PRESETS = {
    characterAssetPromptPrefix: constant("src/domain/storyGeneration/storyCharacterAssetPromptPrefix.js", "STORY_CHARACTER_ASSET_PROMPT_PREFIX"),
    assetReferencePromptSuffix: constant("src/modules/storyWorkspace/storyAssetAppearances.js", "STORY_ASSET_REFERENCE_PROMPT_SUFFIX"),
    characterAssetPromptPresets: constant("src/modules/storyWorkspace/storyAssetPromptPresets.js", "STORY_CHARACTER_ASSET_PROMPT_PRESETS"),
    sceneAssetPromptPresets: constant("src/modules/storyWorkspace/storyAssetPromptPresets.js", "STORY_SCENE_ASSET_PROMPT_PRESETS"),
    stylePresets: constant("src/modules/storyWorkspace/storyStyleCatalog.js", "STORY_STYLE_PRESETS"),
    homeGenerationPrompts: constant("src/modules/storyWorkspace/storyProjectPlanning.js", "STORY_HOME_GENERATION_PROMPTS"),
    cameraPresets: constant("src/domain/storyGeneration/episodeSplitContract.js", "STORY_EPISODE_SPLIT_CAMERA_PRESETS"),
};

const SCRIPT_TEMPLATES = {
    summary: summaryTemplates,
    outline: outlineTemplates,
    outlineBatch: outlineBatchTemplates,
    episodeScript: scriptTemplates,
    assetExtraction: assetTemplates,
    split: splitTemplates,
    splitValidationPrompt,
    clipAdjust: clipAdjustTemplate,
    splitReview: splitReviewTemplate,
    splitRepair: splitRepairTemplate,
    stageReview: stageReviewTemplates(),
};

// ---- Replication studio ----
const REPLICATION_PROMPTS = {
    generationSystemPrompt: replicationPolicy.getReplicationGenerationSystemPrompt(),
    rules: {
        ...constants["src/domain/storyGeneration/videoReplicationPromptPolicy.js"],
        ...constants["src/domain/storyGeneration/videoReplicationOrientation.js"],
        ...constants["src/domain/storyGeneration/videoReplicationTimingContract.js"],
        ...constants["src/domain/storyGeneration/videoReplicationVisualState.js"],
        REPLICATION_SHOT_GUIDANCE: constant("src/domain/storyGeneration/videoReplicationSegmentPlan.js", "REPLICATION_SHOT_GUIDANCE"),
        REPLICATION_SPEECH_GUIDANCE: constant("src/domain/storyGeneration/videoReplicationSpeech.js", "REPLICATION_SPEECH_GUIDANCE"),
        REPLICATION_SPEECH_INTEGRITY_GUIDANCE: constant("src/domain/storyGeneration/videoReplicationSpeechIntegrity.js", "REPLICATION_SPEECH_INTEGRITY_GUIDANCE"),
        REPLICATION_SPEECH_ROUTING_GUIDANCE: constant("src/domain/storyGeneration/videoReplicationSpeechPolicy.js", "REPLICATION_SPEECH_ROUTING_GUIDANCE"),
        REPLICATION_CONTENT_ROUTING_RULE: constant("src/domain/storyGeneration/videoReplicationContentRouting.js", "REPLICATION_CONTENT_ROUTING_RULE"),
        REPLICATION_IMAGE_APPEARANCE_GUIDANCE: constant("src/domain/storyGeneration/videoReplicationGenerationAssets.js", "REPLICATION_IMAGE_APPEARANCE_GUIDANCE"),
        VIDEO_REPLICATION_AUDIO_LANGUAGE_SYSTEM_RULE: constant("src/domain/storyGeneration/videoReplicationLanguage.js", "VIDEO_REPLICATION_AUDIO_LANGUAGE_SYSTEM_RULE"),
        SEEDANCE20_REPLICATION_REPAIR_FORMAT_RULE: constant("src/domain/storyGeneration/seedance20ReplicationPromptFormat.js", "SEEDANCE20_REPLICATION_REPAIR_FORMAT_RULE"),
    },
    videoStyleSummaries: constant("src/domain/storyGeneration/videoReplicationStyleSummaries.js", "REPLICATION_VIDEO_STYLE_SUMMARIES"),
    videoExecutionConstraints: constant("src/modules/storyWorkspace/storyReplicationDefinitions.js", "REPLICATION_VIDEO_EXECUTION_CONSTRAINTS"),
    textAssetSystemPrompt: textAssets.SYSTEM_PROMPT,
    textAssetBatch: (() => {
        const request = samples.replication_text_asset_batch.value;
        const payload = JSON.parse(request.prompt);
        delete payload.episodes;
        return { payload, structuredOutputName: request.structuredOutput?.name, schema: request.structuredOutput?.schema, temperature: request.temperature, maxOutputTokens: request.maxOutputTokens };
    })(),
};
delete REPLICATION_PROMPTS.rules.references;
delete REPLICATION_PROMPTS.rules.speechOutput;

// ---- Replacement studio ----
const REPLACEMENT_PROMPTS = {
    defaultVideoPrompt: constant("src/modules/personReplacement/personReplacementProject.js", "PERSON_REPLACEMENT_DEFAULT_VIDEO_PROMPT"),
    characterAssetPromptPresets: constant("src/modules/personReplacement/personReplacementImageGeneration.js", "PERSON_REPLACEMENT_CHARACTER_ASSET_PROMPT_PRESETS"),
    manualPromptExample: constant("src/modules/personReplacement/personReplacementPromptControls.js", "PERSON_REPLACEMENT_MANUAL_PROMPT_EXAMPLE"),
    manualModeFormat: constant("src/modules/personReplacement/personReplacementPromptControls.js", "MANUAL_MODE_FORMAT"),
    manualEnhancementTooltip: constant("src/modules/personReplacement/personReplacementPromptControls.js", "PERSON_REPLACEMENT_MANUAL_ENHANCEMENT_TOOLTIP"),
    enhancementSystemPrompt: enhancementApi.PERSON_REPLACEMENT_PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
    minimaxH3: Object.fromEntries(Object.entries(constants["src/modules/promptPresets.js"]).filter(([key]) => /^(MINIMAX_H3|HAILUO_H3)_/.test(key))),
};

function emit(file, exports) {
    const header = "// 由 tools/shuo-prompt-extract/build-ts.mjs 生成，内容为 SHUO 原文提示词，勿手改。\n/* eslint-disable */\n";
    const body = Object.entries(exports)
        .map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2).split("〔分集标题〕").join("{{episodeTitle}}")} as const;\n`)
        .join("\n");
    fs.writeFileSync(path.join(outDir, file), `${header}\n${body}`);
}

fs.mkdirSync(outDir, { recursive: true });
emit("script.generated.ts", { SCRIPT_SYSTEM_PROMPTS, SCRIPT_TEMPLATES, SCRIPT_PRESETS });
emit("replication.generated.ts", { REPLICATION_PROMPTS });
emit("replacement.generated.ts", { REPLACEMENT_PROMPTS });
console.log("generated script / replication / replacement prompt modules");
if (unresolved.length) {
    console.log(`unresolved varying spots (${unresolved.length}):`);
    for (const where of unresolved.slice(0, 40)) console.log(`  ${where}`);
}
