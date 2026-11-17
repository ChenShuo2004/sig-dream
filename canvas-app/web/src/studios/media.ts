import localforage from "localforage";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

import { downloadGeneratedMedia } from "@/services/api/generated-media";
import { archiveGeneratedBlob } from "@/services/api/save-to-unorganized";
import { withLocalProxy } from "@/stores/use-config-store";

import { fetchStudioMediaBlob, studioMediaExists, uploadStudioMedia } from "./studio-media-api";

// Kept apart from the canvas media stores so canvas cleanup never removes studio files.
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "studio_media" });
const objectUrls = new Map<string, string>();
const syncedKeys = new Set<string>();
const pushAttempts = new Map<string, number>();

function kindFromKey(key: string): "image" | "video" | "audio" | null {
    if (key.startsWith("studio-image:")) return "image";
    if (key.startsWith("studio-video:")) return "video";
    if (key.startsWith("studio-audio:")) return "audio";
    return null;
}

function asBlob(value: unknown): Blob | null {
    if (value instanceof Blob) return value;
    if (value instanceof ArrayBuffer) return new Blob([value]);
    if (ArrayBuffer.isView(value)) return new Blob([value.buffer]);
    return null;
}

async function pushStudioMedia(key: string, blob: Blob, kind: "image" | "video" | "audio", checkRemote = true) {
    try {
        if (checkRemote && (await studioMediaExists(key))) {
            syncedKeys.add(key);
            pushAttempts.delete(key);
            return;
        }
        await uploadStudioMedia(key, blob, kind);
        syncedKeys.add(key);
        pushAttempts.delete(key);
    } catch {
        const attempt = (pushAttempts.get(key) || 0) + 1;
        pushAttempts.set(key, attempt);
        if (attempt < 5) {
            window.setTimeout(() => void pushStudioMedia(key, blob, kind, checkRemote), attempt * 3000);
        }
    }
}

let persistRequested = false;

/** Asks the browser not to evict this origin's IndexedDB under disk pressure. */
export function requestPersistentStorage() {
    if (persistRequested) return;
    persistRequested = true;
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return;
    void storage
        .persisted()
        .then((already) => (already ? true : storage.persist()))
        .catch(() => false);
}

const STUDIO_KEY_RE = /^studio-(image|video|audio):[A-Za-z0-9_-]{8,64}$/;

function collectStudioKeys(value: unknown, out: Set<string>, depth = 0) {
    if (depth > 12 || value == null) return;
    if (typeof value === "string") {
        if (STUDIO_KEY_RE.test(value)) out.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStudioKeys(item, out, depth + 1);
        return;
    }
    if (typeof value === "object") {
        for (const item of Object.values(value as Record<string, unknown>)) collectStudioKeys(item, out, depth + 1);
    }
}

const backfilling = new Set<string>();

/** Uploads every media key referenced by the document that is still only in the local cache. */
export async function backfillStudioMedia(document: unknown) {
    const keys = new Set<string>();
    collectStudioKeys(document, keys);
    const pending = [...keys].filter((key) => !syncedKeys.has(key) && !backfilling.has(key));
    pending.forEach((key) => backfilling.add(key));
    const worker = async () => {
        while (pending.length) {
            const key = pending.shift()!;
            try {
                const kind = kindFromKey(key);
                const local = asBlob(await store.getItem(key));
                if (kind && local && local.size > 0) await pushStudioMedia(key, local, kind);
            } catch {
                // retried on next open or render
            } finally {
                backfilling.delete(key);
            }
        }
    };
    await Promise.all([worker(), worker()]);
}

export async function persistStudioGenerated(input: string | Blob, kind: "image" | "video", prompt?: string) {
    const blob = typeof input === "string" ? await downloadGeneratedMedia(input) : input;
    const key = await saveStudioMedia(blob, kind);
    await archiveGeneratedBlob(blob, kind, { prompt });
    return key;
}

