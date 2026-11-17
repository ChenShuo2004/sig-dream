import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";

import { normalizeVideoModeValue, VideoSettingsPanel, videoModeLabel, videoQualityChoices, videoQualityLabel, videoResolutionLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { resolveVideoQuality, resolveVideoSize } from "@/studios/script/video-gen-params";
import {
    isRunningHubAiAppGen,
    isRunningHubBaseUrl,
    isRunningHubComfyGenWorkflow,
    isRunningHubFixedQualityTiers,
    isRunningHubH3FamilyGen,
    normalizeRunningHubInstanceType,
    resolveRunningHubH3FamilyWorkflowId,
    RUNNINGHUB_INSTANCE_OPTIONS,
} from "@/lib/relay-stations";
import { isLanComfyModel, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

/** MiniMax H3 / Comfy ResolutionSelector megapixels (author outer-panel params). */
export const VIDEO_MEGAPIXEL_OPTIONS = [
    { value: "0.2", label: "0.2MP", hint: "草稿" },
    { value: "0.4", label: "0.4MP", hint: "约480p" },
    { value: "0.6", label: "0.6MP", hint: "约720p" },
    { value: "0.8", label: "0.8MP", hint: "" },
    { value: "1.0", label: "1.0MP", hint: "约1080p" },
    { value: "2.0", label: "2.0MP", hint: "高清" },
] as const;

export type VideoGenSettingsPatch = {
    videoQuality?: string;
    videoSize?: string;
    videoMode?: string;
    videoMegapixels?: string;
    videoSeed?: string;
    runningHubInstanceType?: string;
    h3DeOilStrength?: string;
};

export function normalizeVideoMegapixels(value: string | undefined) {
    const raw = String(value || "0.4").trim();
    const match = VIDEO_MEGAPIXEL_OPTIONS.find((item) => item.value === raw || Number(item.value) === Number(raw));
    return match?.value || "0.4";
}

export function videoMegapixelsLabel(value: string | undefined) {
    const item = VIDEO_MEGAPIXEL_OPTIONS.find((entry) => entry.value === normalizeVideoMegapixels(value));
    if (!item) return "0.4MP";
    return item.hint ? `${item.label} · ${item.hint}` : item.label;
}

function usesH3MegapixelsPanel(model: string | undefined) {
    const bare = modelOptionName(model || "").trim();
    return isLanComfyModel(bare) || isRunningHubComfyGenWorkflow(bare) || isRunningHubH3FamilyGen(bare) || /comfy|minimax-h3|minimax_h3/i.test(bare);
}

function usesFixedQualityTiers(model: string | undefined) {
    return isRunningHubFixedQualityTiers(modelOptionName(model || "").trim());
}

function usesRunningHubInstance(config: AiConfig, videoModel?: string) {
    const model = videoModel || config.videoModel || config.model || "";
    const bare = modelOptionName(model).trim();
    if (isRunningHubAiAppGen(bare) || isRunningHubComfyGenWorkflow(bare)) return true;
    try {
        return isRunningHubBaseUrl(resolveModelRequestConfig(config, model).baseUrl);
    } catch {
        return false;
    }
}

export function VideoGenOptionsPopover({
    config,
    videoModel,
    quality,
    size,
    mode,
    megapixels,
    seed,
    runningHubInstanceType,
    h3DeOilStrength,
    clipSeconds,
    disabled,
    onChange,
}: {
    config: AiConfig;
    videoModel?: string;
    quality?: string;
    size?: string;
    mode?: string;
    megapixels?: string;
    seed?: string;
    runningHubInstanceType?: string;
    h3DeOilStrength?: string;
    /** Clip duration in seconds (read-only; driven by shots). */
    clipSeconds?: number;
    disabled?: boolean;
    onChange: (patch: VideoGenSettingsPatch) => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [hoverTip, setHoverTip] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);

    const lan = usesH3MegapixelsPanel(videoModel);
    const fixedTiers = usesFixedQualityTiers(videoModel);
    const showRhInstance = usesRunningHubInstance(config, videoModel);
    const modelConfig = useMemo(() => {
        const raw = videoModel || config.model || config.videoModel || "";
        const bare = modelOptionName(raw);
        // Prefer Comfy workflow id so channel resolutions / duration caps resolve correctly.
        const model = resolveRunningHubH3FamilyWorkflowId(bare) || bare;
        const allowed = videoQualityChoices({ ...config, model, videoModel: model }, fixedTiers);
        const vquality = resolveVideoQuality(quality, allowed);
        return {
            ...config,
            model,
            videoModel: model,
            vquality,
            size: resolveVideoSize(size, vquality),
            videoMode: normalizeVideoModeValue(mode),
            runningHubInstanceType: normalizeRunningHubInstanceType(runningHubInstanceType || config.runningHubInstanceType),
            h3DeOilStrength: h3DeOilStrength || config.h3DeOilStrength || "0.4",
        } satisfies AiConfig;
    }, [config, videoModel, quality, size, mode, runningHubInstanceType, h3DeOilStrength, fixedTiers]);

    const allowed = useMemo(() => videoQualityChoices(modelConfig, fixedTiers), [fixedTiers, modelConfig]);
    const activeQuality = modelConfig.vquality;
    const activeSize = modelConfig.size;
    const activeMode = modelConfig.videoMode;
    const activeMegapixels = normalizeVideoMegapixels(megapixels);
    const activeSeed = String(seed || "").trim();
    const activeInstance = normalizeRunningHubInstanceType(modelConfig.runningHubInstanceType);
    const instanceLabel = RUNNINGHUB_INSTANCE_OPTIONS.find((item) => item.value === activeInstance)?.vram || "24G";
    const summaryBase = fixedTiers
        ? `${videoQualityLabel(activeQuality)} · ${videoSizeLabel(activeSize)}`
        : lan
          ? `${videoMegapixelsLabel(activeMegapixels)} · ${videoSizeLabel(activeSize)} · ${activeMode === "reference" ? "参考图" : "首尾帧"}`
          : `${videoResolutionLabel(activeQuality, allowed)} · ${videoSizeLabel(activeSize)} · ${videoModeLabel(activeMode)}`;
    const summary = showRhInstance ? `${summaryBase} · ${instanceLabel}` : summaryBase;

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

    const onPanelChange = (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "runningHubInstanceType" | "h3DeOilStrength", value: string) => {
        if (key === "vquality") onChange({ videoQuality: value });
        else if (key === "size") onChange({ videoSize: value });
        else if (key === "videoMode") onChange({ videoMode: value });
        else if (key === "runningHubInstanceType") onChange({ runningHubInstanceType: value });
        else if (key === "h3DeOilStrength") onChange({ h3DeOilStrength: value });
    };

    const tipRect = hoverTip && !open ? buttonRef.current?.getBoundingClientRect() || null : null;
    const theme = canvasThemes.dark;

    return (
        <>
            <div className="inline-flex max-w-[260px] items-center gap-1.5">
                <button
                    ref={buttonRef}
                    type="button"
                    disabled={disabled}
                    aria-label="视频设置"
                    onClick={() => {
                        setHoverTip(false);
                        setOpen((value) => !value);
                    }}
                    onMouseEnter={() => !open && setHoverTip(true)}
                    onMouseLeave={() => setHoverTip(false)}
                    className={cn(
                        "inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 text-neutral-200 transition hover:bg-white/[0.12] disabled:opacity-40",
                        open ? "border-white/30 bg-white/[0.14]" : "",
                    )}
                >
                    <Settings2 className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate text-[11px]" title={summary}>
                        {summary}
                    </span>
                </button>
            </div>
            {tipRect
                ? createPortal(
                      <div
                          className="pointer-events-none fixed z-[1200] max-w-[220px] rounded-lg bg-white px-2.5 py-1.5 text-[11px] leading-4 text-neutral-900 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
                          style={{
                              left: Math.max(8, tipRect.left + tipRect.width / 2 - 110),
                              bottom: window.innerHeight - tipRect.top + 8,
                          }}
                      >
                          视频设置（与视频创作台一致）
                          <span className="absolute left-1/2 top-full -ml-1.5 border-[6px] border-transparent border-t-white" />
                      </div>,
                      document.body,
                  )
                : null}
            {open && rect
                ? createPortal(
                      <div
                          ref={panelRef}
                          className="overflow-auto rounded-2xl border border-white/10 shadow-[0_18px_54px_rgba(0,0,0,0.45)]"
                          style={{
                              position: "fixed",
                              zIndex: 1200,
                              width: 356,
                              left: Math.max(12, Math.min(window.innerWidth - 356 - 12, rect.right - 356)),
                              bottom: window.innerHeight - rect.top + 8,
                              maxHeight: Math.max(280, rect.top - 24),
                              background: theme.toolbar.panel,
                              padding: 18,
                              color: theme.node.text,
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          <VideoSettingsPanel
                              config={modelConfig}
                              onConfigChange={onPanelChange}
                              theme={theme}
                              showTitle
                              hideSeconds
                              hideMode={fixedTiers}
                              className="space-y-4"
                          />
                          {lan ? (
                              <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
                                  <SectionTitle>百万像素</SectionTitle>
                                  <p className="text-[10px] leading-4 text-neutral-500">H3 外层面板常用项；越高越清晰，越吃显存/越慢</p>
                                  <div className="grid grid-cols-3 gap-1.5">
                                      {VIDEO_MEGAPIXEL_OPTIONS.map((item) => {
                                          const selected = activeMegapixels === item.value;
                                          return (
                                              <button key={item.value} type="button" onClick={() => onChange({ videoMegapixels: item.value })} style={selected ? inkOnWhiteStyle : undefined} className={cn("flex h-11 flex-col items-center justify-center rounded-lg text-[11px] font-medium transition", selected ? "bg-white" : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1]")}>
                                                  <span>{item.label}</span>
                                                  {item.hint ? <span className={cn("text-[9px]", selected ? "text-neutral-600" : "text-neutral-500")}>{item.hint}</span> : null}
                                              </button>
                                          );
                                      })}
                                  </div>
                                  <SectionTitle>随机种子</SectionTitle>
                                  <div className="flex items-center gap-1.5">
                                      <input
                                          type="text"
                                          inputMode="numeric"
                                          value={activeSeed}
                                          placeholder="空=每次随机"
                                          onChange={(event) => onChange({ videoSeed: event.target.value.replace(/[^\d]/g, "").slice(0, 16) })}
                                          className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
                                      />
                                      <button type="button" className="h-8 shrink-0 rounded-lg bg-white/[0.08] px-2.5 text-[11px] text-neutral-300 hover:bg-white/[0.14]" onClick={() => onChange({ videoSeed: String(Math.floor(Math.random() * 1_000_000_000)) })}>
                                          随机
                                      </button>
                                      <button type="button" className="h-8 shrink-0 rounded-lg bg-white/[0.08] px-2.5 text-[11px] text-neutral-300 hover:bg-white/[0.14]" onClick={() => onChange({ videoSeed: "" })}>
                                          清空
                                      </button>
                                  </div>
                              </div>
                          ) : null}
                          {typeof clipSeconds === "number" && clipSeconds > 0 ? (
                              <p className="mt-3 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                  时长由分镜决定：约 {Math.round(clipSeconds)}s（会按模型上限裁剪）
                              </p>
                          ) : null}
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}

function SectionTitle({ children }: { children: ReactNode }) {
    return <div className="mb-1.5 text-[11px] font-medium text-neutral-400">{children}</div>;
}
