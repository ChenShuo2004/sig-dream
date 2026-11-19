import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { ImageOff, Pause, Play, X } from "lucide-react";
import { nanoid } from "nanoid";

import { cn } from "@/lib/utils";
import { useStudioMedia, useStudioMediaState } from "@/studios/media";
import { renumberMarkers, type ReplacementBox, type ReplacementPerson } from "@/studios/replacement/document";
import { GUIDE_COLOR_VALUES, PERSON_REPLACEMENT_MARKER_COLORS } from "@/studios/replacement/prompt-mode";
import { inkOnWhiteStyle } from "./ui";

export function markerColor(index: number) {
    return GUIDE_COLOR_VALUES[PERSON_REPLACEMENT_MARKER_COLORS[Math.max(0, index) % PERSON_REPLACEMENT_MARKER_COLORS.length]];
}

export function StudioImage({ mediaKey, className, alt = "", fit = "cover" }: { mediaKey?: string; className?: string; alt?: string; fit?: "cover" | "contain" }) {
    const { url, phase } = useStudioMediaState(mediaKey);
    if (!url) {
        const restoring = phase === "restoring" || phase === "loading";
        return (
            <div
                className={cn("flex flex-col items-center justify-center gap-1 bg-white/[0.04] px-1 text-center text-neutral-600", className)}
                title={mediaKey ? (restoring ? "正在从 NAS 恢复媒体…" : "本地与 NAS 都找不到这张图") : undefined}
            >
                <ImageOff className="size-4 shrink-0" />
                {mediaKey ? (
                    <span className="max-w-full truncate text-[10px] leading-3 text-neutral-500">{restoring ? "恢复中…" : "缓存丢失"}</span>
                ) : null}
            </div>
        );
    }
    return <img src={url} alt={alt} draggable={false} className={cn(fit === "cover" ? "object-cover" : "object-contain", className)} />;
}

export function StudioVideo({ mediaKey, className, controls = true }: { mediaKey?: string; className?: string; controls?: boolean }) {
    const { url, phase } = useStudioMediaState(mediaKey);
    if (!url) {
        const restoring = phase === "restoring" || phase === "loading";
        return <div className={cn("flex items-center justify-center bg-white/[0.04] text-xs text-neutral-500", className)}>{restoring ? "恢复中…" : "无视频"}</div>;
    }
    return <video src={url} controls={controls} preload="metadata" className={cn("bg-black object-contain", className)} />;
}

export function StudioAudio({ mediaKey, className }: { mediaKey?: string; className?: string }) {
    const url = useStudioMedia(mediaKey);
    if (!url) return null;
    return <audio src={url} controls preload="none" className={cn("h-8 w-full", className)} />;
}

export type BoxLabel = { personId: string; label: string; colorIndex: number; active: boolean };

const MIN_BOX = 0.02;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

type DragState = { mode: "move" | "resize" | "draw"; personId: string; startX: number; startY: number; origin: ReplacementBox };

/**
 * Keyframe with person boxes. Editable: drag to move, corner handle to resize, drag on empty area to draw
 * a manual box, × to delete; characters dragged from the material list drop onto a box.
 */
