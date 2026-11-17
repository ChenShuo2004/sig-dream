// SHUO 复刻工作室原文提示词（来自其前端代码中的模板函数与常量，参数位置按原实现拼接）；生成文件之外的部分集中放在这里。
import { REPLICATION_PROMPTS } from "./replication.generated";

const R = REPLICATION_PROMPTS.rules;

export type ReplicationContentType = "story" | "narrated_story" | "advertisement" | "unknown";
export const REPLICATION_CONTENT_TYPES: ReplicationContentType[] = ["story", "narrated_story", "advertisement", "unknown"];
export const normalizeContentType = (value: unknown): ReplicationContentType => (REPLICATION_CONTENT_TYPES.includes(value as ReplicationContentType) ? (value as ReplicationContentType) : "unknown");

export const REPLICATION_CHARACTER_ROLES = { main: "主角", supporting: "配角", background: "背景人物", uncertain: "待确认" } as const;
export const REPLICATION_SUBJECT_TYPES = { person: "人物", animal: "动物", uncertain: "待确认" } as const;
export const REPLICATION_VOICEOVER_KINDS = { narration: "解说／旁白", inner_monologue: "内心独白", uncertain: "类型待核对" } as const;

const NARRATIVE_ROUTE =
    "剧情模板：重点还原人物动作、表情、镜头与人物关系。textElements 的 physical/graphic 只记录当前画面实际物体文字或独立叙事图文；对白/旁白的转录字幕归 speech_subtitle 证据条目，不进入画面生成指令，也不塞入 visual/camera。人声仍完整输出一次。独立站位设定仅用于相邻片段的同场连续衔接，不逐句对白或逐镜重复；换场、时间跳跃及空镜/静物不套站位。";
const ROUTE_RULES: Record<ReplicationContentType, string> = {
    story: `${NARRATIVE_ROUTE}人物对白放在对应镜头，不根据剧情类型删掉实际存在的画外音。`,
    narrated_story: `${NARRATIVE_ROUTE}画外音保留独立起止，跨镜只在起始镜头写一次；不能把解说说到的事情编成当前画面。`,
    advertisement:
        "广告模板：还原产品展示、构图、运镜、光影与演示动作；画面文案及字幕原文保存在 textElements 观察证据，不改写品牌或宣传文案。产品位置、朝向和变化写入画面，不套人物起始/结束状态表。有人物的连续表演需要站位时才填写空间关系数组。原人声照常独立输出。",
    unknown: "类型未确定：保留已观察画面、镜头和人声，画面文字与转录字幕分别记录，不猜成广告或故事；不输出转录字幕生成指令，不追加识别请求、不阻断交付，供用户核对。",
};

export function replicationRoutePolicy(value: unknown) {
    const contentType = normalizeContentType(value);
    return {
        contentType,
        includeSpeechSubtitles: false,
        instruction:
            ROUTE_RULES[contentType] +
            (contentType === "advertisement"
                ? "仅将已观察到的 graphic 广告设计文案按原文、承载位置写入对应镜头的画面文字；物体文字、人物介绍和人声转录字幕仍只保存在 textElements 证据，不混入 visual/camera；人声原文照常保留。"
                : "生成提示词不呈现画面文字：字幕、人物介绍、物体文字与广告文案均只保存在 textElements 证据，不进入 visual/camera 或其他生成正文；人声原文照常保留。"),
    };
}

export function replicationTargetStyleInstruction(style: string) {
    return style
        ? `目标视觉风格：${style}\n仅将画面媒介、色调、光影表现和材质渲染调整为目标风格；原片记录中的视觉风格只用于理解来源，不作为生成风格。保留人物身份、服饰与道具形制、故事年代、场景布局、光源位置和昼夜、动作、摄影方向、对白、镜头顺序及已有时长；不因风格名称新增或改写剧情。同场景与跨片段统一使用目标风格。`
        : "";
}

export function buildAudioLanguageRule(targetLocale: string, sourceLanguage: string) {
    if (!targetLocale) return "";
    const language = targetLocale === "source" ? `原片语言${sourceLanguage ? `（${sourceLanguage}）` : ""}，保留原对白语言，不猜测未知语种` : targetLocale;
    return `复刻声音语言规则：对白及其括号内的语气、情绪、音量、语速、说话方式描述，旁白/画外音，以及音效与声音描述，统一使用${language}。此规则优先于通用提示词模式中的中文声音/对白要求；dialogue/q、voiceover/o、audio/a 均须遵守。已翻译的台词保留原意、完整信息、说话顺序和说话人，不得擅自改变目标语种或混入其他语言；不得把语气说明读成台词。人物姓名、素材引用、字段名与时间标记保持原样；画面 visual/v、动作、场景和运镜 camera/c 继续使用中文。没有的声音不补写。译后对白沿用既定时间轴，无法自然容纳时指出疑点，不自行改时长、不加速硬塞。`;
}

