import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox, Drawer, Modal, Popconfirm } from "antd";
import { Film, RefreshCw, Repeat, Scissors, Sparkles, Trash2, Upload, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useStudioMedia } from "@/studios/media";
import type { ReplacementSource, ReplacementStudioDocument } from "@/studios/replacement/document";

import { pickFiles } from "./assets-step";
import { StudioImage } from "./media";
import { DarkButton, IconButton, StatusBadge } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

function clock(value: number) {
    return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

export function SourcesDrawer({ open, onClose, document, runner, onEditCuts }: { open: boolean; onClose: () => void; document: ReplacementStudioDocument; runner: ReplacementRunner; onEditCuts: (sourceId: string) => void }) {
    const [skipCuts, setSkipCuts] = useState(false);
    const busy = Boolean(runner.busy);
    return (
        <Drawer title="原视频" open={open} onClose={onClose} width={460} styles={{ body: { padding: 16 } }}>
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <DarkButton size="sm" disabled={busy} onClick={() => pickFiles("video/*", true, (files) => files.length && void runner.addSources(files, skipCuts))}>
                        <Upload className="size-3.5" />
                        加入视频
                    </DarkButton>
                    <Checkbox checked={skipCuts} onChange={(event) => setSkipCuts(event.target.checked)} className="!text-xs">
                        跳过处理（不切镜头）
                    </Checkbox>
                </div>
                {document.sources.map((source, index) => (
                    <div key={source.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                        <div className="flex items-center gap-2">
                            <Film className="size-4 shrink-0 text-neutral-400" />
                            <span className="min-w-0 flex-1 truncate text-sm">
                                {index + 1}. {source.fileName}
                            </span>
                            <StatusBadge status={source.status} error={source.error} />
                        </div>
                        <p className={cn("text-xs", source.status === "failed" ? "text-red-300" : "text-neutral-400")}>{source.status === "failed" ? source.error : source.message}</p>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-neutral-500">
                                {source.durationSec ? `${source.durationSec.toFixed(1)} 秒 · ` : ""}
                                {document.shots.filter((shot) => shot.sourceId === source.id).length} 个镜头
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                                {source.status === "done" ? (
                                    <DarkButton size="sm" disabled={busy} onClick={() => onEditCuts(source.id)}>
                                        <Scissors className="size-3.5" />
                                        切点
                                    </DarkButton>
                                ) : (
                                    <DarkButton size="sm" disabled={busy} onClick={() => void runner.retrySource(source.id)}>
                                        <RefreshCw className="size-3.5" />
                                        {source.status === "failed" ? "重试" : "继续"}
                                    </DarkButton>
                                )}
                                <Popconfirm title="移除这个视频？它的镜头和生成结果会一起移除。" onConfirm={() => runner.removeSource(source.id)}>
                                    <IconButton disabled={busy} aria-label="移除">
                                        <Trash2 className="size-4" />
                                    </IconButton>
                                </Popconfirm>
                            </div>
                        </div>
                    </div>
                ))}
                {!document.sources.length ? <p className="py-8 text-center text-sm text-neutral-500">还没有加入视频</p> : null}
            </div>
        </Drawer>
    );
}

/** Cut-point editor: cuts are absolute seconds inside one source; applying re-runs intake with those bounds. */
export function ShotCutEditor({ source, document, runner, onClose }: { source: ReplacementSource | undefined; document: ReplacementStudioDocument; runner: ReplacementRunner; onClose: () => void }) {
    const url = useStudioMedia(source?.videoKey);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [cuts, setCuts] = useState<number[]>([]);
    const [time, setTime] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const duration = source?.durationSec || 0;
    const shots = useMemo(() => document.shots.filter((shot) => shot.sourceId === source?.id).sort((a, b) => a.index - b.index), [document.shots, source?.id]);

    useEffect(() => {
        if (!source) return;
        setCuts(source.cuts?.length ? [...source.cuts] : shots.slice(1).map((shot) => shot.startSec));
        setSelected(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source?.id]);

    if (!source) return null;
    const original = JSON.stringify((source.cuts?.length ? source.cuts : shots.slice(1).map((shot) => shot.startSec)).map((cut) => cut.toFixed(2)));
    const dirty = JSON.stringify(cuts.map((cut) => cut.toFixed(2))) !== original;
    const seek = (value: number) => {
        if (videoRef.current) videoRef.current.currentTime = value;
        setTime(value);
    };
    const addCut = () => {
        if (time < 0.3 || time > duration - 0.3 || cuts.some((cut) => Math.abs(cut - time) < 0.3)) return;
        setCuts((list) => [...list, Math.round(time * 100) / 100].sort((a, b) => a - b));
    };
    const bounds = [0, ...cuts, duration];
    const segmentAt = (value: number) => Math.max(0, bounds.findIndex((bound, index) => value >= bound && value < (bounds[index + 1] ?? Infinity)));
    const currentSegment = segmentAt(time);
    const matchingShot = !dirty ? shots[currentSegment] : undefined;

    return (
        <Modal open title={`切点编辑 · ${source.fileName}`} onCancel={onClose} footer={null} width={960} destroyOnHidden>
            <div className="flex flex-col gap-4">
                <div className="flex h-[360px] items-center justify-center overflow-hidden rounded-xl bg-black">
                    {url ? <video ref={videoRef} src={url} controls className="max-h-full max-w-full" onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} /> : <span className="text-xs text-neutral-500">原视频缺失</span>}
                </div>
                <div className="relative h-12 select-none rounded-lg bg-white/[0.06]" onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seek(((event.clientX - rect.left) / rect.width) * duration);
                }}>
                    {bounds.slice(0, -1).map((start, index) => (
                        <div key={index} className={cn("absolute inset-y-1 rounded-md border border-white/10", index === currentSegment ? "bg-white/25" : index % 2 ? "bg-white/[0.08]" : "bg-white/[0.12]")} style={{ left: `${(start / duration) * 100}%`, width: `${((bounds[index + 1] - start) / duration) * 100}%` }}>
                            <span className="absolute left-1.5 top-1 text-[10px] text-neutral-300">{index + 1}</span>
                        </div>
                    ))}
                    {cuts.map((cut, index) => (
                        <button
                            key={cut}
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                setSelected(index);
                                seek(cut);
                            }}
                            className={cn("absolute -top-1 bottom-[-4px] w-1 -translate-x-1/2 rounded-full", selected === index ? "bg-amber-300" : "bg-white")}
                            style={{ left: `${(cut / duration) * 100}%` }}
                            title={clock(cut)}
                        />
                    ))}
                    <span className="pointer-events-none absolute inset-y-0 w-px bg-red-400" style={{ left: `${(time / (duration || 1)) * 100}%` }} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-neutral-400">
                        {clock(time)} / {clock(duration)} · {bounds.length - 1} 个镜头
                    </span>
                    <DarkButton size="sm" onClick={addCut}>
                        <Scissors className="size-3.5" />
                        在当前位置切分
                    </DarkButton>
                    <DarkButton size="sm" disabled={selected === null} onClick={() => {
                        setCuts((list) => list.filter((_, index) => index !== selected));
                        setSelected(null);
                    }}>
                        <X className="size-3.5" />
                        删除切点
                    </DarkButton>
                    <DarkButton size="sm" disabled={!cuts.length} onClick={() => setCuts([])}>
                        合并为一个镜头
                    </DarkButton>
                    <DarkButton size="sm" disabled={Boolean(runner.busy)} onClick={() => {
                        void runner.recutSource(source.id, "detect");
                        onClose();
                    }}>
                        <Sparkles className="size-3.5" />
                        智能检测
                    </DarkButton>
                    <DarkButton size="sm" disabled={!matchingShot || Boolean(runner.busy)} title={dirty ? "先应用切点再倒放" : ""} onClick={() => matchingShot && void runner.reverseShot(matchingShot.id)}>
                        <Repeat className="size-3.5" />
                        {matchingShot?.reversed ? "取消倒放" : "倒放当前镜头"}
                    </DarkButton>
                    <DarkButton size="sm" tone="primary" className="ml-auto" disabled={!dirty || Boolean(runner.busy)} onClick={() => {
                        void runner.recutSource(source.id, cuts);
                        onClose();
                    }}>
                        应用切点
                    </DarkButton>
                </div>
                {dirty ? <p className="text-xs text-amber-300">应用后会按新切点重新处理这个视频，它已有的图像、视频替换结果和句子会清空。</p> : null}
                {!dirty && shots.length ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {shots.map((shot, index) => (
                            <button key={shot.id} type="button" onClick={() => seek(shot.startSec + 0.05)} className={cn("relative w-28 shrink-0 overflow-hidden rounded-lg border", index === currentSegment ? "border-white" : "border-white/10")}>
                                <StudioImage mediaKey={shot.keyframeKey} className="aspect-video w-full" />
                                <span className="absolute bottom-0.5 left-1 text-[10px] text-white drop-shadow">
                                    {index + 1} · {(shot.endSec - shot.startSec).toFixed(1)}s{shot.reversed ? " · 倒放" : ""}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
