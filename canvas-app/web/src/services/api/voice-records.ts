import { nanoid } from "nanoid";

import { mirrorBlobToCanvasMedia, pinCanvasMedia } from "@/services/api/canvas-media-api";
import { authorizedFetch } from "@/services/api/canvas-channels";
import { uploadMediaFile } from "@/services/file-storage";
import { saveBlobToUnorganized } from "@/services/api/save-to-unorganized";
import { getMediaBlob } from "@/services/file-storage";

const BASE = "/api-proxy/voice-records";

export type VoiceRecord = {
    id: string;
    text: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    createdAt: string;
};

export async function listVoiceRecords() {
    const response = await authorizedFetch(BASE);
    if (!response.ok) return [] as VoiceRecord[];
    const payload = (await response.json()) as { records?: VoiceRecord[] };
    return Array.isArray(payload.records) ? payload.records : [];
}

/** Keep the wav locally, on NAS, and as a server record so another computer can play it. */
export async function persistVoiceResult(text: string, blob: Blob, referenceKeys: string[] = []) {
    const stored = await uploadMediaFile(blob, "audio");
    const nasWarning = await mirrorBlobToCanvasMedia(stored.storageKey, blob);
    try {
        const response = await authorizedFetch(BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: nanoid(),
                text,
                storageKey: stored.storageKey,
                bytes: stored.bytes,
                mimeType: stored.mimeType || blob.type || "audio/wav",
                referenceKeys: referenceKeys.filter(Boolean),
            }),
        });
        if (!response.ok) return { ...stored, nasWarning: nasWarning || "语音已保存在本地，写入服务器记录失败" };
    } catch {
        return { ...stored, nasWarning: nasWarning || "语音已保存在本地，登录后才会写入服务器" };
    }
    return { ...stored, nasWarning };
}

export async function deleteVoiceRecord(id: string) {
    const response = await authorizedFetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("delete");
}

export async function saveVoiceRecordToLibrary(record: VoiceRecord) {
    const blob = await getMediaBlob(record.storageKey);
    if (!blob) throw new Error("empty");
    const title = record.text.replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "克隆语音";
    const mime = blob.type || record.mimeType || "audio/wav";
    const extension = mime.includes("wav") ? "wav" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "wav";
    try {
        await saveBlobToUnorganized(new File([blob], `${title}.${extension}`, { type: mime }), { title, description: record.text });
    } catch (error) {
        if (!(error instanceof Error) || error.message !== "duplicate") throw error;
    }
    await pinCanvasMedia(record.storageKey);
}
