export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export const mediaRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "2:3", width: 2, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840" },
};

export function parsePixelSize(value: string) {
    const match = String(value || "").match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseAspectRatio(value: string) {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return null;
    return { width, height };
}

export const videoRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "3:4", width: 3, height: 4 },
    { value: "4:3", width: 4, height: 3 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

export function normalizeMediaScale(value: string | undefined) {
    const scale = String(value || "").trim().toLowerCase();
    if (scale === "2k" || scale === "2048") return "2k";
    if (scale === "4k" || scale === "3840") return "4k";
    if (scale === "auto") return "auto";
    if (mediaScaleOptions.includes(scale as (typeof mediaScaleOptions)[number])) return scale;
    return "1k";
}

export function inferMediaScale(size: string, storedScale?: string) {
    if (storedScale) return normalizeMediaScale(storedScale);
    if (!size || size === "auto") return "auto";
    if (parseAspectRatio(size)) return "auto";
    const pixels = parsePixelSize(size);
    if (!pixels) return "auto";
    const presetScale = Object.keys(imageSizePresets).find((scale) => Object.values(imageSizePresets[scale]).includes(`${pixels.width}x${pixels.height}`));
    if (presetScale) return presetScale;
    const longSide = Math.max(pixels.width, pixels.height);
    if (longSide >= 3072) return "4k";
    if (longSide >= 1536) return "2k";
    return "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
    if (!size || size === "auto") return "auto";
    if (mediaRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return fallback;
    const target = pixels.width / pixels.height;
    return mediaRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = mediaRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 1) / Math.max(1, bestOption?.height || 1);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, fallback);
}

export function computeMediaSize(scale: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const normalizedScale = normalizeMediaScale(scale);
    if (normalizedScale === "auto") return ratio;
    return imageSizePresets[normalizedScale][ratio];
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

export function videoSecondsMaxForModel(model: string) {
    const name = model.split("::").pop()?.toLowerCase() || "";
    // OnionCreate / Seedance 2.0 family tops out at 15s; 2.5 / Wan3 / F2 go to 30s.
    if (name.includes("seedance-2.5") || name === "ai-video-v3" || name === "w3-c1") return 30;
    // Metaso MiniMax-H3: 480p/768p/1080p ≤30s；2K 另在提交侧压到 15s。
    if (name === "minimax-h3") return 30;
    // Volcano Ark Seedance 2.0 family (doubao-seedance-2-0-*) also tops out at 15s.
    if (name.includes("doubao-seedance-2-0") || name.includes("seedance-2.0") || name === "kontony-seedance-2.0" || name === "mj-720-933" || name === "video-generation") return 15;
    // RunningHub Minimax_H3 人脸 / 电影质感 duration max 30s.
    if (name === "2111749073912025090" || name === "2111770992677838849" || name === "2112022441269747713") return 30;
    return VIDEO_SECONDS_MAX;
}

export function clampVideoSeconds(value: string, max = VIDEO_SECONDS_MAX, min = VIDEO_SECONDS_MIN) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(min, Math.min(max, seconds)));
}

export function parseVideoResolution(value: string | undefined) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "low") return "480";
    if (raw === "auto" || raw === "high" || raw === "medium") return "720";
    // Metaso / MiniMax label tiers (not short-side pixels).
    if (raw === "2k" || raw === "2048") return "1440";
    if (raw === "4k" || raw === "3840") return "2160";
    const number = raw.replace(/p$/i, "");
    return /^\d+$/.test(number) && Number(number) > 0 ? number : "720";
}

function catalogResolutionRank(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "2k") return 1440;
    if (raw === "4k") return 2160;
    return Number(parseVideoResolution(value)) || 720;
}

/**
 * Map a stored quality onto a model catalog tier.
 * MiniMax-H3 has 768p and no 720p; the workbench default "720" must land on 768p, not the first tier (480p).
 */
export function matchCatalogResolution(selected: string, allowed: string[]) {
    const list = allowed.map((item) => item.trim()).filter(Boolean);
    const raw = String(selected || "").trim().toLowerCase();
    const exact = (candidate: string) => list.find((item) => item.toLowerCase() === candidate.toLowerCase());
    const nearest = (target: number) =>
        [...list].sort((a, b) => Math.abs(catalogResolutionRank(a) - target) - Math.abs(catalogResolutionRank(b) - target))[0] || list[0] || "720p";
    if (!list.length) {
        if (!raw || raw === "auto" || raw === "high" || raw === "medium") return "720p";
        if (raw === "low") return "480p";
        if (raw === "2k" || raw === "4k") return raw;
        return raw.endsWith("p") ? raw : `${parseVideoResolution(selected)}p`;
    }
    if (!raw || raw === "auto" || raw === "high" || raw === "medium") return exact("720p") || exact("768p") || nearest(720);
    if (raw === "low") return exact("480p") || list[0];
    if (raw === "2k" || raw === "2048") return exact("2k") || nearest(1440);
    if (raw === "4k" || raw === "3840") return exact("4k") || nearest(2160);
    const withP = raw.endsWith("p") ? raw : `${raw.replace(/p$/i, "")}p`;
    return exact(withP) || exact(raw) || nearest(catalogResolutionRank(withP));
}

export function inferVideoRatio(size: string) {
    if (!size || size === "auto") return "auto";
    if (videoRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return "16:9";
    const target = pixels.width / pixels.height;
    return videoRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = videoRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 16) / (bestOption?.height || 9);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, "16:9");
}

export function computeVideoSize(resolution: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const parsed = parseAspectRatio(ratio);
    if (!parsed) return "auto";
    const p = Math.max(1, Math.floor(Number(parseVideoResolution(resolution)) || 720));
    const landscape = parsed.width >= parsed.height;
    const width = evenRound(landscape ? (p * parsed.width) / parsed.height : p);
    const height = evenRound(landscape ? p : (p * parsed.height) / parsed.width);
    return `${width}x${height}`;
}

/** Minimax H3 人脸：仅 9:16 / 16:9；短边=清晰度档 → 720×1280 / 1280×720 / 1080×1920 … */
export function normalizeH3FaceRatio(sizeOrRatio: string | undefined): "9:16" | "16:9" {
    return inferVideoRatio(sizeOrRatio || "16:9") === "9:16" ? "9:16" : "16:9";
}

export function computeH3FaceOutputSize(resolution: string | undefined, sizeOrRatio: string | undefined) {
    return computeVideoSize(parseVideoResolution(resolution || "720"), normalizeH3FaceRatio(sizeOrRatio));
}

export function readVideoDimensions(size: string, resolution: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

function evenRound(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}
