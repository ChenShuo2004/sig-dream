import { nanoid } from "nanoid";

import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { clampedVideoSeconds, normalizeVideoModeValue, videoQualityChoices, videoSecondsBounds } from "@/components/video-settings-panel";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { clampH3DeOilStrength, isRunningHubH3FaceGen, isRunningHubH3FamilyGen, normalizeRunningHubInstanceType } from "@/lib/relay-stations";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { requestVideoGeneration } from "@/services/api/video";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

import { getStudioMediaBlob, persistStudioGenerated, studioMediaDataUrl } from "../media";
import type { StudioAppearance, StudioAsset, StudioClip, StudioAppearanceReferenceRole } from "../types";
import { clipDuration } from "../types";
import type { ScriptSettings, ScriptStudioDocument } from "./document";
import { appendImageGeometryToPrompt, assetImagePrompt, assetImageRatio, compileAssetReferencePrompt } from "./stages";
import { resolveVideoQuality, resolveVideoSize } from "./video-gen-params";
import { assertClipReadyForVideo, bindClipAppearanceRefs, collectClipMaterials, compileClipPromptToImageIndexes, H3_FACE_MAX_REF_IMAGES } from "./video-prompt";

export type StudioMediaSettings = Pick<ScriptSettings, "imageModel" | "videoModel" | "aspectRatio" | "imageQuality" | "videoQuality" | "videoSize" | "videoMode" | "videoMegapixels" | "videoSeed" | "runningHubInstanceType" | "h3DeOilStrength">;

const REFERENCE_ROLE_ORDER: StudioAppearanceReferenceRole[] = ["draft", "style", "character", "background"];
const REFERENCE_ROLE_LABEL: Record<StudioAppearanceReferenceRole, string> = {
    draft: "草稿形象",
    style: "风格参考",
    character: "角色参考",
    background: "背景参考",
};

async function appearanceReferenceImages(appearance: StudioAppearance): Promise<{ references: ReferenceImage[]; roles: StudioAppearanceReferenceRole[] }> {
    const byRole = new Map((appearance.references || []).filter((item) => item.mediaKey).map((item) => [item.role, item]));
    const references: ReferenceImage[] = [];
    const roles: StudioAppearanceReferenceRole[] = [];
    for (const role of REFERENCE_ROLE_ORDER) {
        const item = byRole.get(role);
        if (!item) continue;
        const dataUrl = await studioMediaDataUrl(item.mediaKey);
        if (!dataUrl) continue;
        roles.push(role);
        references.push({
            id: item.id || `${role}-${roles.length}`,
            name: item.name || REFERENCE_ROLE_LABEL[role],
            type: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png",
            dataUrl,
        });
    }
    return { references, roles };
}

export async function generateAppearanceImage(settings: StudioMediaSettings, asset: StudioAsset, appearance: StudioAppearance, signal?: AbortSignal, prompt?: string) {
    const { references, roles } = await appearanceReferenceImages(appearance);
    // Always rebuild with role suffixes so caller-provided body still gets draft/style/character/background lines.
    const body = prompt?.trim() || appearance.prompt;
    const built = assetImagePrompt(asset, { ...appearance, prompt: body }, { roles });
    const ratio = assetImageRatio(asset, settings.aspectRatio);
    const finalPrompt = appendImageGeometryToPrompt(compileAssetReferencePrompt(built, roles), ratio, settings.imageQuality);
    const base = buildGenerationConfig(useConfigStore.getState().config, undefined, "image");
    const quality = (settings.imageQuality || "2K").trim().toLowerCase();
    const config = {
        ...base,
        ...(settings.imageModel ? { model: settings.imageModel } : {}),
        size: ratio === "auto" || ratio === "自适应" ? "auto" : ratio,
        quality,
        count: "1",
    };
    if (!config.model) throw new Error("请先在设置里选择图片模型。");
    const [image] = references.length ? await requestEdit(config, finalPrompt, references, { signal }) : await requestGeneration(config, finalPrompt, { signal });
    if (!image?.dataUrl) throw new Error("图片模型没有返回图片。");
    return persistStudioGenerated(image.dataUrl, "image", finalPrompt);
}

