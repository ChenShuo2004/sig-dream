import type { StudioAppearance, StudioAsset, StudioClip } from "../types";
import type { ScriptPromptMode } from "./document";

const text = (value: unknown) => String(value ?? "").trim();
const sentence = (value: unknown) => (text(value) && !/[。！？.!?]$/u.test(text(value)) ? `${text(value)}。` : text(value));
const CLIP_CONSTRAINTS = "按下方分镜描述呈现画面、镜头和声音；人物身份与已绑定形象保持一致，表情、动作、站位与持物按具体镜头呈现；不添加未描述的人物、画面文字或声音。";

const SPATIAL_CONTINUITY_LINES = [
    "场景空间连续性参考锚点：同一连续时空内，除非剧情通过可见事件明确改变，场景参考图中的建筑、家具、出入口、固定地标和光线方向的相对关系保持连续；镜头变化只改变观察方式，不得整体镜像或重排世界空间布局。",
    "人物空间连续性：人物站位优先用场景固定地标或主体相对关系描述，画面左/右只作当前机位补充；位置、朝向、视线与动作方向、左右手持物和动作落点按时间轴连续变化，换位或持物变化必须通过可观察动作完成，不得瞬移或无动作位置重置；不得在无人移动时对调人物相对场景地标的世界位置，仅由机位变化产生的屏幕左右变化不算换位。除非剧情通过可见事件明确改变，人物面部、发型和服装沿用已选参考形象。",
];

export type ClipMaterial = {
    assetId: string;
    appearanceId: string;
    asset: StudioAsset;
    appearance?: StudioAppearance;
    mention: string;
    alias: string;
    purpose: string;
    kind: StudioAsset["kind"];
    shotNumbers: number[];
    literalDefinition: string;
    scope: string;
    line: string;
};

function seedanceCharacterDefinition(mention: string, alias: string) {
    return `将 ${mention} 中的主要人物定义为剧中的${alias}。面部、发型、服装和体型以该参考图为准；\n表情、动作和站位按下方分镜执行。`;
}

function seedanceSound(sound: string) {
    return (String(sound).match(/<[^<>]+>|（[^（）]+）|\([^()]+\)|[^，,；;\n]+/gu) || [])
        .map((part) => part.trim().replace(/[。]+$/u, ""))
        .filter((part) => part && !/^(?:无|没有|不添加|不要)(?:背景音乐|配乐|音效)?$/u.test(part))
        .map((part) =>
            /^（[^（）]+）$/u.test(part) ? `(${part.slice(1, -1)})` : /^(?:<[^<>]+>|\([^()]+\))$/u.test(part) ? part : /背景音乐|配乐|\bBGM\b/iu.test(part) ? `(${part})` : `<${part}>`,
        )
        .join("\n");
}

function shotHeading(mode: ScriptPromptMode, index: number, start: number, end: number, camera: string) {
    return mode === "seedance-2.0" ? `镜头${index + 1}（${start}-${end}秒）：【${text(camera).replace(/[。]+$/u, "") || "拍摄方式待确认"}】` : `${start}-${end}秒：`;
}

