import { useEffect, useMemo, useRef, useState } from "react";
import { App, Checkbox, Mentions, Popconfirm, Select, Switch } from "antd";
import { Download, Eraser, Eye, EyeOff, ImagePlus, RotateCcw, Scissors, Sparkles, Trash2, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { assetCoverUrl, useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { saveStudioMedia } from "@/studios/media";
import {
    characterImageKey,
    currentResult,
    KEEP_PERSON,
    orderedShots,
    personTarget,
    PROMPT_MODE_OPTIONS,
    SCOPE_OPTIONS,
    shotImageKey,
    type ReplacementPerson,
    type ReplacementPromptMode,
    type ReplacementScope,
    type ReplacementShot,
    type ReplacementStudioDocument,
} from "@/studios/replacement/document";
import { personLabel } from "@/studios/replacement/prompt-package";
import { mentionOptions, shotPackage } from "@/studios/replacement/stages";

import { ImageComparePair, KeyframeEditor, StudioImage, type BoxLabel } from "./media";
import { DarkButton, EmptyHint, IconButton, ModelSelect, Pager, Panel, QUALITY_OPTIONS, SmallSelect, StatusBadge, Tabs } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

export type ShotSelection = { shotId: string; setShotId: (id: string) => void; checked: string[]; setChecked: (ids: string[]) => void; onEditCuts: (sourceId: string) => void };

export function ShotTimeline({
    document,
    selection,
    thumb,
    status,
}: {
    document: ReplacementStudioDocument;
    selection: ShotSelection;
    thumb: (shot: ReplacementShot) => string;
    status: (shot: ReplacementShot) => { status?: string; error?: string };
}) {
    const shots = orderedShots(document);
    const allChecked = shots.length > 0 && shots.every((shot) => selection.checked.includes(shot.id));
    const current = shots.find((shot) => shot.id === selection.shotId) || shots[0];
    const stripRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = stripRef.current;
        if (!el) return;
        const onWheel = (event: WheelEvent) => {
            if (el.scrollWidth <= el.clientWidth) return;
            if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
            event.preventDefault();
            el.scrollLeft += event.deltaY;
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    return (
        <div className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-[#141416] p-2">
            <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="text-xs font-medium text-neutral-100">镜头</span>
                <span>{shots.length} 个</span>
                <Checkbox className="!ml-2 !text-xs !text-neutral-300" checked={allChecked} indeterminate={!allChecked && selection.checked.length > 0} onChange={(event) => selection.setChecked(event.target.checked ? shots.map((shot) => shot.id) : [])}>
                    全选
                </Checkbox>
                {selection.checked.length ? <span>已选 {selection.checked.length}</span> : null}
                <DarkButton size="sm" tone="ghost" className="ml-auto" disabled={!current} onClick={() => current && selection.onEditCuts(current.sourceId)}>
                    <Scissors className="size-3.5" />
                    编辑切点
                </DarkButton>
            </div>
            <div ref={stripRef} className="flex gap-2 overflow-x-auto pb-1">
                {shots.map((shot, index) => {
                    const active = shot.id === current?.id;
                    const state = status(shot);
                    return (
                        <div key={shot.id} onClick={() => selection.setShotId(shot.id)} className={cn("relative w-32 shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 transition", active ? "border-white" : "border-transparent hover:border-white/30")}>
                            <StudioImage mediaKey={thumb(shot)} className="aspect-video w-full" />
                            <Checkbox className="!absolute left-1.5 top-1" checked={selection.checked.includes(shot.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => selection.setChecked(event.target.checked ? [...selection.checked, shot.id] : selection.checked.filter((id) => id !== shot.id))} />
                            <div className="absolute right-1 top-1">
                                <StatusBadge status={state.status} error={state.error} />
                            </div>
                            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
                                <span>{String(index + 1).padStart(2, "0")}</span>
                                <span className="tabular-nums">{(shot.endSec - shot.startSec).toFixed(1)}s</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function MaterialList({ document, onPick, selectedPerson }: { document: ReplacementStudioDocument; onPick: (characterId: string) => void; selectedPerson?: ReplacementPerson }) {
    const characters = document.characters.filter((item) => item.kind === "character");
    return (
        <Panel title="替换素材" extra={<span className="text-[10px] text-neutral-500">拖到人物框上</span>} className="w-52 shrink-0" bodyClassName="overflow-auto px-2.5 pb-2.5">
            {characters.length ? (
                <div className="grid grid-cols-2 gap-2">
                    {characters.map((character) => (
                        <button
                            key={character.id}
                            type="button"
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData("text/x-replacement-character", character.id)}
                            onClick={() => selectedPerson && onPick(character.id)}
                            title={selectedPerson ? "点击绑定到选中的人物框" : "拖到人物框上"}
                            className="group flex cursor-grab flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-black text-left transition hover:border-white/40 active:cursor-grabbing"
                        >
                            <StudioImage mediaKey={characterImageKey(character)} className="pointer-events-none aspect-[3/4] w-full" />
                            <span className="truncate px-2 py-1.5 text-xs text-neutral-200">{character.name || "未命名"}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <EmptyHint icon={<UserRound className="size-5" />} title="还没有替换素材" hint="在「素材设定」上传或生成人物形象" className="min-h-[200px]" />
            )}
        </Panel>
    );
}

export function ImageStep({ document, runner, selection }: { document: ReplacementStudioDocument; runner: ReplacementRunner; selection: ShotSelection }) {
    const { message } = App.useApp();
    const shots = orderedShots(document);
    const shot = shots.find((item) => item.id === selection.shotId) || shots[0];
    const [personId, setPersonId] = useState("");
    const [showBoxes, setShowBoxes] = useState(true);
    const library = useAssetStore((state) => state.assets).filter((asset): asset is ImageAsset => asset.kind === "image");
    const pkg = useMemo(() => (shot ? shotPackage(document, shot) : null), [document, shot]);

    if (!shot || !pkg) return <EmptyHint title="还没有镜头" hint="请先在顶部「原视频」里加入并处理视频" />;

    const person = shot.persons.find((item) => item.id === personId);
    const patchShot = (patch: Partial<ReplacementShot>) => runner.patchShot(shot.id, patch);
    const patchPerson = (id: string, patch: Partial<ReplacementPerson>) => runner.patchShot(shot.id, (current) => ({ persons: current.persons.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));

    const bind = (id: string, characterId: string) => {
        const target = shot.persons.find((item) => item.id === id);
        if (!target) return;
        setPersonId(id);
        if (document.settings.syncIdentity && target.identity) {
            runner.update((current) => ({
                ...current,
                identities: current.identities.map((identity) => (identity.id === target.identity ? { ...identity, targetCharacterId: characterId } : identity)),
                shots: current.shots.map((item) => (item.id === shot.id ? { ...item, persons: item.persons.map((entry) => (entry.id === id ? { ...entry, targetCharacterId: "", targetAppearanceId: undefined } : entry)) } : item)),
            }));
        } else patchPerson(id, { targetCharacterId: characterId, targetAppearanceId: undefined });
    };

    const labels: BoxLabel[] = pkg.markers.length
        ? pkg.markers.map((marker) => ({ personId: marker.personId, label: marker.label, colorIndex: marker.colorIndex, active: marker.mapped }))
        : shot.persons.map((item) => ({ personId: item.id, label: personLabel(item).replace("人物", ""), colorIndex: item.promptMarkerIndex, active: Boolean(personTarget(item, document.identities)) }));

    const targetOf = (item: ReplacementPerson) => {
        const character = document.characters.find((entry) => entry.id === personTarget(item, document.identities));
        return character ? { name: character.name || "未命名", imageKey: characterImageKey(character, item.targetAppearanceId) } : null;
    };

    const manual = shot.promptMode === "manual";
    const promptValue = manual ? shot.manualPrompt : pkg.prompt;
    const options = mentionOptions(document, shot);
    const result = currentResult(shot.imageResults, shot.imageIndex);
    const targets = selection.checked.length ? selection.checked : [shot.id];
    const personCharacter = person ? document.characters.find((item) => item.id === personTarget(person, document.identities)) : undefined;
    const scenes = document.characters.filter((item) => item.kind === "scene");

    const addLibraryMention = async (asset: ImageAsset) => {
        const label = (asset.title || "素材").replace(/[\s@，。、,.;；:：！!？?（）()]+/gu, "").slice(0, 16) || "素材";
        const key = await saveStudioMedia(asset.data.dataUrl || assetCoverUrl(asset), "image");
        const base = manual ? shot.manualPrompt : pkg.prompt;
        patchShot({ promptMode: "manual", manualPrompt: `${base}${base.endsWith(" ") || !base ? "" : " "}@${label} `, mentions: { ...(shot.mentions || {}), [label]: key } });
        message.success(`已引用 @${label}`);
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 gap-2">
                <MaterialList document={document} selectedPerson={person} onPick={(characterId) => person && bind(person.id, characterId)} />

                <Panel
                    className="min-w-0 flex-1"
                    bodyClassName="flex min-h-0 flex-col gap-2 px-3 pb-3"
                    title={`镜头 ${String(shots.indexOf(shot) + 1).padStart(2, "0")}`}
                    extra={
                        <>
                            <Tabs<ReplacementPromptMode> value={shot.promptMode} onChange={(mode) => patchShot({ promptMode: mode, ...(mode === "manual" && !shot.manualPrompt ? { manualPrompt: pkg.prompt } : {}) })} items={PROMPT_MODE_OPTIONS.map((item) => ({ key: item.value, label: item.label }))} />
                            <IconButton onClick={() => setShowBoxes((value) => !value)} title={showBoxes ? "隐藏人物框" : "显示人物框"}>
                                {showBoxes ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                            </IconButton>
                            <Popconfirm title="清空这个镜头的全部人物框？" onConfirm={() => patchShot({ persons: [] })}>
                                <DarkButton size="sm" tone="ghost" disabled={!shot.persons.length} title="清空全部人物框">
                                    <Eraser className="size-3.5" />
                                    清空人物框
                                </DarkButton>
                            </Popconfirm>
                        </>
                    }
                >
                    {result ? (
                        <ImageComparePair
                            className="min-h-0 flex-1"
                            left={shot.keyframeKey}
                            right={result.key}
                            leftLabel="原图"
                            rightLabel="替换结果"
                            rightExtra={
                                <>
                                    <StatusBadge status={shot.imageStatus} error={shot.imageError} />
                                    <Pager index={Math.min(shot.imageIndex, shot.imageResults.length - 1)} total={shot.imageResults.length} onChange={(imageIndex) => patchShot({ imageIndex })} />
                                </>
                            }
                            rightOverlay={
                                <>
                                    <IconButton
                                        className="!bg-black/55 !text-white hover:!bg-black/75"
                                        title="下载"
                                        onClick={() => void runner.exportMedia(result.key, `镜头片段${String(shots.indexOf(shot) + 1).padStart(2, "0")}-关键帧`, "png")}
                                    >
                                        <Download className="size-4" />
                                    </IconButton>
                                    <Popconfirm
                                        title="删除这条结果？"
                                        onConfirm={() =>
                                            runner.patchShot(shot.id, (current) => {
                                                const imageResults = current.imageResults.filter((item) => item.id !== result.id);
                                                return { imageResults, imageIndex: Math.min(current.imageIndex, Math.max(0, imageResults.length - 1)) };
                                            })
                                        }
                                    >
                                        <IconButton className="!bg-black/55 !text-white hover:!bg-black/75" title="删除结果">
                                            <Trash2 className="size-4" />
                                        </IconButton>
                                    </Popconfirm>
                                </>
                            }
                            leftSlot={
                                <KeyframeEditor
                                    className="min-h-0 flex-1 [max-height:100%]"
                                    keyframeKey={shot.keyframeKey}
                                    persons={showBoxes ? shot.persons : []}
                                    labels={labels}
                                    selectedId={personId}
                                    onSelect={setPersonId}
                                    onChange={(persons) => patchShot({ persons })}
                                    onDropCharacter={bind}
                                    targetOf={targetOf}
                                />
                            }
                        />
                    ) : (
                        <KeyframeEditor
                            className="min-h-0 flex-1 [max-height:100%]"
                            keyframeKey={shot.keyframeKey}
                            persons={showBoxes ? shot.persons : []}
                            labels={labels}
                            selectedId={personId}
                            onSelect={setPersonId}
                            onChange={(persons) => patchShot({ persons })}
                            onDropCharacter={bind}
                            targetOf={targetOf}
                        />
                    )}
                    <div className="flex min-h-[36px] flex-wrap items-center gap-2 text-xs text-neutral-400">
                        {person ? (
                            <>
                                <span className="text-neutral-200">人物 {labels.find((item) => item.personId === person.id)?.label}</span>
                                <Select
                                    size="small"
                                    variant="filled"
                                    popupMatchSelectWidth={false}
                                    className="min-w-[130px]"
                                    value={person.targetCharacterId}
                                    onChange={(value) => patchPerson(person.id, { targetCharacterId: value, targetAppearanceId: undefined })}
                                    options={[
                                        { value: "", label: !person.targetCharacterId && personCharacter ? `跟随人物设定（${personCharacter.name}）` : "跟随人物设定" },
                                        { value: KEEP_PERSON, label: "保持原人物" },
                                        ...document.characters.filter((item) => item.kind === "character").map((item) => ({ value: item.id, label: item.name || "未命名" })),
                                    ]}
                                />
                                {personCharacter && personCharacter.appearances.length > 1 ? (
                                    <Select
                                        size="small"
                                        variant="filled"
                                        popupMatchSelectWidth={false}
                                        value={person.targetAppearanceId || personCharacter.baseAppearanceId}
                                        onChange={(value) => patchPerson(person.id, { targetAppearanceId: value })}
                                        options={personCharacter.appearances.map((item, index) => ({ value: item.id, label: `形象 ${index + 1}${item.id === personCharacter.baseAppearanceId ? "（基础）" : ""}` }))}
                                    />
                                ) : null}
                                <SmallSelect<ReplacementScope> value={person.scope} onChange={(scope) => patchPerson(person.id, { scope })} options={SCOPE_OPTIONS} />
                                <DarkButton size="sm" tone="ghost" onClick={() => patchShot({ persons: shot.persons.filter((item) => item.id !== person.id) })}>
                                    <Trash2 className="size-3.5" />
                                    删除框
                                </DarkButton>
                            </>
                        ) : (
                            <span>点击人物框调整替换目标与范围；在空白处拖动可手动画框</span>
                        )}
                        {scenes.length ? (
                            <Select
                                size="small"
                                variant="filled"
                                popupMatchSelectWidth={false}
                                className="ml-auto min-w-[120px]"
                                value={shot.sceneId}
                                onChange={(value) => patchShot({ sceneId: value })}
                                options={[{ value: "", label: "保持原场景" }, ...scenes.map((item) => ({ value: item.id, label: `场景：${item.name}` }))]}
                            />
                        ) : null}
                    </div>
                </Panel>

                <aside className="flex w-[320px] shrink-0 flex-col gap-2">
                    {!result && (shot.imageStatus === "running" || shot.imageError) ? (
                        <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#1b1b1e] px-3 py-2 text-xs text-neutral-400">
                            <StatusBadge status={shot.imageStatus} error={shot.imageError} />
                            <span className="truncate">{shot.imageStatus === "running" ? "生成中…" : shot.imageError}</span>
                        </div>
                    ) : null}
                    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/[0.08] bg-[#1b1b1e] p-3">
                        <Mentions
                            variant="borderless"
                            autoSize={{ minRows: 4, maxRows: 9 }}
                            prefix="@"
                            value={promptValue}
                            onChange={(value) => patchShot({ promptMode: "manual", manualPrompt: value })}
                            placeholder="提示词，输入 @ 引用当前首帧、主体定位图或素材"
                            options={options.map((option) => ({ value: option.label, label: <span className="text-xs">{option.label}<span className="ml-2 text-neutral-500">{option.group}</span></span> }))}
                            className="!px-0 !text-xs !leading-5"
                        />
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
                            {manual ? (
                                <DarkButton size="sm" tone="ghost" className="!h-6 !px-2" onClick={() => patchShot({ promptMode: "positioning" })}>
                                    <RotateCcw className="size-3" />
                                    恢复自动提示词
                                </DarkButton>
                            ) : null}
                            {library.length ? (
                                <Select
                                    size="small"
                                    variant="filled"
                                    popupMatchSelectWidth={false}
                                    placeholder={<span className="inline-flex items-center gap-1"><ImagePlus className="size-3" />引用素材库</span>}
                                    value={null}
                                    onChange={(id) => {
                                        const asset = library.find((item) => item.id === id);
                                        if (asset) void addLibraryMention(asset);
                                    }}
                                    options={library.map((asset) => ({ value: asset.id, label: <span className="flex items-center gap-2"><img src={assetCoverUrl(asset)} alt="" className="size-6 rounded object-cover" />{asset.title}</span> }))}
                                />
                            ) : null}
                            <SmallSelect<ReplacementScope | "">
                                value=""
                                onChange={(scope) => scope && patchShot({ persons: shot.persons.map((item) => ({ ...item, scope })) })}
                                options={[{ value: "", label: "全部替换" }, ...SCOPE_OPTIONS.map((item) => ({ value: item.value, label: `全部：${item.label}` }))]}
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-2 text-xs text-neutral-300">
                            <label className="flex items-center gap-1.5">
                                <Switch size="small" checked={document.settings.useEnhancement} onChange={(useEnhancement) => runner.update((current) => ({ ...current, settings: { ...current.settings, useEnhancement } }))} />
                                AI 提示词增强
                            </label>
                            <label className="flex items-center gap-1.5">
                                <Switch size="small" checked={document.settings.useSourceDescriptions} onChange={(useSourceDescriptions) => runner.update((current) => ({ ...current, settings: { ...current.settings, useSourceDescriptions } }))} />
                                原人物描述
                            </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <ModelSelect capability="image" value={document.settings.imageModel} onChange={(imageModel) => runner.update((current) => ({ ...current, settings: { ...current.settings, imageModel } }))} placeholder="图片模型" className="!min-w-[130px]" />
                            <SmallSelect value={document.settings.imageQuality || "auto"} onChange={(imageQuality) => runner.update((current) => ({ ...current, settings: { ...current.settings, imageQuality } }))} options={QUALITY_OPTIONS} />
                            <DarkButton tone="primary" size="sm" className="ml-auto" disabled={Boolean(runner.busy)} onClick={() => void runner.replaceImages(targets)}>
                                <Sparkles className="size-3.5" />
                                {targets.length > 1 ? `生成 ${targets.length} 个关键帧` : "生成关键帧"}
                            </DarkButton>
                        </div>
                        {pkg.warnings.length ? <p className="text-[11px] leading-4 text-amber-300">{pkg.warnings.join("；")}</p> : null}
                    </div>
                </aside>
            </div>
            <ShotTimeline document={document} selection={selection} thumb={(item) => shotImageKey(item) || item.keyframeKey} status={(item) => ({ status: item.imageStatus, error: item.imageError })} />
        </div>
    );
}
