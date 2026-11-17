// Usage: node tools/shuo-prompt-extract/capture.mjs  (run extract.mjs first)
// Calls SHUO's pure prompt builders with sample inputs and records the user payloads
// they produce, so task / requirements / outputSchema can be reused verbatim.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const work = path.join(os.tmpdir(), "shuo-prompt-work");
const load = (rel) => import(pathToFileURL(path.join(work, rel)).href);

const story = await load("api/storyGenerationApi.js");
const demo = await load("src/modules/storyWorkspace/storyWorkspaceData.js");
const textAssets = await load("api/story-generation/storyReplicationTextAssets.js");
const enhancement = await load("src/modules/personReplacement/personReplacementPromptEnhancement.js");

const summary = {
    title: "重生者的诡异任务",
    logline: demo.STORY_SUMMARY,
    summary: demo.STORY_SUMMARY,
    genre: ["悬疑", "重生"],
    tone: "紧张克制",
    worldSetting: "诡异末世降临前一个月的高中",
    characters: [
        { name: "陈木", role: "主角", description: "十八岁高中生，重生者，冷静克制。" },
        { name: "班主任", role: "重要角色", description: "四十多岁，严肃克制。" },
    ],
    episodeCount: 2,
};
const project = {
    ...summary,
    storyType: "悬疑",
    targetAudience: "年轻观众",
    background: summary.worldSetting,
    coreHook: "重生者提前一个月知道末世规则",
    plotBeats: [{ ref: "beat-1", stage: "开端", event: "陈木重生", consequence: "决定提前组队" }],
    characters: summary.characters.map((c, i) => ({ ref: `character-${i + 1}`, name: c.name, roleType: c.role, profile: c.description, motivation: "活下去", personality: "冷静" })),
    scriptMode: "plot",
    mode: "upload",
    sourceText: demo.PLOT_SCRIPT,
    storySummary: summary,
    aspectRatio: "9:16",
    visualStyle: "真人写实",
    planning: { episodeCount: 2, episodeDurationSeconds: 60, clipMaxSeconds: 15 },
    chapters: [
        { id: "chapter-1", title: "第1集 重生者的诡异任务", content: demo.PLOT_SCRIPT },
        { id: "chapter-2", title: "第2集 午夜食堂", content: demo.NARRATION_SCRIPT },
    ],
    episodes: demo.EPISODES,
    assets: demo.DEMO_ASSETS,
};
const episode = { ...demo.EPISODES[0], ref: "episode-1", text: demo.PLOT_SCRIPT, script: demo.PLOT_SCRIPT, synopsis: demo.STORY_SUMMARY };

const replicationEpisodes = [
    {
        id: "episode-1",
        title: "原片复刻",
        clips: [
            {
                id: "clip-1",
                shots: [{ id: "shot-1", visual: "陈木在教室醒来，环顾四周", characters: ["陈木"], dialogue: "", scene: "夜晚教室" }],
            },
        ],
    },
];