function visualFields(mode: ScriptPromptMode, camera: string, picture: string, sound: string) {
    return [
        mode !== "seedance-2.0" && text(camera) ? `镜头：${text(camera).replace(/[。]+$/u, "")}。` : "",
        text(picture) ? `拍摄内容：${text(picture)}` : "",
        text(sound) && text(sound) !== "无" ? seedanceSound(sound) : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export type SpeechTurn = { header: string; text: string };

/** Split "说话人：台词" lines into turns; lines without a speaker continue the previous turn. */
export function speechTurns(value: string, assets: StudioAsset[]): SpeechTurn[] {
    const names = assets.filter((asset) => asset.kind === "character").map((asset) => asset.name);
    const turns: SpeechTurn[] = [];
    for (const raw of String(value || "").split(/\n+/)) {
        const line = raw.trim();
        if (!line) continue;
        const match = line.match(/^([^：:“”"{}]{1,24})[：:]\s*([\s\S]+)$/u);
        const header = match?.[1]?.trim() || "";
        if (match && (names.includes(header.replace(/[（(].*$/u, "")) || header.length <= 12)) {
            turns.push({ header, text: stripQuotes(match[2]) });
        } else if (turns.length) {
            turns[turns.length - 1].text += stripQuotes(line);
        } else {
            turns.push({ header: "", text: stripQuotes(line) });
        }
    }
    return turns;
}

function stripQuotes(value: string) {
    return value.trim().replace(/^[“"]([\s\S]*)[”"]$/u, "$1");
}

function seedanceSpeech(speaker: string, kind: "dialogue" | "voiceover", content: string, mode: ScriptPromptMode, start: number, end: number) {
    const range = kind === "voiceover" && mode === "seedance-2.5" ? `（本片段${start}-${end}秒）` : "";
    const verb = kind === "voiceover" ? (/^(?:旁白|画外音|解说)$/u.test(speaker) ? "" : "画外音") : "说";
    return `${range}${speaker || "说话人"}${verb}：{${content}}`;
}

function speechLines(value: string, kind: "dialogue" | "voiceover", assets: StudioAsset[], mode: ScriptPromptMode, start: number, end: number) {
    if (!text(value)) return [];
    return speechTurns(value, assets).map((turn) => {
        const narrated = turn.header.match(/^(?:旁白|内心独白|独白|解说|画外音)[（(](.+)[）)]$/u);
        const speaker = (narrated?.[1] || turn.header).replace(/\(([^()]*)\)/gu, "（$1）");
        return seedanceSpeech(speaker, kind, turn.text, mode, start, end);
    });
}

export function resolveClipAppearance(clip: StudioClip, asset: StudioAsset) {
    const chosen = clip.appearanceRefs?.[asset.id];
    const preferred = chosen ? asset.appearances.find((item) => item.id === chosen) : undefined;
    if (preferred?.imageKey) return preferred;
    return asset.appearances.find((item) => item.imageKey) || preferred || asset.appearances[0];
}

/** Prefer an appearance that already has an uploaded/generated image. */
export function appearanceWithImage(asset: StudioAsset, appearanceId?: string) {
    const preferred = appearanceId ? asset.appearances.find((item) => item.id === appearanceId) : undefined;
    if (preferred?.imageKey) return preferred;
    return asset.appearances.find((item) => item.imageKey) || preferred || asset.appearances[0];
}

export function clipMissingImageAssets(clip: StudioClip, assets: StudioAsset[]) {
    return clip.assetRefs
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is StudioAsset => Boolean(asset))
        .filter((asset) => !appearanceWithImage(asset, clip.appearanceRefs?.[asset.id])?.imageKey);
}

/** Point each bound asset at an appearance that has an image when possible. */
export function bindClipAppearanceRefs(clip: StudioClip, assets: StudioAsset[]): StudioClip {
    const appearanceRefs = { ...(clip.appearanceRefs || {}) };
    for (const assetId of clip.assetRefs) {
        const asset = assets.find((item) => item.id === assetId);
        if (!asset) continue;
        const look = appearanceWithImage(asset, appearanceRefs[assetId]);
        if (look?.id) appearanceRefs[assetId] = look.id;
    }
    return { ...clip, appearanceRefs };
}

const KIND_ZH: Record<StudioAsset["kind"], string> = { character: "角色", scene: "场景", prop: "道具" };

/** Hard gate before video gen: bound character/scene/prop must already have images. */
export function assertClipReadyForVideo(clip: StudioClip, assets: StudioAsset[]) {
    if (!clip.assetRefs.length) throw new Error("请先为本片段绑定要用到的角色、场景或道具。");
    const missing = clipMissingImageAssets(clip, assets);
    if (missing.length) {
        throw new Error(`请先生成或上传参考图后再生成视频：${missing.map((asset) => `${KIND_ZH[asset.kind]}「${asset.name}」`).join("、")}`);
    }
}

/** Max reference images for Minimax_H3 face AI App (matches video workbench / LoadImage slots). */
export const H3_FACE_MAX_REF_IMAGES = 9;

/** Rewrite @角色/场景/道具名 → @图片N in the same order images are uploaded (视频创作台对齐). */
export function compileClipPromptToImageIndexes(prompt: string, materials: ClipMaterial[]) {
    let text = prompt;
    const labeled = materials.map((material, index) => ({ material, index, label: `@图片${index + 1}` }));
    // Longest mention first so「@李云东 · 日常装束」不会被短的「@李云东」截断替换。
    for (const { material, label } of [...labeled].sort((a, b) => b.material.mention.length - a.material.mention.length)) {
        if (material.mention) text = text.split(material.mention).join(label);
    }
    for (const { material, label } of [...labeled].sort((a, b) => b.material.asset.name.length - a.material.asset.name.length)) {
        const bare = `@${material.asset.name}`;
        if (bare && bare !== material.mention) text = text.split(bare).join(label);
    }
    return text;
}

export function collectClipMaterials(clip: StudioClip, assets: StudioAsset[]): ClipMaterial[] {
    const byAsset = new Map<string, number>();
    const materials: ClipMaterial[] = [];
    for (const assetId of clip.assetRefs) {
        const asset = assets.find((item) => item.id === assetId);
        if (!asset) continue;
        const appearance = resolveClipAppearance(clip, asset);
        const name = text(asset.name) || asset.id;
        const appearanceName = asset.appearances.length > 1 ? text(appearance?.name) : "";
        const alias = asset.kind !== "character" && asset.appearances.length > 1 && appearanceName ? `${name}（${appearanceName}）` : name;
        const description = text(appearance?.description);
        const literalDefinition = description ? `外观与状态：${sentence(description)}` : "";
        const purpose = asset.kind === "character" ? "角色" : asset.kind === "scene" ? "参考场景" : "参考道具";
        const mention = `@${name}${appearanceName ? ` · ${appearanceName}` : ""}`;
        byAsset.set(asset.id, (byAsset.get(asset.id) || 0) + 1);
        materials.push({
            assetId: asset.id,
            appearanceId: appearance?.id || "",
            asset,
            appearance,
            mention,
            alias,
            purpose,
            kind: asset.kind,
            shotNumbers: clip.shots.map((_, index) => index + 1),
            literalDefinition,
            scope: "",
            line: `将 ${mention} ${asset.kind === "character" ? "中的角色定义为剧中的" : "定义为"}${alias}${asset.kind === "character" ? "" : `的${purpose}`}。${literalDefinition}`,
        });
    }
    return materials;
}

function applyMaterials(body: string, materials: ClipMaterial[], mode: ScriptPromptMode, visualStyle: string, spokenLiterals: string[], constraints: string) {
    const sorted = [...materials].sort((a, b) => b.mention.length - a.mention.length);
    let prefix = "story-spoken-literal-";
    while (body.includes(prefix)) prefix += "x";
    const literals = [...new Set(spokenLiterals.filter(Boolean))].sort((a, b) => b.length - a.length).map((literal, index) => ({ literal, token: `${prefix}${index}` }));
    let protectedBody = body;
    for (const { literal, token } of literals) protectedBody = protectedBody.split(literal).join(token);
    let replaced = protectedBody
        .split("\n")
        .map((line) =>
            line.startsWith("画面文字：")
                ? line
                : line
                      .split(/(“[^”]*”|\{[^{}]*\})/u)
                      .map((part, index) => (index % 2 ? part : sorted.reduce((current, material) => current.split(material.mention).join(material.alias), part)))
                      .join(""),
        )
        .join("\n");
    for (const { literal, token } of literals) replaced = replaced.split(token).join(literal);

    if (mode === "seedance-2.0") {
        const definitions = materials.map((material) =>
            material.kind === "character"
                ? seedanceCharacterDefinition(material.mention, material.alias) + material.scope + material.literalDefinition
                : `${material.mention} 是${material.alias}的${material.purpose}${material.scope ? `，${material.scope.replace(/[。]+$/u, "")}` : ""}${material.literalDefinition ? `。${material.literalDefinition}` : ""}`,
        );
        return [
            definitions.length ? `素材：${definitions.map((line) => line.replace(/。$/u, "")).join("；\n")}。` : "",
            `风格一致性：${text(visualStyle) ? `${text(visualStyle)} ` : ""}保持同场景的色调、光影和角色造型一致。`,
            "",
            replaced,
        ]
            .filter((line, index) => line || index > 1)
            .join("\n")
            .trim();
    }
    return [
        "【统一风格与约束】",
        ...(text(visualStyle) ? [text(visualStyle)] : []),
        constraints,
        "",
        "【参考素材】",
        ...materials.map((material) => (material.kind === "character" ? seedanceCharacterDefinition(material.mention, material.alias) + material.scope + material.literalDefinition : material.line)),
        "",
        replaced,
    ].join("\n");
}

export function buildClipVideoPrompt({ clip, assets, promptMode, visualStyle, constraints = CLIP_CONSTRAINTS }: { clip: StudioClip; assets: StudioAsset[]; promptMode: ScriptPromptMode; visualStyle: string; constraints?: string }) {
    const materials = collectClipMaterials(clip, assets);
    const header = promptMode === "seedance-2.5" ? SPATIAL_CONTINUITY_LINES : [];
    let cursor = 0;
    const shots = clip.shots.map((shot, index) => {
        const start = cursor;
        const end = Number((start + (Number(shot.duration) || 0)).toFixed(6));
        cursor = end;
        const lines = [
            visualFields(promptMode, shot.camera, shot.visual, shot.audio),
            ...speechLines(shot.dialogue, "dialogue", assets, promptMode, start, end),
            ...speechLines(shot.voiceover, "voiceover", assets, promptMode, start, end),
        ]
            .filter(Boolean)
            .join("\n");
        return `${shotHeading(promptMode, index, start, end, shot.camera)}\n${lines}`;
    });
    const body = [...header, shots.join("\n\n")].filter(Boolean).join("\n\n");
    const spoken = clip.shots.flatMap((shot) => [shot.dialogue, shot.voiceover].flatMap((value) => speechTurns(value, assets).map((turn) => turn.text)));
    return applyMaterials(body, materials, promptMode, visualStyle, spoken, constraints);
}
