import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

export type TextProcessSource = {
    text: string;
    title: string;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];
export type TextProcessAction =
    | { action: "h3"; text: string }
    | { action: "sync"; to: "zh" | "en" }
    | { action: "output"; lang: "zh" | "en" };

export function TextProcessNodeContent({
    node,
    theme,
    source,
    onPatch,
    onAction,
}: {
    node: CanvasNodeData;
    theme: Theme;
    source: TextProcessSource | null;
    onPatch: (nodeId: string, patch: { h3Zh?: string; h3En?: string; h3Lang?: "zh" | "en"; h3Dirty?: "zh" | "en" | "" }) => void;
    onAction: (node: CanvasNodeData, action: TextProcessAction) => void;
}) {
    const { t } = useTranslation();
    const lang = node.metadata?.h3Lang === "en" ? "en" : "zh";
    const pairReady = Boolean(node.metadata?.h3Zh || node.metadata?.h3En);
    const shown = pairReady ? (lang === "en" ? node.metadata?.h3En || "" : node.metadata?.h3Zh || "") : source?.text || "";
    const running = node.metadata?.status === "loading";
    const job = node.metadata?.textProcessJob;
    const dirty = node.metadata?.h3Dirty;
    const ink = { color: theme.node.text, WebkitTextFillColor: theme.node.text } as const;

    return (
        <div className="flex h-full w-full flex-col gap-2 overflow-auto px-3 py-2.5" style={ink} data-canvas-no-zoom>
            <div className="flex min-w-0 items-center gap-2 text-xs">
                <Languages className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate">{source?.title || t("canvas.node.textProcessNeedSource")}</span>
            </div>
            {source ? (
                <div className="text-[11px]" style={{ color: theme.node.muted }}>
                    {t("canvas.node.textProcessSlots", { images: source.imageCount, videos: source.videoCount, audios: source.audioCount })}
                </div>
            ) : null}
            {pairReady ? (
                <div className="flex items-center gap-1.5">
                    <LangButton label={`${t("videoWorkbench.formatH3LangZh")}${dirty === "zh" ? " *" : ""}`} selected={lang === "zh"} theme={theme} disabled={running} onClick={() => onPatch(node.id, { h3Lang: "zh" })} />
                    <LangButton label={`${t("videoWorkbench.formatH3LangEn")}${dirty === "en" ? " *" : ""}`} selected={lang === "en"} theme={theme} disabled={running} onClick={() => onPatch(node.id, { h3Lang: "en" })} />
                    <button type="button" disabled={running} className="ml-auto h-7 rounded-full border px-2.5 text-[11px] disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.node.fill }} onClick={() => onAction(node, { action: "sync", to: lang === "zh" ? "en" : "zh" })}>
                        {running && job === "sync" ? t("canvas.node.textProcessSyncing") : lang === "zh" ? t("canvas.node.textProcessSyncToEn") : t("canvas.node.textProcessSyncToZh")}
                    </button>
                </div>
            ) : null}
            <textarea
                value={shown}
                readOnly={!pairReady}
                className="min-h-28 w-full flex-1 resize-none rounded-xl px-2.5 py-2 text-xs leading-5 outline-none"
                style={{ ...ink, background: theme.canvas.background }}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                    const value = event.target.value;
                    onPatch(node.id, lang === "en" ? { h3En: value, h3Dirty: "en" } : { h3Zh: value, h3Dirty: "zh" });
                }}
            />
            {node.metadata?.status === "error" && node.metadata.errorDetails ? <div className="text-[11px] text-red-300">{node.metadata.errorDetails}</div> : null}
            <div className="text-[11px]" style={{ color: theme.node.muted }}>
                {t("canvas.node.textProcessSubmitHint")}
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2">
                <button type="button" disabled={running || !source?.text} className="col-span-2 h-8 rounded-full border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.toolbar.activeBg }} onClick={() => onAction(node, { action: "h3", text: pairReady ? (node.metadata?.h3Zh || node.metadata?.h3En || source?.text || "") : source?.text || "" })}>
                    {running && job === "h3" ? t("canvas.node.textProcessH3Running") : t("canvas.node.textProcessH3")}
                </button>
                {pairReady ? (
                    <>
                        <button type="button" disabled={running} className="h-8 rounded-full border text-xs font-medium disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.node.fill }} onClick={() => onAction(node, { action: "output", lang: "zh" })}>
                            {running && job === "output" ? t("canvas.node.textProcessOutputRunning") : t("canvas.node.textProcessOutputZh")}
                        </button>
                        <button type="button" disabled={running} className="h-8 rounded-full border text-xs font-medium disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: theme.toolbar.activeBg }} onClick={() => onAction(node, { action: "output", lang: "en" })}>
                            {running && job === "output" ? t("canvas.node.textProcessOutputRunning") : t("canvas.node.textProcessOutputEn")}
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    );
}

function LangButton({ label, selected, theme, disabled, onClick }: { label: string; selected: boolean; theme: Theme; disabled: boolean; onClick: () => void }) {
    const ink = { color: selected ? theme.toolbar.activeText : theme.node.text, WebkitTextFillColor: selected ? theme.toolbar.activeText : theme.node.text } as const;
    return (
        <button type="button" disabled={disabled} className="h-7 rounded-full border px-2.5 text-[11px] disabled:opacity-40" style={{ ...ink, borderColor: theme.node.stroke, background: selected ? theme.toolbar.activeBg : "transparent" }} onClick={onClick}>
            {label}
        </button>
    );
}
