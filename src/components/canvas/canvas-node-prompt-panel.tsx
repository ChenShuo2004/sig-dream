import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Sparkles, Square } from "lucide-react";
import { App, Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { saveCanvasImagePreference, saveCanvasVideoPreference } from "@/lib/canvas/canvas-generation-preference";
import { rewritePromptToMinimaxH3, translateMinimaxH3Prompt } from "@/lib/minimax-h3-prompt";
import { formatQuotePoints, modelCallQuote } from "@/lib/canvas/call-quote";
import { isRunningHubH3CinematicGen, isRunningHubH3FamilyGen, relayStationOf } from "@/lib/relay-stations";
import { fetchChannelBalance, type ChannelBalance } from "@/services/api/channel-balance";
import { decodeChannelModel, defaultConfig, modelOptionName, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onPickReferenceAsset?: (nodeId: string) => void;
    onPickReferenceFile?: (nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, nodes, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], connectedNodes = [], onDisconnectReference, onStartReferenceSelection, onPickReferenceAsset, onPickReferenceFile, onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);
    const [boxSize, setBoxSize] = useState(() => composerBoxSize(node));
    const [formattingH3, setFormattingH3] = useState(false);
    const [syncingH3, setSyncingH3] = useState(false);
    const [originalOpen, setOriginalOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const h3Lang = node.metadata?.h3Lang === "en" ? "en" : "zh";
    const pairReady = Boolean(node.metadata?.h3Zh || node.metadata?.h3En);
    const shownPrompt = pairReady ? (h3Lang === "en" ? node.metadata?.h3En || "" : node.metadata?.h3Zh || "") : prompt;
    const modelName = modelOptionName(config.model || "");
    const callQuote = modelCallQuote(config, mode);
    const balanceStation = balanceStationOf(config);
    const [channelBalance, setChannelBalance] = useState<ChannelBalance | null | "loading">(balanceStation ? "loading" : null);
    const h3Family = mode === "video" && isRunningHubH3FamilyGen(modelName);
    const h3Cinematic = isRunningHubH3CinematicGen(modelName);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        setBoxSize(composerBoxSize(node));
        setOriginalOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    useEffect(() => {
        if (!balanceStation) {
            setChannelBalance(null);
            return;
        }
        let cancelled = false;
        setChannelBalance("loading");
        fetchChannelBalance(balanceStation)
            .then((value) => {
                if (!cancelled) setChannelBalance(value);
            })
            .catch(() => {
                if (!cancelled) setChannelBalance(null);
            });
        return () => {
            cancelled = true;
        };
    }, [balanceStation]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const updateShownPrompt = (value: string) => {
        if (pairReady) {
            onConfigChange(node.id, h3Lang === "en" ? { h3En: value, h3Dirty: "en" } : { h3Zh: value, h3Dirty: "zh" });
            return;
        }
        updatePrompt(value);
    };

    const resolveTextModel = () => {
        const textModel = globalConfig.textModel || globalConfig.model;
        if (!textModel || !isAiConfigReady(globalConfig, textModel)) {
            message.warning(t(textModel ? "workbench.configFirst" : "videoWorkbench.formatH3NeedTextModel"));
            openConfigDialog(true);
            return "";
        }
        return textModel;
    };

    const formatPromptForH3 = async () => {
        const text = (pairReady ? node.metadata?.h3Zh || node.metadata?.h3En || shownPrompt : shownPrompt).trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return;
        }
        const textModel = resolveTextModel();
        if (!textModel) return;
        setFormattingH3(true);
        try {
            const next = await rewritePromptToMinimaxH3({
                prompt: text,
                textModel,
                slots: {
                    imageCount: mentionReferences.filter((item) => item.kind === "image").length,
                    videoCount: h3Cinematic ? 0 : mentionReferences.filter((item) => item.kind === "video").length,
                    audioCount: h3Cinematic ? 0 : mentionReferences.filter((item) => item.kind === "audio").length,
                },
            });
            onConfigChange(node.id, {
                h3Zh: next.zh,
                h3En: next.en,
                h3Lang: "zh",
                h3Dirty: "",
                h3Original: node.metadata?.h3Original || (pairReady ? "" : text),
                prompt: next.zh,
            });
            setPrompt(next.zh);
            message.success(t("videoWorkbench.formatH3Done"));
        } catch (error) {
            message.error(t("videoWorkbench.formatH3Failed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setFormattingH3(false);
        }
    };

    const syncH3Language = async (to: "zh" | "en") => {
        const from = to === "en" ? "zh" : "en";
        const source = (from === "en" ? node.metadata?.h3En || "" : node.metadata?.h3Zh || "").trim();
        if (!source) {
            message.error(t("videoWorkbench.promptRequired"));
            return "";
        }
        const textModel = resolveTextModel();
        if (!textModel) return "";
        setSyncingH3(true);
        try {
            const translated = await translateMinimaxH3Prompt({ source, from, to, textModel });
            onConfigChange(node.id, to === "en" ? { h3En: translated, h3Dirty: "" } : { h3Zh: translated, h3Dirty: "", prompt: translated });
            message.success(t("videoWorkbench.formatH3SyncDone"));
            return translated;
        } catch (error) {
            message.error(t("videoWorkbench.formatH3SyncFailed", { error: error instanceof Error ? error.message : String(error) }));
            return "";
        } finally {
            setSyncingH3(false);
        }
    };

    const submit = async () => {
        if (isRunning || formattingH3 || syncingH3) return;
        let text = shownPrompt.trim();
        if (pairReady) {
            let english = node.metadata?.h3En || "";
            if (node.metadata?.h3Dirty === "zh" && (node.metadata?.h3Zh || "").trim()) {
                message.info(t("videoWorkbench.formatH3SyncingBeforeSubmit"));
                english = await syncH3Language("en");
                if (!english) return;
            }
            text = (english || node.metadata?.h3Zh || shownPrompt).trim();
        }
        if (!text) return;
        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    const startResize = (event: ReactPointerEvent<HTMLDivElement>, axis: "width" | "height" | "both") => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const start = boxSize;
        const panel = panelRef.current;
        const scale = panel && panel.offsetWidth > 0 ? panel.getBoundingClientRect().width / panel.offsetWidth : 1;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";
        const nextSize = (clientX: number, clientY: number) => ({
            width: axis === "height" ? start.width : clampComposerWidth(start.width + (clientX - startX) / (scale || 1)),
            height: axis === "width" ? start.height : clampComposerHeight(start.height + (clientY - startY) / (scale || 1)),
        });
        const onMove = (moveEvent: PointerEvent) => setBoxSize(nextSize(moveEvent.clientX, moveEvent.clientY));
        const onUp = (upEvent: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            document.body.style.userSelect = previousUserSelect;
            const next = nextSize(upEvent.clientX, upEvent.clientY);
            setBoxSize(next);
            onConfigChange(node.id, { composerWidth: next.width, composerHeight: next.height });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="relative rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ width: boxSize.width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} onPickAsset={onPickReferenceAsset} onPickLocalFile={onPickReferenceFile} />
            <CanvasPromptChipInput
                key={pairReady ? `h3-${h3Lang}` : "prompt"}
                value={shownPrompt}
                references={mentionReferences}
                onChange={updateShownPrompt}
                onSubmit={() => void submit()}
                className="thin-scrollbar w-full cursor-text rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ height: boxSize.height, background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            {h3Family ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {pairReady ? (
                        <>
                            <H3LangButton theme={theme} label={`${t("videoWorkbench.formatH3LangZh")}${node.metadata?.h3Dirty === "zh" ? " *" : ""}`} selected={h3Lang === "zh"} disabled={formattingH3 || syncingH3 || isRunning} onClick={() => onConfigChange(node.id, { h3Lang: "zh" })} />
                            <H3LangButton theme={theme} label={`${t("videoWorkbench.formatH3LangEn")}${node.metadata?.h3Dirty === "en" ? " *" : ""}`} selected={h3Lang === "en"} disabled={formattingH3 || syncingH3 || isRunning} onClick={() => onConfigChange(node.id, { h3Lang: "en" })} />
                            <button type="button" disabled={formattingH3 || syncingH3 || isRunning} className="h-7 rounded-full border px-2.5 text-[11px] disabled:opacity-40" style={h3IdleStyle(theme)} onClick={() => void syncH3Language(h3Lang === "zh" ? "en" : "zh")}>
                                {syncingH3 ? t("canvas.node.textProcessSyncing") : h3Lang === "zh" ? t("videoWorkbench.formatH3SyncToEn") : t("videoWorkbench.formatH3SyncToZh")}
                            </button>
                        </>
                    ) : null}
                    <button type="button" disabled={formattingH3 || syncingH3 || isRunning || !shownPrompt.trim()} className="inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] disabled:opacity-40" style={h3IdleStyle(theme)} onClick={() => void formatPromptForH3()}>
                        {formattingH3 ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        {t("videoWorkbench.formatH3")}
                    </button>
                    <button type="button" className="h-7 rounded-full border px-2.5 text-[11px]" style={h3IdleStyle(theme)} onClick={() => setOriginalOpen(true)}>
                        {t("videoWorkbench.viewOriginalPrompt")}
                    </button>
                </div>
            ) : null}

            <div className="mt-2 flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                    </Tooltip>
                    <CanvasPromptLibrary
                        onSelect={(value) => {
                            if (pairReady) onConfigChange(node.id, { h3Zh: "", h3En: "", h3Dirty: "", h3Lang: "zh", h3Original: "" });
                            updatePrompt(value);
                        }}
                    />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} grow />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                grow
                                buttonClassName="!h-10 !w-full !max-w-none !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                                onFillPrompt={updatePrompt}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} grow />
                            <CanvasVideoSettingsPopover config={config} grow buttonClassName="!h-10 !w-full !max-w-none !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} grow />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} grow />
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} />
                        </>
                    )}
                </div>
                {mode === "image" || mode === "video" ? (
                    <button
                        type="button"
                        className="h-10 shrink-0 rounded-full border px-3 text-xs"
                        style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text, borderColor: theme.node.stroke, background: theme.node.fill }}
                        onClick={() => {
                            if (mode === "video") {
                                saveCanvasVideoPreference({
                                    model: config.model,
                                    vquality: config.vquality,
                                    size: config.size,
                                    seconds: config.videoSeconds,
                                    videoMode: config.videoMode,
                                    generateAudio: config.videoGenerateAudio,
                                    watermark: config.videoWatermark,
                                    runningHubInstanceType: config.runningHubInstanceType,
                                    h3DeOilStrength: config.h3DeOilStrength,
                                });
                                message.success(t("canvas.promptPanel.videoPreferenceSaved"));
                                return;
                            }
                            saveCanvasImagePreference({
                                model: config.model,
                                quality: config.quality,
                                size: config.size,
                                background: config.background,
                                count: config.count,
                            });
                            message.success(t("canvas.promptPanel.imagePreferenceSaved"));
                        }}
                    >
                        {t("canvas.promptPanel.savePreference")}
                    </button>
                ) : null}
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && (!shownPrompt.trim() || formattingH3 || syncingH3)}
                    onClick={() => (isRunning ? onStop(node.id) : void submit())}
                    aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("canvas.promptPanel.stop")}</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            {callQuote ? (
                <p className="mt-1 px-1 text-[11px] leading-4" style={{ color: theme.node.muted, WebkitTextFillColor: theme.node.muted }} title={t("canvas.promptPanel.callHint")}>
                    {callQuote.points == null
                        ? t("canvas.promptPanel.callUnpriced", { balance: balancePhrase(t, channelBalance, Boolean(balanceStation)) })
                        : t("canvas.promptPanel.callPriced", { points: formatQuotePoints(callQuote.points), balance: balancePhrase(t, channelBalance, Boolean(balanceStation)) })}
                </p>
            ) : null}
            <div className="absolute inset-x-4 -bottom-1 z-20 h-3 cursor-ns-resize" role="separator" aria-orientation="horizontal" aria-label={t("canvas.promptPanel.resize")} onPointerDown={(event) => startResize(event, "height")} />
            <div className="absolute inset-y-8 -right-1 z-20 w-3 cursor-ew-resize" role="separator" aria-orientation="vertical" aria-label={t("canvas.promptPanel.resize")} onPointerDown={(event) => startResize(event, "width")} />
            <div className="absolute -bottom-1 -right-1 z-30 size-4 cursor-nwse-resize" role="separator" aria-label={t("canvas.promptPanel.resize")} onPointerDown={(event) => startResize(event, "both")}>
                <span className="pointer-events-none absolute bottom-1 right-1 block size-2 rounded-sm border-b-2 border-r-2" style={{ borderColor: theme.node.muted }} />
            </div>
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} onPickAsset={(nodeId) => { setExpanded(false); onPickReferenceAsset?.(nodeId); }} onPickLocalFile={(nodeId) => { setExpanded(false); onPickReferenceFile?.(nodeId); }} />
                    <CanvasPromptChipInput
                        key={pairReady ? `expanded-h3-${h3Lang}` : "expanded-prompt"}
                        value={shownPrompt}
                        references={mentionReferences}
                        onChange={updateShownPrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
            <Modal title={t("videoWorkbench.viewOriginalPromptTitle")} open={originalOpen} centered width={640} footer={null} onCancel={() => setOriginalOpen(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="max-h-[60dvh] overflow-auto whitespace-pre-wrap text-sm leading-6" onWheelCapture={(event) => event.stopPropagation()}>
                    {node.metadata?.h3Original?.trim() || t("videoWorkbench.viewOriginalPromptEmpty")}
                </div>
            </Modal>
        </div>
    );
}

function h3IdleStyle(theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    return { color: theme.node.text, WebkitTextFillColor: theme.node.text, borderColor: theme.node.stroke, background: "transparent" } as const;
}

function H3LangButton({ theme, label, selected, disabled, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; label: string; selected: boolean; disabled: boolean; onClick: () => void }) {
    const style = selected
        ? { color: "#292524", WebkitTextFillColor: "#292524", background: "#fafaf9", borderColor: "#fafaf9" }
        : h3IdleStyle(theme);
    return (
        <button type="button" disabled={disabled} className="h-7 rounded-full border px-2.5 text-[11px] disabled:opacity-40" style={style} onClick={onClick}>
            {label}
        </button>
    );
}

const DEFAULT_COMPOSER_WIDTH = 796;
const DEFAULT_COMPOSER_HEIGHT = 172;

function clampComposerWidth(value: number) {
    return Math.min(1280, Math.max(420, Math.round(value)));
}

function clampComposerHeight(value: number) {
    return Math.min(640, Math.max(96, Math.round(value)));
}

function balanceStationOf(config: AiConfig) {
    const decoded = decodeChannelModel(config.model || "");
    if (!decoded) return null;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const station = relayStationOf(channel);
    return station === "runninghub" || station === "deepseek" ? station : null;
}

function balancePhrase(translate: (key: string, options?: Record<string, unknown>) => string, balance: ChannelBalance | null | "loading", canQuery: boolean) {
    if (canQuery && balance === "loading") return translate("canvas.promptPanel.balanceLoading");
    if (balance && balance !== "loading" && balance.kind === "points") return translate("canvas.promptPanel.balancePoints", { count: formatQuotePoints(Number(balance.amount)) });
    if (balance && balance !== "loading" && balance.kind === "money") {
        const unit = balance.currency === "CNY" ? translate("canvas.promptPanel.currencyCny") : balance.currency === "USD" ? translate("canvas.promptPanel.currencyUsd") : balance.currency;
        return translate("canvas.promptPanel.balanceMoney", { amount: balance.amount, unit });
    }
    return translate("canvas.promptPanel.balanceMissing");
}

function composerBoxSize(node: CanvasNodeData) {
    return {
        width: clampComposerWidth(node.metadata?.composerWidth || DEFAULT_COMPOSER_WIDTH),
        height: clampComposerHeight(node.metadata?.composerHeight || DEFAULT_COMPOSER_HEIGHT),
    };
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const model = resolveModelForCapability(globalConfig, node.metadata?.model, mode);
    return {
        ...globalConfig,
        model,
        // Node model must win over the account default videoModel, or the settings popover reads another model's clarity and duration.
        ...(mode === "video" ? { videoModel: model } : {}),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
        runningHubInstanceType: node.metadata?.runningHubInstanceType || globalConfig.runningHubInstanceType || defaultConfig.runningHubInstanceType,
        h3DeOilStrength: node.metadata?.h3DeOilStrength || globalConfig.h3DeOilStrength || defaultConfig.h3DeOilStrength,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    if (key === "runningHubInstanceType") return { runningHubInstanceType: value };
    if (key === "h3DeOilStrength") return { h3DeOilStrength: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
