import { App, Input, Select, Spin } from "antd";
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import { DarkButton, EmptyHint, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { StudioPromptMentionInput, type StudioMentionOption } from "@/studios/components/studio-prompt-mention-input";
import { saveStudioMedia, useStudioMedia } from "@/studios/media";
import { appearanceImageKeys, applyAppearanceImage, defaultAssetPresetId, downloadAllAssetImages, downloadAppearanceImage } from "@/studios/script/appearance-images";
import type { ScriptStudioDocument } from "@/studios/script/document";
import { appendImageGeometryToPrompt, applyAssetPromptPreset, assetImagePrompt, assetImageRatio, assetPromptPresets, compileAssetReferencePrompt } from "@/studios/script/stages";
import type { StudioAppearance, StudioAppearanceReference, StudioAppearanceReferenceRole, StudioAsset, StudioAssetKind } from "@/studios/types";
import { useConfigStore } from "@/stores/use-config-store";

import { ImageGenOptionsPopover, normalizeImageQuality } from "./image-gen-options";
import type { ScriptRunner } from "./use-script-runner";

const REFERENCE_ROLE_ORDER: StudioAppearanceReferenceRole[] = ["draft", "style", "character", "background"];

/** Same final text sent to the image API (preset + sheet prefix + ref suffixes + @图片N + 比例/分辨率). */
function buildFullAppearancePrompt(asset: StudioAsset, look: StudioAppearance, presetId: string, aspectRatio: string, imageQuality?: string) {
    const body = presetId && presetId !== "none" ? applyAssetPromptPreset(presetId, asset.kind, look.prompt) : look.prompt;
    const roles = REFERENCE_ROLE_ORDER.filter((role) => (look.references || []).some((item) => item.role === role && item.mediaKey));
    const ratio = assetImageRatio(asset, aspectRatio);
    return appendImageGeometryToPrompt(compileAssetReferencePrompt(assetImagePrompt(asset, { ...look, prompt: body }, { roles }), roles), ratio, imageQuality);
}

const KIND_LABEL: Record<StudioAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };

/** Match replacement studio card footprint. */
const ASSET_CARD_WIDTH = 168;
const ASSET_IMAGE_HEIGHT = 156;
const ASSET_GRID_GAP = 8;

const REFERENCE_SLOTS: Array<{ role: StudioAppearanceReferenceRole; label: string }> = [
    { role: "draft", label: "草稿形象" },
    { role: "style", label: "风格参考" },
    { role: "character", label: "角色参考" },
    { role: "background", label: "背景参考" },
];

function fileToMediaKey(file: File) {
    return saveStudioMedia(file, "image");
}

function ReferenceSlot({
    label,
    mediaKey,
    disabled,
    onDropFile,
    onClear,
}: {
    label: string;
    mediaKey?: string;
    disabled: boolean;
    onDropFile: (file: File) => void;
    onClear: () => void;
}) {
    const url = useStudioMedia(mediaKey);
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    return (
        <div
            onDragOver={(event) => {
                event.preventDefault();
                if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = [...(event.dataTransfer.files || [])].find((item) => item.type.startsWith("image/"));
                if (file && !disabled) onDropFile(file);
            }}
            className={cn("relative flex h-11 min-w-[68px] flex-1 flex-col items-center justify-center overflow-hidden rounded-md border border-dashed text-[10px] transition", dragging ? "border-sky-400 bg-sky-500/10 text-sky-200" : "border-white/15 bg-white/[0.03] text-neutral-400 hover:border-white/30")}
        >
            {url ? (
                <>
                    <img src={url} alt={label} className="absolute inset-0 size-full object-cover" />
                    <button type="button" disabled={disabled} onClick={onClear} className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white" aria-label={`移除${label}`}>
                        <X className="size-2.5" />
                    </button>
                    <span className="relative z-10 mt-auto w-full bg-black/55 px-0.5 py-0.5 text-center text-[9px] text-white">{label}</span>
                </>
            ) : (
                <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1">
                    <Upload className="size-3" />
                    <span className="truncate">{label}</span>
                </button>
            )}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                disabled={disabled}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onDropFile(file);
                    event.target.value = "";
                }}
            />
        </div>
    );
}

