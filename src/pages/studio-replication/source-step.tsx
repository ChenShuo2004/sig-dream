import { useRef } from "react";
import { Alert, Button, Empty, Tag } from "antd";
import { Film, Upload } from "lucide-react";

import { useStudioMedia } from "@/studios/media";
import type { ReplicationStudioDocument } from "@/studios/replication/document";

import { FrameThumb, formatSec } from "./media";
import type { ReplicationRunner } from "./use-replication-runner";

const STATUS_LABEL = { uploading: "上传中", pending: "排队中", running: "处理中", done: "已切镜", failed: "失败" } as const;

export function SourceStep({ document, runner }: { document: ReplicationStudioDocument; runner: ReplicationRunner }) {
    const disabled = Boolean(runner.busy);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const source = document.source;
    const videoUrl = useStudioMedia(source?.videoKey);
    const waiting = source && (source.status === "pending" || source.status === "running" || source.status === "uploading");

    const picker = (
        <input
            ref={inputRef}
            type="file"
            accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v"
            className="hidden"
            onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void runner.uploadSource(file);
            }}
        />
    );

    if (!source) {
        return (
            <div className="flex flex-col items-center gap-4 pt-16">
                {picker}
                <button
                    type="button"
                    disabled={disabled}
                    className="flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 px-8 py-16 text-stone-500 transition hover:border-stone-500 hover:text-stone-700 disabled:opacity-50 dark:border-stone-700"
                    onClick={() => inputRef.current?.click()}
                >
                    <Upload className="size-8" />
                    <span className="text-sm font-medium">上传要复刻的原片</span>
                    <span className="text-xs">支持 mp4 / mov / mkv / webm，最大 500MB；超过 180 秒只处理前 180 秒</span>
                </button>
                <p className="max-w-xl text-center text-xs leading-5 text-stone-400">导入原片后自动转码、提取音轨并按切镜截取每个镜头的首帧，结果保存在本机浏览器中。</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            {picker}
            <div className="flex flex-wrap items-center gap-3">
                <Film className="size-4 text-stone-500" />
                <span className="font-medium">{source.fileName}</span>
                <Tag color={source.status === "done" ? "green" : source.status === "failed" ? "red" : "blue"}>{STATUS_LABEL[source.status]}</Tag>
                <span className="text-xs text-stone-500">{source.message}</span>
                <div className="ml-auto flex gap-2">
                    {waiting && !disabled && source.jobId ? <Button onClick={() => void runner.resumeIntake()}>继续读取结果</Button> : null}
                    <Button disabled={disabled} onClick={() => inputRef.current?.click()}>
                        重新上传
                    </Button>
                    <Button type="primary" disabled={disabled || source.status !== "done"} onClick={() => void runner.analyze()}>
                        {document.analysis ? "重新分析原片" : "分析原片"}
                    </Button>
                </div>
            </div>
            {source.status === "failed" && source.error ? <Alert type="error" showIcon message={source.error} /> : null}
            {source.status === "done" ? (
                <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="flex flex-col gap-2">
                        {videoUrl ? <video src={videoUrl} controls className="w-full rounded-lg bg-black" /> : null}
                        <p className="text-xs text-stone-500">
                            {formatSec(source.durationSec)} · {source.width}×{source.height} · {Math.round(source.fps)}fps · {source.shots.length} 个镜头{source.audioKey ? " · 含音轨" : " · 无音轨"}
                        </p>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                        {source.shots.map((shot) => (
                            <figure key={shot.index} className="flex flex-col gap-1">
                                <FrameThumb frameKey={shot.frameKey} alt={`镜头 ${shot.index}`} className="aspect-video w-full rounded-md" />
                                <figcaption className="text-[11px] text-stone-500">
                                    shot-{shot.index} · {formatSec(shot.startSec)}–{formatSec(shot.endSec)}
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </div>
            ) : source.status !== "failed" ? (
                <Empty className="mt-16" description="原片处理完成后在这里显示镜头" />
            ) : null}
        </div>
    );
}
