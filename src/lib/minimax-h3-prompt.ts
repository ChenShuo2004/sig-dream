import { requestPlainText } from "@/studios/runtime/strict-request";

/** Mentions H3 binds to uploaded slots: @图片N / @视频N / @音频N. */
const SLOT_MENTION_RE = /@(?:图片|视频|音频)\d+/gu;

export type MinimaxH3Lang = "en" | "zh";

export type MinimaxH3PromptPair = {
    en: string;
    zh: string;
};

export type MinimaxH3SlotCounts = {
    imageCount?: number;
    videoCount?: number;
    audioCount?: number;
};

/**
 * System prompt distilled from MiniMax official skill
 * `MiniMax-AI/MiniMax-H3` → `skills/h3-prompt-writing` (Ref2VA / full-reference).
 * Product labels stay `@图片N` / `@视频N` / `@音频N` (same indices as official `<Picture N>` / `<Video N>` / `<Audio N>`).
 */
export const MINIMAX_H3_FORMAT_SYSTEM_PROMPT = `你是 MiniMax H3 全参考（Ref2VA）提示词改写器。
规则来源：MiniMax 官方技能 h3-prompt-writing + references/ref-en.txt（Full-Reference Mode）。
只改格式与组织方式，不新增剧情/人物/道具/对白/运镜，不删减关键画面与对白事实。

## 输出结构（必须按此顺序，字段名保持英文）
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:

## 标签（本产品槽位写法，编号必须与原文一致）
- @图片N = 官方 <Picture N>
- @视频N = 官方 <Video N>
- @音频N = 官方 <Audio N>
- 可用 <Subject N> 描述可复用主体（人物/服装/场景等），并在定义里引用对应 @图片N/@视频N
- 原文已有的 @图片N/@视频N/@音频N 必须全部保留，不得改号、合并或删除
- 若原文写成 <Picture N> 等官方写法，改写后统一成 @图片N / @视频N / @音频N
- 若提供了已上传槽位清单，必须在 subject_definitions 与 detailed_description 中为每个槽位补全引用；原文未写出生效点的，按素材角色合理补到对应镜头/主体行，不得漏槽

## 对白与字幕（必须执行，中英两份都遵守）
H3 会把 detailed_description 里引号中的整句对白画成画面字幕。默认成片不要字幕。
对白、旁白、口播、歌词必须在中文版和英文版里逐字保留原文，禁止翻译成英文或其他语言。英文版只把镜头和场景说明写成英文，引号里的台词仍是原文。
示例：The host says, spoken only, do not show on screen: "原文台词"
1. 人物对白、旁白、口播的原句只作为声音保留，一字不改、一语不译，只写进 overall_soundscape。中文版标明「只出声，不出现在画面上」；英文版标明 "spoken only, do not show on screen"，引号内仍用原文。
2. detailed_description 的镜头只写谁在说话、语气、口型与表情，禁止写入对白原句、引号台词或可被当成字幕的整句。每个有人说话的镜头末尾：中文写「画面中不出现任何文字或字幕」；英文写 "No text, captions, or subtitles appear in the frame."
3. summary 必须写明无需字幕、无需画面文字叠层。英文版必须包含 "No subtitles, no captions, no burned-in text."
4. 只有用户明确要求观众看见的物体文字（招牌、手机屏幕内容、屏幕字幕）才写进对应镜头，并标明这是物体上的文字，不是字幕条。原文没要求看见的对白、弹幕、评论，不要画进画面。
5. 英文是实际提交稿。禁止把对白原句放回英文版的 detailed_description。
6. 用户原文明确要求「要字幕 / 烧录字幕 / 屏幕上显示对白」时，才把这些对白作为画面字幕保留，并在 summary 写明这是用户要求的字幕。

## 写法要求
1. 六段说明正文：英文版的说明用英文；中文版的说明用中文。对白、旁白、口播、歌词、用户明确要求看见的画面文字在两份里都逐字保留原文，禁止翻译。对白原句只出现在 overall_soundscape。
2. detailed_description 按播放顺序写镜头：构图、主体、环境光影、动作、运镜、谁在说话及语气、参考素材生效点；用 [Shot 1]、[Shot N] At MM:SS.mmm 等官方镜头标记。镜头内不引用对白原句。
3. subject_definitions 逐行定义需要跟踪的主体/素材角色；不要空壳字段。
4. summary 简述任务类型、成片目标、主要参考关系，并写明无需字幕。
5. retention_analysis 说明各参考是完整保留、部分保留、迁移还是复用。
6. overall_soundscape 总结环境声/动作声/非语言人声，并逐条写出对白原句（说话人、语气、只出声不入画）。non_diegetic_music 写观众可听、角色听不见的配乐（若原文要求 no music，写 none / no non-diegetic music）。
7. 删除产品字段壳：【场景名称】【基础空间】【配音指令】VoiceID、::~FIELD::~、状态（）、情绪百分比等表头。
8. 总时长语义贴近用户原文，不要编造未给出的秒级时间表细节。
9. 只输出指定分隔的正文，不要解释、不要 Markdown 代码围栏、不要前后缀。`;