function ImagePager({
    index,
    total,
    onPrev,
    onNext,
    onDownload,
    className,
}: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
    onDownload?: () => void;
    className?: string;
}) {
    if (total < 1) return null;
    return (
        <div className={cn("flex items-center gap-0.5 rounded-md bg-black/65 px-0.5 py-0.5 text-white", className)} onClick={(event) => event.stopPropagation()}>
            <button type="button" disabled={total < 2} className="rounded p-0.5 disabled:opacity-30 hover:bg-white/15" onClick={onPrev} aria-label="上一张">
                <ChevronLeft className="size-3" />
            </button>
            <span className="min-w-[2.25rem] text-center text-[9px] tabular-nums">
                {index + 1}/{total}
            </span>
            <button type="button" disabled={total < 2} className="rounded p-0.5 disabled:opacity-30 hover:bg-white/15" onClick={onNext} aria-label="下一张">
                <ChevronRight className="size-3" />
            </button>
            {onDownload ? (
                <button type="button" className="rounded p-0.5 hover:bg-white/15" onClick={onDownload} aria-label="下载当前图" title="下载当前图">
                    <Download className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function AssetCard({
    asset,
    active,
    disabled,
    onSelect,
    onUpload,
    onGenerate,
    onSelectImage,
    onDownloadImage,
}: {
    asset: StudioAsset;
    active: boolean;
    disabled: boolean;
    onSelect: () => void;
    onUpload: (file: File) => void;
    onGenerate: () => void;
    onSelectImage: (lookId: string, imageKey: string) => void;
    onDownloadImage: (look: StudioAppearance, imageKey: string) => void;
}) {
    const isRunning = asset.appearances.some((item) => item.imageStatus === "running");
    const look = asset.appearances.find((item) => item.imageStatus === "running") || asset.appearances.find((item) => appearanceImageKeys(item).length) || asset.appearances[0];
    const keys = look ? appearanceImageKeys(look) : [];
    const activeKey = look?.imageKey && keys.includes(look.imageKey) ? look.imageKey : keys[0];
    const activeIndex = Math.max(0, keys.indexOf(activeKey || ""));
    const url = useStudioMedia(activeKey);
    const uploadRef = useRef<HTMLInputElement>(null);
    const imageHeight = asset.kind === "scene" ? Math.round(ASSET_IMAGE_HEIGHT * 0.62) : ASSET_IMAGE_HEIGHT;

    const stepImage = (delta: number) => {
        if (!look || keys.length < 2) return;
        const next = keys[(activeIndex + delta + keys.length) % keys.length];
        onSelectImage(look.id, next);
    };

    return (
        <article
            onClick={onSelect}
            style={{ width: ASSET_CARD_WIDTH, ...(active ? { boxShadow: "0 0 0 1px #fff" } : undefined) }}
            className={cn("group flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-[#141416] transition", active ? "border-white" : "border-white/[0.07] hover:border-white/30")}
        >
            <div className="relative shrink-0 bg-black" style={{ height: imageHeight }}>
                {url ? (
                    <img src={url} alt={asset.name} className="size-full object-contain" />
                ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-0.5 text-neutral-600">
                        <ImagePlus className="size-5" />
                        <span className="text-[10px]">{isRunning ? "生成中" : "待生成"}</span>
                    </div>
                )}
                {isRunning ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/55">
                        <Spin size="small" />
                    </div>
                ) : null}
                {keys.length ? (
                    <ImagePager
                        className="absolute bottom-1 left-1/2 z-10 -translate-x-1/2"
                        index={activeIndex}
                        total={keys.length}
                        onPrev={() => stepImage(-1)}
                        onNext={() => stepImage(1)}
                        onDownload={activeKey && look ? () => onDownloadImage(look, activeKey) : undefined}
                    />
                ) : null}
            </div>
            <div className="flex flex-col gap-1 p-1.5" onClick={(event) => event.stopPropagation()}>
                <div className="flex min-w-0 items-center gap-1">
                    <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-100">{asset.name}</h3>
                    {asset.role ? <span className="shrink-0 rounded bg-white/[0.08] px-1 py-0.5 text-[9px] text-neutral-300">{asset.role}</span> : null}
                </div>
                {asset.description ? <p className="line-clamp-2 text-[10px] leading-3.5 text-neutral-500">{asset.description}</p> : null}
                <div className="mt-0.5 flex gap-1">
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => uploadRef.current?.click()}
                        className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-white/[0.14] disabled:opacity-40"
                    >
                        上传形象
                    </button>
                    <button
                        type="button"
                        disabled={disabled || isRunning || !look?.prompt.trim()}
                        onClick={onGenerate}
                        style={inkOnWhiteStyle}
                        className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium hover:bg-neutral-200 disabled:opacity-40"
                    >
                        {isRunning ? "生成中" : "生成形象"}
                    </button>
                    <input
                        ref={uploadRef}
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={disabled}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) onUpload(file);
                            event.target.value = "";
                        }}
                    />
                </div>
            </div>
        </article>
    );
}

