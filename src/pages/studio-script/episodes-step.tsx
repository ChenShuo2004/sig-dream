import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { App, Input, Select, Spin, Switch } from "antd";
import { ArrowLeft, CheckSquare, Clapperboard, Download, Film, Grid2x2, LayoutGrid, Pencil, RefreshCw, Sparkles, Square, Wand2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { videoQualityChoices } from "@/components/video-settings-panel";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { rewritePromptToMinimaxH3, translateMinimaxH3Prompt, type MinimaxH3Lang } from "@/lib/minimax-h3-prompt";
import { isRunningHubH3FamilyGen } from "@/lib/relay-stations";
import { cn } from "@/lib/utils";
import { DarkButton, EmptyHint, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { StudioPromptMentionInput, type StudioMentionOption } from "@/studios/components/studio-prompt-mention-input";
import { useStudioMedia } from "@/studios/media";
import type { ScriptStudioDocument } from "@/studios/script/document";
import { resolveVideoQuality, resolveVideoSize } from "@/studios/script/video-gen-params";
import { appearanceWithImage, bindClipAppearanceRefs, clipMissingImageAssets, H3_FACE_MAX_REF_IMAGES } from "@/studios/script/video-prompt";
import { clipDuration, type StudioAsset, type StudioAssetKind, type StudioClip, type StudioClipFrame, type StudioEpisode } from "@/studios/types";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";

import { ClipFrameThumb, ClipVideoPreview } from "./clip-video-preview";
import { buildPrompts, type ScriptRunner } from "./use-script-runner";
import { VideoGenOptionsPopover } from "./video-gen-options";

const KIND_LABEL: Record<StudioAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };
const EPISODE_CARD_WIDTH = 168;
const ASSET_DRAG_MIME = "application/x-studio-asset-id";

function startAssetDrag(event: DragEvent, asset: StudioAsset) {
    if (!assetHasImage(asset)) {
        event.preventDefault();
        return;
    }
    event.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
    event.dataTransfer.setData("text/plain", asset.id);
    event.dataTransfer.effectAllowed = "copy";
}

/** Re-split confirmation when an episode already has clips (and possibly videos). */
function confirmResplitStoryboard(
    modal: ReturnType<typeof App.useApp>["modal"],
    opts: { episodeCount: number; hasVideos: boolean; onOk: () => void | Promise<unknown> },
) {
    const videoHint = opts.hasVideos ? "已生成的片段视频也会一并清空。" : "";
    modal.confirm({
        title: "重新生成分镜？",
        content:
            opts.episodeCount > 1
                ? `将覆盖选中 ${opts.episodeCount} 集已有的分镜脚本。${videoHint}确定继续？`
                : `将覆盖本集已有的分镜脚本。${videoHint}确定继续？`,
        okText: "继续生成",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: opts.onOk,
    });
}

function assetHasImage(asset: StudioAsset) {
    return asset.appearances.some((look) => look.imageKey);
}

function padClip(number: number) {
    return String(number).padStart(2, "0");
}

function episodeAssetCounts(episode: StudioEpisode, assets: StudioAsset[]) {
    const linked = assets.filter((asset) => asset.sourceChapterIds?.includes(episode.id) || asset.appearances.some((look) => look.sourceChapterIds?.includes(episode.id)));
    const pool = linked.length ? linked : assets;
    return {
        character: pool.filter((asset) => asset.kind === "character").length,
        scene: pool.filter((asset) => asset.kind === "scene").length,
        prop: pool.filter((asset) => asset.kind === "prop").length,
    };
}

function episodeCoverKey(episode: StudioEpisode, assets: StudioAsset[]) {
    for (const clip of episode.clips) {
        for (const assetId of clip.assetRefs) {
            const asset = assets.find((item) => item.id === assetId);
            const key = asset?.appearances.find((look) => look.imageKey)?.imageKey || asset?.appearances[0]?.imageKey;
            if (key) return key;
        }
    }
    const character = assets.find((asset) => asset.kind === "character" && asset.appearances.some((look) => look.imageKey));
    return character?.appearances.find((look) => look.imageKey)?.imageKey;
}

function CoverThumb({ mediaKey, className }: { mediaKey?: string; className?: string }) {
    const url = useStudioMedia(mediaKey);
    if (!url) {
        return (
            <div className={cn("flex items-center justify-center bg-black/50 text-neutral-600", className)}>
                <Clapperboard className="size-8" />
            </div>
        );
    }
    return <img src={url} alt="" className={cn("size-full object-cover", className)} />;
}

function AssetThumb({ asset, dimmed, bound }: { asset: StudioAsset; dimmed?: boolean; bound?: boolean }) {
    const look = appearanceWithImage(asset);
    const url = useStudioMedia(look?.imageKey);
    return (
        <div className={cn("overflow-hidden rounded-md border bg-black/30", bound ? "border-white/70" : dimmed ? "border-white/[0.05] opacity-50" : "border-transparent")}>
            <div className="aspect-square overflow-hidden rounded-md bg-black/60">
                {url ? <img src={url} alt={asset.name} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-neutral-600"><Clapperboard className="size-4" /></div>}
            </div>
            <div className="truncate px-0.5 pt-1 text-center text-[9px] leading-3 text-neutral-300" title={`${KIND_LABEL[asset.kind]} · ${asset.name}`}>
                {KIND_LABEL[asset.kind]} · {asset.name}
            </div>
        </div>
    );
}

function toggleClipAsset(clip: StudioClip | undefined, asset: StudioAsset, bind: (assetRefs: string[]) => void) {
    if (!clip || !assetHasImage(asset)) return;
    const assetRefs = clip.assetRefs.includes(asset.id) ? clip.assetRefs.filter((id) => id !== asset.id) : [...clip.assetRefs, asset.id];
    bind(assetRefs);
}

function AssetGrid({
    assets,
    clip,
    disabled,
    onToggle,
}: {
    assets: StudioAsset[];
    clip?: StudioClip;
    disabled?: boolean;
    onToggle: (asset: StudioAsset) => void;
}) {
    return (
        <div className="grid grid-cols-3 gap-1.5">
            {assets.map((asset) => {
                const ready = assetHasImage(asset);
                const bound = Boolean(clip?.assetRefs.includes(asset.id));
                return (
                    <button
                        key={asset.id}
                        type="button"
                        draggable={ready && !disabled}
                        title={ready ? (bound ? `已绑定：${asset.name}（可拖到参考栏）` : `拖到参考栏或点击绑定：${asset.name}`) : `请先生成或上传「${asset.name}」参考图`}
                        disabled={disabled || !clip || !ready}
                        onDragStart={(event) => startAssetDrag(event, asset)}
                        onClick={() => onToggle(asset)}
                    >
                        <AssetThumb asset={asset} dimmed={!ready} bound={bound} />
                    </button>
                );
            })}
        </div>
    );
}

/** Episode / all-asset pool: group by 角色 · 场景 · 道具 like SHUO. */
function AssetKindSections({
    assets,
    clip,
    disabled,
    onToggle,
}: {
    assets: StudioAsset[];
    clip?: StudioClip;
    disabled?: boolean;
    onToggle: (asset: StudioAsset) => void;
}) {
    const sections = (["character", "scene", "prop"] as StudioAssetKind[])
        .map((kind) => ({ kind, items: assets.filter((asset) => asset.kind === kind) }))
        .filter((section) => section.items.length);
    if (!sections.length) return <EmptyHint title="没有匹配的素材" />;
    return (
        <div className="space-y-3">
            {sections.map((section) => (
                <section key={section.kind}>
                    <div className="mb-1.5 text-[11px] font-medium text-neutral-400">{KIND_LABEL[section.kind]}</div>
                    <AssetGrid assets={section.items} clip={clip} disabled={disabled} onToggle={onToggle} />
                </section>
            ))}
        </div>
    );
}

function MentionChip({
    asset,
    clip,
    disabled,
    onRemove,
    index,
    indexed,
    onReorder,
}: {
    asset: StudioAsset;
    clip: StudioClip;
    disabled?: boolean;
    onRemove: () => void;
    /** 1-based slot when aligned with 视频创作台 图片N. */
    index?: number;
    indexed?: boolean;
    onReorder?: (fromId: string, toId: string) => void;
}) {
    const look = appearanceWithImage(asset, clip.appearanceRefs?.[asset.id]);
    const url = useStudioMedia(look?.imageKey);
    const missing = !look?.imageKey;
    const label = indexed && index ? imageReferenceLabel(index - 1) : `@${asset.name}`;
    return (
        <div
            draggable={Boolean(indexed && onReorder && !disabled)}
            onDragStart={(event) => {
                if (!indexed || !onReorder || disabled) return;
                event.dataTransfer.setData("text/x-clip-ref-id", asset.id);
                event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
                if (!indexed || !onReorder || disabled) return;
                if (![...event.dataTransfer.types].includes("text/x-clip-ref-id")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
                if (!indexed || !onReorder || disabled) return;
                const fromId = event.dataTransfer.getData("text/x-clip-ref-id");
                if (!fromId || fromId === asset.id) return;
                event.preventDefault();
                event.stopPropagation();
                onReorder(fromId, asset.id);
            }}
            className={cn(
                "inline-flex max-w-[180px] items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5",
                indexed ? "cursor-grab active:cursor-grabbing" : "",
                missing ? "border-amber-400/50 bg-amber-500/10" : "border-white/15 bg-black/40",
            )}
            title={missing ? `请先生成或上传「${asset.name}」参考图` : indexed ? `${label} · ${KIND_LABEL[asset.kind]} · ${asset.name}（可拖动排序）` : `${KIND_LABEL[asset.kind]} · ${asset.name}`}
        >
            <span className="relative size-6 shrink-0 overflow-hidden rounded-full bg-black/50">
                {url ? <img src={url} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-[9px] text-neutral-500">?</span>}
                {indexed && index ? (
                    <span className="absolute -left-0.5 -top-0.5 rounded bg-black/80 px-1 text-[8px] font-medium leading-3 text-white">{index}</span>
                ) : null}
            </span>
            <span className={cn("truncate text-[10px]", missing ? "text-amber-200" : "text-neutral-200")}>
                {indexed ? (
                    <>
                        <span className="text-neutral-400">{label}</span>
                        <span className="mx-0.5 text-neutral-600">·</span>
                        <span>{asset.name}</span>
                    </>
                ) : (
                    `@${asset.name}`
                )}
            </span>
            <button type="button" disabled={disabled} className="text-[11px] text-neutral-500 hover:text-neutral-200" onClick={onRemove} aria-label={`移除 ${asset.name}`}>
                ×
            </button>
        </div>
    );
}

function EpisodeListView({
    document,
    runner,
    disabled,
    onEnter,
}: {
    document: ScriptStudioDocument;
    runner: ScriptRunner;
    disabled: boolean;
    onEnter: (episodeId: string) => void;
}) {
    const { modal } = App.useApp();
    const scripted = document.episodes.filter((episode) => episode.script);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeSplitIds, setActiveSplitIds] = useState<string[]>([]);
    const characterRef = Boolean(document.settings.characterRefExperiment);
    const unsplit = scripted.filter((episode) => !episode.clips.length);
    const splitting = Boolean(runner.busy && /拆分|分镜/.test(runner.busy));

    useEffect(() => {
        if (!splitting) setActiveSplitIds([]);
    }, [splitting]);

    const toggleAll = () => {
        if (selected.size === scripted.length) setSelected(new Set());
        else setSelected(new Set(scripted.map((episode) => episode.id)));
    };

    /** Selection: all selected; no selection: only unsplit episodes. */
    const batchTargets = selected.size ? scripted.filter((episode) => selected.has(episode.id)).map((episode) => episode.id) : unsplit.map((episode) => episode.id);

    const runSplit = (ids: string[]) => {
        if (!ids.length) return;
        setActiveSplitIds(ids);
        void runner.splitEpisodes(ids);
    };

    const requestSplit = (ids: string[]) => {
        if (!ids.length) return;
        const targets = scripted.filter((episode) => ids.includes(episode.id));
        const regenerating = targets.filter((episode) => episode.clips.length);
        if (!regenerating.length) {
            runSplit(ids);
            return;
        }
        confirmResplitStoryboard(modal, {
            episodeCount: regenerating.length,
            hasVideos: regenerating.some((episode) => episode.clips.some((clip) => clip.videoKey)),
            onOk: () => runSplit(ids),
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                <h2 className="text-sm font-medium text-neutral-100">分集视频</h2>
                <span className="text-[11px] text-neutral-500">每一集会形成一套分镜脚本；确认后可进入片段编辑并生成视频</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300">
                        <Switch
                            size="small"
                            checked={characterRef}
                            disabled={disabled}
                            onChange={(checked) => runner.update((current) => ({ ...current, settings: { ...current.settings, characterRefExperiment: checked } }))}
                        />
                        人物参考 · 测试中
                    </label>
                    <DarkButton size="sm" disabled={!scripted.length} onClick={toggleAll}>
                        {selected.size === scripted.length && scripted.length ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
                        {selected.size === scripted.length && scripted.length ? "取消全选" : "全选"}
                    </DarkButton>
                    <DarkButton size="sm" tone="primary" disabled={disabled || !batchTargets.length} onClick={() => requestSplit(batchTargets)}>
                        <LayoutGrid className="size-3.5" />
                        批量拆分{batchTargets.length ? ` ${batchTargets.length}` : ""}
                    </DarkButton>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
                {!scripted.length ? (
                    <EmptyHint title="请先在「原始剧本」生成分集剧本" />
                ) : (
                    <div className="flex flex-wrap content-start gap-2">
                        {scripted.map((episode) => {
                            const counts = episodeAssetCounts(episode, document.assets);
                            const cover = episodeCoverKey(episode, document.assets);
                            const videoDone = episode.clips.filter((clip) => clip.videoKey).length;
                            const clipTotal = episode.clips.length;
                            const progress = clipTotal ? Math.round((videoDone / clipTotal) * 100) : 0;
                            const ready = clipTotal > 0;
                            const isSelected = selected.has(episode.id);
                            const isThisBusy = splitting && activeSplitIds.includes(episode.id);
                            return (
                                <article
                                    key={episode.id}
                                    style={{ width: EPISODE_CARD_WIDTH }}
                                    className={cn("relative flex shrink-0 flex-col overflow-hidden rounded-xl border bg-[#141416] transition", isSelected ? "border-white/50" : "border-white/[0.08] hover:border-white/25")}
                                >
                                    <button
                                        type="button"
                                        className="absolute left-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded bg-black/55 text-white"
                                        onClick={() =>
                                            setSelected((current) => {
                                                const next = new Set(current);
                                                if (next.has(episode.id)) next.delete(episode.id);
                                                else next.add(episode.id);
                                                return next;
                                            })
                                        }
                                    >
                                        {isSelected ? <CheckSquare className="size-3" /> : <Square className="size-3" />}
                                    </button>
                                    <div className="relative aspect-video bg-black">
                                        <CoverThumb mediaKey={cover} className="size-full" />
                                        <span className={cn("absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-medium", ready ? "bg-violet-500 text-white" : "bg-black/65 text-neutral-200")}>
                                            {ready ? "已生成" : "待拆分"}
                                        </span>
                                        {isThisBusy ? (
                                            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-black/70">
                                                <Spin size="small" />
                                                <span className="text-[10px] text-neutral-200">生成分镜中</span>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-1 flex-col gap-0.5 p-2">
                                        <div className="text-[10px] text-neutral-500">第{episode.number}集</div>
                                        <h3 className="line-clamp-2 text-[11px] font-semibold leading-4 text-neutral-100">{episode.title || `第${episode.number}集`}</h3>
                                        <p className="text-[9px] text-neutral-500">
                                            角{counts.character} · 场{counts.scene} · 道{counts.prop}
                                        </p>
                                        {ready ? (
                                            <>
                                                <p className="text-[9px] text-neutral-400">
                                                    片段 {clipTotal} · 视频 {videoDone}/{clipTotal}
                                                </p>
                                                <div className="h-0.5 overflow-hidden rounded-full bg-white/10">
                                                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
                                                </div>
                                            </>
                                        ) : null}
                                        <div className="mt-auto flex flex-col gap-1 pt-1.5">
                                            {ready ? (
                                                <>
                                                    <DarkButton tone="primary" size="sm" className="w-full !text-[10px]" onClick={() => onEnter(episode.id)}>
                                                        <Pencil className="size-3" />
                                                        进入编辑
                                                    </DarkButton>
                                                    <DarkButton size="sm" className="w-full !text-[10px]" disabled={disabled || splitting} onClick={() => requestSplit([episode.id])}>
                                                        <RefreshCw className="size-3" />
                                                        重新生成分镜
                                                    </DarkButton>
                                                </>
                                            ) : (
                                                <DarkButton tone="primary" size="sm" className="w-full !text-[10px]" disabled={disabled || splitting} onClick={() => requestSplit([episode.id])}>
                                                    <Grid2x2 className="size-3" />
                                                    生成分镜
                                                </DarkButton>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function EpisodeEditor({
    document,
    runner,
    episodeId,
    projectId,
    disabled,
    onBack,
    onSwitchEpisode,
}: {
    document: ScriptStudioDocument;
    runner: ScriptRunner;
    episodeId: string;
    projectId?: string;
    disabled: boolean;
    onBack: () => void;
    onSwitchEpisode: (episodeId: string) => void;
}) {
    const navigate = useNavigate();
    const { modal, message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const episode = document.episodes.find((item) => item.id === episodeId);
    const [clipId, setClipId] = useState(episode?.clips[0]?.id || "");
    const [assetScope, setAssetScope] = useState<"episode" | "clips" | "all">("episode");
    const [assetQuery, setAssetQuery] = useState("");
    const [instruction, setInstruction] = useState("");
    const [refDropActive, setRefDropActive] = useState(false);
    const [formattingH3, setFormattingH3] = useState(false);
    const [syncingH3, setSyncingH3] = useState(false);
    const clip = episode?.clips.find((item) => item.id === clipId) || episode?.clips[0];
    const h3PairReady = Boolean(clip?.promptH3En?.trim() && clip?.promptH3Zh?.trim());
    const h3Lang: MinimaxH3Lang = clip?.promptH3Lang === "en" ? "en" : "zh";
    const editorPrompt = h3PairReady ? (h3Lang === "en" ? clip!.promptH3En! : clip!.promptH3Zh!) : clip?.prompt || "";

    useEffect(() => {
        if (!episode?.clips.some((item) => item.id === clipId)) setClipId(episode?.clips[0]?.id || "");
    }, [episode, clipId]);

    const episodeAssets = useMemo(() => {
        if (!episode) return [] as StudioAsset[];
        const ids = new Set<string>();
        for (const asset of document.assets) {
            if (asset.sourceChapterIds?.includes(episode.id) || asset.appearances.some((look) => look.sourceChapterIds?.includes(episode.id))) ids.add(asset.id);
        }
        for (const item of episode.clips) item.assetRefs.forEach((id) => ids.add(id));
        const linked = document.assets.filter((asset) => ids.has(asset.id));
        return linked.length ? linked : document.assets;
    }, [document.assets, episode]);

    const clipGroups = useMemo(() => {
        if (!episode) return [] as Array<{ clip: StudioClip; assets: StudioAsset[]; frames: StudioClipFrame[] }>;
        return episode.clips.map((item) => ({
            clip: item,
            assets: item.assetRefs.map((id) => document.assets.find((asset) => asset.id === id)).filter((asset): asset is StudioAsset => Boolean(asset)),
            frames: item.frames || [],
        }));
    }, [document.assets, episode]);

    const clipFrameCount = clipGroups.reduce((total, group) => total + group.assets.length + group.frames.length, 0);

    const appendClipFrame = (frame: StudioClipFrame) => {
        if (!episode || !clip) return;
        const episodeId = episode.id;
        const clipId = clip.id;
        runner.update((current) => ({
            ...current,
            episodes: current.episodes.map((item) => {
                if (item.id !== episodeId) return item;
                return {
                    ...item,
                    clips: item.clips.map((entry) => (entry.id === clipId ? { ...entry, frames: [...(entry.frames || []), frame] } : entry)),
                };
            }),
        }));
        setAssetScope("clips");
    };

    const removeClipFrame = (targetClipId: string, frameId: string) => {
        if (!episode) return;
        const episodeId = episode.id;
        runner.update((current) => ({
            ...current,
            episodes: current.episodes.map((item) => {
                if (item.id !== episodeId) return item;
                return {
                    ...item,
                    clips: item.clips.map((entry) => (entry.id === targetClipId ? { ...entry, frames: (entry.frames || []).filter((frame) => frame.id !== frameId) } : entry)),
                };
            }),
        }));
    };
    const query = assetQuery.trim().toLowerCase();
    const matchAsset = (asset: StudioAsset) => !query || `${KIND_LABEL[asset.kind]} ${asset.name}`.toLowerCase().includes(query);

    const faceAppModel = isRunningHubH3FamilyGen(modelOptionName(document.settings.videoModel || ""));

    const formatClipPromptForH3 = async () => {
        const source = (clip?.promptH3Zh || clip?.promptH3En || clip?.prompt || "").trim();
        if (!source) {
            message.warning("请先填写视频提示词");
            return;
        }
        const textModel = document.settings.textModel || config.textModel || config.model;
        if (!textModel) {
            message.warning("请先在设置里选择文本模型");
            openConfigDialog(true);
            return;
        }
        setFormattingH3(true);
        try {
            const imageCount = Math.min(H3_FACE_MAX_REF_IMAGES, (clip?.assetRefs || []).length);
            const next = await rewritePromptToMinimaxH3({
                prompt: source,
                textModel,
                slots: { imageCount, videoCount: 0, audioCount: 0 },
            });
            updateClip({
                prompt: next.zh,
                promptEdited: true,
                promptH3En: next.en,
                promptH3Zh: next.zh,
                promptH3Lang: "zh",
                promptH3Dirty: undefined,
            });
            message.success("已转成 MiniMax H3 中英双份；提交用英文，改中文后点「同步到英文」");
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setFormattingH3(false);
        }
    };

    const syncClipH3Language = async (to: MinimaxH3Lang) => {
        if (!clip?.promptH3En?.trim() || !clip.promptH3Zh?.trim()) return;
        const textModel = document.settings.textModel || config.textModel || config.model;
        if (!textModel) {
            message.warning("请先在设置里选择文本模型");
            openConfigDialog(true);
            return;
        }
        const from: MinimaxH3Lang = to === "en" ? "zh" : "en";
        const source = (from === "en" ? clip.promptH3En : clip.promptH3Zh).trim();
        setSyncingH3(true);
        try {
            const translated = await translateMinimaxH3Prompt({ source, from, to, textModel });
            updateClip({
                prompt: to === "zh" ? translated : clip.promptH3Zh,
                promptEdited: true,
                promptH3En: to === "en" ? translated : clip.promptH3En,
                promptH3Zh: to === "zh" ? translated : clip.promptH3Zh,
                promptH3Dirty: undefined,
            });
            message.success("已同步");
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setSyncingH3(false);
        }
    };

    const mentionOptions = useMemo<StudioMentionOption[]>(() => {
        const boundOrder = new Map((clip?.assetRefs || []).map((id, index) => [id, index]));
        return document.assets
            .filter((asset) => assetHasImage(asset))
            .map((asset) => {
                const look = appearanceWithImage(asset, clip?.appearanceRefs?.[asset.id]);
                const appearanceName = asset.appearances.length > 1 ? (look?.name || "").trim() : "";
                const slot = boundOrder.get(asset.id);
                // H3 人脸：与视频创作台一致，已绑定参考用 @图片N；未绑定仍用资产名便于挑选。
                const mention =
                    faceAppModel && slot != null
                        ? `@${imageReferenceLabel(slot)}`
                        : `@${asset.name}${appearanceName ? ` · ${appearanceName}` : ""}`;
                return {
                    id: asset.id,
                    label: asset.name,
                    mention,
                    kindLabel: faceAppModel && slot != null ? `${imageReferenceLabel(slot)} · ${KIND_LABEL[asset.kind]}` : KIND_LABEL[asset.kind],
                    mediaKey: look?.imageKey,
                };
            });
    }, [clip?.appearanceRefs, clip?.assetRefs, document.assets, faceAppModel]);

    if (!episode) {
        return <EmptyHint title="分集不存在" hint="返回列表重试" />;
    }

    const updateClip = (patch: Partial<StudioClip>) => {
        if (!clip) return;
        runner.update((current) => ({
            ...current,
            episodes: current.episodes.map((item) => (item.id === episode.id ? { ...item, clips: item.clips.map((entry) => (entry.id === clip.id ? { ...entry, ...patch } : entry)) } : item)),
        }));
    };

    const bindAssets = (assetRefs: string[]) => {
        if (!clip) return;
        const nextRefs = faceAppModel ? assetRefs.slice(0, H3_FACE_MAX_REF_IMAGES) : assetRefs;
        runner.update((current) => ({
            ...current,
            episodes: current.episodes.map((item) => {
                if (item.id !== episode.id) return item;
                const clips = item.clips.map((entry) => {
                    if (entry.id !== clip.id) return entry;
                    return bindClipAppearanceRefs({ ...entry, assetRefs: nextRefs, promptEdited: false }, current.assets);
                });
                return { ...item, clips: buildPrompts(current, { ...item, clips }) };
            }),
        }));
    };

    const reorderRefAssets = (fromId: string, toId: string) => {
        if (!clip || fromId === toId) return;
        const list = [...clip.assetRefs];
        const from = list.indexOf(fromId);
        const to = list.indexOf(toId);
        if (from < 0 || to < 0) return;
        list.splice(from, 1);
        list.splice(to, 0, fromId);
        bindAssets(list);
    };

    const missingVideos = episode.clips.filter((item) => !item.videoKey).map((item) => item.id);
    const refAssets = (clip?.assetRefs || []).map((id) => document.assets.find((asset) => asset.id === id)).filter(Boolean) as StudioAsset[];
    const missingImages = clip ? clipMissingImageAssets(clip, document.assets) : [];
    const canGenerateClip = Boolean(clip?.prompt.trim() && clip.assetRefs.length && !missingImages.length);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
                <DarkButton size="sm" tone="ghost" onClick={onBack}>
                    <ArrowLeft className="size-3.5" />
                    返回列表
                </DarkButton>
                <Select
                    size="small"
                    className="!min-w-[200px]"
                    value={episode.id}
                    options={document.episodes.filter((item) => item.script && item.clips.length).map((item) => ({ value: item.id, label: `第${item.number}集 ${item.title}` }))}
                    onChange={onSwitchEpisode}
                />
                <div className="ml-auto flex items-center gap-1.5">
                    <DarkButton
                        size="sm"
                        disabled={disabled || !episode.clips.length || Boolean(runner.busy)}
                        onClick={() =>
                            confirmResplitStoryboard(modal, {
                                episodeCount: 1,
                                hasVideos: episode.clips.some((item) => item.videoKey),
                                onOk: () => runner.splitEpisodes([episode.id]),
                            })
                        }
                    >
                        重新生成分镜
                    </DarkButton>
                    <DarkButton size="sm" disabled={disabled || !missingVideos.length} onClick={() => void runner.generateVideos(episode.id, missingVideos)}>
                        批量缺视频 {missingVideos.length || ""}
                    </DarkButton>
                    <DarkButton
                        size="sm"
                        disabled={disabled || !episode.clips.some((item) => item.videoKey)}
                        onClick={async () => {
                            const canvasId = await runner.syncCanvas({ episodeIds: [episode.id], includeAssets: true });
                            if (canvasId) navigate(`/canvas/${canvasId}`);
                        }}
                    >
                        加入画布
                    </DarkButton>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 gap-2 p-2">
                <aside className="flex h-full min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#101012]">
                    <div className="flex gap-1 border-b border-white/[0.06] p-1.5">
                        {(
                            [
                                ["episode", "本集素材", episodeAssets.length],
                                ["clips", "片段帧", clipFrameCount],
                                ["all", "总素材", document.assets.length],
                            ] as const
                        ).map(([scope, label, count]) => {
                            const active = assetScope === scope;
                            return (
                                <button key={scope} type="button" onClick={() => setAssetScope(scope)} style={active ? inkOnWhiteStyle : undefined} className={cn("rounded-md px-1.5 py-1 text-[10px]", active ? "bg-white" : "text-neutral-400 hover:bg-white/[0.06]")}>
                                    {label} {count}
                                </button>
                            );
                        })}
                    </div>
                    <div className="border-b border-white/[0.06] px-2 py-1.5">
                        <Input size="small" value={assetQuery} placeholder="筛选角色 / 场景 / 道具" onChange={(event) => setAssetQuery(event.target.value)} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                        {assetScope === "clips" ? (
                            clipGroups.some((group) => group.assets.some(matchAsset) || group.frames.length) ? (
                                <div className="space-y-3">
                                    <p className="text-[10px] leading-4 text-amber-200/90">图片帧可作生视频参考；在右侧预览里截取当前帧或裁剪视频后会出现在这里</p>
                                    {clipGroups.map((group) => {
                                        const visible = group.assets.filter(matchAsset);
                                        if (!visible.length && !group.frames.length) return null;
                                        const total = visible.length + group.frames.length;
                                        return (
                                            <section key={group.clip.id}>
                                                <button type="button" className="mb-1.5 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setClipId(group.clip.id)}>
                                                    片段{padClip(group.clip.number)} · {total} 项
                                                </button>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {visible.map((asset) => {
                                                        const ready = assetHasImage(asset);
                                                        const bound = Boolean(clip?.assetRefs.includes(asset.id));
                                                        return (
                                                            <button
                                                                key={asset.id}
                                                                type="button"
                                                                draggable={ready && !disabled}
                                                                title={ready ? (bound ? `已绑定：${asset.name}（可拖到参考栏）` : `拖到参考栏或点击绑定：${asset.name}`) : `请先生成或上传「${asset.name}」参考图`}
                                                                disabled={disabled || !clip || !ready}
                                                                onDragStart={(event) => startAssetDrag(event, asset)}
                                                                onClick={() => toggleClipAsset(clip, asset, bindAssets)}
                                                            >
                                                                <AssetThumb asset={asset} dimmed={!ready} bound={bound} />
                                                            </button>
                                                        );
                                                    })}
                                                    {group.frames.map((frame) => (
                                                        <div key={frame.id} className="relative">
                                                            <button type="button" title={frame.label} className="w-full" onClick={() => setClipId(group.clip.id)}>
                                                                <ClipFrameThumb frame={frame} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={disabled}
                                                                title="删除此帧"
                                                                className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-neutral-200 hover:bg-red-500/80"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    removeClipFrame(group.clip.id, frame.id);
                                                                }}
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptyHint title="还没有片段帧" hint="生成视频后，在右侧预览截取当前帧或裁剪视频" />
                            )
                        ) : (
                            <AssetKindSections
                                assets={(assetScope === "episode" ? episodeAssets : document.assets).filter(matchAsset)}
                                clip={clip}
                                disabled={disabled}
                                onToggle={(asset) => toggleClipAsset(clip, asset, bindAssets)}
                            />
                        )}
                    </div>
                </aside>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                    <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
                        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#101012]">
                            {clip ? (
                                <>
                                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
                                        <h3 className="text-sm font-medium text-neutral-100">片段{padClip(clip.number)}</h3>
                                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">{document.settings.visualStyle || "默认风格"}</span>
                                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">{document.settings.aspectRatio || "16:9"}</span>
                                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">{document.settings.promptMode}</span>
                                        <span className="text-[10px] text-neutral-500">
                                            {clipDuration(clip)}s · {clip.shots.length} 镜
                                        </span>
                                    </div>
                                    {/* Fixed reference rail: chips + AI instruction stay put; only the prompt below scrolls. */}
                                    <div
                                        className={cn("shrink-0 space-y-2 border-b border-white/[0.06] px-3 py-2", refDropActive ? "bg-violet-500/10" : "bg-[#101012]")}
                                        onDragOver={(event) => {
                                            if (disabled) return;
                                            if (![...event.dataTransfer.types].includes(ASSET_DRAG_MIME) && ![...event.dataTransfer.types].includes("text/plain")) return;
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                            setRefDropActive(true);
                                        }}
                                        onDragLeave={(event) => {
                                            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                                            setRefDropActive(false);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            setRefDropActive(false);
                                            if (disabled || !clip) return;
                                            const assetId = event.dataTransfer.getData(ASSET_DRAG_MIME) || event.dataTransfer.getData("text/plain");
                                            const asset = document.assets.find((item) => item.id === assetId);
                                            if (!asset || !assetHasImage(asset)) return;
                                            if (clip.assetRefs.includes(asset.id)) return;
                                            if (faceAppModel && clip.assetRefs.length >= H3_FACE_MAX_REF_IMAGES) return;
                                            bindAssets([...clip.assetRefs, asset.id]);
                                        }}
                                    >
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {refAssets.map((asset, index) => (
                                                <MentionChip
                                                    key={asset.id}
                                                    asset={asset}
                                                    clip={clip}
                                                    disabled={disabled}
                                                    index={index + 1}
                                                    indexed={faceAppModel}
                                                    onReorder={faceAppModel ? reorderRefAssets : undefined}
                                                    onRemove={() => bindAssets(clip.assetRefs.filter((id) => id !== asset.id))}
                                                />
                                            ))}
                                            {!refAssets.length ? (
                                                <span className="text-[11px] text-neutral-500">
                                                    {faceAppModel ? "将左侧素材拖入此处作为图片参考（最多 9 张，顺序=图片1…）" : "将左侧素材拖入此处作为参考"}
                                                </span>
                                            ) : null}
                                            {faceAppModel && h3PairReady ? (
                                                <>
                                                    <div className="ml-auto inline-flex overflow-hidden rounded-md border border-white/15">
                                                        <DarkButton
                                                            size="sm"
                                                            className={`!rounded-none ${h3Lang === "zh" ? "!bg-white !text-neutral-900" : ""}`}
                                                            style={h3Lang === "zh" ? inkOnWhiteStyle : undefined}
                                                            disabled={disabled || formattingH3 || syncingH3}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => updateClip({ promptH3Lang: "zh" })}
                                                        >
                                                            中文{clip.promptH3Dirty === "zh" ? " *" : ""}
                                                        </DarkButton>
                                                        <DarkButton
                                                            size="sm"
                                                            className={`!rounded-none !border-l-0 ${h3Lang === "en" ? "!bg-white !text-neutral-900" : ""}`}
                                                            style={h3Lang === "en" ? inkOnWhiteStyle : undefined}
                                                            disabled={disabled || formattingH3 || syncingH3}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => updateClip({ promptH3Lang: "en" })}
                                                        >
                                                            英文{clip.promptH3Dirty === "en" ? " *" : ""}
                                                        </DarkButton>
                                                    </div>
                                                    <DarkButton size="sm" disabled={disabled || formattingH3 || syncingH3} onClick={() => void syncClipH3Language(h3Lang === "zh" ? "en" : "zh")}>
                                                        {syncingH3 ? "同步中…" : h3Lang === "zh" ? "同步到英文" : "同步到中文"}
                                                    </DarkButton>
                                                </>
                                            ) : null}
                                            {faceAppModel ? (
                                                <DarkButton size="sm" className={h3PairReady ? "" : "ml-auto"} disabled={disabled || formattingH3 || syncingH3 || !editorPrompt.trim()} onClick={() => void formatClipPromptForH3()}>
                                                    <Sparkles className="size-3" />
                                                    {formattingH3 ? "转换中…" : "转成 H3 格式"}
                                                </DarkButton>
                                            ) : null}
                                            <DarkButton size="sm" className={faceAppModel ? "" : "ml-auto"} disabled={disabled || !clip.prompt || !instruction.trim()} onClick={() => void runner.adjustClip(episode.id, clip.id, instruction.trim())}>
                                                <Wand2 className="size-3" />
                                                AI 调整
                                            </DarkButton>
                                        </div>
                                        {faceAppModel && refAssets.length ? (
                                            <p className="text-[10px] text-neutral-500">Minimax_H3：参考顺序对应 @图片1…；生成时会按视频创作台方式映射到模型槽位（最多 {H3_FACE_MAX_REF_IMAGES} 张）</p>
                                        ) : null}
                                        {missingImages.length ? (
                                            <p className="text-[11px] text-amber-300">请先生成或上传参考图：{missingImages.map((asset) => `${KIND_LABEL[asset.kind]}「${asset.name}」`).join("、")}</p>
                                        ) : null}
                                        <Input size="small" disabled={disabled} value={instruction} placeholder="AI 调整说明（可选）" onChange={(event) => setInstruction(event.target.value)} />
                                    </div>
                                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                                        <StudioPromptMentionInput
                                            key={h3PairReady ? `clip-h3-${clip.id}-${h3Lang}` : `clip-${clip.id}`}
                                            fill
                                            disabled={disabled}
                                            value={editorPrompt}
                                            options={mentionOptions}
                                            minRows={8}
                                            placeholder={faceAppModel ? "视频提示词；输入 @ 选择图片参考（图片1…）" : "视频提示词；输入 @ 选择角色/场景/道具参考图"}
                                            onChange={(prompt) => {
                                                if (h3PairReady) {
                                                    updateClip({
                                                        prompt: h3Lang === "zh" ? prompt : clip.promptH3Zh || prompt,
                                                        promptEdited: true,
                                                        promptH3En: h3Lang === "en" ? prompt : clip.promptH3En,
                                                        promptH3Zh: h3Lang === "zh" ? prompt : clip.promptH3Zh,
                                                        promptH3Dirty: h3Lang,
                                                        promptH3Lang: h3Lang,
                                                    });
                                                    return;
                                                }
                                                updateClip({ prompt, promptEdited: true, promptH3En: undefined, promptH3Zh: undefined, promptH3Dirty: undefined });
                                            }}
                                            onPick={(option) => {
                                                if (!clip.assetRefs.includes(option.id)) bindAssets([...clip.assetRefs, option.id]);
                                            }}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-2">
                                        <div className="min-w-[160px] flex-1">
                                            <ModelPicker
                                                config={config}
                                                value={document.settings.videoModel}
                                                onChange={(value) =>
                                                    runner.update((current) => {
                                                        const picked = value || config.model || config.videoModel || "";
                                                        const modelConfig = { ...config, model: picked, videoModel: picked };
                                                        const face = isRunningHubH3FamilyGen(modelOptionName(value || ""));
                                                        const allowed = videoQualityChoices(modelConfig, face);
                                                        const videoQuality = resolveVideoQuality(current.settings.videoQuality, allowed);
                                                        const videoSize = resolveVideoSize(current.settings.videoSize || current.settings.aspectRatio, videoQuality, current.settings.aspectRatio || "16:9");
                                                        const assetRefs = face
                                                            ? (current.episodes.find((item) => item.id === episode.id)?.clips.find((entry) => entry.id === clip?.id)?.assetRefs || []).slice(0, H3_FACE_MAX_REF_IMAGES)
                                                            : undefined;
                                                        return {
                                                            ...current,
                                                            settings: { ...current.settings, videoModel: value, videoQuality, videoSize },
                                                            ...(assetRefs
                                                                ? {
                                                                      episodes: current.episodes.map((item) =>
                                                                          item.id !== episode.id
                                                                              ? item
                                                                              : {
                                                                                    ...item,
                                                                                    clips: item.clips.map((entry) =>
                                                                                        entry.id !== clip?.id ? entry : bindClipAppearanceRefs({ ...entry, assetRefs }, current.assets),
                                                                                    ),
                                                                                },
                                                                      ),
                                                                  }
                                                                : {}),
                                                        };
                                                    })
                                                }
                                                capability="video"
                                                fullWidth
                                                placeholder="视频模型"
                                                onMissingConfig={() => openConfigDialog(true)}
                                            />
                                        </div>
                                        <VideoGenOptionsPopover
                                            config={config}
                                            videoModel={document.settings.videoModel}
                                            quality={document.settings.videoQuality}
                                            size={document.settings.videoSize || document.settings.aspectRatio}
                                            mode={document.settings.videoMode}
                                            megapixels={document.settings.videoMegapixels}
                                            seed={document.settings.videoSeed}
                                            runningHubInstanceType={document.settings.runningHubInstanceType}
                                            h3DeOilStrength={document.settings.h3DeOilStrength}
                                            clipSeconds={clipDuration(clip)}
                                            disabled={disabled}
                                            onChange={(patch) => runner.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }))}
                                        />
                                        <DarkButton tone="primary" disabled={disabled || !canGenerateClip} onClick={() => void runner.generateVideos(episode.id, [clip.id])}>
                                            <Film className="size-3.5" />
                                            {clip.videoKey ? "重新生成本片段" : "生成本片段"}
                                        </DarkButton>
                                    </div>
                                </>
                            ) : (
                                <EmptyHint title="本集还没有分镜" hint="返回列表点击「生成分镜脚本」" />
                            )}
                        </section>

                        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#101012] p-2">
                            {clip ? (
                                <>
                                    <ClipVideoPreview
                                        videoKey={clip.videoKey}
                                        running={clip.videoStatus === "running"}
                                        clipNumber={clip.number}
                                        projectId={projectId}
                                        disabled={disabled}
                                        onSaved={appendClipFrame}
                                    />
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        <DarkButton size="sm" disabled={!clip.videoKey} onClick={() => void runner.downloadClip(episode, clip)}>
                                            <Download className="size-3" />
                                            下载
                                        </DarkButton>
                                        {clip.videoStatus === "failed" && clip.videoError ? <span className="text-[11px] text-red-300">{clip.videoError}</span> : null}
                                    </div>
                                </>
                            ) : (
                                <EmptyHint title="选择片段查看预览" />
                            )}
                        </aside>
                    </div>

                    <div className="shrink-0 rounded-xl border border-white/[0.07] bg-[#0d0d0f] px-2 py-1.5">
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                            {episode.clips.map((item) => {
                                const active = item.id === clip?.id;
                                const thumbAsset = document.assets.find((asset) => item.assetRefs.includes(asset.id) && assetHasImage(asset));
                                const thumb = thumbAsset ? appearanceWithImage(thumbAsset, item.appearanceRefs?.[thumbAsset.id])?.imageKey : undefined;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setClipId(item.id)}
                                        style={active ? { boxShadow: "0 0 0 1px #fff" } : undefined}
                                        className={cn("w-[72px] shrink-0 overflow-hidden rounded-md border text-left transition", active ? "border-white" : "border-white/[0.08] hover:border-white/30")}
                                    >
                                        <div className="relative aspect-video bg-black">
                                            {item.videoKey ? <ClipStripThumb videoKey={item.videoKey} /> : <CoverThumb mediaKey={thumb} className="size-full" />}
                                            {item.videoStatus === "running" ? (
                                                <div className="absolute inset-0 grid place-items-center bg-black/50">
                                                    <Spin size="small" />
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="px-1 py-0.5">
                                            <div className="truncate text-[9px] font-medium text-neutral-200">片段{padClip(item.number)}</div>
                                            <div className="text-[8px] text-neutral-500">
                                                {clipDuration(item)}s{item.videoKey ? " · 已出" : ""}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ClipStripThumb({ videoKey }: { videoKey: string }) {
    const url = useStudioMedia(videoKey);
    if (!url) return <div className="size-full bg-black/40" />;
    return <video src={url} muted className="size-full object-cover" />;
}

export function EpisodesStep({ document, runner, projectId }: { document: ScriptStudioDocument; runner: ScriptRunner; projectId?: string }) {
    // Allow more clip video jobs to enqueue while a media batch is already running.
    const disabled = Boolean(runner.busy && !/(素材图|生成视频|批量生成|生视频)/.test(runner.busy));
    const scripted = document.episodes.filter((episode) => episode.script);
    const [view, setView] = useState<"list" | "editor">("list");
    const [editingId, setEditingId] = useState("");

    useEffect(() => {
        if (view === "editor" && editingId && !scripted.some((episode) => episode.id === editingId && episode.clips.length)) {
            setView("list");
            setEditingId("");
        }
    }, [editingId, scripted, view]);

    if (!scripted.length) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyHint title="请先在「原始剧本」生成分集剧本" />
            </div>
        );
    }

    if (view === "editor" && editingId) {
        return (
            <EpisodeEditor
                key={editingId}
                document={document}
                runner={runner}
                episodeId={editingId}
                projectId={projectId}
                disabled={disabled}
                onBack={() => {
                    setView("list");
                    setEditingId("");
                }}
                onSwitchEpisode={setEditingId}
            />
        );
    }

    return (
        <EpisodeListView
            document={document}
            runner={runner}
            disabled={disabled}
            onEnter={(episodeId) => {
                setEditingId(episodeId);
                setView("editor");
            }}
        />
    );
}
