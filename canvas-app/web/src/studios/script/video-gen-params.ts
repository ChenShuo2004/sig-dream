import { normalizeVideoSizeValue, resolutionMatches } from "@/components/video-settings-panel";
import { parseVideoResolution } from "@/lib/media-size";

export function resolveVideoQuality(value: string | undefined, allowed: string[] = []) {
    const raw = (value || "720").trim();
    if (!allowed.length) return raw || "720";
    const match = allowed.find((item) => resolutionMatches(raw, item));
    return match || allowed[0] || "720";
}

export function resolveVideoSize(value: string | undefined, quality: string, fallbackRatio = "16:9") {
    const stored = (value || "").trim();
    if (stored) return normalizeVideoSizeValue(stored, parseVideoResolution(quality));
    return normalizeVideoSizeValue(fallbackRatio, parseVideoResolution(quality));
}
