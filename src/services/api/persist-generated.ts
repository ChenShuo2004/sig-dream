import { getImageBlob, uploadImage, type UploadedImage } from "@/services/image-storage";

import { archiveGeneratedBlob } from "./save-to-unorganized";

/** Cache a generated image locally, then queue it for NAS. The picture is kept even if NAS upload fails. */
export async function storeGeneratedImage(input: string, options?: { signal?: AbortSignal; prompt?: string }): Promise<UploadedImage & { nasWarning?: string }> {
    const stored = await uploadImage(input, { signal: options?.signal });
    if (!stored.storageKey || !stored.bytes) throw new Error("生成图片没有保存到本地");
    const blob = await getImageBlob(stored.storageKey);
    if (!blob || blob.size < 32) throw new Error("生成图片没有保存到本地");
    const nasWarning = await archiveGeneratedBlob(blob, "image", { prompt: options?.prompt });
    return nasWarning ? { ...stored, nasWarning } : stored;
}