const PAIR_EN_MARK = "=====H3_EN=====";
const PAIR_ZH_MARK = "=====H3_ZH=====";

/** Spoken lines stay in the sound section so H3 does not burn them in as captions. */
const H3_NO_SUBTITLE_RULE =
    "对白与字幕：人物对白、旁白、口播、歌词在中文稿和英文稿里都必须逐字保留原文，禁止翻译。原句只写入 overall_soundscape，标明只出声、不出现在画面上；detailed_description 禁止写入对白原句或引号台词，每个说话镜头写明画面不出现任何文字或字幕；summary 写明无需字幕。英文提交稿必须包含 No subtitles, no captions, no burned-in text，但引号内台词仍是原文。只有用户明确要求观众看见的招牌、手机屏幕或屏幕字幕才写入镜头，并标明是物体上的文字。用户明确要求烧录字幕时才保留画面字幕。";

function collectSlotMentions(text: string) {
    const fromAt = text.match(SLOT_MENTION_RE) || [];
    const fromOfficial = [
        ...(text.matchAll(/<Picture\s*(\d+)\s*>/gi) || []),
        ...(text.matchAll(/<Video\s*(\d+)\s*>/gi) || []),
        ...(text.matchAll(/<Audio\s*(\d+)\s*>/gi) || []),
    ].map((match) => {
        const kind = match[0].toLowerCase().includes("picture") ? "图片" : match[0].toLowerCase().includes("video") ? "视频" : "音频";
        return `@${kind}${match[1]}`;
    });
    return [...new Set([...fromAt, ...fromOfficial])];
}

/** Build required @槽位 from prompt mentions + uploaded reference counts. */
export function requiredMinimaxH3Mentions(prompt: string, slots?: MinimaxH3SlotCounts) {
    const fromText = collectSlotMentions(prompt);
    const fromSlots: string[] = [];
    const images = Math.max(0, Math.floor(Number(slots?.imageCount) || 0));
    const videos = Math.max(0, Math.floor(Number(slots?.videoCount) || 0));
    const audios = Math.max(0, Math.floor(Number(slots?.audioCount) || 0));
    for (let i = 1; i <= images; i += 1) fromSlots.push(`@图片${i}`);
    for (let i = 1; i <= videos; i += 1) fromSlots.push(`@视频${i}`);
    for (let i = 1; i <= audios; i += 1) fromSlots.push(`@音频${i}`);
    return [...new Set([...fromText, ...fromSlots])].sort((a, b) => a.localeCompare(b, "zh"));
}