function GenerationPanel({
    asset,
    look,
    lookIndex,
    disabled,
    runner,
    document,
}: {
    asset: StudioAsset;
    look: StudioAppearance;
    lookIndex: number;
    disabled: boolean;
    runner: ScriptRunner;
    document: ScriptStudioDocument;
}) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const imageKeys = appearanceImageKeys(look);
    const activeKey = look.imageKey && imageKeys.includes(look.imageKey) ? look.imageKey : imageKeys[0];
    const activeIndex = Math.max(0, imageKeys.indexOf(activeKey || ""));
    const previewUrl = useStudioMedia(activeKey);
    const [presetId, setPresetId] = useState(() => defaultAssetPresetId(asset.kind));
    const [draggingPreview, setDraggingPreview] = useState(false);
    const presets = assetPromptPresets(asset.kind);
    const uploadInput = useRef<HTMLInputElement>(null);

    const updateLook = (patch: Partial<StudioAppearance>) =>
        runner.update((current) => ({
            ...current,
            assets: current.assets.map((item) => (item.id === asset.id ? { ...item, appearances: item.appearances.map((entry) => (entry.id === look.id ? { ...entry, ...patch } : entry)) } : item)),
        }));

    const patchSettings = (patch: { imageQuality?: string; aspectRatio?: string; imageModel?: string }) =>
        runner.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));

    useEffect(() => {
        setPresetId(defaultAssetPresetId(asset.kind));
    }, [asset.id, asset.kind]);

    const copyFullPrompt = async () => {
        const text = buildFullAppearancePrompt(asset, look, presetId, document.settings.aspectRatio || "16:9", document.settings.imageQuality).trim();
        if (!text) {
            message.warning("提示词为空");
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            message.success("已复制完整提示词（含比例与分辨率）");
        } catch {
            message.error("复制失败，请手动全选复制");
        }
    };

    const setReference = async (role: StudioAppearanceReferenceRole, file?: File) => {
        if (!file) return;
        const mediaKey = await fileToMediaKey(file);
        const next: StudioAppearanceReference = { id: `ref-${nanoid(6)}`, role, mediaKey, name: file.name };
        updateLook({ references: [...(look.references || []).filter((item) => item.role !== role), next] });
    };

    const clearReference = (role: StudioAppearanceReferenceRole) => updateLook({ references: (look.references || []).filter((item) => item.role !== role) });

    const stepPreview = (delta: number) => {
        if (imageKeys.length < 2) return;
        const next = imageKeys[(activeIndex + delta + imageKeys.length) % imageKeys.length];
        updateLook({ imageKey: next });
    };

    const downloadCurrent = async () => {
        if (!activeKey) return;
        try {
            await downloadAppearanceImage(asset, look, activeKey);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
            <div
                className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-black", draggingPreview ? "border-sky-400" : "border-white/[0.08]")}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDraggingPreview(true);
                }}
                onDragLeave={() => setDraggingPreview(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDraggingPreview(false);
                    const file = [...(event.dataTransfer.files || [])].find((item) => item.type.startsWith("image/"));
                    if (file && !disabled) void setReference("style", file);
                }}
            >
                {look.imageStatus === "running" ? (
                    <Spin tip="生成中…" />
                ) : previewUrl ? (
                    <img src={previewUrl} alt={look.name || asset.name} className="max-h-full max-w-full object-contain" />
                ) : (
                    <div className="flex flex-col items-center gap-1.5 text-neutral-500">
                        <ImagePlus className="size-8" />
                        <span className="text-xs">待生成</span>
                        <span className="text-[10px]">参考图可拖入此处</span>
                    </div>
                )}
                {activeKey ? (
                    <DarkButton size="sm" className="!absolute right-2 top-2" onClick={() => void downloadCurrent()} title="下载当前预览图">
                        <Download className="size-3.5" />
                        下载
                    </DarkButton>
                ) : null}
                {imageKeys.length ? (
                    <ImagePager className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2" index={activeIndex} total={imageKeys.length} onPrev={() => stepPreview(-1)} onNext={() => stepPreview(1)} onDownload={() => void downloadCurrent()} />
                ) : null}
            </div>

            <div className="shrink-0 rounded-xl border border-white/[0.08] bg-[#141416] px-2 py-1.5">
                <div className="mb-1 flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-neutral-100">{asset.name}</span>
                    <span className="truncate text-[10px] text-neutral-500">
                        {look.name || "日常装束"}
                        {asset.appearances.length > 1 ? ` · 形象 ${lookIndex + 1}` : ""}
                    </span>
                </div>

                <div className="flex gap-1">
                    {REFERENCE_SLOTS.map((slot) => (
                        <ReferenceSlot
                            key={slot.role}
                            label={slot.label}
                            mediaKey={look.references?.find((item) => item.role === slot.role)?.mediaKey}
                            disabled={disabled}
                            onDropFile={(file) => void setReference(slot.role, file)}
                            onClear={() => clearReference(slot.role)}
                        />
                    ))}
                </div>

                <div className="relative mt-1.5">
                    <StudioPromptMentionInput
                        disabled={disabled}
                        value={look.prompt}
                        minRows={2}
                        maxRows={4}
                        className="pr-14"
                        placeholder="形象提示词；输入 @ 选择已上传的参考图槽位"
                        options={REFERENCE_SLOTS.map((slot): StudioMentionOption => {
                            const mediaKey = look.references?.find((item) => item.role === slot.role)?.mediaKey;
                            return {
                                id: slot.role,
                                label: slot.label,
                                mention: `@${slot.label}`,
                                kindLabel: mediaKey ? "已上传参考" : "未上传",
                                mediaKey,
                            };
                        }).filter((item) => item.mediaKey)}
                        onChange={(prompt) => updateLook({ prompt })}
                    />
                    <DarkButton size="sm" className="!absolute right-1 top-1 z-10" disabled={!look.prompt.trim()} onClick={() => void copyFullPrompt()} title="复制完整提示词（含预设、参考图指令、画面比例与分辨率）">
                        <Copy className="size-3" />
                        复制
                    </DarkButton>
                </div>
                {look.imageStatus === "failed" && look.imageError ? (
                    <div className="mt-0.5 flex flex-wrap items-start gap-1.5">
                        <p className="min-w-0 flex-1 text-[10px] leading-4 text-red-300">{look.imageError}</p>
                        <DarkButton
                            size="sm"
                            disabled={disabled}
                            title="根据接口返回的审核/策略错误，用文本模型改写提示词后再生成"
                            onClick={() => void runner.reviseAppearancePrompt(asset.id, look.id)}
                        >
                            按错误改提示词
                        </DarkButton>
                    </div>
                ) : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <div className="min-w-[140px] flex-1">
                        <ModelPicker
                            config={config}
                            value={document.settings.imageModel}
                            onChange={(value) => patchSettings({ imageModel: value })}
                            capability="image"
                            fullWidth
                            placeholder="图片模型"
                            onMissingConfig={() => openConfigDialog(true)}
                        />
                    </div>
                    <Select
                        size="small"
                        className="!min-w-[110px]"
                        disabled={disabled || asset.kind === "prop"}
                        value={presetId}
                        onChange={(value) => {
                            setPresetId(value);
                            const preset = presets.find((item) => item.id === value);
                            if (preset && /三视|three[-_]?view|多视角/i.test(`${preset.id} ${preset.label}`)) patchSettings({ aspectRatio: "16:9" });
                        }}
                        options={presets.map((preset) => ({ value: preset.id, label: preset.label }))}
                    />
                    <ImageGenOptionsPopover
                        quality={normalizeImageQuality(document.settings.imageQuality)}
                        ratio={document.settings.aspectRatio || "16:9"}
                        disabled={disabled}
                        onChange={patchSettings}
                    />
                    <DarkButton size="sm" disabled={disabled} onClick={() => uploadInput.current?.click()}>
                        <Upload className="size-3.5" />
                        上传形象
                    </DarkButton>
                    <DarkButton tone="primary" disabled={disabled || !look.prompt.trim() || look.imageStatus === "running"} onClick={() => void runner.generateImages([{ assetId: asset.id, appearanceId: look.id, presetId }])}>
                        {look.imageStatus === "running" ? "生成中…" : "生成素材图"}
                    </DarkButton>
                    <input
                        ref={uploadInput}
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={disabled}
                        onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const imageKey = await fileToMediaKey(file);
                            updateLook(applyAppearanceImage(look, imageKey));
                            event.target.value = "";
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

export function AssetsStep({ document, runner }: { document: ScriptStudioDocument; runner: ScriptRunner }) {
    const { message } = App.useApp();
    // Keep 生图 clickable while image/video jobs run so more cards can enqueue into the concurrent pool.
    const disabled = Boolean(runner.busy && !/(素材图|生成视频|批量生成|生视频)/.test(runner.busy));
    const [kind, setKind] = useState<StudioAssetKind>("character");
    const [selectedId, setSelectedId] = useState(document.assets.find((asset) => asset.kind === "character")?.id || document.assets[0]?.id || "");
    const [selectedLookId, setSelectedLookId] = useState("");
    const hasScripts = document.episodes.some((episode) => episode.script);
    const counts = useMemo(
        () => ({
            character: document.assets.filter((asset) => asset.kind === "character").length,
            scene: document.assets.filter((asset) => asset.kind === "scene").length,
            prop: document.assets.filter((asset) => asset.kind === "prop").length,
        }),
        [document.assets],
    );
    const visible = document.assets.filter((asset) => asset.kind === kind);
    const selected = visible.find((asset) => asset.id === selectedId) || visible[0] || document.assets.find((asset) => asset.id === selectedId);
    const selectedLook = selected?.appearances.find((look) => look.id === selectedLookId) || selected?.appearances[0];
    const missing = document.assets.flatMap((asset) => asset.appearances.filter((look) => !look.imageKey && look.prompt.trim()).map((look) => ({ assetId: asset.id, appearanceId: look.id })));
    const lookIndex = selected && selectedLook ? Math.max(0, selected.appearances.findIndex((item) => item.id === selectedLook.id)) : 0;

    useEffect(() => {
        if (!selected) return;
        if (!selected.appearances.some((look) => look.id === selectedLookId)) setSelectedLookId(selected.appearances[0]?.id || "");
    }, [selected, selectedLookId]);

    useEffect(() => {
        if (visible.some((asset) => asset.id === selectedId)) return;
        setSelectedId(visible[0]?.id || "");
    }, [kind, selectedId, visible]);

    return (
        <div className="grid h-full min-h-0 gap-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(380px,1.15fr)]">
            <section className="flex min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-[#101012]">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                    {(["character", "scene", "prop"] as StudioAssetKind[]).map((value) => {
                        const active = kind === value;
                        return (
                            <button key={value} type="button" onClick={() => setKind(value)} style={active ? inkOnWhiteStyle : undefined} className={cn("rounded-full px-3 py-1 text-xs font-medium transition", active ? "bg-white" : "text-neutral-300 hover:bg-white/[0.08]")}>
                                {KIND_LABEL[value]} {counts[value]}
                            </button>
                        );
                    })}
                    <div className="ml-auto flex items-center gap-1.5">
                        <DarkButton size="sm" disabled={disabled || !hasScripts} onClick={() => void runner.extract()}>
                            {document.assets.length ? "重提取" : "提取"}
                        </DarkButton>
                        <DarkButton
                            size="sm"
                            disabled={!document.assets.some((asset) => asset.appearances.some((look) => appearanceImageKeys(look).length))}
                            onClick={async () => {
                                try {
                                    const count = await downloadAllAssetImages(document.assets, document.summary?.title || "素材图片");
                                    message.success(`已打包下载 ${count} 张图片`);
                                } catch (error) {
                                    message.error(error instanceof Error ? error.message : String(error));
                                }
                            }}
                        >
                            <Download className="size-3.5" />
                            下载全部
                        </DarkButton>
                        <DarkButton size="sm" tone="primary" disabled={disabled || !missing.length} onClick={() => void runner.generateImages(missing.map((item) => ({ ...item, presetId: defaultAssetPresetId(document.assets.find((asset) => asset.id === item.assetId)?.kind || "character") })))}>
                            缺图 {missing.length || ""}
                        </DarkButton>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                    {!document.assets.length ? (
                        <EmptyHint title={hasScripts ? "尚未提取素材" : "请先生成分集剧本"} hint={hasScripts ? "点击「提取」生成角色、场景和道具" : undefined} />
                    ) : !visible.length ? (
                        <EmptyHint title={`暂无${KIND_LABEL[kind]}`} />
                    ) : (
                        <div className="flex flex-wrap content-start" style={{ gap: ASSET_GRID_GAP }}>
                            {visible.map((asset) => {
                                const look = asset.appearances[0];
                                return (
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        active={asset.id === selected?.id}
                                        disabled={disabled}
                                        onSelect={() => {
                                            setSelectedId(asset.id);
                                            setSelectedLookId(asset.appearances[0]?.id || "");
                                        }}
                                        onSelectImage={(lookId, imageKey) => {
                                            runner.update((current) => ({
                                                ...current,
                                                assets: current.assets.map((item) =>
                                                    item.id === asset.id
                                                        ? { ...item, appearances: item.appearances.map((entry) => (entry.id === lookId ? { ...entry, imageKey } : entry)) }
                                                        : item,
                                                ),
                                            }));
                                        }}
                                        onDownloadImage={(appearance, imageKey) => {
                                            void downloadAppearanceImage(asset, appearance, imageKey).catch((error) => message.error(error instanceof Error ? error.message : String(error)));
                                        }}
                                        onUpload={async (file) => {
                                            if (!look) return;
                                            const imageKey = await fileToMediaKey(file);
                                            runner.update((current) => ({
                                                ...current,
                                                assets: current.assets.map((item) =>
                                                    item.id === asset.id
                                                        ? { ...item, appearances: item.appearances.map((entry) => (entry.id === look.id ? applyAppearanceImage(entry, imageKey) : entry)) }
                                                        : item,
                                                ),
                                            }));
                                            setSelectedId(asset.id);
                                            setSelectedLookId(look.id);
                                        }}
                                        onGenerate={() => {
                                            if (!look) return;
                                            setSelectedId(asset.id);
                                            setSelectedLookId(look.id);
                                            void runner.generateImages([{ assetId: asset.id, appearanceId: look.id, presetId: defaultAssetPresetId(asset.kind) }]);
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            <section className="min-h-0 rounded-2xl border border-white/[0.07] bg-[#101012] p-2">
                {!selected || !selectedLook ? (
                    <EmptyHint title="选择左侧素材卡开始生图" hint="右侧可拖入风格/角色/背景参考图" />
                ) : (
                    <div className="flex h-full min-h-0 flex-col">
                        {selected.appearances.length > 1 ? (
                            <div className="mb-1 flex flex-wrap gap-1">
                                {selected.appearances.map((item, index) => {
                                    const active = item.id === selectedLook.id;
                                    const imageCount = appearanceImageKeys(item).length;
                                    return (
                                        <button key={item.id} type="button" onClick={() => setSelectedLookId(item.id)} style={active ? inkOnWhiteStyle : undefined} className={cn("rounded-full px-2 py-0.5 text-[10px]", active ? "bg-white" : "bg-white/[0.06] text-neutral-300")}>
                                            {item.name || `形象 ${index + 1}`}
                                            {imageCount ? ` · ${imageCount}` : ""}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        <div className="min-h-0 flex-1">
                            <GenerationPanel asset={selected} look={selectedLook} lookIndex={lookIndex} disabled={disabled} runner={runner} document={document} />
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
