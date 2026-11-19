import { useEffect } from "react";
import { AudioLines, Dices, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
    randomVoiceDesignSeed,
    VOICE_DESIGN_ACCENT,
    VOICE_DESIGN_AGE,
    VOICE_DESIGN_ATTR_DEFAULTS,
    VOICE_DESIGN_DIALECT,
    VOICE_DESIGN_GENDER,
    VOICE_DESIGN_PITCH,
    VOICE_DESIGN_PRESETS,
    VOICE_DESIGN_READING,
    VOICE_DESIGN_STYLE,
    voiceDesignPresetMatches,
    type VoiceDesignAttrs,
    type VoiceDesignChoice,
    type VoiceDesignPreset,
} from "@/lib/canvas/voice-design";
import type { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];

export type VoiceDesignAction = { action: "describe" } | { action: "generate" };

export function voiceDesignAttrs(metadata: CanvasNodeMetadata | undefined): VoiceDesignAttrs {
    return {
        Gender: metadata?.voiceDesignGender || VOICE_DESIGN_ATTR_DEFAULTS.Gender,
        Age: metadata?.voiceDesignAge || VOICE_DESIGN_ATTR_DEFAULTS.Age,
        Pitch: metadata?.voiceDesignPitch || VOICE_DESIGN_ATTR_DEFAULTS.Pitch,
        Style: metadata?.voiceDesignStyle || VOICE_DESIGN_ATTR_DEFAULTS.Style,
        EnglishAccent: metadata?.voiceDesignAccent || VOICE_DESIGN_ATTR_DEFAULTS.EnglishAccent,
        ChineseDialect: metadata?.voiceDesignDialect || VOICE_DESIGN_ATTR_DEFAULTS.ChineseDialect,
    };
}