/** Map official angle-bracket labels → product @槽位；补全裸「图片1」。 */
export function normalizeMinimaxH3SlotMentions(text: string) {
    return text
        .replace(/<Picture\s*(\d+)\s*>/gi, "@图片$1")
        .replace(/<Video\s*(\d+)\s*>/gi, "@视频$1")
        .replace(/<Audio\s*(\d+)\s*>/gi, "@音频$1")
        .replace(/(?<!@)图片\s*(\d+)/gu, "@图片$1")
        .replace(/(?<!@)视频\s*(\d+)/gu, "@视频$1")
        .replace(/(?<!@)音频\s*(\d+)/gu, "@音频$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function stripFence(text: string) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)```$/u);
    return (fenced?.[1] || trimmed).trim();
}

function looksLikeRef2Va(text: string) {
    const lower = text.toLowerCase();
    return (
        lower.includes("subject_definitions") &&
        lower.includes("detailed_description") &&
        (lower.includes("overall_soundscape") || lower.includes("retention_analysis"))
    );
}

function missingMentions(text: string, required: string[]) {
    return required.filter((token) => !text.includes(token));
}

function parsePairPayload(raw: string): MinimaxH3PromptPair | null {
    const text = stripFence(raw);
    const enIdx = text.indexOf(PAIR_EN_MARK);
    const zhIdx = text.indexOf(PAIR_ZH_MARK);
    if (enIdx < 0 || zhIdx < 0) return null;
    let en = "";
    let zh = "";
    if (enIdx < zhIdx) {
        en = text.slice(enIdx + PAIR_EN_MARK.length, zhIdx).trim();
        zh = text.slice(zhIdx + PAIR_ZH_MARK.length).trim();
    } else {
        zh = text.slice(zhIdx + PAIR_ZH_MARK.length, enIdx).trim();
        en = text.slice(enIdx + PAIR_EN_MARK.length).trim();
    }
    en = normalizeMinimaxH3SlotMentions(en);
    zh = normalizeMinimaxH3SlotMentions(zh);
    if (!en || !zh) return null;
    return { en, zh };
}

function slotBrief(slots?: MinimaxH3SlotCounts) {
    const images = Math.max(0, Math.floor(Number(slots?.imageCount) || 0));
    const videos = Math.max(0, Math.floor(Number(slots?.videoCount) || 0));
    const audios = Math.max(0, Math.floor(Number(slots?.audioCount) || 0));
    if (!images && !videos && !audios) return "";
    return `已上传参考槽位：图片 ${images} 张、视频 ${videos} 段、音频 ${audios} 段。必须为 @图片1…@图片${images || 0}、@视频1…、@音频1… 在未标出生效点的段落补全引用。`;
}

async function requestH3Text(input: { model: string; prompt: string; signal?: AbortSignal; temperature?: number }) {
    return requestPlainText({
        model: input.model,
        systemPrompt: MINIMAX_H3_FORMAT_SYSTEM_PROMPT,
        prompt: input.prompt,
        temperature: input.temperature ?? 0.2,
        maxOutputTokens: 8000,
        signal: input.signal,
    });
}

function assertPairReady(pair: MinimaxH3PromptPair, required: string[]) {
    const missEn = missingMentions(pair.en, required);
    const missZh = missingMentions(pair.zh, required);
    if (missEn.length) throw new Error(`英文版丢失了参考引用：${missEn.join("、")}`);
    if (missZh.length) throw new Error(`中文版丢失了参考引用：${missZh.join("、")}`);
    if (!looksLikeRef2Va(pair.en) || !looksLikeRef2Va(pair.zh)) {
        throw new Error("转换结果不符合官方 Ref2VA 六段结构，请重试");
    }
}

/**
 * LLM rewrite using MiniMax official Ref2VA structure (h3-prompt-writing).
 * Returns English (submit) + Chinese (review/edit) pair.
 */
export async function rewritePromptToMinimaxH3(input: {
    prompt: string;
    textModel: string;
    slots?: MinimaxH3SlotCounts;
    signal?: AbortSignal;
}): Promise<MinimaxH3PromptPair> {
    const source = String(input.prompt || "").trim();
    if (!source) throw new Error("请先填写提示词");
    if (!String(input.textModel || "").trim()) throw new Error("请先在设置里选择文本模型");

    const required = requiredMinimaxH3Mentions(source, input.slots);
    const slotLine = slotBrief(input.slots);
    const requiredLine = required.length ? `必须保留并补全的引用：${required.join("、")}` : "原文若无参考标签且未上传槽位，不要凭空捏造 @图片/@视频/@音频。";

    const askPair = [
        "请按 MiniMax 官方 H3 Ref2VA（全参考）格式改写下面提示词。",
        "输出两份完整六段：先英文（提交用），后中文（核对用）。",
        `严格使用分隔符，顺序如下：\n${PAIR_EN_MARK}\n<英文六段>\n${PAIR_ZH_MARK}\n<中文六段>`,
        "两份语义一致；@图片N/@视频N/@音频N 编号与出现集合必须一致。",
        H3_NO_SUBTITLE_RULE,
        slotLine,
        requiredLine,
        "",
        "原文：",
        source,
    ]
        .filter(Boolean)
        .join("\n");

    let pair = parsePairPayload(await requestH3Text({ model: input.textModel, prompt: askPair, signal: input.signal, temperature: 0.2 }));
    if (!pair) {
        // Fallback: English-only then translate.
        const enRaw = await requestH3Text({
            model: input.textModel,
            prompt: [
                "请只输出一份英文六段 Ref2VA 提示词（不要中文版、不要分隔符）。",
                H3_NO_SUBTITLE_RULE,
                slotLine,
                requiredLine,
                "",
                "原文：",
                source,
            ]
                .filter(Boolean)
                .join("\n"),
            signal: input.signal,
            temperature: 0.2,
        });
        const en = normalizeMinimaxH3SlotMentions(stripFence(enRaw));
        if (!en || !looksLikeRef2Va(en)) throw new Error("文本模型没有返回有效的英文 H3 提示词");
        const zh = await translateMinimaxH3Prompt({
            source: en,
            from: "en",
            to: "zh",
            textModel: input.textModel,
            required,
            signal: input.signal,
        });
        pair = { en, zh };
    }

    const missEn = missingMentions(pair.en, required);
    const missZh = missingMentions(pair.zh, required);
    if (missEn.length || missZh.length || !looksLikeRef2Va(pair.en) || !looksLikeRef2Va(pair.zh)) {
        const repaired = await requestH3Text({
            model: input.textModel,
            prompt: [
                missEn.length || missZh.length ? `上一版漏了必须保留的引用：英文缺 ${missEn.join("、") || "无"}；中文缺 ${missZh.join("、") || "无"}。` : "",
                !looksLikeRef2Va(pair.en) || !looksLikeRef2Va(pair.zh) ? "上一版缺少官方六段字段。" : "",
                slotLine,
                requiredLine,
                H3_NO_SUBTITLE_RULE,
                "请在不改原意的前提下重新输出完整中英双份（含分隔符）。对白原句仍只放在 overall_soundscape。",
                "",
                "原文：",
                source,
                "",
                "上一版英文：",
                pair.en,
                "",
                "上一版中文：",
                pair.zh,
            ]
                .filter(Boolean)
                .join("\n"),
            signal: input.signal,
            temperature: 0.1,
        });
        const next = parsePairPayload(repaired);
        if (!next) throw new Error("转换结果无法解析为中英双份，请重试");
        pair = next;
    }

    assertPairReady(pair, required);
    return pair;
}

/**
 * Sync one language side of an H3 pair to the other (structure + @ tags preserved).
 * Typical flow: user edits Chinese for review → syncZhToEn → submit English.
 */
export async function translateMinimaxH3Prompt(input: {
    source: string;
    from: MinimaxH3Lang;
    to: MinimaxH3Lang;
    textModel: string;
    required?: string[];
    signal?: AbortSignal;
}) {
    const source = normalizeMinimaxH3SlotMentions(String(input.source || "").trim());
    if (!source) throw new Error("没有可同步的提示词");
    if (!String(input.textModel || "").trim()) throw new Error("请先在设置里选择文本模型");
    if (input.from === input.to) return source;

    const required = input.required?.length ? input.required : collectSlotMentions(source);
    const targetLabel = input.to === "en" ? "英文" : "中文";
    const sourceLabel = input.from === "en" ? "英文" : "中文";
    const raw = await requestH3Text({
        model: input.textModel,
        prompt: [
            `将下面这份 MiniMax H3 Ref2VA 六段提示词从${sourceLabel}同步成${targetLabel}。`,
            "保持字段名英文、段落顺序、镜头标记、@图片N/@视频N/@音频N 编号完全一致。",
            "只改说明语言。对白、旁白、口播、歌词禁止翻译，英文稿引号里的台词必须仍是原文原句，且对白原句仍只在 overall_soundscape。",
            H3_NO_SUBTITLE_RULE,
            "不要增减剧情事实；不要输出另一语言版本；不要分隔符与解释。",
            required.length ? `必须保留的引用：${required.join("、")}` : "",
            "",
            "原文：",
            source,
        ]
            .filter(Boolean)
            .join("\n"),
        signal: input.signal,
        temperature: 0.1,
    });
    const result = normalizeMinimaxH3SlotMentions(stripFence(raw));
    if (!result) throw new Error(`同步${targetLabel}失败：模型没有返回内容`);
    const missing = missingMentions(result, required);
    if (missing.length) throw new Error(`同步${targetLabel}后丢失了参考引用：${missing.join("、")}`);
    if (!looksLikeRef2Va(result)) throw new Error(`同步${targetLabel}结果不符合官方六段结构，请重试`);
    return result;
}

/** Prefer English H3 for API submit when a converted pair exists. */
export function submitPromptForMinimaxH3(pair: MinimaxH3PromptPair | null | undefined, fallback: string) {
    const en = pair?.en?.trim();
    if (en) return en;
    return String(fallback || "").trim();
}
