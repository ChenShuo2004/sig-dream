import localforage from "localforage";

const mediaStore = localforage.createInstance({
    name: "sig-dream-studios",
    storeName: "media",
});

export async function uploadStudioMedia(mediaKey: string, blob: Blob, _kind: "image" | "video" | "audio") {
    await mediaStore.setItem(mediaKey, blob);
    return { mediaKey, status: "ready" };
}

export async function studioMediaExists(mediaKey: string) {
    const item = await mediaStore.getItem<Blob>(mediaKey);
    return Boolean(item && item.size > 0);
}

export async function fetchStudioMediaBlob(mediaKey: string, _opts?: { signal?: AbortSignal; maxWaitMs?: number }) {
    const blob = await mediaStore.getItem<Blob>(mediaKey);
    if (!blob || blob.size <= 0) return null;
    return blob;
}
