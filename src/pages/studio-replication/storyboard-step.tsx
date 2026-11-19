import { Button, Empty, Input, Select, Spin, Tag } from "antd";
import { Clapperboard, RefreshCw } from "lucide-react";

import { useStudioMedia } from "@/studios/media";
import type { ReplicationStudioDocument } from "@/studios/replication/document";
import { clipPlanRef } from "@/studios/replication/stages";
import { clipDuration, type StudioClip } from "@/studios/types";

import { FrameThumb, SourceSegmentPlayer, formatSec } from "./media";
import type { ReplicationRunner } from "./use-replication-runner";

function GeneratedVideo({ videoKey, running }: { videoKey?: string; running: boolean }) {
    const url = useStudioMedia(videoKey);
    if (running) return <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-stone-100 dark:bg-stone-900"><Spin /></div>;
    if (!url) return <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-stone-100 text-stone-400 dark:bg-stone-900"><Clapperboard className="size-6" /></div>;
    return <video src={url} controls className="w-full rounded-md bg-black" />;
}

function ClipCard({ document, clip, disabled, runner }: { document: ReplicationStudioDocument; clip: StudioClip; disabled: boolean; runner: ReplicationRunner }) {
    const updateClip = (patch: Partial<StudioClip>) => runner.update((current) => ({ ...current, clips: current.clips.map((entry) => (entry.id === clip.id ? { ...entry, ...patch } : entry)) }));
    const frames = new Map((document.source?.shots || []).map((shot) => [`shot-${shot.index}`, shot.frameKey]));
    const ref = clipPlanRef(clip);
    return (
        <article className="grid gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-800 xl:grid-cols-[180px_minmax(0,1fr)_180px]">
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">原片 {formatSec(clip.sourceStartSec || 0)}–{formatSec(clip.sourceEndSec || 0)}</span>
                <SourceSegmentPlayer videoKey={document.source?.videoKey} startSec={clip.sourceStartSec || 0} endSec={clip.sourceEndSec || 0} className="w-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">第 {clip.number} 段</span>
                    <span className="text-xs text-stone-500">
                        {ref} · {clipDuration(clip)} 秒 · {clip.shots.length} 镜
                    </span>
                    {clip.review ? <Tag color={clip.review.verdict === "pass" ? "green" : "orange"}>{clip.review.verdict === "pass" ? "审核通过" : "已按审核意见修补"}</Tag> : null}
                    <Button size="small" type="text" className="ml-auto" disabled={disabled} icon={<RefreshCw className="size-3.5" />} onClick={() => void runner.generateStoryboard([ref])}>
                        重新生成本段分镜
                    </Button>
                </div>
                {clip.creativeIntent ? <p className="text-xs text-stone-500">导演意图：{clip.creativeIntent}</p> : null}
                <ol className="flex flex-col gap-2 text-xs leading-5">
                    {clip.shots.map((shot, index) => (
                        <li key={shot.id} className="flex gap-2 rounded-md bg-stone-50 p-2 dark:bg-stone-900">
                            <FrameThumb frameKey={shot.sourceShotId ? frames.get(shot.sourceShotId) : undefined} className="h-12 w-20 shrink-0 rounded" />
                            <div className="min-w-0">
                                <span className="mr-2 font-medium">
                                    镜{index + 1} · {shot.duration}s
                                </span>
                                {shot.camera ? <span className="mr-2 text-stone-500">【{shot.camera}】</span> : null}
                                <span>{shot.visual}</span>
                                {shot.dialogue ? <p className="mt-1 text-stone-700 dark:text-stone-300">对白：{shot.dialogue}</p> : null}
                                {shot.voiceover ? <p className="mt-1 text-stone-700 dark:text-stone-300">画外音：{shot.voiceover}</p> : null}
                                {shot.audio ? <p className="mt-1 text-stone-500">声音：{shot.audio}</p> : null}
                            </div>
                        </li>
                    ))}
                </ol>
                {clip.review?.issues.length ? <p className="text-xs text-amber-600">审核意见：{clip.review.issues.map((issue) => issue.reason).join("；")}</p> : null}
                <Select
                    mode="multiple"
                    size="small"
                    disabled={disabled}
                    placeholder="绑定素材（参考图）"
                    value={clip.assetRefs}
                    options={document.assets.map((asset) => ({ value: asset.id, label: asset.name }))}
                    onChange={(assetRefs) => {
                        updateClip({ assetRefs });
                        runner.rebuildPrompts([clip.id]);
                    }}
                />
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-stone-600 dark:text-stone-300">视频提示词{clip.promptEdited ? "（已手动修改）" : ""}</span>
                    <Button size="small" type="text" disabled={disabled} onClick={() => runner.rebuildPrompts([clip.id])}>
                        按分镜重新拼接
                    </Button>
                </div>
                <Input.TextArea size="small" disabled={disabled} autoSize={{ minRows: 4, maxRows: 16 }} value={clip.prompt} placeholder="生成视频时按分镜自动拼接" onChange={(event) => updateClip({ prompt: event.target.value, promptEdited: true })} />
            </div>
            <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">复刻视频</span>
                <GeneratedVideo videoKey={clip.videoKey} running={clip.videoStatus === "running"} />
                <Button size="small" type={clip.videoKey ? "default" : "primary"} disabled={disabled} onClick={() => void runner.generateVideos([clip.id])}>
                    {clip.videoKey ? "重新生成视频" : "生成视频"}
                </Button>
                {clip.videoStatus === "failed" && clip.videoError ? <p className="text-xs text-red-600">{clip.videoError}</p> : null}
            </div>
        </article>
    );
}

export function StoryboardStep({ document, runner }: { document: ReplicationStudioDocument; runner: ReplicationRunner }) {
    const disabled = Boolean(runner.busy);
    if (!document.analysis) return <Empty className="mt-24" description="请先完成原片分析" />;
    const missingVideos = document.clips.filter((clip) => !clip.videoKey).map((clip) => clip.id);
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-base font-medium">
                    {document.clips.length} / {document.segmentPlan.length} 段分镜
                </h3>
                {!document.assets.length ? <span className="text-xs text-stone-500">未整理素材时片段不会绑定参考图</span> : null}
                <Button disabled={disabled} onClick={() => void runner.generateStoryboard()}>
                    {document.clips.length ? "重新生成全部分镜" : "生成分镜"}
                </Button>
                <Button type="primary" disabled={disabled || !missingVideos.length} onClick={() => void runner.generateVideos(missingVideos)}>
                    生成缺少的视频{missingVideos.length ? `（${missingVideos.length}）` : ""}
                </Button>
            </div>
            {document.clips.length ? (
                document.clips.map((clip) => <ClipCard key={clip.id} document={document} clip={clip} disabled={disabled} runner={runner} />)
            ) : (
                <Empty className="mt-12" description="点击「生成分镜」按分段计划把原片记录转换成可生成的视频分镜" />
            )}
        </div>
    );
}
