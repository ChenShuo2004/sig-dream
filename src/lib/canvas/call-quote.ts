import { metasoH3CallQuote, formatMetasoPoints } from "@/lib/canvas/metaso-quote";
import { channelModelOf, decodeChannelModel, isLanCanvasModel, type AiConfig } from "@/stores/use-config-store";

export type CanvasQuoteMode = "image" | "video" | "text" | "audio";

export function formatQuotePoints(points: number) {
    return formatMetasoPoints(points);
}

/** 选中远程渠道模型时的本次调用标价。局域网模型不显示。没有标价时 points 为空。 */
export function modelCallQuote(config: AiConfig, mode: CanvasQuoteMode) {
    if (isLanCanvasModel(config.model || "")) return null;
    const decoded = decodeChannelModel(config.model || "");
    if (!decoded) return null;
    if (!config.channels.some((item) => item.id === decoded.channelId)) return null;

    if (mode === "video") {
        const metaso = metasoH3CallQuote(config);
        if (metaso) return metaso;
    }

    const profile = channelModelOf(config, config.model);
    const price = profile?.price;
    if (typeof price !== "number") return { points: null as number | null };
    if (profile?.billingMode === "per_second") {
        if (mode !== "video") return { points: null as number | null };
        const seconds = Number(config.videoSeconds);
        if (!Number.isFinite(seconds) || seconds <= 0) return { points: null as number | null };
        return { points: Math.round(price * seconds * 100) / 100 };
    }
    const count = mode === "image" ? Math.max(1, Number(config.count) || 1) : 1;
    return { points: Math.round(price * count * 100) / 100 };
}
