import { findRelayChannel } from "@/lib/relay-stations";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata, CanvasNodeTypeId } from "@/types/canvas";
import { encodeChannelModel, type AiConfig } from "@/stores/use-config-store";

const STORAGE_KEY = "canvas-generation-preference";

export const CANVAS_VIDEO_DEFAULTS = {
    vquality: "720",
    size: "3:4",
    seconds: "15",
    videoMode: "reference",
} as const;

type CanvasImagePreference = {
    model: string;
    quality: string;
    size: string;
    background: string;
    count: string;
};

type CanvasVideoPreference = {
    model: string;
    vquality: string;
    size: string;
    seconds: string;
    videoMode: string;
    generateAudio: string;
    watermark: string;
    runningHubInstanceType: string;
    h3DeOilStrength: string;
};

type CanvasGenerationPreference = {
    image?: CanvasImagePreference;
    video?: CanvasVideoPreference;
};

function canvasUserKey() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { username?: unknown }) : null;
        const name = typeof parsed?.username === "string" ? parsed.username.trim() : "";
        return name || "_local";
    } catch {
        return "_local";
    }
}

function readAll(): Record<string, CanvasGenerationPreference> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : {};
        return parsed && typeof parsed === "object" ? (parsed as Record<string, CanvasGenerationPreference>) : {};
    } catch {
        return {};
    }
}

function readPreference() {
    return readAll()[canvasUserKey()] || {};
}

function writePreference(next: CanvasGenerationPreference) {
    const all = readAll();
    all[canvasUserKey()] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** 画布视频默认模型：当前账号里的秘塔渠道 Seedance 2.0 标准版。 */
export function defaultCanvasVideoModel(config: AiConfig) {
    const channel = findRelayChannel(config.channels, "metaso");
    if (!channel) return "";
    return encodeChannelModel(channel.id, "seedance-2.0");
}

export function saveCanvasImagePreference(preference: CanvasImagePreference) {
    writePreference({ ...readPreference(), image: preference });
}

export function saveCanvasVideoPreference(preference: CanvasVideoPreference) {
    writePreference({ ...readPreference(), video: preference });
}

export function newNodeGenerationMetadata(type: CanvasNodeTypeId, config: AiConfig): CanvasNodeMetadata | undefined {
    if (type === CanvasNodeType.Video) {
        const saved = readPreference().video;
        const model = saved?.model || defaultCanvasVideoModel(config);
        return {
            ...(model ? { model } : {}),
            vquality: saved?.vquality || CANVAS_VIDEO_DEFAULTS.vquality,
            size: saved?.size || CANVAS_VIDEO_DEFAULTS.size,
            seconds: saved?.seconds || CANVAS_VIDEO_DEFAULTS.seconds,
            videoMode: saved?.videoMode || CANVAS_VIDEO_DEFAULTS.videoMode,
            ...(saved?.generateAudio ? { generateAudio: saved.generateAudio } : {}),
            ...(saved?.watermark ? { watermark: saved.watermark } : {}),
            ...(saved?.runningHubInstanceType ? { runningHubInstanceType: saved.runningHubInstanceType } : {}),
            ...(saved?.h3DeOilStrength ? { h3DeOilStrength: saved.h3DeOilStrength } : {}),
        };
    }
    if (type !== CanvasNodeType.Image && type !== CanvasNodeType.Config) return undefined;
    const saved = readPreference().image;
    if (!saved) return undefined;
    const count = Math.max(1, Math.floor(Number(saved.count) || 1));
    return {
        ...(saved.model ? { model: saved.model } : {}),
        ...(saved.quality ? { quality: saved.quality } : {}),
        ...(saved.size ? { size: saved.size } : {}),
        background: saved.background || "",
        count,
    };
}
