import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";

export const CANVAS_INSERT_DRAG_TYPE = "application/x-canvas-insert";

export function writeCanvasInsertDrag(data: DataTransfer, payload: InsertAssetPayload) {
    data.setData(CANVAS_INSERT_DRAG_TYPE, JSON.stringify(payload));
    data.setData("text/plain", payload.title || "");
    data.effectAllowed = "copy";
}

export function readCanvasInsertDrag(data: DataTransfer): InsertAssetPayload | null {
    const raw = data.getData(CANVAS_INSERT_DRAG_TYPE);
    if (!raw) return null;
    try {
        const payload = JSON.parse(raw) as InsertAssetPayload;
        if (!payload || typeof payload !== "object" || !("kind" in payload)) return null;
        return payload;
    } catch {
        return null;
    }
}