export function VoiceDesignNodeContent({
    node,
    theme,
    onPatch,
    onAction,
}: {
    node: CanvasNodeData;
    theme: Theme;
    onPatch: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onAction: (node: CanvasNodeData, action: VoiceDesignAction) => void;
}) {
    const { t } = useTranslation();
    const running = node.metadata?.status === "loading";
    const job = node.metadata?.voiceDesignJob;
    const ink = { color: theme.node.text, WebkitTextFillColor: theme.node.text } as const;
    const fieldStyle = { ...ink, background: theme.canvas.background, borderColor: theme.node.stroke };
    const attrs = voiceDesignAttrs(node.metadata);
    const script = node.metadata?.voiceDesignText ?? VOICE_DESIGN_READING;
    const description = node.metadata?.voiceDesignDescription || "";

    const setAttr = (patch: Partial<CanvasNodeMetadata>) => onPatch(node.id, patch);
    const applyPreset = (preset: VoiceDesignPreset) => {
        const next = voiceDesignPresetMatches(attrs, preset) ? VOICE_DESIGN_ATTR_DEFAULTS : preset.attrs;
        setAttr({
            voiceDesignGender: next.Gender,
            voiceDesignAge: next.Age,
            voiceDesignPitch: next.Pitch,
            voiceDesignStyle: next.Style,
            voiceDesignAccent: next.EnglishAccent,
            voiceDesignDialect: next.ChineseDialect,
        });
    };
    const seed = node.metadata?.voiceDesignSeed || "";
    useEffect(() => {
        if (node.metadata?.voiceDesignSeed) return;
        onPatch(node.id, { voiceDesignSeed: randomVoiceDesignSeed() });
        // Fill once for nodes created before seeds were stored. Clearing the field must stay empty while typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    return (
        <div className="flex h-full w-full flex-col gap-2 overflow-auto px-3 py-2.5" style={ink} data-canvas-no-zoom>
            <div className="flex min-w-0 items-center gap-2 text-xs">
                <AudioLines className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate">{t("canvas.voiceDesign.script")}</span>
            </div>
            <textarea
                value={script}
                className="min-h-24 w-full resize-none rounded-xl border px-2.5 py-2 text-xs leading-5 outline-none"
                style={fieldStyle}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => setAttr({ voiceDesignText: event.target.value })}
            />
            <div className="text-[11px]" style={{ color: theme.node.muted }}>
                {t("canvas.voiceDesign.scriptHint")}
            </div>
            <label className="text-[11px]" style={{ color: theme.node.muted }}>
                {t("canvas.voiceDesign.description")}
            </label>
            <div className="flex gap-2">
                <input
                    value={description}
                    placeholder={t("canvas.voiceDesign.descriptionPlaceholder")}
                    className="h-8 min-w-0 flex-1 rounded-xl border px-2.5 text-xs outline-none"
                    style={fieldStyle}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={(event) => setAttr({ voiceDesignDescription: event.target.value })}
                />
                <button
                    type="button"
                    disabled={running || !description.trim()}
                    className="h-8 shrink-0 rounded-full border px-3 text-xs disabled:opacity-40"
                    style={{ ...ink, borderColor: theme.node.stroke, background: theme.node.fill }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => onAction(node, { action: "describe" })}
                >
                    {running && job === "describe" ? t("canvas.voiceDesign.describing") : t("canvas.voiceDesign.describe")}
                </button>
            </div>
            {node.metadata?.voiceDesignUnmatched ? (
                <div className="text-[11px]" style={{ color: theme.node.muted }}>
                    {t("canvas.voiceDesign.unmatched", { words: node.metadata.voiceDesignUnmatched })}
                </div>
            ) : null}
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                <Sparkles className="size-3 shrink-0" />
                <span>{t("canvas.voiceDesign.startingPoints")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {VOICE_DESIGN_PRESETS.map((preset) => {
                    const selected = voiceDesignPresetMatches(attrs, preset);
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            disabled={running}
                            className="rounded-full border px-2 py-1 text-[11px] leading-4 disabled:opacity-40"
                            style={
                                selected
                                    ? { color: theme.canvas.background, WebkitTextFillColor: theme.canvas.background, background: theme.node.activeStroke, borderColor: theme.node.activeStroke }
                                    : { ...ink, background: theme.node.fill, borderColor: theme.node.stroke }
                            }
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => applyPreset(preset)}
                        >
                            {t(preset.labelKey)}
                        </button>
                    );
                })}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Field label={t("canvas.voiceDesign.gender")} value={attrs.Gender} choices={VOICE_DESIGN_GENDER} theme={theme} disabled={running} onChange={(value) => setAttr({ voiceDesignGender: value })} />
                <Field label={t("canvas.voiceDesign.age")} value={attrs.Age} choices={VOICE_DESIGN_AGE} theme={theme} disabled={running} onChange={(value) => setAttr({ voiceDesignAge: value })} />
                <Field label={t("canvas.voiceDesign.pitch")} value={attrs.Pitch} choices={VOICE_DESIGN_PITCH} theme={theme} disabled={running} onChange={(value) => setAttr({ voiceDesignPitch: value })} />
                <Field label={t("canvas.voiceDesign.style")} value={attrs.Style} choices={VOICE_DESIGN_STYLE} theme={theme} disabled={running} onChange={(value) => setAttr({ voiceDesignStyle: value })} />
                <div className="col-span-2">
                    <Field
                        label={t("canvas.voiceDesign.accent")}
                        value={attrs.EnglishAccent}
                        choices={VOICE_DESIGN_ACCENT}
                        theme={theme}
                        disabled={running}
                        onChange={(value) => setAttr({ voiceDesignAccent: value, ...(value !== "Auto" ? { voiceDesignDialect: "Auto" } : {}) })}
                    />
                </div>
                <Field
                    label={t("canvas.voiceDesign.dialect")}
                    value={attrs.ChineseDialect}
                    choices={VOICE_DESIGN_DIALECT}
                    theme={theme}
                    disabled={running}
                    onChange={(value) => setAttr({ voiceDesignDialect: value, ...(value !== "Auto" ? { voiceDesignAccent: "Auto" } : {}) })}
                />
                <label className="flex min-w-0 flex-col gap-1 text-[11px]" style={{ color: theme.node.muted }}>
                    {t("canvas.voiceDesign.seed")}
                    <div className="flex gap-1">
                        <input
                            value={seed}
                            inputMode="numeric"
                            className="h-8 min-w-0 flex-1 rounded-xl border px-2 text-xs outline-none"
                            style={fieldStyle}
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => setAttr({ voiceDesignSeed: event.target.value.replace(/[^\d]/g, "") })}
                        />
                        <button
                            type="button"
                            disabled={running}
                            title={t("canvas.voiceDesign.newSeed")}
                            aria-label={t("canvas.voiceDesign.newSeed")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border disabled:opacity-40"
                            style={{ ...ink, borderColor: theme.node.stroke, background: theme.node.fill }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => setAttr({ voiceDesignSeed: randomVoiceDesignSeed() })}
                        >
                            <Dices className="size-3.5" />
                        </button>
                    </div>
                </label>
            </div>
            {node.metadata?.status === "error" && node.metadata.errorDetails ? <div className="text-[11px] text-red-300">{node.metadata.errorDetails}</div> : null}
            <button
                type="button"
                disabled={running}
                className="mt-auto h-8 rounded-full border text-xs font-medium disabled:opacity-40"
                style={{ ...ink, borderColor: theme.node.stroke, background: theme.toolbar.activeBg }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onAction(node, { action: "generate" })}
            >
                {running && job === "generate" ? t("canvas.voiceDesign.generating") : t("canvas.voiceDesign.generate")}
            </button>
        </div>
    );
}

function Field({
    label,
    value,
    choices,
    theme,
    disabled,
    onChange,
}: {
    label: string;
    value: string;
    choices: VoiceDesignChoice[];
    theme: Theme;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const ink = { color: theme.node.text, WebkitTextFillColor: theme.node.text } as const;
    return (
        <label className="flex min-w-0 flex-col gap-1 text-[11px]" style={{ color: theme.node.muted }}>
            {label}
            <select
                value={choices.some((choice) => choice.value === value) ? value : "Auto"}
                disabled={disabled}
                className="h-8 rounded-xl border px-2 text-xs outline-none disabled:opacity-40"
                style={{ ...ink, background: theme.canvas.background, borderColor: theme.node.stroke }}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => onChange(event.target.value)}
            >
                {choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                        {t(choice.labelKey)}
                    </option>
                ))}
            </select>
        </label>
    );
}
