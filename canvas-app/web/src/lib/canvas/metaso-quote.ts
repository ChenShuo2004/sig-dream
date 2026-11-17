import { isMetasoBaseUrl } from "@/lib/relay-stations";
import { decodeChannelModel, type AiConfig } from "@/stores/use-config-store";

/** 秘塔 MiniMax-H3 标准通道标价，单位是积分/秒。来源：metaso.cn/minimax-h3 */
const H3_POINTS_PER_SECOND: Array<[RegExp, number]> = [
    [/480/, 6.82],
    [/768/, 10.2],
    [/1080/, 15.91],
    [/2k|1440|2160/, 17],
];

export function metasoH3CallQuote(config: Pick<AiConfig, "model" | "channels" | "vquality" | "videoSeconds">) {
    const decoded = decodeChannelModel(config.model || "");
    if (!decoded) return null;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    if (!channel || !isMetasoBaseUrl(channel.baseUrl || "")) return null;
    if (!/minimax|h3/i.test(decoded.model)) return null;
    const quality = String(config.vquality || "").toLowerCase();
    const perSecond = H3_POINTS_PER_SECOND.find(([pattern]) => pattern.test(quality))?.[1];
    const seconds = Number(config.videoSeconds);
    if (!perSecond || !Number.isFinite(seconds) || seconds <= 0) return { points: null as number | null };
    return {
        points: Math.round(perSecond * seconds * 100) / 100,
    };
}

export function formatMetasoPoints(points: number) {
    const rounded = Math.round(points * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}
