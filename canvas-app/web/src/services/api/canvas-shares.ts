import { nanoid } from "nanoid";

import { collectCanvasMediaKeys } from "@/services/api/canvas-media-api";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

export type SharedCanvasItem = {
    shareId: string;
    documentId: string;
    owner: string;
    title: string;
    nodeCount: number;
    connectionCount: number;
    createdAt: string;
    updatedAt: string;
    isOwner: boolean;
};

type SharedProjectDetail = SharedCanvasItem & {
    project: {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        document?: Partial<CanvasProject>;
    };
    mediaKeys?: string[];
};

function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

async function api(path: string, init: RequestInit = {}) {
    const token = platformToken();
    if (!token) throw new Error("请先登录平台后再使用共享画布");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`/api-proxy/canvas-workspace${path}`, { ...init, headers, cache: "no-store" });
    if (!response.ok) {
        let detail = "";
        try {
            const data = (await response.json()) as { detail?: string };
            detail = typeof data.detail === "string" ? data.detail : "";
        } catch {
            detail = "";
        }
        throw new Error(detail || `请求失败（${response.status}）`);
    }
    if (response.status === 204) return null;
    return response;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function remapMediaKeys(value: unknown, keyMap: Map<string, string>, depth = 0): unknown {
    if (depth > 16 || value == null) return value;
    if (typeof value === "string") return keyMap.get(value) || value;
    if (Array.isArray(value)) return value.map((item) => remapMediaKeys(item, keyMap, depth + 1));
    if (typeof value === "object") {
        const next: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            next[key] = remapMediaKeys(item, keyMap, depth + 1);
        }
        return next;
    }
    return value;
}

async function fetchSharedMediaBlob(shareId: string, mediaKey: string, maxWaitMs = 60_000) {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
        const token = platformToken();
        if (!token) throw new Error("请先登录平台后再使用共享画布");
        const response = await fetch(
            `/api-proxy/canvas-workspace/shares/${encodeURIComponent(shareId)}/media/${encodeURIComponent(mediaKey)}/file`,
            { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        if (response.status === 202) {
            await sleep(1200);
            continue;
        }
        if (!response.ok) return null;
        return response.blob();
    }
    return null;
}

export async function listSharedCanvases(): Promise<SharedCanvasItem[]> {
    const response = await api("/shares");
    if (!response) return [];
    const data = (await response.json()) as { shares?: SharedCanvasItem[] };
    return data.shares || [];
}

export async function shareCanvasProject(projectId: string): Promise<SharedCanvasItem> {
    // Ensure the latest local project is on the server before sharing.
    const state = useCanvasStore.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("画布不存在");
    await api("/projects", {
        method: "PUT",
        body: JSON.stringify({
            projects: [
                {
                    id: project.id,
                    title: project.title,
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt,
                    document: {
                        nodes: project.nodes,
                        connections: project.connections,
                        chatSessions: project.chatSessions,
                        activeChatId: project.activeChatId,
                        backgroundMode: project.backgroundMode,
                        showImageInfo: project.showImageInfo,
                        viewport: project.viewport,
                    },
                },
            ],
            deletedIds: [],
        }),
    });
    const response = await api(`/projects/${encodeURIComponent(projectId)}/share`, { method: "POST", body: "{}" });
    if (!response) throw new Error("分享失败");
    return (await response.json()) as SharedCanvasItem;
}

export async function unshareCanvas(shareId: string) {
    await api(`/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });
}

/** Copy a shared canvas into the current user's library (new id + remapped media). */
export async function copySharedCanvasToMine(shareId: string): Promise<string> {
    const response = await api(`/shares/${encodeURIComponent(shareId)}`);
    if (!response) throw new Error("无法读取共享画布");
    const detail = (await response.json()) as SharedProjectDetail;
    const document = detail.project?.document || {};
    const keys = [...collectCanvasMediaKeys(document)];
    const keyMap = new Map<string, string>();
    for (const oldKey of keys) {
        const prefix = oldKey.split(":")[0] || "file";
        const newKey = `${prefix}:${nanoid()}`;
        keyMap.set(oldKey, newKey);
        const blob = await fetchSharedMediaBlob(shareId, oldKey);
        if (!blob || blob.size < 16) continue;
        if (newKey.startsWith("image:")) await setImageBlob(newKey, blob);
        else await setMediaBlob(newKey, blob);
    }
    const remapped = remapMediaKeys(document, keyMap) as Partial<CanvasProject>;
    const title = `${detail.title || detail.project?.title || "共享画布"}（副本）`;
    return useCanvasStore.getState().importProject({
        ...remapped,
        title,
        nodes: Array.isArray(remapped.nodes) ? remapped.nodes : [],
        connections: Array.isArray(remapped.connections) ? remapped.connections : [],
        chatSessions: Array.isArray(remapped.chatSessions) ? remapped.chatSessions : [],
        activeChatId: typeof remapped.activeChatId === "string" ? remapped.activeChatId : null,
        backgroundMode: remapped.backgroundMode || "lines",
        showImageInfo: Boolean(remapped.showImageInfo),
        viewport: remapped.viewport || { x: 0, y: 0, k: 1 },
    });
}