const cases = {
    summary_generate: () => story.buildStorySummaryPrompt({ mode: "generate", scriptMode: "plot", idea: "高中生重生回到诡异末世前一个月", visualStyle: "真人写实", planning: project.planning }),
    summary_upload: () => story.buildStorySummaryPrompt({ mode: "upload", scriptMode: "plot", sourceText: demo.PLOT_SCRIPT, fileName: "剧本.txt", planning: project.planning }),
    summary_rewrite: () => story.buildStorySummaryPrompt({ mode: "rewrite", scriptMode: "plot", sourceText: demo.PLOT_SCRIPT, rewriteInstruction: "改成都市职场背景", planning: project.planning }),
    summary_upload_narration: () => story.buildStorySummaryPrompt({ mode: "upload", scriptMode: "narration", sourceText: demo.NARRATION_SCRIPT, planning: project.planning }),
    source_digest: () => story.buildStorySourceDigestPrompt?.({ sourceText: demo.PLOT_SCRIPT, chunkIndex: 0, chunkTotal: 1 }),
    outline: () => story.buildStoryEpisodeOutlinePrompt({ project, constraints: project.planning }),
    outline_batch: () => story.buildStoryEpisodeOutlineBatchPrompt({ project, constraints: project.planning, skeleton: { episodes: [{ number: 1, title: "第一集" }, { number: 2, title: "第二集" }] }, batchEpisodes: [{ number: 1, title: "第一集" }], batchIndex: 0, batchTotal: 1 }),
    planning: () => story.buildStoryEpisodePlanningPrompt?.({ project, constraints: project.planning }),
    episode_script_plot: () => story.buildStoryEpisodeScriptPrompt({ project, episode }),
    episode_script_narration: () => story.buildStoryEpisodeScriptPrompt({ project: { ...project, scriptMode: "narration" }, episode }),
    asset_extraction: () => story.buildStoryAssetExtractionPrompt({ project, aspectRatio: "9:16", visualStyle: "真人写实" }),
    episode_split: () => story.buildStoryEpisodeSplitPrompt({ project, episode, assets: demo.DEMO_ASSETS, constraints: project.planning }),
    episodes_split: () => story.buildStoryEpisodesSplitPrompt({ project, episodes: [episode], assets: demo.DEMO_ASSETS, constraints: project.planning }),
    episodes_split_validation: () => story.buildStoryEpisodesSplitValidationPrompt?.({ project, episodes: [episode], assets: demo.DEMO_ASSETS, constraints: project.planning }),
    split_system_compact: () => story.getStoryEpisodeSplitRequestSystemPrompt({ compactPrompt: true, promptMode: "seedance-2.0" }),
    split_system_seedance25: () => story.getStoryEpisodeSplitRequestSystemPrompt({ compactPrompt: true, promptMode: "seedance-2.5" }),
    split_system_full: () => story.getStoryEpisodeSplitRequestSystemPrompt({ compactPrompt: false, promptMode: "seedance-2.0" }),
    clip_adjust: () => story.buildStoryClipAdjustmentPrompt({ scope: "prompt", instruction: "镜头更紧张", currentPrompt: demo.EPISODES[0].clips[0].prompt, duration: "4.0s", maxDurationSeconds: 15 }),
    story_generation: () => story.buildStoryGenerationPrompt({ mode: "generate", idea: "高中生重生回到诡异末世前一个月", planning: project.planning }),
    replication_text_asset_batch: () => textAssets.buildStoryReplicationTextAssetBatchRequest({ model: "sample-model", provider: "openai", episodes: replicationEpisodes }),
    replication_text_asset_merge: () => textAssets.buildStoryReplicationTextAssetMergeRequest({ model: "sample-model", provider: "openai", kind: "character", records: [{ name: "陈木", description: "高中生" }], stage: "merge" }),
    person_enhancement: () => enhancement.buildPersonReplacementPromptEnhancementPrompt({ promptPackage: { prompt: "把图1中的A替换为图2的人物", referenceImages: [{ role: "keyframe", label: "图1", index: 1 }, { role: "target-character", label: "图2", index: 2 }] } }),
};

