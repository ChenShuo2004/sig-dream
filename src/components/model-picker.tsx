import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { mergeOnionProfiles } from "@/lib/relay-stations";
import { fetchCanvasChannels } from "@/services/api/canvas-channels";
import { fetchOnionModels } from "@/services/api/onion-relay";
import { createModelChannel, decodeChannelModel, isLanCanvasModel, modelOptionLabel, modelOptionName, modelVisibleToUser, replaceConfigChannels, selectableModelsByCapability, useConfigStore, type AiConfig, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    grow?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

/**
 * Provider-first picker: left = 供应商(渠道), right = models for current capability (text/image/video/audio).
 */
export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, grow = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [station, setStation] = useState("");
    const [listed, setListed] = useState<ModelChannel[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const view = useMemo(() => (listed ? { ...config, channels: listed } : config), [config, listed]);
    const [box, setBox] = useState({ top: 0, left: 0, width: 520, height: 360 });
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(view, capability).filter((model): model is string => Boolean(model)))), [capability, view]);
    const stations = useMemo(() => stationSummaries(view, capability), [capability, view]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const needle = query.trim().toLowerCase();

    const activeStationKey = station || (current ? stationKey(view, current) : stations[0]?.key || "");
    const visible = options.filter((model) => {
        if (activeStationKey && stationKey(view, model) !== activeStationKey) return false;
        if (!needle) return true;
        const label = `${stationLabel(view, model)} ${modelOptionLabel(view, model)}`.toLowerCase();
        return label.includes(needle);
    });
    const activeStation = stations.find((item) => item.key === activeStationKey);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const trigger = triggerRef.current;
            if (!trigger) return;
            const rect = trigger.getBoundingClientRect();
            const width = Math.min(640, window.innerWidth - 24);
            const maxHeight = Math.min(window.innerHeight * 0.72, 560);
            let left = rect.left;
            if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
            if (left < 12) left = 12;
            const spaceAbove = Math.max(160, rect.top - 12);
            const spaceBelow = Math.max(160, window.innerHeight - rect.bottom - 12);
            const openUp = spaceAbove > spaceBelow;
            const height = Math.min(maxHeight, openUp ? spaceAbove : spaceBelow);
            const top = openUp ? Math.max(12, rect.top - 6 - height) : rect.bottom + 6;
            setBox({ top, left, width, height });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && (panelRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const openPicker = () => {
        if (!options.length && config.channelMode === "local") onMissingConfig?.();
        window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        setQuery("");
        setStation(current ? stationKey(view, current) : "");
        setLoadError("");
        setOpen(true);
        void fetchCanvasChannels()
            .then(async (remote) => {
                if (!remote.some((channel) => channel.baseUrl?.trim() && (channel.apiKey?.trim() || channel.apiKeys?.some((item) => item.key?.trim())))) return;
                let channels = remote.map((channel) => createModelChannel(channel));
                try {
                    const profiles = await fetchOnionModels();
                    if (profiles.length) channels = mergeOnionProfiles(channels, profiles).channels;
                } catch {
                    // Keep the saved names when the live catalog cannot be loaded.
                }
                setListed(channels);
                useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, channels) }));
            })
            .catch((error: unknown) => {
                setLoadError(error instanceof Error && error.message ? error.message : "读取模型失败");
            });
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={cn(
                    "canvas-composer-model-picker inline-flex h-8 items-center gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    grow ? "min-w-0 flex-1 basis-0 justify-start" : fullWidth ? "w-full min-w-0 justify-start" : "w-fit max-w-full min-w-[9rem] justify-start",
                    open && "border-ring ring-2 ring-ring/20",
                    className,
                )}
                title={current ? modelOptionLabel(view, current) : pickerPlaceholder}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    if (open) setOpen(false);
                    else openPicker();
                }}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(view, current) : pickerPlaceholder}</span>
            </button>
            {open
                ? createPortal(
                      <div
                          ref={panelRef}
                          data-canvas-no-zoom
                          className="fixed z-[1200] flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl"
                          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onWheel={(event) => event.stopPropagation()}
                      >
                          <div className="shrink-0 border-b border-border/60 p-2">
                              <input
                                  autoFocus
                                  value={query}
                                  placeholder={t("settingsPanels.model.search")}
                                  className="h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring"
                                  onChange={(event) => setQuery(event.target.value)}
                                  onKeyDown={(event) => event.stopPropagation()}
                              />
                              {capability ? (
                                  <p className="mt-1.5 px-1 text-[11px] text-stone-500 dark:text-stone-400">
                                      {t(`settingsPanels.model.capabilities.${capability}`)} · 先选供应商，再选模型
                                  </p>
                              ) : null}
                          </div>
                          <div className="flex min-h-0 flex-1">
                              <div className="thin-scrollbar w-[38%] shrink-0 overflow-y-auto border-r border-border/60 bg-stone-50/80 p-1 dark:bg-stone-900/40">
                                  {stations.length ? (
                                      stations.map((item) => {
                                          const active = item.key === activeStationKey;
                                          const count = capability ? item.counts[capability] : item.counts.text + item.counts.image + item.counts.video + item.counts.audio;
                                          return (
                                              <button
                                                  key={item.key}
                                                  type="button"
                                                  className={cn(
                                                      "flex w-full flex-col items-start gap-0.5 rounded-lg border-l-2 px-2.5 py-2 text-left text-sm transition-colors",
                                                      active
                                                          ? "border-stone-900 bg-stone-200/80 text-stone-950 dark:border-stone-100 dark:bg-stone-800 dark:text-stone-50"
                                                          : "border-transparent text-stone-700 hover:bg-stone-200/50 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800/60 dark:hover:text-stone-100",
                                                  )}
                                                  onClick={() => setStation(item.key)}
                                              >
                                                  <span className={cn("font-medium", active && "font-semibold")}>{item.label}</span>
                                                  <span className={cn("text-[11px]", active ? "text-stone-600 dark:text-stone-300" : "text-stone-500 dark:text-stone-400")}>{count} 个模型</span>
                                              </button>
                                          );
                                      })
                                  ) : (
                                      <p className="px-3 py-4 text-sm text-stone-500 dark:text-stone-400">暂无供应商</p>
                                  )}
                              </div>
                              <div className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
                                  {loadError ? <p className="px-2 py-3 text-sm text-stone-800 dark:text-stone-100">{loadError}</p> : null}
                                  {visible.length ? (
                                      visible.map((model) => {
                                          const selected = model === current;
                                          return (
                                              <button
                                                  key={model}
                                                  type="button"
                                                  className={cn(
                                                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                                                      selected
                                                          ? "bg-stone-900/[0.08] font-medium text-stone-950 dark:bg-stone-100/[0.12] dark:text-stone-50"
                                                          : "text-stone-700 hover:bg-stone-900/[0.05] hover:text-stone-950 dark:text-stone-200 dark:hover:bg-stone-100/[0.08] dark:hover:text-stone-50",
                                                  )}
                                                  onClick={() => {
                                                      onChange(model);
                                                      setOpen(false);
                                                  }}
                                              >
                                                  <ModelLabel config={view} model={model} />
                                                  {selected ? <Check className="size-3.5 shrink-0 text-stone-900 dark:text-stone-100" /> : null}
                                              </button>
                                          );
                                      })
                                  ) : (
                                      <p className="px-2 py-3 text-sm text-stone-600 dark:text-stone-300">{stationEmptyLabel(t, capability, activeStation) || emptyModelLabel(view, capability)}</p>
                                  )}
                              </div>
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}

function stationSummaries(config: AiConfig, capability?: ModelCapability) {
    const groups = new Map<string, { key: string; label: string; counts: Record<ModelCapability, number> }>();
    const remember = (key: string, label: string, cap: ModelCapability) => {
        const group = groups.get(key) || { key, label, counts: { video: 0, image: 0, text: 0, audio: 0 } };
        group.counts[cap] += 1;
        groups.set(key, group);
    };
    config.channels.forEach((channel) => {
        channel.models.forEach((model) => {
            if (!modelVisibleToUser(model)) return;
            remember(channel.id, channel.name?.trim() || i18n.t("config.channels.unnamed"), model.capability);
        });
    });
    remember("lan", i18n.t("config.channels.lanStation"), "audio");
    remember("lan", i18n.t("config.channels.lanStation"), "video");
    const all = Array.from(groups.values());
    if (!capability) return all.filter((item) => item.counts.text + item.counts.image + item.counts.video + item.counts.audio > 0);
    return all.filter((item) => item.counts[capability] > 0);
}

function stationKey(config: AiConfig, model: string) {
    if (isLanCanvasModel(model)) return "lan";
    return decodeChannelModel(model)?.channelId || stationLabel(config, model);
}

function stationEmptyLabel(t: (key: string, options?: Record<string, unknown>) => string, capability: ModelCapability | undefined, station?: { label: string; counts: Record<ModelCapability, number> }) {
    if (!station || !capability) return "";
    if (station.counts[capability] > 0) return "";
    return t("settingsPanels.model.stationEmpty", { station: station.label, capability: t(`settingsPanels.model.capabilities.${capability}`), ...station.counts });
}

function stationLabel(config: AiConfig, model: string) {
    if (isLanCanvasModel(model)) return i18n.t("config.channels.lanStation");
    const channelId = decodeChannelModel(model)?.channelId;
    const channel = config.channels.find((item) => item.id === channelId);
    return channel?.name?.trim() || i18n.t("config.channels.unnamed");
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    const monochrome = icon === "/icons/openai.svg" || icon === "/icons/grok.svg";
    return icon ? <img src={icon} alt="" className={cn("size-4 shrink-0", monochrome && "dark:invert")} /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google") || name.includes("nano-banana") || name.includes("veo")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai") || name.includes("whisper") || name.includes("tts-")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}
