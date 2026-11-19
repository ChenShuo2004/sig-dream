import { useEffect, useState } from "react";
import { Input, Popconfirm, Slider, Switch } from "antd";
import { Download, Film, Repeat, Scissors, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { REPLACEMENT_PROMPTS } from "@/studios/prompts/replacement.generated";
import { currentResult, orderedShots, shotDuration, shotImageKey, type ReplacementStudioDocument } from "@/studios/replacement/document";
import { shotFileName } from "@/studios/replacement/stages";

import { ShotTimeline, type ShotSelection } from "./image-step";
import { StudioImage, SyncedPair } from "./media";
import { DarkButton, EmptyHint, IconButton, ModelSelect, Pager, Panel, StatusBadge, resolveRunningHubVideoOptionValue, useRunningHubVideoOptions } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

export function VideoStep({ document, runner, selection }: { document: ReplacementStudioDocument; runner: ReplacementRunner; selection: ShotSelection }) {
    const shots = orderedShots(document);
    const shot = shots.find((item) => item.id === selection.shotId) || shots[0];
    const [range, setRange] = useState<[number, number]>([0, 0]);
    const [trimming, setTrimming] = useState(false);
    const videoModels = useRunningHubVideoOptions();
    const duration = shot ? shotDuration(shot) : 0;

    useEffect(() => {
        setRange([0, duration]);
        setTrimming(false);
    }, [shot?.id, duration]);

    if (!shot) return <EmptyHint title="还没有镜头" hint="请先在顶部「原视频」里加入并处理视频" />;
    const number = shots.indexOf(shot) + 1;
    const result = currentResult(shot.videoResults, shot.videoIndex);
    const firstFrame = shotImageKey(shot);
    const targets = selection.checked.length ? selection.checked : [shot.id];
    const missingFrames = targets.filter((id) => !shotImageKey(shots.find((item) => item.id === id)!)).length;
    const busy = Boolean(runner.busy);

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 gap-2">
                <Panel title="首帧参考" extra={<span className="text-[10px] text-neutral-500">来自图像替换</span>} className="w-52 shrink-0" bodyClassName="flex flex-col gap-1.5 overflow-auto px-2.5 pb-2.5">
                    {shots.map((item, index) => {
                        const key = shotImageKey(item);
                        return (
                            <button key={item.id} type="button" onClick={() => selection.setShotId(item.id)} className={cn("flex items-center gap-2 rounded-xl border p-1.5 text-left transition", item.id === shot.id ? "border-white bg-white/[0.08]" : "border-transparent hover:bg-white/[0.04]")}>
                                <StudioImage mediaKey={key || item.keyframeKey} className={cn("aspect-video w-20 shrink-0 rounded-lg", key ? "" : "opacity-40")} />
                                <div className="flex min-w-0 flex-col gap-1">
                                    <span className="text-xs text-neutral-200">镜头 {String(index + 1).padStart(2, "0")}</span>
                                    {key ? <StatusBadge status={item.videoStatus} error={item.videoError} /> : <span className="text-[11px] text-neutral-500">未替换首帧</span>}
                                </div>
                            </button>
                        );
                    })}
                </Panel>

                <Panel
                    className="min-w-0 flex-1"
                    bodyClassName="flex min-h-0 flex-col gap-2 px-3 pb-3"
                    title={`镜头 ${String(number).padStart(2, "0")}`}
                    extra={
                        <>
                            <Pager index={Math.min(shot.videoIndex, shot.videoResults.length - 1)} total={shot.videoResults.length} onChange={(videoIndex) => runner.patchShot(shot.id, { videoIndex })} />
                            <IconButton disabled={!result} title="下载替换视频" onClick={() => result && void runner.exportMedia(result.key, shotFileName(number, "替换视频"), "mp4")}>
                                <Download className="size-4" />
                            </IconButton>
                            <Popconfirm title="删除这条视频结果？" disabled={!result} onConfirm={() => runner.patchShot(shot.id, (current) => {
                                const videoResults = current.videoResults.filter((item) => item.id !== result?.id);
                                return { videoResults, videoIndex: Math.min(current.videoIndex, videoResults.length - 1) };
                            })}>
                                <IconButton disabled={!result} title="删除结果">
                                    <Trash2 className="size-4" />
                                </IconButton>
                            </Popconfirm>
                        </>
                    }
                >
                    <SyncedPair
                        className="min-h-0 flex-1"
                        left={shot.referenceKey || shot.clipKey}
                        right={result?.key}
                        leftLabel={`原视频${shot.referenceKey ? "（已裁剪）" : ""}${shot.reversed ? "（倒放）" : ""}`}
                        rightLabel="替换视频"
                        rightEmpty={<EmptyHint icon={<Film className="size-6" />} title={shot.videoStatus === "running" ? "视频生成中…" : shot.videoError || "还没有替换视频"} hint={shot.videoStatus === "running" ? "视频模型通常需要几分钟" : undefined} />}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                        <DarkButton size="sm" tone={trimming ? "primary" : "subtle"} disabled={busy} onClick={() => setTrimming((value) => !value)}>
                            <Scissors className="size-3.5" />
                            裁剪参考视频
                        </DarkButton>
                        <DarkButton size="sm" disabled={busy} onClick={() => void runner.reverseShot(shot.id)}>
                            <Repeat className="size-3.5" />
                            {shot.reversed ? "取消倒放" : "倒放"}
                        </DarkButton>
                        <label className="ml-auto flex items-center gap-1.5">
                            <Switch size="small" checked={Boolean(shot.useOriginal)} onChange={(useOriginal) => runner.patchShot(shot.id, { useOriginal })} />
                            合成时使用原视频
                        </label>
                    </div>
                    {trimming ? (
                        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                            <Slider range min={0} max={duration} step={0.1} value={range} onChange={(value) => setRange(value as [number, number])} className="flex-1" />
                            <span className="w-28 text-right text-xs tabular-nums text-neutral-300">
                                {range[0].toFixed(1)}s – {range[1].toFixed(1)}s
                            </span>
                            <DarkButton size="sm" tone="primary" disabled={busy || range[1] - range[0] < 0.5} onClick={() => {
                                void runner.trimReference(shot.id, range[0], range[1]);
                                setTrimming(false);
                            }}>
                                应用裁剪
                            </DarkButton>
                        </div>
                    ) : null}
                </Panel>

                <aside className="flex w-[300px] shrink-0 flex-col gap-2">
                    <Panel title="首帧" className="shrink-0" bodyClassName="px-2.5 pb-2.5">
                        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                            {firstFrame ? <StudioImage mediaKey={firstFrame} fit="contain" className="max-h-full w-full" /> : <span className="px-4 text-center text-[11px] text-neutral-500">先完成图像替换</span>}
                        </div>
                    </Panel>
                    <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-[#1b1b1e] p-2">
                        <Input.TextArea
                            variant="borderless"
                            autoSize={{ minRows: 3, maxRows: 7 }}
                            value={shot.videoPrompt ?? ""}
                            placeholder={document.settings.videoPrompt || REPLACEMENT_PROMPTS.defaultVideoPrompt}
                            onChange={(event) => runner.patchShot(shot.id, { videoPrompt: event.target.value })}
                            className="!px-0 !text-xs !leading-5"
                        />
                        <p className="text-[10px] leading-4 text-neutral-500">留空则用默认提示词（首帧参考 + 原动作）。</p>
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
                            <ModelSelect
                                capability="video"
                                options={videoModels}
                                value={resolveRunningHubVideoOptionValue(document.settings.videoModel, videoModels)}
                                onChange={(videoModel) => runner.update((current) => ({ ...current, settings: { ...current.settings, videoModel } }))}
                                placeholder="视频编辑 Scail V1"
                                className="!min-w-[180px]"
                            />
                            <span className="text-[11px] tabular-nums text-neutral-500">{Math.ceil(shot.referenceDurationSec || duration)} 秒</span>
                            <DarkButton tone="primary" size="sm" className="ml-auto" disabled={busy || missingFrames === targets.length} onClick={() => void runner.replaceVideos(targets)}>
                                <Sparkles className="size-3.5" />
                                {targets.length > 1 ? `生成 ${targets.length} 段视频` : "生成视频"}
                            </DarkButton>
                        </div>
                        {missingFrames ? <p className="text-[11px] text-amber-300">{missingFrames} 个镜头还没有替换首帧，会跳过并标记失败</p> : null}
                    </div>
                </aside>
            </div>
            <ShotTimeline document={document} selection={selection} thumb={(item) => shotImageKey(item) || item.keyframeKey} status={(item) => ({ status: item.videoStatus, error: item.videoError })} />
        </div>
    );
}