export function KeyframeEditor({
    keyframeKey,
    persons,
    labels,
    selectedId,
    onSelect,
    onChange,
    onDropCharacter,
    targetOf,
    editable = true,
    className,
}: {
    keyframeKey: string;
    persons: ReplacementPerson[];
    labels: BoxLabel[];
    selectedId?: string;
    onSelect?: (personId: string) => void;
    onChange?: (persons: ReplacementPerson[]) => void;
    onDropCharacter?: (personId: string, characterId: string) => void;
    targetOf?: (person: ReplacementPerson) => { name: string; imageKey: string } | null;
    editable?: boolean;
    className?: string;
}) {
    const url = useStudioMedia(keyframeKey);
    const boxRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [natural, setNatural] = useState({ width: 16, height: 9 });
    const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [draft, setDraft] = useState<ReplacementPerson[] | null>(null);
    const [hoverDrop, setHoverDrop] = useState("");
    const shown = draft || persons;

    useEffect(() => {
        const element = boxRef.current;
        if (!element) return;
        const measure = () => {
            const { width, height } = element.getBoundingClientRect();
            const scale = Math.min(width / natural.width, height / natural.height);
            setFit(scale > 0 ? { width: Math.floor(natural.width * scale), height: Math.floor(natural.height * scale) } : null);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [natural]);

    const point = (event: ReactPointerEvent) => {
        const rect = frameRef.current!.getBoundingClientRect();
        return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
    };

    const begin = (event: ReactPointerEvent, mode: DragState["mode"], person?: ReplacementPerson) => {
        if (!editable || !onChange || event.button !== 0) return;
        event.stopPropagation();
        const start = point(event);
        frameRef.current?.setPointerCapture(event.pointerId);
        if (mode === "draw") {
            const created: ReplacementPerson = {
                id: `manual-${nanoid(6)}`,
                bbox: { x: start.x, y: start.y, width: 0, height: 0 },
                score: 1,
                cropKey: "",
                identity: "",
                similarity: 0,
                review: false,
                promptMarkerIndex: persons.length,
                targetCharacterId: "",
                scope: "full-person",
                manual: true,
            };
            setDraft([...persons, created]);
            setDrag({ mode, personId: created.id, startX: start.x, startY: start.y, origin: created.bbox });
        } else if (person) {
            onSelect?.(person.id);
            setDraft(persons);
            setDrag({ mode, personId: person.id, startX: start.x, startY: start.y, origin: person.bbox });
        }
    };

    const move = (event: ReactPointerEvent) => {
        if (!drag || !draft) return;
        const current = point(event);
        const dx = current.x - drag.startX;
        const dy = current.y - drag.startY;
        const { origin } = drag;
        let bbox: ReplacementBox;
        if (drag.mode === "move") bbox = { ...origin, x: clamp(origin.x + dx, 0, 1 - origin.width), y: clamp(origin.y + dy, 0, 1 - origin.height) };
        else if (drag.mode === "resize") bbox = { ...origin, width: clamp(origin.width + dx, MIN_BOX, 1 - origin.x), height: clamp(origin.height + dy, MIN_BOX, 1 - origin.y) };
        else bbox = { x: Math.min(drag.startX, current.x), y: Math.min(drag.startY, current.y), width: Math.abs(dx), height: Math.abs(dy) };
        setDraft(draft.map((person) => (person.id === drag.personId ? { ...person, bbox } : person)));
    };

    const end = () => {
        if (!drag || !draft) return;
        const next = draft.filter((person) => person.id !== drag.personId || (person.bbox.width >= MIN_BOX && person.bbox.height >= MIN_BOX));
        const changed = next.some((person, index) => person !== persons[index]) || next.length !== persons.length;
        setDrag(null);
        setDraft(null);
        if (changed) {
            onChange?.(renumberMarkers(next));
            if (drag.mode === "draw" && next.length > persons.length) onSelect?.(drag.personId);
        }
    };

    const remove = (personId: string) => onChange?.(renumberMarkers(persons.filter((person) => person.id !== personId)));

    return (
        <div ref={boxRef} className={cn("relative flex items-center justify-center overflow-hidden rounded-xl bg-black", className)}>
            <div
                ref={frameRef}
                className={cn("relative shrink-0 select-none", editable && onChange ? "cursor-crosshair" : "")}
                style={fit ? { width: fit.width, height: fit.height } : { visibility: "hidden" }}
                onPointerDown={(event) => begin(event, "draw")}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
            >
                {url ? (
                    <img src={url} alt="" draggable={false} className="block size-full" onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth || 16, height: event.currentTarget.naturalHeight || 9 })} />
                ) : (
                    <div className="size-full bg-white/[0.03]" />
                )}
                {shown.map((person) => {
                    const label = labels.find((item) => item.personId === person.id);
                    const color = markerColor(label?.colorIndex ?? person.promptMarkerIndex);
                    const selected = selectedId === person.id;
                    const target = targetOf?.(person);
                    return (
                        <div
                            key={person.id}
                            onPointerDown={(event) => begin(event, "move", person)}
                            onClick={(event) => {
                                event.stopPropagation();
                                onSelect?.(person.id);
                            }}
                            onDragOver={(event) => {
                                if (!onDropCharacter) return;
                                event.preventDefault();
                                setHoverDrop(person.id);
                            }}
                            onDragLeave={() => setHoverDrop("")}
                            onDrop={(event) => {
                                event.preventDefault();
                                setHoverDrop("");
                                const characterId = event.dataTransfer.getData("text/x-replacement-character");
                                if (characterId) onDropCharacter?.(person.id, characterId);
                            }}
                            className={cn("absolute rounded-md border-[3px] transition-[box-shadow]", editable && onChange ? "cursor-move" : "cursor-pointer", label?.active || target ? "" : "border-dashed", selected ? "shadow-[0_0_0_2px_#fff]" : "", hoverDrop === person.id ? "shadow-[0_0_0_3px_#fff]" : "")}
                            style={{ left: `${person.bbox.x * 100}%`, top: `${person.bbox.y * 100}%`, width: `${person.bbox.width * 100}%`, height: `${person.bbox.height * 100}%`, borderColor: color, background: hoverDrop === person.id ? `${color}55` : selected ? `${color}30` : `${color}12` }}
                            title={label?.label ? (target ? `${label.label} → ${target.name}` : label.label) : target?.name || (person.manual ? "手动框" : undefined)}
                        >
                            {target?.imageKey ? <StudioImage mediaKey={target.imageKey} className="pointer-events-none absolute bottom-1 left-1 size-9 rounded-md border border-white/70" /> : null}
                            {editable && onChange && selected ? (
                                <>
                                    <button
                                        type="button"
                                        aria-label="删除人物框"
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            remove(person.id);
                                        }}
                                        className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-white text-black shadow"
                                    >
                                        <X className="size-3" />
                                    </button>
                                    <span onPointerDown={(event) => begin(event, "resize", person)} className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-black bg-white" />
                                </>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function formatClock(value: number) {
    const total = Math.max(0, value);
    return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}.${Math.floor((total % 1) * 10)}`;
}

/** Side-by-side still-image before/after (image-replace middle panel when a result exists). */
export function ImageComparePair({
    left,
    right,
    leftLabel,
    rightLabel,
    className,
    leftSlot,
    rightEmpty,
    rightExtra,
    rightOverlay,
}: {
    left?: string;
    right?: string;
    leftLabel: ReactNode;
    rightLabel: ReactNode;
    className?: string;
    leftSlot?: ReactNode;
    rightEmpty?: ReactNode;
    rightExtra?: ReactNode;
    rightOverlay?: ReactNode;
}) {
    return (
        <div className={cn("flex min-h-0 flex-1 gap-2", className)}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex h-6 shrink-0 items-center text-xs text-neutral-400">{leftLabel}</div>
                {leftSlot || (
                    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
                        <StudioImage mediaKey={left} fit="contain" className="max-h-full max-w-full" />
                    </div>
                )}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex h-6 shrink-0 items-center gap-2 text-xs text-neutral-400">
                    <span>{rightLabel}</span>
                    {rightExtra}
                </div>
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
                    {right ? <StudioImage mediaKey={right} fit="contain" className="max-h-full max-w-full" /> : rightEmpty || <span className="text-xs text-neutral-600">暂无</span>}
                    {right && rightOverlay ? <div className="absolute right-2 top-2 z-10 flex items-center gap-1">{rightOverlay}</div> : null}
                </div>
            </div>
        </div>
    );
}

/** Two players driven by one transport so the original and replaced take can be compared frame for frame. */
export function SyncedPair({
    left,
    right,
    leftLabel,
    rightLabel,
    audio = "right",
    className,
    rightEmpty,
}: {
    left?: string;
    right?: string;
    leftLabel: string;
    rightLabel: string;
    audio?: "left" | "right";
    className?: string;
    rightEmpty?: ReactNode;
}) {
    const leftUrl = useStudioMedia(left);
    const rightUrl = useStudioMedia(right);
    const leftRef = useRef<HTMLVideoElement>(null);
    const rightRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const master = () => (audio === "left" ? leftRef.current : rightRef.current) || leftRef.current || rightRef.current;
    const players = () => [leftRef.current, rightRef.current].filter((item): item is HTMLVideoElement => Boolean(item));

    useEffect(() => {
        setPlaying(false);
        setTime(0);
    }, [leftUrl, rightUrl]);

    useEffect(() => {
        if (leftRef.current) leftRef.current.muted = audio !== "left" && Boolean(rightUrl);
        if (rightRef.current) rightRef.current.muted = audio !== "right";
    }, [audio, leftUrl, rightUrl]);

    const toggle = () => {
        const next = !playing;
        setPlaying(next);
        for (const player of players()) void (next ? player.play().catch(() => undefined) : player.pause());
    };

    const seek = (value: number) => {
        for (const player of players()) player.currentTime = Math.min(value, player.duration || value);
        setTime(value);
    };

    const onTime = () => {
        const main = master();
        if (!main) return;
        setTime(main.currentTime);
        for (const player of players()) if (player !== main && Math.abs(player.currentTime - main.currentTime) > 0.25 && main.currentTime <= (player.duration || 0)) player.currentTime = main.currentTime;
    };

    const video = (ref: RefObject<HTMLVideoElement | null>, url: string, label: string, empty?: ReactNode) => (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <span className="text-xs text-neutral-400">{label}</span>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
                {url ? (
                    <video
                        ref={ref}
                        src={url}
                        preload="metadata"
                        playsInline
                        className="max-h-full max-w-full object-contain"
                        onLoadedMetadata={(event) => {
                            const next = Number(event.currentTarget?.duration) || 0;
                            setDuration((current) => Math.max(current, next));
                        }}
                        onTimeUpdate={(event) => event.currentTarget === master() && onTime()}
                        onEnded={() => setPlaying(false)}
                        onClick={toggle}
                    />
                ) : (
                    empty || <span className="text-xs text-neutral-600">暂无</span>
                )}
            </div>
        </div>
    );

    return (
        <div className={cn("flex min-h-0 flex-col gap-2", className)}>
            <div className="flex min-h-0 flex-1 gap-2">
                {video(leftRef, leftUrl, leftLabel)}
                {video(rightRef, rightUrl, rightLabel, rightEmpty)}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-white/[0.06] px-2.5">
                <button type="button" onClick={toggle} style={inkOnWhiteStyle} className="flex size-6 items-center justify-center rounded-full bg-white" aria-label={playing ? "暂停" : "播放"}>
                    {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
                </button>
                <input type="range" min={0} max={duration || 1} step={0.05} value={time} onChange={(event) => seek(Number(event.target.value))} className="h-1 flex-1 accent-white" />
                <span className="w-20 text-right text-[11px] tabular-nums text-neutral-400">
                    {formatClock(time)} / {formatClock(duration)}
                </span>
            </div>
        </div>
    );
}

export function Waveform({ peaks, className, progress, ranges }: { peaks: number[]; className?: string; progress?: number; ranges?: Array<{ start: number; end: number; color: string }> }) {
    const max = Math.max(0.01, ...peaks);
    return (
        <div className={cn("relative flex items-center gap-px overflow-hidden", className)}>
            {ranges?.map((range, index) => <span key={index} className="absolute inset-y-0 rounded-sm" style={{ left: `${range.start * 100}%`, width: `${Math.max(0.3, (range.end - range.start) * 100)}%`, background: range.color }} />)}
            {peaks.map((peak, index) => (
                <span key={index} className={cn("relative min-w-px flex-1 rounded-full", progress !== undefined && index / peaks.length <= progress ? "bg-white" : "bg-neutral-500")} style={{ height: `${Math.max(4, (peak / max) * 100)}%` }} />
            ))}
        </div>
    );
}