export async function saveStudioMedia(input: string | Blob, kind: "image" | "video" | "audio") {
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(input))).blob() : input;
    const key = `studio-${kind}:${nanoid()}`;
    await store.setItem(key, blob);
    objectUrls.set(key, URL.createObjectURL(blob));
    void pushStudioMedia(key, blob, kind, false);
    return key;
}

export async function putStudioMedia(key: string, blob: Blob) {
    await store.setItem(key, blob);
    objectUrls.set(key, URL.createObjectURL(blob));
    const kind = kindFromKey(key);
    if (kind && !syncedKeys.has(key)) void pushStudioMedia(key, blob, kind);
}

export async function getStudioMediaBlob(key: string) {
    return store.getItem<Blob>(key);
}

export async function resolveStudioMedia(key?: string) {
    if (!key) return "";
    const cached = objectUrls.get(key);
    if (cached) return cached;
    try {
        const local = asBlob(await store.getItem(key));
        if (local && local.size > 0) {
            const url = URL.createObjectURL(local);
            objectUrls.set(key, url);
            const kind = kindFromKey(key);
            if (kind && !syncedKeys.has(key)) void pushStudioMedia(key, local, kind);
            return url;
        }
    } catch {
        // fall through to remote restore
    }

    try {
        const remote = await fetchStudioMediaBlob(key);
        if (!remote || remote.size <= 0) return "";
        await store.setItem(key, remote);
        syncedKeys.add(key);
        const url = URL.createObjectURL(remote);
        objectUrls.set(key, url);
        return url;
    } catch {
        return "";
    }
}

/** True when the project still references this key but neither local nor NAS has the bytes. */
export async function isStudioMediaMissing(key?: string) {
    if (!key) return false;
    if (objectUrls.has(key)) return false;
    try {
        const blob = asBlob(await store.getItem(key));
        if (blob && blob.size > 0) return false;
    } catch {
        // check remote
    }
    try {
        return !(await studioMediaExists(key));
    } catch {
        return true;
    }
}

export async function studioMediaDataUrl(key: string) {
    const blob = await store.getItem<Blob>(key);
    if (!blob) return "";
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export type StudioMediaPhase = "empty" | "loading" | "ready" | "restoring" | "missing";

export function useStudioMediaState(key?: string) {
    const [url, setUrl] = useState(() => (key ? objectUrls.get(key) || "" : ""));
    const [phase, setPhase] = useState<StudioMediaPhase>(() => {
        if (!key) return "empty";
        if (objectUrls.has(key)) return "ready";
        return "loading";
    });

    useEffect(() => {
        let cancelled = false;
        if (!key) {
            setUrl("");
            setPhase("empty");
            return;
        }
        const cached = objectUrls.get(key);
        if (cached) {
            setUrl(cached);
            setPhase("ready");
            return;
        }
        setPhase("loading");
        void (async () => {
            try {
                const local = asBlob(await store.getItem(key));
                if (cancelled) return;
                if (local && local.size > 0) {
                    const next = URL.createObjectURL(local);
                    objectUrls.set(key, next);
                    setUrl(next);
                    setPhase("ready");
                    const kind = kindFromKey(key);
                    if (kind && !syncedKeys.has(key)) void pushStudioMedia(key, local, kind);
                    return;
                }
            } catch {
                // restore from NAS
            }
            if (cancelled) return;
            setPhase("restoring");
            try {
                const remote = await fetchStudioMediaBlob(key);
                if (cancelled) return;
                if (!remote || remote.size <= 0) {
                    setUrl("");
                    setPhase("missing");
                    return;
                }
                await store.setItem(key, remote);
                syncedKeys.add(key);
                const next = URL.createObjectURL(remote);
                objectUrls.set(key, next);
                setUrl(next);
                setPhase("ready");
            } catch {
                if (!cancelled) {
                    setUrl("");
                    setPhase("missing");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [key]);

    return { url, phase };
}

export function useStudioMedia(key?: string) {
    return useStudioMediaState(key).url;
}
