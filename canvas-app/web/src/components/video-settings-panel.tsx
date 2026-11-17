import { type ReactNode, useEffect } from "react";
import { CircleHelp } from "lucide-react";
import { Slider, Switch, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeH3FaceOutputSize, computeVideoSize, inferVideoRatio, matchCatalogResolution, normalizeH3FaceRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions, videoSecondsMaxForModel } from "@/lib/media-size";
import { clampH3DeOilStrength, isRunningHubBaseUrl, isRunningHubH3FaceGen, isRunningHubH3FamilyGen, isRunningHubMinimaxH3Video, isSeedance20Model, normalizeRunningHubInstanceType, RUNNINGHUB_FIXED_QUALITY_OPTIONS, RUNNINGHUB_H3_FACE_RATIOS, RUNNINGHUB_INSTANCE_OPTIONS } from "@/lib/relay-stations";
import { isRunningHubWorkflowModel } from "@/services/api/runninghub-video";
import { boolConfig, channelModelOf, decodeChannelModel, LAN_COMFY_FACE_MODEL, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

/** Seedance 2.0 官方宽高比（含 adaptive→UI auto）。 */
const SEEDANCE20_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "auto"]);

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

/** Settings popover portals use zIndex 1200; tooltips must render above them. */
const SETTINGS_TOOLTIP_LAYER = {
    zIndex: 1400,
    getPopupContainer: () => document.body,
} as const;

