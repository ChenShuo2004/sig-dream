import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Input, Popconfirm } from "antd";
import { Download, ImagePlus, Music, Plus, Sparkles, Trash2, Upload, UserRound, Wand2, X } from "lucide-react";
import { nanoid } from "nanoid";

import { cn } from "@/lib/utils";
import { assetCoverUrl, useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { getStudioMediaBlob, saveStudioMedia } from "@/studios/media";
import { createCharacter, type ReplacementAppearance, type ReplacementAudio, type ReplacementCharacter, type ReplacementIdentity, type ReplacementStudioDocument } from "@/studios/replacement/document";
import { audioDuration, buildIdentityThreeViewPrompt, characterAssetPromptPresets, downloadBlob, extensionOf, isThreeViewPreset, type CharacterAssetPreset } from "@/studios/replacement/stages";

import { StudioAudio, StudioImage } from "./media";
import { DarkButton, EmptyHint, IconButton, ModelSelect, Pager, QUALITY_OPTIONS, RATIO_OPTIONS, SmallSelect, StatusBadge, Tabs } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

type Tab = "character" | "scene" | "audio" | "library";

/** Middle character cards: fixed size so 4 columns always fit. */
const CHARACTER_CARD_WIDTH = 168;
const CHARACTER_IMAGE_HEIGHT = 156;
const CHARACTER_GRID_GAP = 8;
/** Middle column base = 4 cards + 3 gaps; grows by taking 10% of former right-side remainder. */
const MIDDLE_COLUMN_WIDTH = CHARACTER_CARD_WIDTH * 4 + CHARACTER_GRID_GAP * 3;
/** Left: 2-col identity cards; keep narrow so middle can stay 4-wide. */
const IDENTITY_COLUMN_WIDTH = 200;
const IDENTITY_GRID_GAP = 6;
const CHARACTER_DRAG_MIME = "text/x-replacement-character";
const CHARACTER_PRESETS = characterAssetPromptPresets();

/** SHUO preset template: "{用户输入 || 默认}" takes the user's text or falls back to the default. */
function applyPreset(preset: CharacterAssetPreset | undefined, input: string) {
    const template = preset?.template;
    if (!template) return input;
    return template.text.replace(/\{用户输入\s*\|\|\s*([^}]*)\}/u, (_, fallback: string) => input.trim() || fallback.trim());
}

export function pickFiles(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => onFiles([...(input.files || [])]);
    input.click();
}

export function removeCharacterFrom(current: ReplacementStudioDocument, ids: string[]): ReplacementStudioDocument {
    const gone = new Set(ids);
    return {
        ...current,
        characters: current.characters.filter((item) => !gone.has(item.id)),
        identities: current.identities.map((identity) => (gone.has(identity.targetCharacterId) ? { ...identity, targetCharacterId: "" } : identity)),
        lines: current.lines.map((line) => (line.characterId && gone.has(line.characterId) ? { ...line, characterId: "" } : line)),
        shots: current.shots.map((shot) => ({ ...shot, sceneId: gone.has(shot.sceneId) ? "" : shot.sceneId, persons: shot.persons.map((person) => (gone.has(person.targetCharacterId) ? { ...person, targetCharacterId: "", targetAppearanceId: undefined } : person)) })),
    };
}

type GenerateNewOptions = {
    prompt: string;
    model?: string;
    quality?: string;
    ratio?: string;
    referenceKeys?: string[];
    sourceName?: string;
};

