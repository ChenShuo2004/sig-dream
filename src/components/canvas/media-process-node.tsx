import { useEffect, useRef, useState } from "react";
import { Pause, Play, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

export type MediaProcessSource = { kind: "audio" | "video"; url: string; title: string };
export type MediaTrimRange = { start: number; end: number };

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];
type DragKind = "start" | "end" | "frame";

export function MediaProcessNodeContent({
    node,
    theme,
    source,
    onPatch,
    onTrim,
    onFrame,
}: {
    node: CanvasNodeData;
    theme: Theme;
    source: MediaProcessSource | null;
    onPatch: (nodeId: string, patch: { mediaTrimStart?: string; mediaTrimEnd?: string; mediaFrameTime?: string }) => void;
    onTrim: (node: CanvasNodeData, range: MediaTrimRange) => void;
    onFrame: (node: CanvasNodeData, time: number) => void;
}) {
    const { t } = useTranslation();
    const mediaRef = useRef<HTMLMediaElement | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const rangeRef = useRef<MediaTrimRange & { frame: number }>({ start: 0, end: 0, frame: 0 });
    const [duration, setDuration] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [filmstrip, setFilmstrip] = useState("");
    const [waveform, setWaveform] = useState<number[]>([]);
    const [drag, setDrag] = useState<{ kind: DragKind; start: number; end: number; frame: number } | null>(null);
    const [playhead, setPlayhead] = useState<number | null>(null);
    const running = node.metadata?.status === "loading";
    const job = node.metadata?.mediaProcessJob;
    const storedStart = Number(node.metadata?.mediaTrimStart || 0);
    const storedEnd = Number(node.metadata?.mediaTrimEnd || 0);
    const storedFrame = Number(node.metadata?.mediaFrameTime || 0);
    const start = drag?.start ?? (Number.isFinite(storedStart) ? storedStart : 0);
    const end = drag?.end ?? (duration > 0 && !(storedEnd > start) ? duration : storedEnd);
    const frame = drag?.frame ?? playhead ?? (Number.isFinite(storedFrame) ? storedFrame : start);
    rangeRef.current = { start, end, frame };

    useEffect(() => {
        if (!source?.url) {
            setDuration(0);
            setFilmstrip("");
            setWaveform([]);
            return;
        }
        const media = document.createElement(source.kind === "video" ? "video" : "audio");
        media.preload = "metadata";
        media.src = source.url;
        const apply = () => {
            const next = Number.isFinite(media.duration) ? media.duration : 0;
            setDuration(next);
            if (next > 0 && !node.metadata?.mediaTrimEnd) onPatch(node.id, { mediaTrimEnd: secondsText(next) });
        };
        media.onloadedmetadata = apply;
        return () => {
            media.onloadedmetadata = null;
            media.removeAttribute("src");
            media.load();
        };
    }, [node.id, node.metadata?.mediaTrimEnd, onPatch, source?.kind, source?.url]);

    useEffect(() => {
        if (!source?.url || source.kind !== "video") {
            setFilmstrip("");
            return;
        }
        let cancel = false;
        void buildFilmstrip(source.url)
            .then((url) => {
                if (!cancel) setFilmstrip(url);
            })
            .catch(() => {
                if (!cancel) setFilmstrip("");
            });
        return () => {
            cancel = true;
        };
    }, [source?.kind, source?.url]);

    useEffect(() => {
        if (!source?.url || source.kind !== "audio") {
            setWaveform([]);
            return;
        }
        let cancel = false;
        void buildWaveform(source.url)
            .then((peaks) => {
                if (!cancel) setWaveform(peaks);
            })
            .catch(() => {
                if (!cancel) setWaveform([]);
            });
        return () => {
            cancel = true;
        };
    }, [source?.kind, source?.url]);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media || playing || drag?.kind === "frame") return;
        const target = Math.max(0, Math.min(frame, Number.isFinite(media.duration) ? media.duration : frame));
        if (Math.abs(media.currentTime - target) > 0.08) media.currentTime = target;
    }, [drag?.kind, frame, playing, source?.url]);

    const seekFrame = (time: number) => {
        const media = mediaRef.current;
        if (media && Math.abs(media.currentTime - time) > 0.03) media.currentTime = time;
    };

    const move = (kind: DragKind, clientX: number) => {
        const width = trackRef.current?.getBoundingClientRect().width || 1;
        const left = trackRef.current?.getBoundingClientRect().left || 0;
        const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
        const time = (duration || 0) * ratio;
        const current = rangeRef.current;
        const gap = Math.min(0.1, Math.max(0.01, (duration || 1) / 200));
        if (kind === "start") {
            const nextStart = Math.min(time, current.end - gap);
            setDrag({ kind, start: Math.max(0, nextStart), end: current.end, frame: current.frame });
        } else if (kind === "end") {
            const nextEnd = Math.max(time, current.start + gap);
            setDrag({ kind, start: current.start, end: Math.min(duration || nextEnd, nextEnd), frame: current.frame });
        } else {
            const nextFrame = Math.max(0, Math.min(duration || time, time));
            setDrag({ kind, start: current.start, end: current.end, frame: nextFrame });
            seekFrame(nextFrame);
        }
    };

    const commit = () => {
        const current = rangeRef.current;
        setDrag(null);
        onPatch(node.id, { mediaTrimStart: secondsText(current.start), mediaTrimEnd: secondsText(current.end), mediaFrameTime: secondsText(current.frame) });
    };

    const togglePlay = async () => {
        const media = mediaRef.current;
        if (!media || !source) return;
        if (playing) {
            media.pause();
            setPlaying(false);
            setPlayhead(null);
            onPatch(node.id, { mediaFrameTime: secondsText(media.currentTime) });
            return;
        }
        const current = rangeRef.current;
        media.currentTime = current.start;
        setPlayhead(current.start);
        try {
            await media.play();
            setPlaying(true);
        } catch {
            setPlaying(false);
            setDrag(null);
        }
    };

    const ink = { color: theme.node.text, WebkitTextFillColor: theme.node.text } as const;

    return (
        <div className="flex h-full w-full flex-col gap-2 overflow-auto px-3 py-2.5" style={ink} data-canvas-no-zoom>
            <div className="flex min-w-0 items-center gap-2 text-xs">
                <Scissors className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate">{source ? source.title || t(`canvas.nodeTypes.${source.kind}`) : t("canvas.node.mediaProcessNeedSource")}</span>
                <span className="ml-auto shrink-0 tabular-nums" style={{ color: theme.node.muted }}>
                    {duration > 0 ? formatClock(duration) : ""}
                </span>
            </div>

            {source?.kind === "video" ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-xl" style={{ background: theme.canvas.background }}>
                    <video
                        ref={(node) => {
                            mediaRef.current = node;
                        }}
                        src={source.url}
                        className="h-full w-full object-contain"
                        draggable={false}
                        playsInline
                        preload="auto"
                        onDragStart={(event) => event.preventDefault()}
                        onTimeUpdate={(event) => {
                            if (!playing) return;
                            const time = event.currentTarget.currentTime;
                            const limit = rangeRef.current.end;
                            if (time >= limit) {
                                event.currentTarget.pause();
                                event.currentTarget.currentTime = limit;
                                setPlaying(false);
                                setPlayhead(null);
                                onPatch(node.id, { mediaFrameTime: secondsText(limit) });
                                return;
                            }
                            setPlayhead(time);
                        }}
                        onPause={() => setPlaying(false)}
                    />
                    <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums" style={{ background: "rgba(0,0,0,.55)", color: "#fafaf9", WebkitTextFillColor: "#fafaf9" }}>
                        {formatClock(frame)}
                    </span>
                </div>
            ) : source?.kind === "audio" ? (
                <audio
                    ref={(node) => {
                        mediaRef.current = node;
                    }}
                    src={source.url}
                    preload="auto"
                    onTimeUpdate={(event) => {
                        if (!playing) return;
                        const time = event.currentTarget.currentTime;
                        const limit = rangeRef.current.end;
                        if (time >= limit) {
                            event.currentTarget.pause();
                            event.currentTarget.currentTime = limit;
                            setPlaying(false);
                            setPlayhead(null);
                            onPatch(node.id, { mediaFrameTime: secondsText(limit) });
                            return;
                        }
                        setPlayhead(time);
                    }}
                    onPause={() => setPlaying(false)}
                />
            ) : null}

            <div
                ref={trackRef}
                className="relative h-14 shrink-0 cursor-pointer overflow-hidden rounded-xl"
                style={{ background: theme.canvas.background }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    if (!duration) return;
                    mediaRef.current?.pause();
                    setPlaying(false);
                    setPlayhead(null);
                    const kind = ((event.target as HTMLElement).dataset.handle as DragKind | undefined) || "frame";
                    event.currentTarget.setPointerCapture(event.pointerId);
                    move(kind, event.clientX);
                }}
                onPointerMove={(event) => {
                    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    move(drag.kind, event.clientX);
                }}
                onPointerUp={() => {
                    if (drag) commit();
                }}
            >
                {filmstrip ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${filmstrip})` }} /> : null}
                {waveform.length ? <Waveform peaks={waveform} color={theme.node.muted} /> : null}
                {duration > 0 ? (
                    <>
                        <div className="absolute inset-y-0 left-0" style={{ width: `${(start / duration) * 100}%`, background: "rgba(0,0,0,.45)" }} />
                        <div className="absolute inset-y-0 right-0" style={{ width: `${((duration - end) / duration) * 100}%`, background: "rgba(0,0,0,.45)" }} />
                        <div className="absolute inset-y-0" style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%`, boxShadow: "inset 0 0 0 2px #38bdf8" }} />
                        <Handle kind="start" at={start / duration} />
                        <Handle kind="end" at={end / duration} />
                        <div className="absolute inset-y-0 w-0.5" data-handle="frame" style={{ left: `${(frame / duration) * 100}%`, background: "#fafaf9", boxShadow: "0 0 0 1px #181715" }}>
                            <span className="absolute -left-1 top-0 size-2.5 rounded-full" data-handle="frame" style={{ background: "#fafaf9" }} />
                        </div>
                    </>
                ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <TimeField label={t("canvas.node.mediaProcessStart")} value={secondsText(start)} max={duration || undefined} theme={theme} onChange={(value) => onPatch(node.id, { mediaTrimStart: value })} />
                <TimeField label={t("canvas.node.mediaProcessEnd")} value={end > 0 ? secondsText(end) : ""} max={duration || undefined} theme={theme} onChange={(value) => onPatch(node.id, { mediaTrimEnd: value })} />
            </div>
            {node.metadata?.status === "error" && node.metadata.errorDetails ? <div className="text-[11px] text-red-300">{node.metadata.errorDetails}</div> : null}

            <div className="mt-auto grid grid-cols-2 gap-2">
                <button type="button" disabled={running || !source || !(end > start)} className="h-8 rounded-full border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.toolbar.activeBg }} onMouseDown={(event) => event.stopPropagation()} onClick={() => void togglePlay()}>
                    <span className="inline-flex items-center gap-1">
                        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        {playing ? t("canvas.node.mediaProcessPause") : t("canvas.node.mediaProcessPlay")}
                    </span>
                </button>
                <button type="button" disabled={running || !source || !(end > start)} className="h-8 rounded-full border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.toolbar.activeBg }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onTrim(node, { start: rangeRef.current.start, end: rangeRef.current.end })}>
                    {running && job === "trim" ? t("canvas.node.mediaProcessRunning") : t("canvas.node.mediaProcessRun")}
                </button>
                {source?.kind === "video" ? (
                    <button type="button" disabled={running || !source} className="col-span-2 h-8 rounded-full border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onFrame(node, rangeRef.current.frame)}>
                        {running && job === "frame" ? t("canvas.node.mediaProcessFrameRunning") : t("canvas.node.mediaProcessFrame")}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function Handle({ kind, at }: { kind: "start" | "end"; at: number }) {
    return <div className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize" data-handle={kind} style={{ left: `${at * 100}%` }}><span className="pointer-events-none absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full" style={{ background: "#38bdf8" }} /></div>;
}

function Waveform({ peaks, color }: { peaks: number[]; color: string }) {
    return (
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none">
            {peaks.map((peak, index) => {
                const height = Math.max(4, peak * 90);
                return <rect key={index} x={index} y={(100 - height) / 2} width={0.7} height={height} fill={color} />;
            })}
        </svg>
    );
}

function TimeField({ label, value, max, theme, onChange }: { label: string; value: string; max?: number; theme: Theme; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    const ink = { color: theme.node.text, WebkitTextFillColor: theme.node.text } as const;
    return (
        <label className="flex h-8 items-center gap-1 rounded-xl px-2 text-xs" style={{ background: theme.node.fill, ...ink }} onMouseDown={(event) => event.stopPropagation()}>
            <span style={{ color: theme.node.muted }}>{label}</span>
            <input type="number" min={0} max={max} step={0.1} value={value} className="min-w-0 flex-1 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={ink} onChange={(event) => onChange(event.target.value)} />
            <span style={{ color: theme.node.muted }}>{t("canvas.node.mediaProcessSeconds")}</span>
        </label>
    );
}

function secondsText(value: number) {
    return String(Math.round(Math.max(0, value) * 10) / 10);
}

function formatClock(value: number) {
    const safe = Math.max(0, value);
    const minutes = Math.floor(safe / 60);
    const seconds = safe - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

async function buildFilmstrip(url: string) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    try {
        await waitMedia(video, "loadedmetadata");
        if (!Number.isFinite(video.duration) || video.duration <= 0) return "";
        const count = 8;
        const canvas = document.createElement("canvas");
        const width = 80;
        const height = 45;
        canvas.width = width * count;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return "";
        for (let index = 0; index < count; index += 1) {
            const time = Math.min(video.duration - 0.05, (video.duration * (index + 0.5)) / count);
            await seekMedia(video, Math.max(0, time));
            context.drawImage(video, index * width, 0, width, height);
        }
        return canvas.toDataURL("image/jpeg", 0.62);
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

async function buildWaveform(url: string) {
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
        const channel = decoded.getChannelData(0);
        const bars = 64;
        const size = Math.floor(channel.length / bars) || 1;
        return Array.from({ length: bars }, (_, index) => {
            let peak = 0;
            const from = index * size;
            for (let sample = from; sample < from + size && sample < channel.length; sample += 24) peak = Math.max(peak, Math.abs(channel[sample] || 0));
            return peak;
        });
    } finally {
        await context.close().catch(() => undefined);
    }
}

function waitMedia(media: HTMLMediaElement, eventName: "loadedmetadata") {
    return new Promise<void>((resolve, reject) => {
        let timer = 0;
        const finish = () => {
            window.clearTimeout(timer);
            media.removeEventListener(eventName, finish);
            media.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            window.clearTimeout(timer);
            media.removeEventListener(eventName, finish);
            media.removeEventListener("error", fail);
            reject(new Error("read"));
        };
        timer = window.setTimeout(finish, 4000);
        media.addEventListener(eventName, finish);
        media.addEventListener("error", fail);
    });
}

function seekMedia(video: HTMLVideoElement, time: number) {
    return new Promise<void>((resolve) => {
        let timer = 0;
        const finish = () => {
            window.clearTimeout(timer);
            video.onseeked = null;
            resolve();
        };
        if (Math.abs(video.currentTime - time) < 0.05 && video.readyState >= 2) {
            finish();
            return;
        }
        timer = window.setTimeout(finish, 700);
        video.onseeked = finish;
        video.currentTime = time;
    });
}
