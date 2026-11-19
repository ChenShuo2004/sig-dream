import { useState } from "react";
import { Slider, Switch } from "antd";
import { AudioLines, Clapperboard, Download, Film } from "lucide-react";

import { cn } from "@/lib/utils";
import { isAudioOnlyDocument, orderedShots, shotDuration, shotImageKey, shotVideoKey, type ReplacementStudioDocument } from "@/studios/replacement/document";

import type { ShotSelection } from "./image-step";
import { StudioAudio, StudioImage, SyncedPair } from "./media";
import { DarkButton, EmptyHint, Panel, StatusBadge, Tabs } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

function AudioComposeStep({ document, runner }: { document: ReplacementStudioDocument; runner: ReplacementRunner }) {
    const compose = document.compose;
    const busy = Boolean(runner.busy);
    const voiced = document.lines.filter((line) => line.audioKey).length;
    const total = document.sources.reduce((sum, source) => sum + (source.durationSec || 0), 0);
    const hasMix = Boolean(compose?.audioKey);

    return (
        <div className="flex h-full min-h-0 gap-2">
            <Panel title="音轨" className="w-64 shrink-0" bodyClassName="flex flex-col gap-2 overflow-auto px-2.5 pb-2.5">
                {document.sources.map((source, index) => (
                    <div key={source.id} className="flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
                        <span className="truncate text-xs text-neutral-200">
                            声音 {String(index + 1).padStart(2, "0")} · {Number(source.durationSec || 0).toFixed(1)}s
                        </span>
                        <span className="truncate text-[10px] text-neutral-500">{source.fileName}</span>
                        {source.audioKey ? <StudioAudio mediaKey={source.audioKey} className="h-7" /> : null}
                    </div>
                ))}
            </Panel>

            <Panel className="min-w-0 flex-1" bodyClassName="flex min-h-0 flex-col gap-3 px-3 pb-3" title="合成最终音频" extra={<span className="text-[10px] text-neutral-500">背景床 + 克隆/改词句</span>}>
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6">
                    {hasMix && compose?.status === "done" ? (
                        <>
                            <AudioLines className="size-8 text-emerald-300" />
                            <p className="text-sm text-neutral-100">最终音频已合成</p>
                            <p className="text-[11px] text-neutral-500">{compose.message}</p>
                            <StudioAudio mediaKey={compose.audioKey} className="h-10 w-full max-w-lg" />
                            <DarkButton size="sm" onClick={() => void runner.exportMedia(compose.audioKey, "最终音频", "wav")}>
                                <Download className="size-3.5" />
                                再次下载
                            </DarkButton>
                        </>
                    ) : (
                        <EmptyHint
                            icon={<AudioLines className="size-6" />}
                            title={compose?.status === "failed" ? compose.error || "合成失败" : compose && compose.status !== "done" ? compose.message || "合成中…" : "还没有合成最终音频"}
                            hint="把克隆/改词结果与背景声（或静音原声段）混成一条 WAV"
                        />
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[11px] text-neutral-300">
                    <span>
                        {document.sources.length} 段声音 · {total.toFixed(1)} 秒 · 已配音 {voiced}/{document.lines.length} 句
                    </span>
                    <label className="flex items-center gap-2">
                        {document.sources.some((source) => source.separation?.backgroundKey) ? "背景声音量" : "原声音量"}
                        <Slider className="w-28" min={0} max={1} step={0.05} value={document.settings.originalAudioVolume} onChange={(originalAudioVolume) => runner.update((current) => ({ ...current, settings: { ...current.settings, originalAudioVolume } }))} />
                    </label>
                    {compose ? <StatusBadge status={compose.status} error={compose.error} /> : null}
                    <DarkButton tone="primary" className="ml-auto" disabled={busy} onClick={() => void runner.composeMix()}>
                        <AudioLines className="size-4" />
                        合成最终音频
                    </DarkButton>
                </div>
            </Panel>
        </div>
    );
}

function VideoComposeStep({ document, runner, selection }: { document: ReplacementStudioDocument; runner: ReplacementRunner; selection: ShotSelection }) {
    const shots = orderedShots(document);
    const shot = shots.find((item) => item.id === selection.shotId) || shots[0];
    const [view, setView] = useState<"full" | "shot">("full");
    const [track, setTrack] = useState<"left" | "right">("right");
    const compose = document.compose;
    const busy = Boolean(runner.busy);
    if (!shot) return <EmptyHint icon={<Clapperboard className="size-6" />} title="还没有镜头" hint="请先在顶部「原视频」里加入并处理视频" />;

    const replacedCount = shots.filter((item) => !item.useOriginal && shotVideoKey(item)).length;
    const voiced = document.lines.filter((line) => line.audioKey).length;
    const total = shots.reduce((sum, item) => sum + shotDuration(item), 0);
    const multiSource = document.sources.length > 1;
    const left = view === "full" ? (multiSource ? undefined : document.sources[0]?.videoKey) : shot.clipKey;
    const right = view === "full" ? compose?.videoKey : (!shot.useOriginal && shotVideoKey(shot)) || shot.clipKey;

    return (
        <div className="flex h-full min-h-0 gap-2">
            <Panel title="镜头" extra={<span className="text-[10px] text-neutral-500">{replacedCount}/{shots.length} 已替换</span>} className="w-56 shrink-0" bodyClassName="flex flex-col gap-1.5 overflow-auto px-2.5 pb-2.5">
                {shots.map((item, index) => {
                    const replaced = shotVideoKey(item);
                    return (
                        <div
                            key={item.id}
                            onClick={() => {
                                selection.setShotId(item.id);
                                setView("shot");
                            }}
                            className={cn("flex cursor-pointer items-center gap-2 rounded-xl border p-1.5 transition", item.id === shot.id && view === "shot" ? "border-white bg-white/[0.08]" : "border-transparent hover:bg-white/[0.04]")}
                        >
                            <StudioImage mediaKey={shotImageKey(item) || item.keyframeKey} className="aspect-video w-20 shrink-0 rounded-lg" />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-xs text-neutral-200">
                                    镜头 {String(index + 1).padStart(2, "0")} <span className="text-neutral-500">{shotDuration(item).toFixed(1)}s</span>
                                </span>
                                <span className={cn("w-fit rounded-full px-1.5 py-0.5 text-[10px]", replaced && !item.useOriginal ? "bg-emerald-500/20 text-emerald-200" : "bg-white/[0.08] text-neutral-400")}>{replaced && !item.useOriginal ? "替换视频" : "原视频"}</span>
                            </div>
                            {replaced ? <Switch size="small" checked={!item.useOriginal} onClick={(_, event) => event.stopPropagation()} onChange={(checked) => runner.patchShot(item.id, { useOriginal: !checked })} /> : null}
                        </div>
                    );
                })}
            </Panel>

            <Panel
                className="min-w-0 flex-1"
                bodyClassName="flex min-h-0 flex-col gap-2 px-3 pb-3"
                title={<Tabs value={view} onChange={setView} items={[{ key: "full", label: "完整视频" }, { key: "shot", label: `镜头 ${String(shots.indexOf(shot) + 1).padStart(2, "0")}` }]} />}
                extra={
                    <>
                        <span className="text-[10px] text-neutral-500">音轨</span>
                        <Tabs value={track} onChange={setTrack} items={[{ key: "left", label: "原声" }, { key: "right", label: "替换" }]} />
                    </>
                }
            >
                <SyncedPair
                    className="min-h-0 flex-1"
                    left={left}
                    right={right}
                    leftLabel={view === "full" && multiSource ? "原视频（多源见列表）" : "原视频"}
                    rightLabel={view === "full" ? "合成结果" : "替换视频"}
                    audio={track}
                    rightEmpty={<EmptyHint icon={<Film className="size-5" />} title={compose?.status === "failed" ? compose.error || "合成失败" : compose && compose.status !== "done" ? compose.message || "合成中…" : "还没有合成"} hint="点击下方「合成全部视频」拼成完整视频" />}
                />
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[11px] text-neutral-300">
                    <span>
                        {shots.length} 个镜头 · {total.toFixed(1)} 秒 · 替换 {replacedCount} 段 · 配音 {voiced} 句
                    </span>
                    <label className="flex items-center gap-2">
                        {document.sources.some((source) => source.separation?.backgroundKey) ? "背景声音量" : "原声音量"}
                        <Slider className="w-28" min={0} max={1} step={0.05} value={document.settings.originalAudioVolume} onChange={(originalAudioVolume) => runner.update((current) => ({ ...current, settings: { ...current.settings, originalAudioVolume } }))} />
                    </label>
                    {compose ? <StatusBadge status={compose.status} error={compose.error} /> : null}
                    {compose?.status === "done" ? <span className="text-neutral-400">{compose.message}</span> : null}
                    <DarkButton tone="primary" className="ml-auto" disabled={busy} onClick={() => void runner.compose()}>
                        <Clapperboard className="size-4" />
                        合成全部视频
                    </DarkButton>
                </div>
            </Panel>
        </div>
    );
}

export function ComposeStep({ document, runner, selection }: { document: ReplacementStudioDocument; runner: ReplacementRunner; selection: ShotSelection }) {
    if (isAudioOnlyDocument(document)) return <AudioComposeStep document={document} runner={runner} />;
    return <VideoComposeStep document={document} runner={runner} selection={selection} />;
}