export const REPLICATION_REFERENCES_RULE = "assetUsages 只引用素材清单中实际可见的人物、场景和道具及其 appearanceRef；仅被提及的人物不算出镜。正文不写 @、URL、图片编号或内部 ID，最终素材声明与时间轴格式由编译器生成。";

export function isContinuousTimelineMode(promptMode: string) {
    return promptMode === "seedance-2.5";
}

export function replicationGenerationSystemPrompt() {
    return [REPLICATION_PROMPTS.generationSystemPrompt, R.VIDEO_REPLICATION_AUDIO_LANGUAGE_SYSTEM_RULE].join("\n");
}

export function replicationGenerationRequirements({ promptMode, targetStyle, prepared }: { promptMode: string; targetStyle: string; prepared: boolean }) {
    const continuous = isContinuousTimelineMode(promptMode);
    return [
        "逐个返回 segmentPlan 中的片段，ref 原样保留；s 使用 scenes.code，可在同一 clip 中通过各 shot.assetUsages 绑定不同场景。原片证据只在 sourceVideoEvidence 中出现，摘要和素材描述不能补写人声。",
        "contentType 沿用 promptRoute.contentType 并执行对应模板。若为 unknown，在本次生成中根据现有原片观察证据为全片选择 availableRoutes 中最符合的类型，并返回 contentType，不重做识别；仍不确定则 unknown，继续交付。广告不能只因出现商品而判定。",
        R.REPLICATION_SHOOTING_CONTENT_RULE,
        R.REPLICATION_DIRECTION_RULE,
        targetStyle ? `${replicationTargetStyleInstruction(targetStyle)} sceneVisualStyle 填写目标风格，同一 sceneKey 与跨片段文字一致。` : R.REPLICATION_SCENE_STYLE_RULE,
        R.REPLICATION_CAMERA_RULE,
        R.REPLICATION_SPEECH_OUTPUT_RULE,
        REPLICATION_REFERENCES_RULE,
        R.REPLICATION_ORIENTATION_PRESERVATION_RULE,
        R.REPLICATION_VISUAL_ELEMENTS_RULE,
        R.REPLICATION_VISUAL_STATE_RULE,
        "字段职责：shootingContent 只写拍摄主体、动作、表情和场景关系，c 写摄影，textElements 写有用途分类和承载位置的文字，spatialStart/spatialEnd 写边界空间关系，q/o 写人声，a 写环境声音及画外音时间。来源旧文字字段仅是观察证据，不能照抄为新的分类条目；按其实际用途拆分。场戏、镜头和片段边界不得改动，空间关系只使用对应边界有依据的信息。",
        "原片已识别的人声全部保留，包括存疑的字和[听不清]占位。错字与说话人疑点留给用户修改，不因 uncertain 删除、概括或擅自改写台词；局部占位不得吞掉前后文字。",
        ...(prepared ? ["episode.preparedScript 是已确认的目标语言正文，沿用其中的译文和人物对应；来源只用于核对声音类型、顺序、画面与时间，不把已确认译文重新翻译。"] : []),
        R.REPLICATION_SOURCE_CUT_RULE,
        continuous ? R.REPLICATION_TIMING_RULE : "镜头 durationSec/d 使用当前模式允许的秒数，按顺序合计等于计划 durationSec，不重新估算动作时长。",
        "shootingContent 与 camera/c 使用简体中文；声音使用 adaptation.targetLocale 指定语言。shootingContent 与 c 分工保留来源逐镜记录中有助于还原的具体信息，不把动作过程缩成‘交谈、递东西、离开’等结果摘要；a 仅写有依据的声音。不写创作解释、审片结论或重复素材外观。来源细节不足时如实沿用，不靠扩写编造，直接交给用户编辑。",
    ];
}

export function replicationOutputFormat(promptMode: string, targetStyle: string) {
    const continuous = isContinuousTimelineMode(promptMode);
    return `{"contentType":"story/narrated_story/advertisement/unknown","clips":[{"ref":"计划ref","s":"scenes.code","creativeIntent":"本片段希望观众感受到的情绪、氛围和节奏","durationSec":计划秒数,"shots":[{"d":镜头秒数,${continuous ? `"startSec":局部起秒,"endSec":局部止秒,` : ""}"sourceShotId":"对应来源镜头id","shootingContent":"具体主体、动作、表情、环境与道具关系","c":"摄影","sceneKey":"场戏标识","sceneVisualStyle":"${targetStyle ? "所选目标统一视觉风格" : "原片场戏统一氛围、色调和光影"}","textElements":[],"spatialStart":[],"spatialEnd":[],"q":"人物对白","o":"画外音","a":"环境声音及画外音时间","assetUsages":[{"assetRef":"素材ref","appearanceRef":"形象ref"}]}]}]}`;
}

