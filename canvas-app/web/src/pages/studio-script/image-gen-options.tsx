import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";

/** SHUO-aligned 画质 options (maps to API quality via 1k/2k/4k aliases). */
export const IMAGE_QUALITY_OPTIONS = ["1K", "2K", "4K"] as const;
export type ImageQualityOption = (typeof IMAGE_QUALITY_OPTIONS)[number];

/** SHUO Nano Banana 2–style ratios; 自适应 = auto size. Default for script studio is 16:9. */
export const IMAGE_RATIO_OPTIONS: Array<{ value: string; width: number; height: number; label?: string }> = [
    { value: "auto", width: 0, height: 0, label: "自适应" },
    { value: "1:1", width: 1, height: 1 },
    { value: "9:16", width: 9, height: 16 },
    { value: "16:9", width: 16, height: 9 },
    { value: "3:4", width: 3, height: 4 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "2:3", width: 2, height: 3 },
    { value: "5:4", width: 5, height: 4 },
    { value: "4:5", width: 4, height: 5 },
    { value: "21:9", width: 21, height: 9 },
    { value: "1:4", width: 1, height: 4 },
    { value: "4:1", width: 4, height: 1 },
    { value: "1:8", width: 1, height: 8 },
    { value: "8:1", width: 8, height: 1 },
];

export function normalizeImageQuality(value: string | undefined): ImageQualityOption {
    const raw = (value || "2K").trim().toUpperCase();
    if (raw === "1K" || raw === "LOW") return "1K";
    if (raw === "4K" || raw === "HIGH") return "4K";
    return "2K";
}

export function imageQualityForApi(value: string | undefined) {
    return normalizeImageQuality(value).toLowerCase();
}

export function imageRatioLabel(value: string) {
    if (!value || value === "auto" || value === "自适应") return "自适应";
    return value;
}

function AspectIcon({ width, height }: { width: number; height: number }) {
    if (!width || !height) {
        return (
            <span className="grid h-6 w-8 place-items-center">
                <span className="relative size-5 rounded-sm border border-current">
                    <span className="absolute inset-1 border border-dashed border-current/50" />
                </span>
            </span>
        );
    }
    const ratio = width / height;
    const boxWidth = ratio >= 1 ? 22 : Math.max(8, 22 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(8, 22 / ratio) : 22;
    return (
        <span className="grid h-6 w-8 place-items-center">
            <span className="border border-current" style={{ width: boxWidth, height: boxHeight }} />
        </span>
    );
}

export function ImageGenOptionsPopover({
    quality,
    ratio,
    disabled,
    onChange,
}: {
    quality: string;
    ratio: string;
    disabled?: boolean;
    onChange: (patch: { imageQuality?: string; aspectRatio?: string }) => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const activeQuality = normalizeImageQuality(quality);
    const activeRatio = !ratio || ratio === "自适应" ? "auto" : ratio;
    const summary = `${imageRatioLabel(activeRatio)} · ${activeQuality}`;

    useEffect(() => {
        if (!open) return;
        const sync = () => setRect(buttonRef.current?.getBoundingClientRect() || null);
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        sync();
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        window.addEventListener("pointerdown", close, true);
        return () => {
            window.removeEventListener("resize", sync);
            window.removeEventListener("scroll", sync, true);
            window.removeEventListener("pointerdown", close, true);
        };
    }, [open]);

    const panel =
        open && rect ? (
            <ImageGenOptionsPortal
                panelRef={panelRef}
                buttonRect={rect}
                activeQuality={activeQuality}
                activeRatio={activeRatio}
                onQuality={(imageQuality) => onChange({ imageQuality })}
                onRatio={(aspectRatio) => onChange({ aspectRatio })}
            />
        ) : null;

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen((value) => !value)}
                className="inline-flex h-7 max-w-[160px] items-center gap-1 rounded-full bg-white/[0.08] px-2.5 text-[11px] text-neutral-200 hover:bg-white/[0.14] disabled:opacity-40"
            >
                <ChevronUp className={cn("size-3 transition", open ? "" : "rotate-180")} />
                <span className="truncate">{summary}</span>
            </button>
            {panel}
        </>
    );
}

function ImageGenOptionsPortal({
    panelRef,
    buttonRect,
    activeQuality,
    activeRatio,
    onQuality,
    onRatio,
}: {
    panelRef: React.RefObject<HTMLDivElement | null>;
    buttonRect: DOMRect;
    activeQuality: ImageQualityOption;
    activeRatio: string;
    onQuality: (value: string) => void;
    onRatio: (value: string) => void;
}) {
    const width = 360;
    const gap = 8;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, buttonRect.right - width));
    const style = {
        position: "fixed" as const,
        zIndex: 1200,
        width,
        left,
        bottom: window.innerHeight - buttonRect.top + gap,
        maxHeight: Math.max(240, buttonRect.top - margin * 2),
    };

    return createPortal(
        <div ref={panelRef} style={style} className="overflow-auto rounded-2xl border border-white/10 bg-[#1a1a1d] p-3 text-neutral-100 shadow-[0_18px_54px_rgba(0,0,0,0.45)]" onPointerDown={(event) => event.stopPropagation()}>
            <SectionTitle>画质</SectionTitle>
            <div className="mb-3 grid grid-cols-3 gap-1.5">
                {IMAGE_QUALITY_OPTIONS.map((item) => {
                    const selected = activeQuality === item;
                    return (
                        <button key={item} type="button" onClick={() => onQuality(item)} style={selected ? inkOnWhiteStyle : undefined} className={cn("h-8 rounded-lg text-xs font-medium transition", selected ? "bg-white" : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1]")}>
                            {item}
                        </button>
                    );
                })}
            </div>

            <SectionTitle>比例</SectionTitle>
            <div className="flex gap-2">
                <RatioButton selected={activeRatio === "auto"} onClick={() => onRatio("auto")} className="w-[72px] shrink-0">
                    <AspectIcon width={0} height={0} />
                    <span>自适应</span>
                </RatioButton>
                <div className="grid flex-1 grid-cols-5 gap-1.5">
                    {IMAGE_RATIO_OPTIONS.filter((item) => item.value !== "auto").map((item) => (
                        <RatioButton key={item.value} selected={activeRatio === item.value} onClick={() => onRatio(item.value)}>
                            <AspectIcon width={item.width} height={item.height} />
                            <span>{item.label || item.value}</span>
                        </RatioButton>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function SectionTitle({ children }: { children: ReactNode }) {
    return <div className="mb-1.5 text-[11px] font-medium text-neutral-400">{children}</div>;
}

function RatioButton({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={selected ? inkOnWhiteStyle : undefined}
            className={cn("flex h-[58px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition", selected ? "bg-white" : "bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]", className)}
        >
            {children}
        </button>
    );
}