const splitReview = await load("api/story-generation/storyEpisodeSplitQualityReview.js");
const stageReview = await load("api/story-generation/storyStageAutoReview.js");
const findingVerify = await load("api/story-generation/storyStageFindingVerification.js");
const sampleClips = [
    {
        ref: "clip-1",
        duration: "8s",
        sceneRef: "scene-classroom",
        prompt: "人物站位：陈木趴在教室后排课桌上。镜头缓慢推进，陈木猛地睁眼。",
        shots: [{ ref: "shot-1", duration: 4, visual: "人物站位：陈木趴在后排课桌上，猛地睁眼", camera: "中景，缓推", dialogue: "", voiceover: "", audio: "" }],
    },
];
const reviewCalls = [];
let reviewTurn = 0;
const recordRequest = async (payload) => {
    reviewCalls.push(payload);
    reviewTurn += 1;
    let task = "";
    let body = {};
    try {
        body = JSON.parse(payload.prompt);
        task = body.task || "";
    } catch {}
    let answer = { verdict: "pass", issues: [] };
    if (task === "review_story_stage_content" && reviewTurn === 1) {
        answer = { verdict: "repair", issues: [{ ref: "summary", field: "storySummary", code: "missing_ending", reason: "摘要没有交代结局", evidence: "陈木也发现这场重生并不是偶然", instruction: "补充主要结局" }] };
    } else if (task === "verify_story_stage_findings") {
        answer = { decisions: (body.claims || []).map((claim) => ({ claimRef: claim.claimRef || claim.ref || "claim-1", decision: "confirmed", reason: "确有缺失" })) };
    } else if (/repair/.test(task)) {
        answer = { repairs: [], patches: [], artifact: body.artifact || {}, storySummary: "补充结局后的摘要" };
    }
    const text = JSON.stringify(answer);
    return { text, content: text, output: text, choices: [{ message: { content: text } }] };
};
cases.split_review = () => splitReview.buildReviewPrompt({ episodeRef: "episode-1", episode, batchRef: "batch-1", clips: sampleClips, neighboringClips: [], assets: demo.DEMO_ASSETS, localSignals: [], phase: "review", constraints: project.planning });
cases.split_repair = () => splitReview.buildRepairPrompt({ episodeRef: "episode-1", episode, failedClips: sampleClips, assessments: [{ ref: "clip-1", verdict: "revise", issues: ["人物站位缺失"] }], neighbors: [], assets: demo.DEMO_ASSETS, constraints: project.planning, repairRound: 1 });
cases.finding_verification = () => findingVerify.buildFindingVerificationPrompt({ stage: "summary", grounding: { sourceText: demo.PLOT_SCRIPT }, artifact: { storySummary: demo.STORY_SUMMARY }, issues: [{ ref: "issue-1", problem: "摘要没有交代结局" }], requestRound: 1 });
cases.stage_review_calls = async () => {
    try {
        await stageReview.reviewStoryStage({
            stage: "summary",
            artifact: { title: summary.title, storySummary: demo.STORY_SUMMARY },
            grounding: { sourceText: demo.PLOT_SCRIPT },
            parseCandidate: (value) => (typeof value === "string" ? JSON.parse(value) : value),
            request: recordRequest,
            requestPayload: { model: "sample-model", provider: "openai" },
        });
    } catch (error) {
        reviewCalls.push({ error: String(error?.message || error) });
    }
    return reviewCalls;
};

const stageArtifacts = {
    outline: { storyFacts: ["陈木是重生者"], episodes: [{ ref: "episode-1", number: 1, title: "第一集", synopsis: demo.STORY_SUMMARY, hook: "任务书出现", endingEvent: "任务书出现", continuityFacts: [], endingState: { characters: ["陈木：教室"], props: [], unresolvedThreads: [] } }] },
    script: { episodeRef: "episode-1", title: "第一集", scenes: [{ ref: "episode-1-scene-1", heading: "夜 内 教室", characters: ["陈木"], body: demo.PLOT_SCRIPT }] },
    assets: { assets: demo.DEMO_ASSETS },
    split: { episodeRef: "episode-1", clips: sampleClips },
};
for (const [stage, artifact] of Object.entries(stageArtifacts)) {
    cases[`stage_review_${stage}`] = async () => {
        const calls = [];
        try {
            await stageReview.reviewStoryStage({
                stage,
                artifact,
                grounding: { sourceText: demo.PLOT_SCRIPT, storySummary: demo.STORY_SUMMARY },
                parseCandidate: (value) => (typeof value === "string" ? JSON.parse(value) : value),
                request: async (payload) => {
                    calls.push(payload);
                    const text = JSON.stringify({ verdict: "pass", issues: [] });
                    return { text, content: text, output: text, choices: [{ message: { content: text } }] };
                },
                requestPayload: { model: "sample-model", provider: "openai" },
            });
        } catch (error) {
            calls.push({ error: String(error?.message || error) });
        }
        return calls;
    };
}

const results = {};
for (const [name, run] of Object.entries(cases)) {
    try {
        const out = await run();
        if (out === undefined) {
            results[name] = { error: "builder not exported" };
            continue;
        }
        let value = out;
        if (typeof out === "string") {
            try {
                value = JSON.parse(out);
            } catch {
                value = out;
            }
        }
        results[name] = { value };
        console.log(`ok   ${name}`);
    } catch (error) {
        results[name] = { error: String(error?.message || error) };
        console.log(`fail ${name}: ${String(error?.message || error).slice(0, 140)}`);
    }
}

const outFile = path.join(here, "out", "shuo-prompt-samples.json");
fs.writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
