import i18n from "@/i18n";
import { VOICE_DESIGN_READING } from "@/lib/canvas/voice-design";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.image"); } },
    [CanvasNodeType.Text]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.text"); } },
    [CanvasNodeType.Config]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.config"); } },
    [CanvasNodeType.Video]: { width: 420, height: 236, get title() { return i18n.t("canvas.nodeTypes.video"); } },
    [CanvasNodeType.Audio]: { width: 340, height: 120, get title() { return i18n.t("canvas.nodeTypes.audio"); } },
    [CanvasNodeType.MediaProcess]: { width: 400, height: 520, get title() { return i18n.t("canvas.nodeTypes.mediaProcess"); } },
    [CanvasNodeType.TextProcess]: { width: 400, height: 480, get title() { return i18n.t("canvas.nodeTypes.textProcess"); } },
    [CanvasNodeType.VoiceDesign]: { width: 420, height: 760, get title() { return i18n.t("canvas.nodeTypes.voiceDesign"); } },
    [CanvasNodeType.SeedVc]: { width: 420, height: 640, get title() { return i18n.t("canvas.nodeTypes.seedVc"); } },
    [CanvasNodeType.Group]: { width: 760, height: 480, get title() { return i18n.t("canvas.nodeTypes.group"); } },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Image].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Text].title; },
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Config]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Config].title; },
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        width: 420, height: 236, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Video].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        width: 340, height: 120, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Audio].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.MediaProcess]: {
        width: 400, height: 520, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.MediaProcess].title; },
        metadata: { status: "idle", mediaTrimStart: "0", mediaTrimEnd: "", mediaFrameTime: "0" },
    },
    [CanvasNodeType.TextProcess]: {
        width: 400, height: 480, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.TextProcess].title; },
        metadata: { status: "idle", h3Lang: "zh", h3Dirty: "" },
    },
    [CanvasNodeType.VoiceDesign]: {
        width: 420, height: 760, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.VoiceDesign].title; },
        metadata: { status: "idle", voiceDesignText: VOICE_DESIGN_READING },
    },
    [CanvasNodeType.SeedVc]: {
        width: 420, height: 640, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.SeedVc].title; },
        metadata: { status: "idle", seedVcSteps: 10, seedVcLength: 1, seedVcCfg: 0.7 },
    },
    [CanvasNodeType.Group]: {
        width: 760, height: 480, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Group].title; },
        metadata: { status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

// Return built-in specs directly and resolve plugin types from the registry.
export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
