import { collectCanvasMediaKeys, mirrorBlobToCanvasMedia } from "@/services/api/canvas-media-api";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

type RemoteProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    document?: Partial<CanvasProject>;
};

type RemoteAsset = {
    id: string;
    kind: "text" | "image" | "video" | "audio";
    title: string;
    tags?: string[];
    content?: string;
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
    createdAt: string;
    updatedAt: string;
};

let started = false;
let applying = false;
let knownAssetIds = new Set<string>();

function platformSession() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string; username?: string }) : null;
        return {
            token: typeof parsed?.access_token === "string" ? parsed.access_token : "",
            username: typeof parsed?.username === "string" ? parsed.username : "",
        };
    } catch {
        return { token: "", username: "" };
    }
}

function platformToken() {
    return platformSession().token;
}

async function api(path: string, init: RequestInit = {}) {
    const token = platformToken();
    if (!token) throw new Error("login");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api-proxy/canvas-workspace${path}`, { ...init, headers, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response;
}

function toProject(item: RemoteProject): CanvasProject {
    const document = item.document || {};
    return {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        nodes: document.nodes || [],
        connections: document.connections || [],
        chatSessions: document.chatSessions || [],
        activeChatId: document.activeChatId || null,
        backgroundMode: document.backgroundMode || "lines",
        showImageInfo: Boolean(document.showImageInfo),
        viewport: document.viewport || { x: 0, y: 0, k: 1 },
    };
}

function projectBody(project: CanvasProject) {
    return {
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
    };
}

function mergeProjects(local: CanvasProject[], remote: CanvasProject[]) {
    const map = new Map<string, CanvasProject>();
    remote.forEach((item) => map.set(item.id, item));
    local.forEach((item) => {
        const other = map.get(item.id);
        if (!other || item.updatedAt >= other.updatedAt) map.set(item.id, item);
    });
    return [...map.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function pushProjects() {
    const state = useCanvasStore.getState();
    await api("/projects", {
        method: "PUT",
        body: JSON.stringify({
            projects: state.projects.map(projectBody),
            deletedIds: state.deletedProjects.map((item) => item.id),
        }),
    });
}

async function fileBlob(asset: Asset) {
    if (asset.kind === "image") {
        if (asset.data.storageKey) return getImageBlob(asset.data.storageKey);
        if (asset.data.dataUrl) {
            const response = await fetch(asset.data.dataUrl);
            return response.blob();
        }
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        if (asset.data.storageKey) return getMediaBlob(asset.data.storageKey);
        if (asset.data.url) {
            const response = await fetch(asset.data.url);
            return response.blob();
        }
    }
    return null;
}

async function pushAsset(asset: Asset) {
    if (asset.kind === "text") {
        await api("/assets/text", {
            method: "POST",
            body: JSON.stringify({ id: asset.id, title: asset.title, tags: asset.tags, content: asset.data.content }),
        });
        knownAssetIds.add(asset.id);
        return;
    }
    const blob = await fileBlob(asset);
    if (!blob) return;
    const body = new FormData();
    body.set("asset_id", asset.id);
    body.set("title", asset.title);
    body.set("kind", asset.kind);
    body.set("width", String(asset.kind === "audio" ? 0 : asset.data.width));
    body.set("height", String(asset.kind === "audio" ? 0 : asset.data.height));
    body.set("file", blob, asset.title || `${asset.kind}.bin`);
    await api("/assets/file", { method: "POST", body });
    knownAssetIds.add(asset.id);
}

async function remoteAssetToLocal(item: RemoteAsset): Promise<Asset | null> {
    if (item.kind === "text") {
        return {
            id: item.id,
            kind: "text",
            title: item.title,
            coverUrl: "",
            tags: item.tags || [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            data: { content: item.content || "" },
        };
    }
    if (item.kind !== "image" && item.kind !== "video" && item.kind !== "audio") return null;
    const response = await api(`/assets/${item.id}/file`);
    const blob = await response.blob();
    if (item.kind === "image") {
        const image = await uploadImage(blob);
        return {
            id: item.id,
            kind: "image",
            title: item.title,
            coverUrl: image.url,
            tags: item.tags || [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            data: { dataUrl: image.url, storageKey: image.storageKey, width: item.width || image.width, height: item.height || image.height, bytes: item.bytes || image.bytes, mimeType: item.mimeType || image.mimeType },
        };
    }
    const media = await uploadMediaFile(blob, item.kind === "audio" ? "audio" : "video");
    if (item.kind === "audio") {
        return {
            id: item.id,
            kind: "audio",
            title: item.title,
            coverUrl: "",
            tags: item.tags || [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            data: { url: media.url, storageKey: media.storageKey, bytes: item.bytes || media.bytes, mimeType: item.mimeType || media.mimeType, durationMs: media.durationMs },
        };
    }
    return {
        id: item.id,
        kind: "video",
        title: item.title,
        coverUrl: "",
        tags: item.tags || [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        data: { url: media.url, storageKey: media.storageKey, width: item.width || media.width || 0, height: item.height || media.height || 0, bytes: item.bytes || media.bytes, mimeType: item.mimeType || media.mimeType },
    };
}

async function syncAssets() {
    const response = await api("/assets");
    const payload = (await response.json()) as { assets?: RemoteAsset[] };
    const remote = payload.assets || [];
    knownAssetIds = new Set(remote.map((item) => item.id));
    const local = useAssetStore.getState().assets;
    const localIds = new Set(local.map((item) => item.id));
    const imported: Asset[] = [];
    for (const item of remote) {
        if (localIds.has(item.id)) continue;
        try {
            const asset = await remoteAssetToLocal(item);
            if (asset) imported.push(asset);
        } catch {
            // The NAS copy can exist before this server still has a readable file.
        }
    }
    if (imported.length) {
        applying = true;
        useAssetStore.getState().replaceAssets([...imported, ...useAssetStore.getState().assets]);
        applying = false;
    }
    for (const asset of useAssetStore.getState().assets) {
        if (knownAssetIds.has(asset.id)) continue;
        try {
            await pushAsset(asset);
        } catch {
            // Keep the local asset and retry on the next change.
        }
    }
}

async function pushCanvasMedia() {
    const keys = [...collectCanvasMediaKeys(useCanvasStore.getState().projects)];
    const worker = async () => {
        while (keys.length) {
            const key = keys.shift();
            if (!key) return;
            const blob = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
            if (!blob || blob.size < 32) continue;
            await mirrorBlobToCanvasMedia(key, blob);
        }
    };
    await Promise.all([worker(), worker()]);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePush() {
    if (applying) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        void pushProjects().catch(() => undefined);
        void pushCanvasMedia().catch(() => undefined);
        const pending = useAssetStore.getState().assets.filter((asset) => !knownAssetIds.has(asset.id));
        pending.forEach((asset) => {
            void pushAsset(asset).catch(() => undefined);
        });
    }, 1200);
}

export function startCanvasWorkspaceSync() {
    if (started || !platformToken()) return;
    started = true;
    const run = async () => {
        if (!useCanvasStore.persist.hasHydrated() || !useAssetStore.persist.hasHydrated()) return;
        applying = true;
        try {
            const response = await api("/projects");
            const payload = (await response.json()) as { projects?: RemoteProject[] };
            const remote = (payload.projects || []).map(toProject);
            const username = platformSession().username;
            const previousOwner = localStorage.getItem("canvas-workspace-owner");
            const switchedUser = Boolean(previousOwner && username && previousOwner !== username);
            if (username) localStorage.setItem("canvas-workspace-owner", username);
            if (switchedUser) {
                useCanvasStore.getState().replaceProjects(remote, []);
                useAssetStore.getState().replaceAssets([]);
            } else {
                const deleted = new Set(useCanvasStore.getState().deletedProjects.map((item) => item.id));
                const merged = mergeProjects(
                    useCanvasStore.getState().projects,
                    remote.filter((item) => !deleted.has(item.id)),
                );
                useCanvasStore.getState().replaceProjects(merged, useCanvasStore.getState().deletedProjects);
            }
            if (!switchedUser) await pushProjects();
            await pushCanvasMedia();
            await syncAssets();
        } finally {
            applying = false;
        }
    };
    let booted = false;
    const boot = () => {
        if (!useCanvasStore.persist.hasHydrated() || !useAssetStore.persist.hasHydrated()) return;
        if (booted) return;
        booted = true;
        void run().catch(() => undefined);
    };
    if (useCanvasStore.persist.hasHydrated() && useAssetStore.persist.hasHydrated()) boot();
    useCanvasStore.persist.onFinishHydration(boot);
    useAssetStore.persist.onFinishHydration(boot);
    useCanvasStore.subscribe(() => schedulePush());
    useAssetStore.subscribe(() => schedulePush());
}
