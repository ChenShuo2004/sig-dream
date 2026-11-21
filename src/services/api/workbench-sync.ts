import localforage from "localforage";

import { collectCanvasMediaKeys, mirrorBlobToCanvasMedia } from "@/services/api/canvas-media-api";
import { authorizedFetch } from "@/services/api/canvas-channels";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";

export type WorkbenchKind = "image" | "video";

type StoredLog = Record<string, unknown> & { id?: string; createdAt?: number; updatedAt?: number };

const BASE = "/api-proxy/workbench-records";

function deletedStorageKey(kind: WorkbenchKind) {
    return `workbench-deleted:${kind}`;
}

function readDeleted(kind: WorkbenchKind) {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(deletedStorageKey(kind)) || "[]") as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    } catch {
        return [];
    }
}

export function markWorkbenchDeleted(kind: WorkbenchKind, ids: string[]) {
    const next = new Set([...readDeleted(kind), ...ids]);
    sessionStorage.setItem(deletedStorageKey(kind), JSON.stringify([...next]));
}

function stamp(log: StoredLog) {
    const createdAt = typeof log.createdAt === "number" ? log.createdAt : Date.now();
    const updatedAt = typeof log.updatedAt === "number" ? log.updatedAt : createdAt;
    return { ...log, createdAt, updatedAt };
}

function stripLocalUrls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripLocalUrls);
    if (!value || typeof value !== "object") return value;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) next[key] = stripLocalUrls(item);
    if (typeof next.storageKey === "string" && next.storageKey.includes(":")) {
        if (typeof next.dataUrl === "string" && (next.dataUrl.startsWith("blob:") || next.dataUrl.startsWith("data:"))) next.dataUrl = "";
        if (typeof next.url === "string" && next.url.startsWith("blob:")) next.url = "";
    }
    return next;
}

async function readLocal(store: LocalForage) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object" && typeof value.id === "string") logs.push(stamp(value));
    });
    return logs;
}

async function replaceLocal(store: LocalForage, logs: StoredLog[]) {
    const keep = new Set(logs.map((log) => String(log.id)));
    const existing: string[] = [];
    await store.iterate<StoredLog, void>((_value, key) => {
        existing.push(String(key));
    });
    await Promise.all(logs.map((log) => store.setItem(String(log.id), log)));
    await Promise.all(existing.filter((id) => !keep.has(id)).map((id) => store.removeItem(id)));
}

function mergeLogs(local: StoredLog[], remote: StoredLog[], deleted: Set<string>) {
    const map = new Map<string, StoredLog>();
    for (const item of remote) {
        if (!item.id || deleted.has(item.id)) continue;
        map.set(item.id, stamp(item));
    }
    for (const item of local) {
        if (!item.id || deleted.has(item.id)) continue;
        const other = map.get(item.id);
        if (!other || (item.updatedAt || 0) >= (other.updatedAt || 0)) map.set(item.id, stamp(item));
    }
    return [...map.values()].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0)).slice(0, 400);
}

async function uploadLogMedia(logs: StoredLog[]) {
    const keys = collectCanvasMediaKeys(logs);
    const pending = [...keys];
    const worker = async () => {
        while (pending.length) {
            const key = pending.shift();
            if (!key) return;
            const blob = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
            if (!blob) continue;
            await mirrorBlobToCanvasMedia(key, blob);
        }
    };
    await Promise.all([worker(), worker()]);
}

/** Pull this browser's logs together with the account's server copy, then write both back. */
export async function syncWorkbenchLogs(kind: WorkbenchKind, store: LocalForage) {
    const local = await readLocal(store);
    const deleted = new Set(readDeleted(kind));
    let remote: StoredLog[] = [];
    try {
        const response = await authorizedFetch(`${BASE}?kind=${kind}`);
        if (response.ok) {
            const payload = (await response.json()) as { records?: Array<{ id?: string; document?: StoredLog }> };
            remote = (payload.records || [])
                .map((item): StoredLog | null => (item.document && typeof item.document === "object" ? stamp({ ...item.document, id: item.document.id || item.id }) : null))
                .filter((item): item is StoredLog => Boolean(item?.id));
        }
    } catch {
        return local;
    }
    const merged = mergeLogs(local, remote, deleted);
    try {
        await uploadLogMedia(merged);
        const response = await authorizedFetch(BASE, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                kind,
                records: merged.map((log) => ({ id: log.id, document: stripLocalUrls(log) })),
                deletedIds: [...deleted],
            }),
        });
        if (response.ok) sessionStorage.removeItem(deletedStorageKey(kind));
    } catch {
        // The local copy remains. The next open tries the server again.
    }
    await replaceLocal(store, merged);
    return merged;
}
