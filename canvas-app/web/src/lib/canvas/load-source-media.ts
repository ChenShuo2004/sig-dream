import { downloadGeneratedMedia } from "@/services/api/generated-media";

/** Bytes for trim / frame capture. Remote platform URLs are downloaded through the same-origin cache. */
export async function loadCanvasMediaBlob(content: string): Promise<Blob> {
    return downloadGeneratedMedia(content);
}