export async function clipReferences(clip: StudioClip, assets: StudioAsset[], options?: { indexedNames?: boolean; maxImages?: number }): Promise<ReferenceImage[]> {
    const references: ReferenceImage[] = [];
    for (const material of collectClipMaterials(clip, assets)) {
        const key = material.appearance?.imageKey;
        if (!key) continue;
        const dataUrl = await studioMediaDataUrl(key);
        // Keep @mention as the reference name so the video prompt and image payload stay aligned.
        if (dataUrl) references.push({ id: material.appearanceId || material.assetId, name: material.mention, type: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png", dataUrl });
    }
    // Include captured 片段帧 stills as extra reference images for re-generation.
    for (const frame of clip.frames || []) {
        if (frame.kind !== "image" || !frame.mediaKey) continue;
        const dataUrl = await studioMediaDataUrl(frame.mediaKey);
        if (dataUrl) references.push({ id: frame.id, name: frame.label || "片段帧", type: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png", dataUrl });
    }
    const capped = typeof options?.maxImages === "number" ? references.slice(0, Math.max(0, options.maxImages)) : references;
    if (!options?.indexedNames) return capped;
    return capped.map((item, index) => ({ ...item, name: imageReferenceLabel(index) }));
}

export async function generateClipVideo(settings: StudioMediaSettings, clip: StudioClip, assets: StudioAsset[], prompt: string, signal?: AbortSignal) {
    const ready = bindClipAppearanceRefs(clip, assets);
    assertClipReadyForVideo(ready, assets);
    const base = buildGenerationConfig(useConfigStore.getState().config, undefined, "video");
    const model = settings.videoModel || base.model;
    const modelBare = modelOptionName(model || "");
    const h3Family = isRunningHubH3FamilyGen(modelBare);
    const faceApp = isRunningHubH3FaceGen(modelBare);
    const modelConfig = { ...base, model, videoModel: model };
    const allowed = videoQualityChoices(modelConfig, h3Family);
    const vquality = resolveVideoQuality(settings.videoQuality || base.vquality, allowed);
    const size = resolveVideoSize(settings.videoSize || settings.aspectRatio || base.size, vquality, settings.aspectRatio || "16:9");
    const secondsBound = videoSecondsBounds(modelConfig);
    const videoSeconds = clampedVideoSeconds({
        ...modelConfig,
        videoSeconds: String(Math.max(secondsBound.min, Math.round(clipDuration(clip)))),
    });
    const config = {
        ...base,
        model,
        vquality,
        size,
        videoMode: normalizeVideoModeValue(settings.videoMode || "reference"),
        videoSeconds,
        videoMegapixels: settings.videoMegapixels || "0.4",
        videoSeed: settings.videoSeed || "",
        runningHubInstanceType: normalizeRunningHubInstanceType(settings.runningHubInstanceType || base.runningHubInstanceType),
        h3DeOilStrength: faceApp ? String(clampH3DeOilStrength(settings.h3DeOilStrength || base.h3DeOilStrength)) : base.h3DeOilStrength,
    };
    if (!config.model) throw new Error("请先在设置里选择视频模型。");
    const materials = collectClipMaterials(ready, assets).slice(0, h3Family ? H3_FACE_MAX_REF_IMAGES : undefined);
    const finalPrompt = h3Family ? compileClipPromptToImageIndexes(prompt, materials) : prompt;
    const references = await clipReferences(ready, assets, h3Family ? { indexedNames: true, maxImages: H3_FACE_MAX_REF_IMAGES } : undefined);
    const result = await requestVideoGeneration(config as typeof base, finalPrompt, references, { signal });
    if (result.blob) return persistStudioGenerated(result.blob, "video", finalPrompt);
    if (result.url) return persistStudioGenerated(result.url, "video", finalPrompt);
    throw new Error("视频模型没有返回视频。");
}

const COLUMN_GAP = 40;

export type CanvasSyncSource = Pick<ScriptStudioDocument, "assets"> & { episodes: Array<{ id?: string; number: number; clips: StudioClip[] }> };

export async function syncScriptToCanvas(title: string, document: CanvasSyncSource, options?: { episodeIds?: string[]; includeAssets?: boolean }) {
    const nodes: CanvasNodeData[] = [];
    let y = 0;
    const includeAssets = options?.includeAssets !== false;
    const episodeFilter = options?.episodeIds?.length ? new Set(options.episodeIds) : null;
    const assetRow: CanvasNodeData[] = [];
    if (includeAssets) {
        for (const asset of document.assets) {
            for (const look of asset.appearances) {
                if (!look.imageKey) continue;
                const blob = await getStudioMediaBlob(look.imageKey);
                if (!blob) continue;
                const uploaded = await uploadImage(blob);
                const node = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ...imageMetadata(uploaded), prompt: look.prompt });
                assetRow.push({ ...node, title: look.name ? `${asset.name} · ${look.name}` : asset.name });
            }
        }
    }
    let x = 0;
    for (const node of assetRow) {
        nodes.push({ ...node, position: { x, y } });
        x += node.width + COLUMN_GAP;
    }
    if (assetRow.length) y += Math.max(...assetRow.map((node) => node.height)) + COLUMN_GAP * 3;

    for (const episode of document.episodes) {
        if (episodeFilter && episode.id && !episodeFilter.has(episode.id)) continue;
        const row: CanvasNodeData[] = [];
        for (const clip of episode.clips) {
            if (!clip.videoKey) continue;
            const blob = await getStudioMediaBlob(clip.videoKey);
            if (!blob) continue;
            const uploaded = await uploadMediaFile(blob, "video");
            const node = createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 }, { ...videoMetadata(uploaded), prompt: clip.prompt });
            row.push({ ...node, title: `第${episode.number}集 · 第${clip.number}段` });
        }
        x = 0;
        for (const node of row) {
            nodes.push({ ...node, position: { x, y } });
            x += node.width + COLUMN_GAP;
        }
        if (row.length) y += Math.max(...row.map((node) => node.height)) + COLUMN_GAP * 2;
    }
    if (!nodes.length) throw new Error("还没有可同步的素材图或视频。");
    const suffix = episodeFilter ? "本集同步" : "工作室同步";
    return useCanvasStore.getState().importProject({ title: `${title}（${suffix}）`, nodes: nodes.map((node) => ({ ...node, id: `${node.type}-${nanoid(10)}` })) });
}

export async function downloadStudioClipVideo(clip: StudioClip, fileName: string) {
    if (!clip.videoKey) throw new Error("该片段还没有视频。");
    const blob = await getStudioMediaBlob(clip.videoKey);
    if (!blob) throw new Error("找不到片段视频文件。");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.endsWith(".mp4") ? fileName : `${fileName}.mp4`;
    anchor.click();
    URL.revokeObjectURL(url);
}
