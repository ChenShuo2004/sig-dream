import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { createStudioProject } from "../api";
import { getStudioMediaBlob, putStudioMedia } from "../media";
import { upgradeReplacementDocument, type ReplacementStudioDocument } from "./document";

const FEATURE = "person-replacement";
const MEDIA_KEY = /^studio-(image|video|audio):[\w-]+$/u;

type Manifest = { feature: string; version: number; title: string; document: ReplacementStudioDocument; media: Record<string, string> };

function collectKeys(value: unknown, keys: Set<string>) {
    if (typeof value === "string") {
        if (MEDIA_KEY.test(value)) keys.add(value);
    } else if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => collectKeys(item, keys));
}

export async function exportProjectPackage(title: string, document: ReplacementStudioDocument) {
    const keys = new Set<string>();
    collectKeys(document, keys);
    const files: Record<string, Uint8Array> = {};
    const media: Record<string, string> = {};
    for (const key of keys) {
        const blob = await getStudioMediaBlob(key);
        if (!blob) continue;
        const path = `media/${key.replace(":", "_")}`;
        files[path] = new Uint8Array(await blob.arrayBuffer());
        media[key] = `${path}|${blob.type}`;
    }
    const manifest: Manifest = { feature: FEATURE, version: document.version, title, document, media };
    files["project.json"] = strToU8(JSON.stringify(manifest));
    return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
}

export async function importProjectPackage(file: File, defaultVideoPrompt: string) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    if (!entries["project.json"]) throw new Error("不是人物替换项目包：缺少 project.json");
    const manifest = JSON.parse(strFromU8(entries["project.json"])) as Manifest;
    if (manifest.feature !== FEATURE || !manifest.document) throw new Error("不是人物替换项目包");
    for (const [key, value] of Object.entries(manifest.media || {})) {
        const [path, type] = value.split("|");
        const data = entries[path];
        if (data && MEDIA_KEY.test(key)) await putStudioMedia(key, new Blob([data], { type: type || "application/octet-stream" }));
    }
    const document = upgradeReplacementDocument(manifest.document, defaultVideoPrompt);
    return createStudioProject("replacement", `${manifest.title || "人物替换项目"} - 导入`, { ...document, meta: { ...document.meta, archived: false } });
}
