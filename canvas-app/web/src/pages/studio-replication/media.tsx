import { useEffect, useRef } from "react";
import { Clapperboard, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useStudioMedia, useStudioMediaState } from "@/studios/media";
import type { IntakeShot } from "@/studios/replication/document";

export function formatSec(value: number) {
    const minutes = Math.floor(value / 60);
    const seconds = (value - minutes * 60).toFixed(1).padStart(4, "0");
    return `${minutes}:${seconds}`;
}

export function FrameThumb({ frameKey, className, alt = "" }: { frameKey?: string; className?: string; alt?: string }) {
    const { url, phase } = useStudioMediaState(frameKey);
    if (!url) {
        const restoring = phase === "restoring" || phase === "loading";
        return (
            <div className={cn("flex flex-col items-center justify-center gap-1 bg-stone-100 text-stone-400 dark:bg-stone-900", className)}>
                <ImageOff className="size-4" />
                {frameKey ? <span className="text-[10px]">{restoring ? "恢复中…" : "缓存丢失"}</span> : null}
            </div>
        );
    }
    return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}

export function shotAt(shots: IntakeShot[], timeSec: number) {
    return shots.find((shot) => timeSec >= shot.startSec && timeSec < shot.endSec) || shots[shots.length - 1];
}

/** Plays only [startSec, endSec) of the proxy video, looping back to the start. */
export function SourceSegmentPlayer({ videoKey, startSec, endSec, className }: { videoKey?: string; startSec: number; endSec: number; className?: string }) {
    const url = useStudioMedia(videoKey);
    const ref = useRef<HTMLVideoElement | null>(null);
    useEffect(() => {
        if (ref.current && ref.current.readyState > 0) ref.current.currentTime = startSec;
    }, [startSec, url]);
    if (!url) return <div className={cn("flex aspect-[9/16] items-center justify-center rounded-md bg-stone-100 text-stone-400 dark:bg-stone-900", className)}><Clapperboard className="size-6" /></div>;
    return (
        <video
            ref={ref}
            src={url}
            controls
            preload="metadata"
            className={cn("rounded-md bg-black", className)}
            onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = startSec;
            }}
            onPlay={(event) => {
                const video = event.currentTarget;
                if (video.currentTime < startSec - 0.05 || video.currentTime >= endSec - 0.05) video.currentTime = startSec;
            }}
            onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (video.currentTime >= endSec) {
                    video.pause();
                    video.currentTime = startSec;
                }
            }}
        />
    );
}
