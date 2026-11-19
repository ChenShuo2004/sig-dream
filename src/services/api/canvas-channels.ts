import type { ModelChannel } from "@/stores/use-config-store";

/** Pure local standalone edition — no login gate or remote account server required. */
export function isLocalCanvasPreview() {
    return true;
}

export function platformRole() {
    return "super_admin";
}

export function canUseCanvas(_role?: string) {
    return true;
}

export async function readDetail(response: Response) {
    try {
        const payload = (await response.json()) as { detail?: unknown };
        if (typeof payload.detail === "string" && payload.detail) return payload.detail;
    } catch {
        return "";
    }
    return "";
}

export function readableError(detail: string, fallback: string) {
    return detail || fallback;
}

export async function authorizedFetch(url: string, init: RequestInit = {}) {
    return fetch(url, { ...init, cache: "no-store" });
}

export async function fetchCanvasChannels() {
    return [] as ModelChannel[];
}

export async function saveCanvasChannels(_channels: ModelChannel[]) {
    // Channels are persisted locally in browser storage via use-config-store.
}
