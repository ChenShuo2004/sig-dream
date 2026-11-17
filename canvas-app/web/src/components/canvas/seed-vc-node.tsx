import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { canvasThemes } from "@/lib/canvas-theme";

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];

function clamp(value: number, min: number, max: number, step: number) {
    if (!Number.isFinite(value)) return min;
    const snapped = Math.round(value / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

function StoredAudio({ storageKey }: { storageKey?: string }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let alive = true;
        if (!storageKey) {
            setUrl("");
            return () => {
                alive = false;
            };
        }
        void resolveMediaUrl(storageKey).then((next) => {
            if (alive) setUrl(next || "");
        });
        return () => {
            alive = false;
        };
    }, [storageKey]);
    if (!url) return null;
    return <audio className="mt-1 h-8 w-full" src={url} controls onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} />;
}

function AudioField({
    label,
    storageKey,
    onPick,
}: {
    label: string;
    storageKey?: string;
    onPick: (file: File) => void;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const chosen = Boolean(storageKey);
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-medium">{label}</span>
            <button
                type="button"
                className="h-8 rounded-lg border text-xs font-medium"
                style={
                    chosen
                        ? { background: "#1c1917", color: "#fafaf9", WebkitTextFillColor: "#fafaf9", borderColor: "#1c1917" }
                        : { background: "#fff7ed", color: "#1c1917", WebkitTextFillColor: "#1c1917", borderColor: "#fdba74" }
                }
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => inputRef.current?.click()}
            >
                {chosen ? t("canvas.seedVc.replaceAudio") : t("canvas.seedVc.upload")}
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onPick(file);
                    event.target.value = "";
                }}
            />
            <StoredAudio storageKey={storageKey} />
        </label>
    );
}

function Slider({
    label,
    info,
    min,
    max,
    step,
    value,
    onChange,
}: {
    label: string;
    info: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
}) {
    const ink = { color: "#1c1917", WebkitTextFillColor: "#1c1917" } as const;
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-medium">{label}</span>
            <span className="flex items-center gap-2">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => onChange(clamp(Number(event.target.value), min, max, step))}
                />
                <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    className="h-7 w-16 rounded border px-1 text-xs"
                    style={{ ...ink, background: "#ffffff", borderColor: "#d4d4d8" }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => onChange(clamp(Number(event.target.value), min, max, step))}
                />
            </span>
            <span className="text-[10px] leading-4" style={{ color: "#57534e" }}>
                {info}
            </span>
        </label>
    );
}

export function SeedVcNodeContent({
    node,
    onPatch,
    onConvert,
}: {
    node: CanvasNodeData;
    theme: Theme;
    onPatch: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onConvert: (node: CanvasNodeData) => void;
}) {
    const { t } = useTranslation();
    const running = node.metadata?.status === "loading";
    const steps = clamp(Number(node.metadata?.seedVcSteps ?? 10), 1, 200, 1);
    const length = clamp(Number(node.metadata?.seedVcLength ?? 1), 0.5, 2, 0.1);
    const cfg = clamp(Number(node.metadata?.seedVcCfg ?? 0.7), 0, 1, 0.1);
    const ink = { color: "#1c1917", WebkitTextFillColor: "#1c1917" } as const;
    const pick = async (file: File, field: "seedVcSourceKey" | "seedVcReferenceKey") => {
        const stored = await uploadMediaFile(file, "audio");
        onPatch(node.id, { [field]: stored.storageKey });
    };
    return (
        <div className="flex h-full w-full flex-col gap-2 overflow-auto p-3 text-xs" style={{ ...ink, background: "#ffffff" }}>
            <div className="text-sm font-semibold">{t("canvas.seedVc.title")}</div>
            <p className="text-[11px] leading-4" style={{ color: "#44403c" }}>
                {t("canvas.seedVc.note")}
            </p>
            <AudioField label={t("canvas.seedVc.source")} storageKey={node.metadata?.seedVcSourceKey} onPick={(file) => void pick(file, "seedVcSourceKey")} />
            <AudioField label={t("canvas.seedVc.reference")} storageKey={node.metadata?.seedVcReferenceKey} onPick={(file) => void pick(file, "seedVcReferenceKey")} />
            <Slider label={t("canvas.seedVc.steps")} info={t("canvas.seedVc.stepsInfo")} min={1} max={200} step={1} value={steps} onChange={(seedVcSteps) => onPatch(node.id, { seedVcSteps })} />
            <Slider label={t("canvas.seedVc.length")} info={t("canvas.seedVc.lengthInfo")} min={0.5} max={2} step={0.1} value={length} onChange={(seedVcLength) => onPatch(node.id, { seedVcLength })} />
            <Slider label={t("canvas.seedVc.cfg")} info={t("canvas.seedVc.cfgInfo")} min={0} max={1} step={0.1} value={cfg} onChange={(seedVcCfg) => onPatch(node.id, { seedVcCfg })} />
            {node.metadata?.status === "error" && node.metadata.errorDetails ? <div className="text-[11px] text-red-700">{node.metadata.errorDetails}</div> : null}
            <button
                type="button"
                disabled={running}
                className="mt-auto h-8 rounded-full border text-xs font-medium disabled:opacity-40"
                style={{ background: "#1c1917", color: "#fafaf9", WebkitTextFillColor: "#fafaf9", borderColor: "#1c1917" }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onConvert(node)}
            >
                {running ? t("canvas.seedVc.running") : t("canvas.seedVc.submit")}
            </button>
        </div>
    );
}