/** Unified generation container + bottom preview (identity / character card / generated result). */
function GenerationBar({
    document,
    runner,
    character,
    prompt,
    onPromptChange,
    referenceKeys,
    onReferenceKeysChange,
    characters,
    previewKey,
    generating,
    onGenerateNew,
}: {
    document: ReplacementStudioDocument;
    runner: ReplacementRunner;
    character: ReplacementCharacter;
    prompt: string;
    onPromptChange: (value: string) => void;
    referenceKeys: string[];
    onReferenceKeysChange: (keys: string[]) => void;
    characters: ReplacementCharacter[];
    previewKey: string;
    generating: boolean;
    onGenerateNew: (options: GenerateNewOptions) => void;
}) {
    const [preset, setPreset] = useState(character.kind === "character" ? "character-three-view-face-only" : "none");
    const [model, setModel] = useState(document.settings.imageModel);
    const [quality, setQuality] = useState(document.settings.imageQuality || "auto");
    // 无脸三视图设定板为横版，默认 16:9
    const [ratio, setRatio] = useState(character.kind === "scene" || character.kind === "character" ? "16:9" : "3:4");
    const [dragOver, setDragOver] = useState(false);
    const running = generating || character.imageStatus === "running";

    const onPresetChange = (next: string) => {
        setPreset(next);
        if (next === "character-three-view-face-only") setRatio("16:9");
    };

    const addReferenceKey = (key: string) => {
        if (!key || referenceKeys.includes(key)) return;
        onReferenceKeysChange([...referenceKeys, key]);
    };

    const dropCharacterAsReference = (characterId: string) => {
        const source = characters.find((item) => item.id === characterId);
        if (!source) return;
        const look = source.appearances.find((item) => item.id === source.baseAppearanceId) || source.appearances[0];
        if (!look?.imageKey) return runner.log("该人物形象还没有图片，无法作为参考", "warn");
        addReferenceKey(look.imageKey);
    };

    const uploadReference = () =>
        pickFiles("image/*", true, async (files) => {
            for (const file of files) addReferenceKey(await saveStudioMedia(file, "image"));
        });

    const generate = () => {
        const chosen = CHARACTER_PRESETS.find((item) => item.id === preset);
        // 无脸三视图：编辑框可空（模板有服饰兜底），但需提示词或参考图至少其一
        const faceOnly = preset === "character-three-view-face-only";
        if (!prompt.trim() && !referenceKeys.length) {
            return runner.log(faceOnly ? "请填写服饰与头饰，或上传/拖入参考图" : chosen?.template?.emptyInputMessage || "请先填写形象描述", "warn");
        }
        if (!faceOnly && chosen?.template?.requireInput && !prompt.trim()) return runner.log(chosen.template.emptyInputMessage || "请先填写形象描述", "warn");
        const finalPrompt = isThreeViewPreset(preset)
            ? buildIdentityThreeViewPrompt(preset, prompt, referenceKeys.length > 0)
            : applyPreset(chosen, prompt);
        // Always create a new character card — do not append under the currently selected one.
        onGenerateNew({
            prompt: finalPrompt,
            model,
            quality,
            ratio,
            referenceKeys: referenceKeys.length ? referenceKeys : undefined,
            sourceName: character.name,
        });
    };

    return (
        <div
            className={cn("flex h-full min-h-0 flex-col gap-2 rounded-xl border bg-[#1b1b1e] p-2.5 transition", dragOver ? "border-white/50 bg-white/[0.06]" : "border-white/[0.08]")}
            onDragOver={(event) => {
                if (![...event.dataTransfer.types].includes(CHARACTER_DRAG_MIME)) return;
                event.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const id = event.dataTransfer.getData(CHARACTER_DRAG_MIME);
                if (id) dropCharacterAsReference(id);
            }}
        >
            <label className="flex shrink-0 flex-col gap-1">
                <span className="text-[10px] text-neutral-400">
                    {preset === "character-three-view-face-only" ? "服饰与头饰（写入设定板，默认模板不显示）" : "生图提示词"}
                </span>
                <Input.TextArea
                    variant="filled"
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    placeholder={
                        character.kind === "scene"
                            ? "描述要替换成的场景"
                            : preset === "character-three-view-face-only"
                              ? "例如：白色蕾丝婚纱，金色凤冠与长流苏，红色披衣…"
                              : "描述人物形象，例如：短发、白衬衫的年轻女性"
                    }
                    className="!rounded-lg !border !border-white/15 !bg-black/35 !px-2.5 !py-2 !text-xs !leading-5 !text-neutral-100"
                />
            </label>

            <div className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-dashed border-white/15 bg-black/20 p-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-400">参考图（拖入人物卡或上传）</span>
                    <DarkButton size="sm" className="ml-auto !h-6 !px-2 !text-[10px]" onClick={uploadReference}>
                        <Upload className="size-3" />
                        上传参考图
                    </DarkButton>
                </div>
                {referenceKeys.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {referenceKeys.map((key, index) => (
                            <div key={key} className="relative size-14 overflow-hidden rounded-md ring-1 ring-white/20">
                                <StudioImage mediaKey={key} fit="cover" className="size-full" />
                                <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] text-white">图{index + 1}</span>
                                <button
                                    type="button"
                                    className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500"
                                    onClick={() => onReferenceKeysChange(referenceKeys.filter((item) => item !== key))}
                                    aria-label="移除参考图"
                                >
                                    <X className="size-2.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-center text-[10px] leading-4 text-neutral-500">{dragOver ? "松开以添加为参考图" : "从中间栏拖入人物形象卡，或点击上方上传"}</p>
                )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <SmallSelect value={preset} onChange={onPresetChange} options={CHARACTER_PRESETS.map((item) => ({ value: item.id, label: item.label }))} />
                <ModelSelect capability="image" value={model} onChange={setModel} placeholder="图片模型" />
                <SmallSelect value={quality} onChange={setQuality} options={QUALITY_OPTIONS} />
                <SmallSelect value={ratio} onChange={setRatio} options={RATIO_OPTIONS} className="!min-w-[72px]" />
                <DarkButton tone="primary" size="sm" className="ml-auto" disabled={Boolean(runner.busy) || !prompt.trim()} onClick={generate}>
                    <Sparkles className="size-3.5" />
                    {running ? "生成中…" : "生成形象"}
                </DarkButton>
            </div>
            {character.imageError ? <p className="shrink-0 text-xs text-red-300">{character.imageError}</p> : null}

            <div className="relative mt-0.5 min-h-0 flex-1 overflow-hidden rounded-lg border border-white/[0.08] bg-black">
                {running ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
                        <StatusBadge status="running" />
                    </div>
                ) : null}
                {previewKey ? (
                    <StudioImage mediaKey={previewKey} fit="contain" className="size-full" />
                ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-neutral-500">
                        <span>预览</span>
                        <span className="text-[10px] text-neutral-600">点选左侧原视频人物、中间形象卡，或生成后显示于此</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function AudioTab({ document, runner }: { document: ReplacementStudioDocument; runner: ReplacementRunner }) {
    const upload = () =>
        pickFiles("audio/*", true, async (files) => {
            const items: ReplacementAudio[] = [];
            for (const file of files) {
                const key = await saveStudioMedia(file, "audio");
                items.push({ id: nanoid(8), name: file.name.replace(/\.[^.]+$/u, ""), key, durationSec: await audioDuration(key), origin: "upload" as const });
            }
            runner.update((current) => ({ ...current, audios: [...current.audios, ...items] }));
        });
    const origin = { upload: "上传", vocals: "分离人声", background: "背景声", clip: "截取" } as const;
    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-[11px] text-neutral-500">声音样本；分离人声也会出现在这里</span>
                <DarkButton size="sm" className="ml-auto" onClick={upload}>
                    <Upload className="size-3.5" />
                    上传音频
                </DarkButton>
            </div>
            {document.audios.length ? (
                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 overflow-auto pr-1">
                    {document.audios.map((audio) => (
                        <div key={audio.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                            <div className="flex items-center gap-2">
                                <Music className="size-4 shrink-0 text-neutral-400" />
                                <Input size="small" variant="borderless" value={audio.name} onChange={(event) => runner.update((current) => ({ ...current, audios: current.audios.map((item) => (item.id === audio.id ? { ...item, name: event.target.value } : item)) }))} />
                                <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-neutral-300">{origin[audio.origin]}</span>
                                <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">{audio.durationSec ? `${audio.durationSec.toFixed(1)}s` : ""}</span>
                                <Popconfirm title="删除这个音频？" onConfirm={() => runner.update((current) => ({ ...current, audios: current.audios.filter((item) => item.id !== audio.id), characters: current.characters.map((item) => (item.voiceAudioId === audio.id ? { ...item, voiceAudioId: undefined } : item)) }))}>
                                    <IconButton className="size-6" aria-label="删除">
                                        <Trash2 className="size-3.5" />
                                    </IconButton>
                                </Popconfirm>
                            </div>
                            <StudioAudio mediaKey={audio.key} />
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyHint icon={<Music className="size-6" />} title="还没有音频" hint="上传要克隆的声音样本，建议 5～15 秒的清晰人声" />
            )}
        </div>
    );
}

function LibraryTab({ runner, selected }: { runner: ReplacementRunner; selected?: ReplacementCharacter }) {
    const { message } = App.useApp();
    const assets = useAssetStore((state) => state.assets).filter((asset): asset is ImageAsset => asset.kind === "image");
    const add = async (asset: ImageAsset, mode: "character" | "scene" | "appearance") => {
        const key = await saveStudioMedia(asset.data.dataUrl || assetCoverUrl(asset), "image");
        if (mode === "appearance" && selected) {
            runner.patchCharacter(selected.id, (current) => {
                const appearance = { id: nanoid(8), imageKey: key, prompt: "", origin: "library" as const };
                return { appearances: [...current.appearances, appearance], baseAppearanceId: current.baseAppearanceId || appearance.id };
            });
        } else runner.update((current) => ({ ...current, characters: [...current.characters, createCharacter(mode === "scene" ? "scene" : "character", asset.title || (mode === "scene" ? "场景" : "人物"), key, "library")] }));
        message.success("已添加到替换素材");
    };
    if (!assets.length) return <EmptyHint icon={<ImagePlus className="size-6" />} title="画布素材库里还没有图片" hint="在画布或素材页保存的图片会出现在这里" />;
    return (
        <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-auto pr-1">
            {assets.map((asset) => (
                <div key={asset.id} className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-black">
                    <img src={assetCoverUrl(asset)} alt="" className="aspect-[3/4] w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/90 to-transparent p-2 pt-8 opacity-0 transition group-hover:opacity-100">
                        <span className="truncate text-xs text-white">{asset.title}</span>
                        <div className="flex flex-wrap gap-1">
                            <DarkButton size="sm" className="!h-6 !px-2" onClick={() => void add(asset, "character")}>添加为人物</DarkButton>
                            <DarkButton size="sm" className="!h-6 !px-2" onClick={() => void add(asset, "scene")}>添加为场景</DarkButton>
                            {selected ? <DarkButton size="sm" className="!h-6 !px-2" onClick={() => void add(asset, "appearance")}>作为「{selected.name}」形象</DarkButton> : null}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function AssetsStep({ document, runner }: { document: ReplacementStudioDocument; runner: ReplacementRunner }) {
    const [tab, setTab] = useState<Tab>("character");
    const [selectedId, setSelectedId] = useState("");
    const [selectedIdentityId, setSelectedIdentityId] = useState("");
    const [genPrompt, setGenPrompt] = useState("");
    const [referenceKeys, setReferenceKeys] = useState<string[]>([]);
    const [previewKey, setPreviewKey] = useState("");
    const [pages, setPages] = useState<Record<string, number>>({});
    const autoDescribeRef = useRef(false);
    const imageStatusRef = useRef<string | undefined>(undefined);
    const kind = tab === "scene" ? "scene" : "character";
    const items = useMemo(() => document.characters.filter((item) => item.kind === kind), [document.characters, kind]);
    const selected = document.characters.find((item) => item.id === selectedId) || items[0];
    const identities = document.identities;
    const missingPrompts = identities.filter((item) => !item.visualPrompt?.trim()).length;
    const pageOf = (character: ReplacementCharacter) => {
        const stored = pages[character.id];
        if (stored !== undefined) return Math.min(stored, Math.max(0, character.appearances.length - 1));
        return Math.max(0, character.appearances.findIndex((item) => item.id === character.baseAppearanceId));
    };
    /** Keep gen prompt in sync when switching character cards (identity click overrides separately). */
    useEffect(() => {
        if (!selected) return;
        if (selectedIdentityId) return;
        setGenPrompt(selected.prompt || "");
        setReferenceKeys([]);
    }, [selected?.id, selectedIdentityId]);

    /** After generation finishes, show the newest appearance in the right preview. */
    useEffect(() => {
        const status = selected?.imageStatus;
        if (imageStatusRef.current === "running" && status && status !== "running" && selected) {
            const latest = selected.appearances[selected.appearances.length - 1];
            if (latest?.imageKey) {
                setPreviewKey(latest.imageKey);
                setPages((current) => ({ ...current, [selected.id]: selected.appearances.length - 1 }));
            }
        }
        imageStatusRef.current = status;
    }, [selected?.imageStatus, selected?.appearances, selected?.id]);

    /** Old projects finished intake before visualPrompt existed — describe once on open (no full re-intake). */
    useEffect(() => {
        if (tab !== "character" || !identities.length || !missingPrompts || runner.busy || autoDescribeRef.current) return;
        autoDescribeRef.current = true;
        void runner.describeIdentities();
    }, [tab, identities.length, missingPrompts, runner]);

    const addEmpty = () => {
        const character = createCharacter(kind, kind === "scene" ? `场景${items.length + 1}` : `人物${items.length + 1}`);
        runner.update((current) => ({ ...current, characters: [...current.characters, character] }));
        setSelectedId(character.id);
        setSelectedIdentityId("");
        setGenPrompt("");
        setReferenceKeys([]);
        setPreviewKey("");
    };

    const uploadCharacters = () =>
        pickFiles("image/*", true, async (files) => {
            const created: ReplacementCharacter[] = [];
            for (const file of files) created.push(createCharacter(kind, file.name.replace(/\.[^.]+$/u, ""), await saveStudioMedia(file, "image")));
            runner.update((current) => ({ ...current, characters: [...current.characters, ...created] }));
            if (created[0]) {
                setSelectedId(created[0].id);
                setSelectedIdentityId("");
                setPreviewKey(created[0].appearances[0]?.imageKey || "");
            }
        });

    const download = async (key: string, name: string) => {
        const blob = await getStudioMediaBlob(key);
        if (blob) downloadBlob(blob, `${name}.${extensionOf(blob, "png")}`);
    };

    const ensureGenerationTarget = () => {
        if (selected && selected.kind === kind) return selected;
        const character = createCharacter(kind, kind === "scene" ? `场景${items.length + 1}` : `人物${items.length + 1}`);
        runner.update((current) => ({ ...current, characters: [...current.characters, character] }));
        setSelectedId(character.id);
        return character;
    };

    const runDescribe = () => void runner.describeIdentities();

    const patchIdentity = (identityId: string, patch: Partial<ReplacementIdentity>) =>
        runner.update((current) => ({
            ...current,
            identities: current.identities.map((item) => (item.id === identityId ? { ...item, ...patch } : item)),
        }));

    const selectIdentity = (identity: ReplacementIdentity) => {
        setSelectedIdentityId(identity.id);
        setGenPrompt(identity.visualPrompt || "");
        setPreviewKey(identity.coverKey || "");
        if (!selected || selected.kind !== "character") {
            const next = createCharacter("character", identity.name || "替换人物");
            runner.update((current) => ({
                ...current,
                characters: [...current.characters, { ...next, prompt: identity.visualPrompt || "" }],
            }));
            setSelectedId(next.id);
        }
    };

    const selectCharacter = (characterId: string) => {
        const character = document.characters.find((item) => item.id === characterId);
        setSelectedId(characterId);
        setSelectedIdentityId("");
        if (character) {
            const look = character.appearances[pageOf(character)] || character.appearances[0];
            setPreviewKey(look?.imageKey || "");
        }
    };

    /** Generate always creates a brand-new character card in the middle column. */
    const generateAsNewCharacter = (options: GenerateNewOptions) => {
        const count = document.characters.filter((item) => item.kind === "character").length + 1;
        const nameSeed = (selectedIdentityId && identities.find((item) => item.id === selectedIdentityId)?.name) || options.sourceName?.trim() || "";
        const next = createCharacter("character", nameSeed || `人物${count}`);
        next.prompt = genPrompt;
        runner.update((current) => ({ ...current, characters: [...current.characters, next] }));
        setSelectedId(next.id);
        setSelectedIdentityId("");
        setPreviewKey("");
        void runner.generateCharacter(next.id, {
            prompt: options.prompt,
            model: options.model,
            quality: options.quality,
            ratio: options.ratio,
            referenceKeys: options.referenceKeys,
        });
    };

    const generationTarget = selected && selected.kind === kind ? selected : null;
    const anyGenerating = items.some((item) => item.imageStatus === "running");

    if (tab === "audio" || tab === "library") {
        return (
            <div className="flex h-full flex-col gap-4">
                <AssetsToolbar tab={tab} setTab={setTab} />
                <div className="min-h-0 flex-1">{tab === "audio" ? <AudioTab document={document} runner={runner} /> : <LibraryTab runner={runner} selected={selected} />}</div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <AssetsToolbar tab={tab} setTab={setTab}>
                <DarkButton size="sm" onClick={addEmpty}>
                    <Plus className="size-3.5" />
                    新建
                </DarkButton>
                <DarkButton size="sm" onClick={uploadCharacters}>
                    <Upload className="size-3.5" />
                    {tab === "scene" ? "上传场景" : "上传人物"}
                </DarkButton>
            </AssetsToolbar>

            <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
                {/* Left: fixed narrow column — 2 identity cards; rest of width goes to middle(4) + right */}
                {tab === "character" && identities.length ? (
                    <aside className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#141416]" style={{ width: IDENTITY_COLUMN_WIDTH }}>
                        <div className="flex h-8 shrink-0 items-center gap-1 px-1.5">
                            <span className="truncate text-[11px] font-medium text-neutral-100">原视频人物</span>
                            <span className="text-[10px] text-neutral-500">{identities.length}</span>
                            <DarkButton size="sm" tone={missingPrompts ? "primary" : "subtle"} className="ml-auto !h-6 !px-1.5 !text-[10px]" disabled={Boolean(runner.busy)} onClick={runDescribe}>
                                <Wand2 className="size-3 shrink-0" />
                                {missingPrompts ? "识别" : "重识别"}
                            </DarkButton>
                        </div>
                        {missingPrompts ? (
                            <button type="button" disabled={Boolean(runner.busy)} onClick={runDescribe} className="mx-1 mb-1 rounded-lg border border-amber-400/40 bg-amber-500/10 px-1.5 py-1 text-left text-[10px] leading-3.5 text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50">
                                {runner.busy === "识别人物外观" ? "正在识别…" : `${missingPrompts} 人无描述`}
                            </button>
                        ) : (
                            <p className="px-1.5 pb-1 text-[9px] leading-tight text-neutral-500">点选填入右侧提示词</p>
                        )}
                        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                            <div className="grid grid-cols-2 items-start" style={{ gap: IDENTITY_GRID_GAP }}>
                                {identities.map((identity) => {
                                    const active = selectedIdentityId === identity.id;
                                    return (
                                        <article
                                            key={identity.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => selectIdentity(identity)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    selectIdentity(identity);
                                                }
                                            }}
                                            className={cn("min-w-0 cursor-pointer overflow-hidden rounded-md border bg-[#0c0c0e] transition", active ? "border-white shadow-[0_0_0_1px_#fff]" : "border-white/[0.07] hover:border-white/30")}
                                        >
                                            <div className="relative w-full overflow-hidden bg-black" style={{ paddingBottom: "133.333%" }}>
                                                <StudioImage mediaKey={identity.coverKey} fit="cover" className="!absolute !inset-0 !h-full !w-full" />
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1 pb-1 pt-5">
                                                    <Input
                                                        size="small"
                                                        variant="borderless"
                                                        value={identity.name}
                                                        onClick={(event) => event.stopPropagation()}
                                                        onChange={(event) => patchIdentity(identity.id, { name: event.target.value })}
                                                        className="!px-0 !text-[9px] !font-medium !text-white"
                                                    />
                                                    <p className="line-clamp-2 text-[8px] leading-2.5 text-neutral-300">{identity.visualPrompt?.trim() || "暂无描述"}</p>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>
                ) : null}

                {/* Middle: 4-card min width; grows with flex-grow 1 vs right's 9 → takes ~10% of former right remainder */}
                <div className="flex min-w-0 flex-col overflow-hidden" style={{ flex: `1 1 ${MIDDLE_COLUMN_WIDTH}px`, minWidth: MIDDLE_COLUMN_WIDTH }}>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {items.length ? (
                            <div className="flex flex-wrap content-start" style={{ gap: CHARACTER_GRID_GAP }}>
                                {items.map((character) => {
                                    const page = pageOf(character);
                                    const current = character.appearances[page];
                                    const active = selected?.id === character.id;
                                    const bound = document.shots.reduce((sum, shot) => sum + shot.persons.filter((person) => person.targetCharacterId === character.id).length, 0) + identities.filter((identity) => identity.targetCharacterId === character.id).length;
                                    return (
                                        <article
                                            key={character.id}
                                            draggable
                                            onDragStart={(event) => event.dataTransfer.setData(CHARACTER_DRAG_MIME, character.id)}
                                            onClick={() => selectCharacter(character.id)}
                                            style={{ width: CHARACTER_CARD_WIDTH }}
                                            className={cn("group flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-[#141416] transition", active ? "border-white shadow-[0_0_0_1px_#fff]" : "border-white/[0.07] hover:border-white/30")}
                                        >
                                            <div className="relative shrink-0 bg-black" style={{ height: kind === "scene" ? Math.round(CHARACTER_IMAGE_HEIGHT * 0.62) : CHARACTER_IMAGE_HEIGHT }}>
                                                <StudioImage mediaKey={current?.imageKey} fit="contain" className="size-full" />
                                                <div className="absolute right-1 top-1 flex gap-0.5 opacity-90 transition group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
                                                    <IconButton
                                                        className="size-6 bg-black/55 text-white hover:bg-black/75"
                                                        disabled={!current?.imageKey}
                                                        title="下载"
                                                        onClick={() => current?.imageKey && void download(current.imageKey, character.name || "形象")}
                                                    >
                                                        <Download className="size-3.5" />
                                                    </IconButton>
                                                    <Popconfirm title="删除这个素材？" onConfirm={() => runner.update((currentDoc) => removeCharacterFrom(currentDoc, [character.id]))}>
                                                        <IconButton className="size-6 bg-black/55 text-white hover:bg-red-600/80" title="删除">
                                                            <Trash2 className="size-3.5" />
                                                        </IconButton>
                                                    </Popconfirm>
                                                </div>
                                                {character.imageStatus === "running" ? <div className="absolute inset-0 flex items-center justify-center bg-black/60"><StatusBadge status="running" /></div> : null}
                                            </div>
                                            <div className="flex flex-col gap-1 p-1.5" onClick={(event) => event.stopPropagation()}>
                                                <div className="flex min-w-0 items-center gap-0.5">
                                                    <Input size="small" variant="borderless" value={character.name} onChange={(event) => runner.patchCharacter(character.id, { name: event.target.value })} className="!min-w-0 !flex-1 !truncate !px-0.5 !text-[11px] !font-medium" />
                                                    <Pager
                                                        index={page}
                                                        total={character.appearances.length}
                                                        onChange={(next) => {
                                                            setPages((list) => ({ ...list, [character.id]: next }));
                                                            if (character.id === selected?.id) setPreviewKey(character.appearances[next]?.imageKey || "");
                                                        }}
                                                    />
                                                </div>
                                                {bound ? <span className="truncate text-[10px] text-neutral-500">已绑定 {bound} 处</span> : null}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyHint icon={<UserRound className="size-6" />} title={tab === "scene" ? "还没有场景" : "还没有替换人物"} hint={tab === "scene" ? "需要换背景时添加场景，图像替换时可为镜头指定场景" : identities.length ? "点选左侧原视频人物，提示词会填入右侧生图区；拖人物卡到右侧作参考" : "上传人物照片或用提示词生成形象，然后在图像替换里拖到人物框上"}>
                                <DarkButton size="sm" tone="primary" onClick={uploadCharacters}>
                                    <Upload className="size-3.5" />
                                    {tab === "scene" ? "上传场景" : "上传人物"}
                                </DarkButton>
                                <DarkButton size="sm" onClick={addEmpty}>
                                    <Plus className="size-3.5" />
                                    新建并生成
                                </DarkButton>
                            </EmptyHint>
                        )}
                    </div>
                </div>

                {/* Right: 生图 — flex-grow 9 vs middle's 1 ⇒ ~90% of leftover after middle base (narrowed ~10%) */}
                <aside className="flex min-h-0 min-w-[220px] flex-col overflow-hidden" style={{ flex: "9 1 0%" }}>
                    {generationTarget ? (
                        <GenerationBar
                            key={`${generationTarget.id}-${selectedIdentityId || "char"}`}
                            document={document}
                            runner={runner}
                            character={generationTarget}
                            prompt={genPrompt}
                            onPromptChange={(value) => {
                                setGenPrompt(value);
                                if (selectedIdentityId) patchIdentity(selectedIdentityId, { visualPrompt: value });
                            }}
                            referenceKeys={referenceKeys}
                            onReferenceKeysChange={setReferenceKeys}
                            characters={document.characters.filter((item) => item.kind === "character")}
                            previewKey={previewKey}
                            generating={anyGenerating}
                            onGenerateNew={generateAsNewCharacter}
                        />
                    ) : (
                        <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-[#1b1b1e] px-3 py-4">
                            <p className="text-center text-[11px] text-neutral-400">先新建或上传人物，再在右侧填写提示词生成形象</p>
                            <DarkButton size="sm" tone="primary" onClick={() => ensureGenerationTarget()}>
                                <Plus className="size-3.5" />
                                新建人物
                            </DarkButton>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}

function AssetsToolbar({ tab, setTab, children }: { tab: Tab; setTab: (tab: Tab) => void; children?: ReactNode }) {
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Tabs
                value={tab}
                onChange={setTab}
                items={[
                    { key: "character", label: "人物" },
                    { key: "scene", label: "场景" },
                    { key: "audio", label: "音频" },
                    { key: "library", label: "素材库" },
                ]}
            />
            <div className="ml-auto flex items-center gap-2">{children}</div>
        </div>
    );
}
