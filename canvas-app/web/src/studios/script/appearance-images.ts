import { zipSync } from "fflate";

import { getStudioMediaBlob } from "../media";
import type { StudioAppearance, StudioAsset, StudioAssetKind } from "../types";

const KIND_FOLDER: Record<StudioAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };

export function defaultAssetPresetId(kind: StudioAssetKind) {
    if (kind === "character") return "character-three-view-face";
    if (kind === "scene") return "scene-four-view";
    return "none";
}

export function appearanceImageKeys(look: StudioAppearance): string[] {
    const keys: string[] = [];
    for (const key of look.imageKeys || []) {
        if (key && !keys.includes(key)) keys.push(key);
    }
    if (look.imageKey && !keys.includes(look.imageKey)) keys.unshift(look.imageKey);
    return keys;
}

/** Append a new generated/uploaded image and make it the active one. */
export function applyAppearanceImage(look: StudioAppearance, imageKey: string): StudioAppearance {
    const keys = appearanceImageKeys(look);
    if (!keys.includes(imageKey)) keys.push(imageKey);
    return { ...look, imageKey, imageKeys: keys, imageStatus: "done", imageError: "" };
}

export function sanitizeDownloadName(name: string) {
    return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "未命名";
}

export function appearanceImageFileName(asset: StudioAsset, look: StudioAppearance, index: number, total: number) {
    const lookName = look.name?.trim() || `形象${index + 1}`;
    const base = `${sanitizeDownloadName(asset.name)}-${sanitizeDownloadName(lookName)}`;
    const suffix = total > 1 ? `-${String(index + 1).padStart(2, "0")}` : "";
    return `${base}${suffix}.png`;
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

export async function downloadAppearanceImage(asset: StudioAsset, look: StudioAppearance, imageKey: string) {
    const keys = appearanceImageKeys(look);
    const index = Math.max(0, keys.indexOf(imageKey));
    const blob = await getStudioMediaBlob(imageKey);
    if (!blob) throw new Error("找不到图片文件。");
    downloadBlob(blob, appearanceImageFileName(asset, look, index, keys.length));
}

export async function downloadAllAssetImages(assets: StudioAsset[], zipName = "素材图片") {
    const files: Record<string, Uint8Array> = {};
    let count = 0;
    for (const asset of assets) {
        const folder = KIND_FOLDER[asset.kind];
        for (const look of asset.appearances) {
            const keys = appearanceImageKeys(look);
            for (let index = 0; index < keys.length; index += 1) {
                const blob = await getStudioMediaBlob(keys[index]);
                if (!blob) continue;
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const name = `${folder}/${appearanceImageFileName(asset, look, index, keys.length)}`;
                files[name] = bytes;
                count += 1;
            }
        }
    }
    if (!count) throw new Error("还没有可下载的素材图。");
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `${sanitizeDownloadName(zipName)}.zip`);
    return count;
}
