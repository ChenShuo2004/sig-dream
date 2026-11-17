const RASTER_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

/** 与派生任务、集合 `file_type` 对齐：仅图片/视频在卡片与详情中展示像素分辨率 */
export function isRasterImageOrVideoExtension(extension: string | null | undefined): boolean {
  const e = (extension || "").trim().toLowerCase().replace(/^\./, "");
  if (!e) return false;
  return RASTER_IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e);
}

export function coalescePositiveInt(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) {
      const t = Math.trunc(v);
      if (t > 0) return t;
    }
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      const t = parseInt(v.trim(), 10);
      if (t > 0) return t;
    }
  }
  return null;
}

export function formatPixelDimensionsLabel(width?: number | null, height?: number | null): string | null {
  const w = typeof width === "number" && Number.isFinite(width) ? Math.trunc(width) : null;
  const h = typeof height === "number" && Number.isFinite(height) ? Math.trunc(height) : null;
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  return `${w}×${h}`;
}

/** 在扩展名为图片/视频且宽高有效时返回「1080×1920」形式文案，否则 null */
export function formatResolutionForExtension(
  extension: string | null | undefined,
  width?: number | null,
  height?: number | null
): string | null {
  if (!isRasterImageOrVideoExtension(extension)) return null;
  return formatPixelDimensionsLabel(width, height);
}