type VideoSettingsKey = "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "runningHubInstanceType" | "h3DeOilStrength";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoSettingsKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    /** Script studio: duration comes from shots, not this slider. */
    hideSeconds?: boolean;
    /** Face / fixed-tier models: hide frames vs reference mode. */
    hideMode?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, hideSeconds = false, hideMode = false, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const secondsBound = videoSecondsBounds(config);
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6", secondsBound.max, secondsBound.min));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const videoModel = config.videoModel || config.model;
    const modelName = modelOptionName(videoModel || "");
    const h3Family = isRunningHubH3FamilyGen(modelName);
    const h3Face = isRunningHubH3FaceGen(modelName);
    const lanFace = videoModel === LAN_COMFY_FACE_MODEL;
    const seedance20 = isSeedance20Model(videoModel || "");
    const allowedResolutions = videoQualityChoices(config, h3Family);
    const resolution = parseVideoResolution(config.vquality);
    const ratioChoices = h3Family
        ? videoRatioOptions.filter((item) => (RUNNINGHUB_H3_FACE_RATIOS as readonly string[]).includes(item.value))
        : seedance20
          ? videoRatioOptions.filter((item) => SEEDANCE20_RATIOS.has(item.value))
          : videoRatioOptions;
    const selectedRatio = h3Family ? normalizeH3FaceRatio(config.size || "16:9") : inferVideoRatio(config.size || "auto");
    const dimensions = h3Family
        ? readVideoDimensions(computeH3FaceOutputSize(resolution, selectedRatio), resolution, selectedRatio)
        : readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const showRunningHubInstance = isRunningHubWorkflowModel(videoModel) || isRunningHubBaseUrl(resolveModelRequestConfig(config, videoModel).baseUrl);
    const instanceType = normalizeRunningHubInstanceType(config.runningHubInstanceType);
    const deOilStrength = clampH3DeOilStrength(config.h3DeOilStrength);
    const hideModeEffective = hideMode || h3Family;
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);
    const applySize = (nextResolution: string, ratio: string) => {
        const lockedRatio = h3Family ? normalizeH3FaceRatio(ratio) : ratio;
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", h3Family ? computeH3FaceOutputSize(nextResolution, lockedRatio) : computeVideoSize(nextResolution, lockedRatio));
    };
    const selectResolution = (nextResolution: string) => {
        if (!h3Family && selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    useEffect(() => {
        if (!h3Family) return;
        const expected = computeH3FaceOutputSize(resolution, selectedRatio);
        if (config.size !== expected) onConfigChange("size", expected);
    }, [h3Family, resolution, selectedRatio, config.size, onConfigChange]);

    // 当前清晰度不在模型档位里时，对齐到最近档。MiniMax-H3 无 720p，默认 720 应对齐 768p，不能落到 480p。
    useEffect(() => {
        if (h3Family || !allowedResolutions.length) return;
        if (allowedResolutions.some((item) => resolutionMatches(config.vquality || "", item))) return;
        const next = matchCatalogResolution(config.vquality || "720", allowedResolutions);
        if (!next || resolutionMatches(config.vquality || "", next)) return;
        if (selectedRatio === "auto") onConfigChange("vquality", next);
        else applySize(next, selectedRatio);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- snap when model catalog changes
    }, [h3Family, videoModel, allowedResolutions.join("|")]);

    // Seedance 2.0：切模型时把分辨率 / 时长 / 比例钳到官方允许范围。
    useEffect(() => {
        if (!seedance20 || !allowedResolutions.length) return;
        const fallbackRes = allowedResolutions.find((item) => /720/i.test(item)) || allowedResolutions[0];
        const matchedRes = allowedResolutions.some((item) => resolutionMatches(config.vquality || "", item));
        const nextRes = matchedRes ? config.vquality || fallbackRes : fallbackRes;
        const ratioOk = selectedRatio === "auto" || SEEDANCE20_RATIOS.has(selectedRatio);
        const nextRatio = ratioOk ? selectedRatio : "16:9";
        if (!matchedRes || !ratioOk) {
            if (nextRatio === "auto") onConfigChange("vquality", nextRes);
            else applySize(nextRes, nextRatio);
        }
        const clamped = clampVideoSeconds(config.videoSeconds || "6", secondsBound.max, secondsBound.min);
        if (String(Math.floor(Number(config.videoSeconds) || 0)) !== clamped) {
            onConfigChange("videoSeconds", clamped);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-clamp when model / catalog bounds change
    }, [seedance20, videoModel, allowedResolutions.join("|"), secondsBound.min, secondsBound.max]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {showRunningHubInstance ? (
                    <SettingGroup
                        title={
                            <span className="inline-flex items-center gap-1.5">
                                <span>{t("settingsPanels.video.runningHubInstance")}</span>
                                <Tooltip
                                    {...SETTINGS_TOOLTIP_LAYER}
                                    title={
                                        <div className="max-w-xs space-y-2 text-xs leading-5">
                                            <div>{t("settingsPanels.video.runningHubInstanceTips.default")}</div>
                                            <div>{t("settingsPanels.video.runningHubInstanceTips.plus")}</div>
                                            <div>{t("settingsPanels.video.runningHubInstanceTips.ultra")}</div>
                                        </div>
                                    }
                                    placement="top"
                                    mouseEnterDelay={0.15}
                                >
                                    <button type="button" className="inline-grid size-4 place-items-center rounded-full opacity-70 transition hover:opacity-100" style={{ color: theme.node.muted }} aria-label={t("settingsPanels.video.runningHubInstanceHelp")} onMouseDown={(event) => event.stopPropagation()}>
                                        <CircleHelp className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </span>
                        }
                        color={theme.node.muted}
                    >
                        <div className="grid grid-cols-3 gap-2.5">
                            {RUNNINGHUB_INSTANCE_OPTIONS.map((item) =>
                                item.disabled ? (
                                    <Tooltip key={item.value} {...SETTINGS_TOOLTIP_LAYER} title={t("settingsPanels.video.runningHubInstanceUltraDisabled")} placement="top">
                                        <span className="block">
                                            <OptionPill selected={false} disabled theme={theme} onClick={() => undefined}>
                                                {item.vram}
                                            </OptionPill>
                                        </span>
                                    </Tooltip>
                                ) : (
                                    <OptionPill key={item.value} selected={instanceType === item.value} theme={theme} onClick={() => onConfigChange("runningHubInstanceType", item.value)}>
                                        {item.vram}
                                    </OptionPill>
                                ),
                            )}
                        </div>
                    </SettingGroup>
                ) : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${(allowedResolutions.length || resolutionOptions.length) > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
                        {(allowedResolutions.length ? allowedResolutions.map((item) => ({ value: item, label: videoQualityLabel(item) })) : resolutionOptions).map((item) => (
                            <OptionPill key={item.value} selected={resolutionMatches(config.vquality || "", item.value)} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={selectedRatio === "auto" ? 0 : dimensions.width} disabled={h3Family || selectedRatio === "auto"} placeholder={selectedRatio === "auto" ? t("settingsPanels.common.auto") : ""} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={selectedRatio === "auto" ? 0 : dimensions.height} disabled={h3Family || selectedRatio === "auto"} placeholder={selectedRatio === "auto" ? t("settingsPanels.common.auto") : ""} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${h3Family ? "grid-cols-2" : "grid-cols-4"}`}>
                        {ratioChoices.map((item) => {
                            const selected = selectedRatio === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 text-sm transition hover:opacity-80"
                                    style={{
                                        borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
                                        background: selected ? theme.toolbar.activeBg : "transparent",
                                        color: theme.node.text,
                                        boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}` : undefined,
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => applySize(resolution, item.value)}
                                >
                                    <SizePreview width={item.width} height={item.height} color={selected ? theme.node.activeStroke : theme.node.text} />
                                    <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                {hideSeconds ? null : (
                    <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                        <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                            <Slider className="min-w-0 flex-1" min={secondsBound.min} max={secondsBound.max} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                            <SecondsInput value={seconds} min={secondsBound.min} max={secondsBound.max} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                            <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                        </div>
                    </SettingGroup>
                )}
                {h3Face || lanFace ? (
                    <SettingGroup
                        title={
                            <span className="inline-flex items-center gap-1.5">
                                <span>{t("settingsPanels.video.h3DeOil")}</span>
                                <Tooltip {...SETTINGS_TOOLTIP_LAYER} title={t("settingsPanels.video.h3DeOilHint")} placement="top" mouseEnterDelay={0.15}>
                                    <button type="button" className="inline-grid size-4 place-items-center rounded-full opacity-70 transition hover:opacity-100" style={{ color: theme.node.muted }} aria-label={t("settingsPanels.video.h3DeOilHint")} onMouseDown={(event) => event.stopPropagation()}>
                                        <CircleHelp className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </span>
                        }
                        color={theme.node.muted}
                    >
                        <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                            <Slider
                                className="min-w-0 flex-1"
                                min={0}
                                max={1}
                                step={0.01}
                                value={deOilStrength}
                                onChange={(value) => onConfigChange("h3DeOilStrength", String(clampH3DeOilStrength(Array.isArray(value) ? value[0] : value)))}
                            />
                            <span className="w-10 shrink-0 text-right text-sm tabular-nums" style={{ color: theme.node.text }}>
                                {deOilStrength.toFixed(2)}
                            </span>
                        </div>
                        <div className="text-[11px] leading-4 opacity-70" style={{ color: theme.node.muted }}>
                            {t("settingsPanels.video.h3DeOilHint")}
                        </div>
                    </SettingGroup>
                ) : null}
                {hideModeEffective ? null : (
                    <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            {videoModeOptions.map((item) => (
                                <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                    {t(`settingsPanels.video.modes.${item.labelKey}`)}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                )}
                {seedance20 ? (
                    <>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.video.generateAudio")}
                            </div>
                            <span onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={generateAudio} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                            </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.video.watermark")}
                            </div>
                            <span onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={watermark} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                            </span>
                        </div>
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoSecondsBounds(config: Pick<AiConfig, "model" | "videoModel" | "channels" | "vquality">) {
    const model = config.videoModel || config.model || "";
    const profile = channelModelOf(config as AiConfig, model);
    const durations = profile?.allowedDurations?.filter((item) => item > 0) || [];
    let min = durations.length ? Math.min(...durations) : VIDEO_SECONDS_MIN;
    let max = durations.length ? Math.max(...durations) : videoSecondsMaxForModel(model);
    // Metaso MiniMax-H3：2K 最长 15 秒（低于同模型 1080p 的 30s）。
    const name = modelOptionName(model).toLowerCase();
    const quality = String(config.vquality || "").trim().toLowerCase();
    if (name === "minimax-h3" && (quality === "2k" || quality === "2048")) {
        max = Math.min(max, 15);
    }
    // RunningHub MiniMax-H3：参数滑块上限固定 30 秒。渠道里旧的 [4, 15] 不能把滑块卡在 15。
    const decoded = decodeChannelModel(model);
    const channel = decoded
        ? config.channels?.find((item) => item.id === decoded.channelId)
        : config.channels?.find((item) => item.models.some((entry) => entry.name === modelOptionName(model)));
    if (isRunningHubMinimaxH3Video(model, { label: profile?.label, baseUrl: channel?.baseUrl })) {
        max = 30;
        if (min > max) min = 4;
    }
    return { min, max };
}

export function clampedVideoSeconds(config: AiConfig) {
    const bound = videoSecondsBounds(config);
    return clampVideoSeconds(config.videoSeconds, bound.max, bound.min);
}

export function modelResolutions(config: Pick<AiConfig, "model" | "videoModel" | "channels">) {
    const model = config.videoModel || config.model || "";
    return channelModelOf(config as AiConfig, model)?.resolutions?.map((item) => item.trim()).filter(Boolean) || [];
}

/** Channel resolutions win. Fixed 480/720/1080 is only the fallback when the channel has none. */
export function videoQualityChoices(config: Pick<AiConfig, "model" | "videoModel" | "channels">, family = false) {
    const catalog = modelResolutions(config);
    if (catalog.length) return catalog;
    if (family) return RUNNINGHUB_FIXED_QUALITY_OPTIONS.map((item) => item.value);
    return [];
}

export function videoQualityLabel(value: string) {
    const raw = value.trim();
    const known = RUNNINGHUB_FIXED_QUALITY_OPTIONS.find((item) => item.value.toLowerCase() === raw.toLowerCase() || item.label.toLowerCase() === raw.toLowerCase());
    if (known) return known.label;
    if (/^\d+$/.test(raw)) return `${raw}P`;
    return raw;
}

export function resolutionMatches(stored: string, option: string) {
    const selected = String(stored || "").trim().toLowerCase();
    const target = option.trim().toLowerCase();
    return selected === target || `${parseVideoResolution(stored)}p` === target;
}

export function videoResolutionLabel(value: string, allowed: string[] = []) {
    const match = allowed.find((item) => resolutionMatches(value, item));
    return match || `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border-2 px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{
                background: selected ? theme.toolbar.activeBg : "transparent",
                borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
                color: theme.node.text,
                boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}` : undefined,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: ReactNode; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SecondsInput({ value, min = VIDEO_SECONDS_MIN, max = VIDEO_SECONDS_MAX, theme, onCommit }: { value: number; min?: number; max?: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSeconds(input.value, max, min));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, placeholder, theme, onChange }: { prefix: string; value: number; disabled: boolean; placeholder?: string; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="text" inputMode="numeric" disabled={disabled} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent px-2 outline-none" value={disabled ? "" : value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