export function replicationVisualSchema() {
    const string = { type: "string" };
    const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
    const spatial = object(Object.fromEntries(["subject", "landmark", "relation", "facing", "pose", "heldObject"].map((key) => [key, string])));
    return {
        sceneKey: string,
        textElements: { type: "array", items: object({ kind: { type: "string", enum: ["physical", "graphic", "speech_subtitle", "uncertain"] }, text: string, carrier: string, placement: string }) },
        spatialStart: { type: "array", items: spatial },
        spatialEnd: { type: "array", items: spatial },
    };
}

export const REPLICATION_SHOT_OUTPUT_TAIL = "；复刻片段保留 creativeIntent，shots 还须原样保留 sourceShotId、shootingContent、sceneKey、sceneVisualStyle、textElements、spatialStart、spatialEnd。";

export function replicationReviewSystemPrompt({ repair, promptMode, audioLanguage }: { repair: boolean; promptMode: string; audioLanguage: string }) {
    return [
        repair ? "你是原片分镜的局部纠错员。只修指定问题，返回严格 JSON。" : "你在核对已识别的原片证据和候选分镜，未提供原视频时不声称回看。只返回严格 JSON。",
        R.REPLICATION_ORIENTATION_PRESERVATION_RULE,
        R.REPLICATION_ORIENTATION_REVIEW_RULE,
        R.REPLICATION_CONTENT_RULE,
        R.REPLICATION_TIMELINE_RULE,
        R.REPLICATION_SOURCE_CUT_RULE,
        ...(isContinuousTimelineMode(promptMode) ? [R.REPLICATION_TIMING_RULE] : []),
        ...(audioLanguage ? [audioLanguage] : []),
    ].join("\n");
}

export function replicationReviewCriteria() {
    return [
        "对照来源逐句检查人声重复、遗漏、说话人、类型与穿插顺序，再检查画面和资产对应，最后检查切点与固定片段时长。",
        R.REPLICATION_VISUAL_RULE,
        R.REPLICATION_SPEECH_OUTPUT_RULE,
        "原片旁白可覆盖多个镜头，不要求每个镜头重复台词，也不按单镜字数强制延长或新增片段。不按景别词数量机械拆镜，以原片记录的切点为依据。",
        "只点名有证据的问题，引用具体 clip、shot 或事件编号。对来源本身的疑点标记需核对，不能假称重新看过视频或凭剧情纠正转写。",
        "每个输入片段返回一次 pass/repair，问题 reason 和 repairInstruction 各不超过80字。",
    ];
}

export function replicationRepairInstruction() {
    return [
        "只返回 failedClips 的修补，每个 sourceClipRef 恰好一个同 ref 的 clip。lockedTiming 固定原片起止、修补总时长及 shotBoundaries 中的已有切点；仅 ASR 末尾未覆盖时，总时长补至该句结束。允许按原片补充切点，但不能删除或移动已有切点。",
        R.REPLICATION_VISUAL_RULE,
        R.REPLICATION_SPEECH_OUTPUT_RULE,
        REPLICATION_REFERENCES_RULE,
        R.REPLICATION_ORIENTATION_PRESERVATION_RULE,
        R.REPLICATION_ORIENTATION_REVIEW_RULE,
        "只修改 issues 指出的字段。未涉及的台词、声音类型、顺序和时间保持；相邻片段只读。已有镜头可按原片证据补切点，不能移动其他切点。无法确定的保留原候选，不能造内容通过校验。",
    ];
}

export function replicationEvidenceInstructions() {
    return (
        "直接依据 events 的原片时间线编排，正文仅辅助理解；按 characterBindings 替换人物，并处理对白语言。保留人物关系、事件顺序、关键动作、场景、道具、冲突和结局，不确定项不得猜测为事实。targetLocale 为 source 时保留原语言和原对白；其他语言逐句翻译，保持原意、信息量、语气、顺序和说话人对应。每句人声放在开始发声的镜头，跨镜保留一次及声音时间，后镜无需延续标记。按已确定的 segmentPlan 保留片段范围和时长，不重新规划。" +
        R.REPLICATION_VISUAL_ELEMENTS_RULE +
        R.REPLICATION_VISUAL_STATE_RULE +
        R.REPLICATION_IMAGE_APPEARANCE_GUIDANCE
    );
}

export { REPLICATION_PROMPTS };
