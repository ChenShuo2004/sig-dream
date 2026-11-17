import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Spin } from "antd";
import { Camera, Check, Clapperboard, Pause, Play, Scissors, Volume2, VolumeX, X } from "lucide-react";

import { captureVideoFrame } from "@/lib/canvas/canvas-video-frame";
import { cn } from "@/lib/utils";
import { DarkButton, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { getStudioMediaBlob, saveStudioMedia, useStudioMedia } from "@/studios/media";
import { runMediaJob } from "@/studios/replacement/intake";
import type { StudioClipFrame } from "@/studios/types";
import { nanoid } from "nanoid";

const MIN_TRIM_SEC = 0.3;
const EDGE_PX = 10;

function formatClock(sec: number) {
    const safe = Math.max(0, sec);
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function formatPlayerTime(sec: number) {
    const safe = Math.max(0, Math.floor(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function clampRange(start: number, end: number, duration: number): [number, number] {
    const max = Math.max(0, duration);
    let a = Math.min(Math.max(0, start), max);
    let b = Math.min(Math.max(0, end), max);
    if (b < a) [a, b] = [b, a];
    if (b - a < MIN_TRIM_SEC) {
        if (a + MIN_TRIM_SEC <= max) b = a + MIN_TRIM_SEC;
        else {
            a = Math.max(0, max - MIN_TRIM_SEC);
            b = max;
        }
    }
    return [a, b];
}

export function ClipVideoPreview({
    videoKey,
    running,
    clipNumber,
    projectId,
    disabled,
    onSaved,
}: {
    videoKey?: string;
    running: boolean;
    clipNumber: number;
    projectId?: string;
    disabled?: boolean;
    onSaved: (frame: StudioClipFrame) => void;
}) {
    const { message } = App.useApp();
    const url = useStudioMedia(videoKey);
    const videoRef = useRef<HTMLVideoElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const rangeRef = useRef<[number, number]>([0, 0]);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [trimming, setTrimming] = useState(false);
    const [range, setRange] = useState<[number, number]>([0, 0]);
    const [busy, setBusy] = useState("");
    const [strip, setStrip] = useState<string[]>([]);
    const [trimPlaying, setTrimPlaying] = useState(false);

    const applyRange = (next: [number, number], seekTo?: "start" | "end" | number) => {
        rangeRef.current = next;
        setRange(next);
        const video = videoRef.current;
        if (!video) return;
        if (seekTo === "start") video.currentTime = next[0];
        else if (seekTo === "end") video.currentTime = next[1];
        else if (typeof seekTo === "number") video.currentTime = seekTo;
    };

    useEffect(() => {
        setTime(0);
        setDuration(0);
        setPlaying(false);
        setTrimming(false);
        setTrimPlaying(false);
        setStrip([]);
        rangeRef.current = [0, 0];
    }, [videoKey]);

    useEffect(() => {
        if (!trimming || !url || duration <= 0) return;
        let cancelled = false;
        const build = async () => {
            const frames: string[] = [];
            const count = 18;
            const video = document.createElement("video");
            video.crossOrigin = "anonymous";
            video.muted = true;
            video.playsInline = true;
            video.src = url;
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => resolve();
                video.onerror = () => reject(new Error("无法读取视频帧"));
            });
            const canvas = document.createElement("canvas");
            canvas.width = 80;
            canvas.height = 45;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            for (let i = 0; i < count; i += 1) {
                const t = (duration * i) / Math.max(1, count - 1);
                await new Promise<void>((resolve, reject) => {
                    video.onseeked = () => resolve();
                    video.onerror = () => reject(new Error("seek failed"));
                    video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
                });
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                frames.push(canvas.toDataURL("image/jpeg", 0.7));
                if (cancelled) return;
            }
            if (!cancelled) setStrip(frames);
        };
        void build().catch(() => {
            if (!cancelled) setStrip([]);
        });
        return () => {
            cancelled = true;
        };
    }, [trimming, url, duration]);

    useEffect(() => {
        if (!trimming) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                videoRef.current?.pause();
                setTrimPlaying(false);
                setTrimming(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [trimming]);

    const captureCurrent = async () => {
        if (!url || !videoRef.current || busy) return;
        setBusy("截取当前帧");
        try {
            const blob = await captureVideoFrame(url, "current", videoRef.current.currentTime);
            const mediaKey = await saveStudioMedia(blob, "image");
            const at = videoRef.current.currentTime;
            onSaved({
                id: nanoid(8),
                mediaKey,
                kind: "image",
                label: `片段${String(clipNumber).padStart(2, "0")} - ${formatClock(at)}`,
                timeSec: at,
            });
            message.success("已保存到片段帧");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "截取失败");
        } finally {
            setBusy("");
        }
    };

    const confirmTrim = async () => {
        if (!videoKey || !url || busy) return;
        const [start, end] = range;
        if (end - start < MIN_TRIM_SEC) {
            message.warning(`裁剪区间至少 ${MIN_TRIM_SEC} 秒`);
            return;
        }
        setBusy("裁剪视频");
        try {
            // Always keep a still from the trim start as 参考图.
            const still = await captureVideoFrame(url, "current", start);
            const stillKey = await saveStudioMedia(still, "image");
            onSaved({
                id: nanoid(8),
                mediaKey: stillKey,
                kind: "image",
                label: `片段${String(clipNumber).padStart(2, "0")} - ${formatClock(start)}～${formatClock(end)}`,
                timeSec: start,
                startSec: start,
                endSec: end,
            });

            if (projectId) {
                const blob = await getStudioMediaBlob(videoKey);
                if (!blob) throw new Error("找不到原视频文件");
                const result = await runMediaJob(blob, "clip.mp4", projectId, { op: "trim", start, end }, (text) => setBusy(text));
                const trimmedKey = result.keys.video;
                if (trimmedKey) {
                    onSaved({
                        id: nanoid(8),
                        mediaKey: trimmedKey,
                        kind: "video",
                        label: `裁剪 ${formatClock(start)}～${formatClock(end)}`,
                        startSec: start,
                        endSec: end,
                    });
                }
            } else {
                message.warning("未绑定项目，仅保存了裁剪起点帧");
            }
            message.success("已保存到片段帧");
            setTrimming(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "裁剪失败");
        } finally {
            setBusy("");
        }
    };

    if (running) {
        return (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black/50">
                <Spin tip="生成中…" />
            </div>
        );
    }
    if (!url) {
        return (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-black/40 text-neutral-500">
                <Clapperboard className="size-8" />
                <span className="text-xs">待生成视频</span>
            </div>
        );
    }

    if (trimming) {
        const span = Math.max(0, range[1] - range[0]);
        const leftPct = duration ? (range[0] / duration) * 100 : 0;
        const widthPct = duration ? (span / duration) * 100 : 0;

        const toggleTrimPlay = () => {
            const video = videoRef.current;
            if (!video || busy) return;
            if (!video.paused) {
                video.pause();
                setTrimPlaying(false);
                return;
            }
            const [start, end] = rangeRef.current;
            if (video.currentTime < start || video.currentTime >= end - 0.05) {
                video.currentTime = start;
            }
            void video.play().then(() => setTrimPlaying(true)).catch(() => setTrimPlaying(false));
        };

        const xToTime = (clientX: number) => {
            const el = stripRef.current;
            if (!el || duration <= 0) return 0;
            const rect = el.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
            return ratio * duration;
        };

        const onStripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
            if (busy || duration <= 0) return;
            const el = stripRef.current;
            if (!el) return;
            event.preventDefault();
            el.setPointerCapture(event.pointerId);
            videoRef.current?.pause();
            setTrimPlaying(false);

            const rect = el.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const startPx = (rangeRef.current[0] / duration) * rect.width;
            const endPx = (rangeRef.current[1] / duration) * rect.width;
            const nearLeft = Math.abs(x - startPx) <= EDGE_PX;
            const nearRight = Math.abs(x - endPx) <= EDGE_PX;
            const inside = x >= startPx && x <= endPx;

            type Mode = "move" | "left" | "right" | "draw";
            let mode: Mode = "draw";
            if (nearLeft) mode = "left";
            else if (nearRight) mode = "right";
            else if (inside) mode = "move";

            const originX = event.clientX;
            const originRange = [...rangeRef.current] as [number, number];
            const drawOrigin = xToTime(event.clientX);

            if (mode === "draw") {
                applyRange(clampRange(drawOrigin, drawOrigin + MIN_TRIM_SEC, duration), "start");
            }

            const onMove = (moveEvent: PointerEvent) => {
                if (mode === "move") {
                    const dx = ((moveEvent.clientX - originX) / Math.max(1, rect.width)) * duration;
                    const width = originRange[1] - originRange[0];
                    let nextStart = originRange[0] + dx;
                    nextStart = Math.min(Math.max(0, nextStart), Math.max(0, duration - width));
                    applyRange([nextStart, nextStart + width], "start");
                    return;
                }
                if (mode === "left") {
                    applyRange(clampRange(xToTime(moveEvent.clientX), originRange[1], duration), "start");
                    return;
                }
                if (mode === "right") {
                    applyRange(clampRange(originRange[0], xToTime(moveEvent.clientX), duration), "end");
                    return;
                }
                const t = xToTime(moveEvent.clientX);
                applyRange(clampRange(drawOrigin, t, duration), t < drawOrigin ? "start" : "end");
            };

            const onUp = (upEvent: PointerEvent) => {
                el.releasePointerCapture(upEvent.pointerId);
                el.removeEventListener("pointermove", onMove);
                el.removeEventListener("pointerup", onUp);
                el.removeEventListener("pointercancel", onUp);
            };

            el.addEventListener("pointermove", onMove);
            el.addEventListener("pointerup", onUp);
            el.addEventListener("pointercancel", onUp);
        };

        return (
            <div className="flex flex-col gap-2">
                <div className="relative overflow-hidden rounded-lg bg-black">
                    <video
                        ref={videoRef}
                        src={url}
                        className="aspect-video w-full cursor-pointer object-contain"
                        muted
                        onLoadedMetadata={(event) => {
                            const next = event.currentTarget.duration || 0;
                            setDuration(next);
                            applyRange([0, next], "start");
                        }}
                        onTimeUpdate={(event) => {
                            const video = event.currentTarget;
                            const [, end] = rangeRef.current;
                            if (!video.paused && video.currentTime >= end - 0.04) {
                                video.pause();
                                video.currentTime = end;
                                setTrimPlaying(false);
                            }
                        }}
                        onPlay={() => setTrimPlaying(true)}
                        onPause={() => setTrimPlaying(false)}
                        onClick={() => toggleTrimPlay()}
                    />
                    <button
                        type="button"
                        className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium tabular-nums text-white"
                    >
                        选中 {span.toFixed(2)}s
                    </button>
                    {busy ? (
                        <div className="absolute inset-0 grid place-items-center bg-black/60">
                            <Spin tip={busy} />
                        </div>
                    ) : null}
                </div>
                <div
                    ref={stripRef}
                    className="relative h-12 touch-none select-none overflow-hidden rounded-md bg-black/50"
                    onPointerDown={onStripPointerDown}
                >
                    <div className="flex h-full">
                        {(strip.length ? strip : Array.from({ length: 18 }, () => "")).map((src, index) => (
                            <div key={index} className="h-full flex-1 border-r border-black/40 bg-neutral-800">
                                {src ? <img src={src} alt="" draggable={false} className="pointer-events-none size-full object-cover" /> : null}
                            </div>
                        ))}
                    </div>
                    <div
                        className="absolute inset-y-0 rounded border-2 border-white bg-white/10"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    >
                        <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/90" />
                        <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/90" />
                        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                            {span.toFixed(2)}s
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        disabled={Boolean(busy)}
                        className="flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                        onClick={() => {
                            videoRef.current?.pause();
                            setTrimPlaying(false);
                            setTrimming(false);
                        }}
                    >
                        <X className="size-4" />
                    </button>
                    <button type="button" disabled={Boolean(busy) || span < MIN_TRIM_SEC} style={inkOnWhiteStyle} className="flex size-9 items-center justify-center rounded-full bg-white disabled:opacity-40" onClick={() => void confirmTrim()}>
                        <Check className="size-4" />
                    </button>
                    <button
                        type="button"
                        disabled={Boolean(busy)}
                        className="flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                        title={trimPlaying ? "暂停" : "播放选中段"}
                        onClick={() => toggleTrimPlay()}
                    >
                        {trimPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                    <div className="text-[11px] text-neutral-400">
                        <div className="font-medium text-neutral-200">裁剪视频 · {span.toFixed(2)}s</div>
                        <div>拖选区 / 拖边框 · Esc 取消</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="relative overflow-hidden rounded-lg bg-black">
                <video
                    ref={videoRef}
                    src={url}
                    className="aspect-video w-full object-contain"
                    muted={muted}
                    onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onClick={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        if (video.paused) void video.play();
                        else video.pause();
                    }}
                />
                {busy ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/60">
                        <Spin tip={busy} />
                    </div>
                ) : null}
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1.5">
                <button
                    type="button"
                    className="text-neutral-200 hover:text-white"
                    onClick={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        if (video.paused) void video.play();
                        else video.pause();
                    }}
                >
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <span className="w-8 text-[10px] tabular-nums text-neutral-400">{formatPlayerTime(time)}</span>
                <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.05}
                    value={time}
                    className="min-w-0 flex-1 accent-white"
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        setTime(next);
                        if (videoRef.current) videoRef.current.currentTime = next;
                    }}
                />
                <span className="w-8 text-right text-[10px] tabular-nums text-neutral-400">{formatPlayerTime(duration)}</span>
                <DarkButton size="sm" className="!h-6 !px-1.5" disabled={disabled || Boolean(busy)} title="获取当前帧" onClick={() => void captureCurrent()}>
                    <Camera className="size-3.5" />
                </DarkButton>
                <DarkButton
                    size="sm"
                    className="!h-6 !px-1.5"
                    disabled={disabled || Boolean(busy)}
                    title="裁剪视频"
                    onClick={() => {
                        videoRef.current?.pause();
                        const end = duration || videoRef.current?.duration || 0;
                        setRange([0, end]);
                        setTrimming(true);
                    }}
                >
                    <Scissors className="size-3.5" />
                </DarkButton>
                <button type="button" className="text-neutral-200 hover:text-white" onClick={() => setMuted((value) => !value)}>
                    {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
            </div>
        </div>
    );
}

export function ClipFrameThumb({ frame, dimmed }: { frame: StudioClipFrame; dimmed?: boolean }) {
    const url = useStudioMedia(frame.mediaKey);
    return (
        <div className={cn("overflow-hidden rounded-md border bg-black/30", dimmed ? "border-white/[0.05] opacity-50" : "border-transparent")}>
            <div className="aspect-square overflow-hidden rounded-md bg-black/60">
                {frame.kind === "video" ? (
                    url ? <video src={url} muted className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-neutral-600"><Clapperboard className="size-4" /></div>
                ) : url ? (
                    <img src={url} alt={frame.label} className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center text-neutral-600">
                        <Camera className="size-4" />
                    </div>
                )}
            </div>
            <div className="truncate px-0.5 pt-1 text-center text-[9px] leading-3 text-neutral-300" title={frame.label}>
                {frame.label}
            </div>
        </div>
    );
}
