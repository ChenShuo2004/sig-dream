import { GIFEncoder, applyPalette, quantize } from "gifenc";

import {
  TOOLBOX_MAX_CLIP_SEC,
  TOOLBOX_MAX_FRAMES,
  TOOLBOX_MAX_FPS,
  TOOLBOX_MAX_OUTPUT_WIDTH,
} from "@/lib/toolbox/constants";

export type VideoToGifParams = {
  video: HTMLVideoElement;
  startSec: number;
  endSec: number;
  fps: number;
  maxOutputWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

export type VideoToGifValidation = {
  ok: boolean;
  message?: string;
  frameCount?: number;
  clipSec?: number;
};

export function computeOutputSize(
  videoWidth: number,
  videoHeight: number,
  maxOutputWidth = TOOLBOX_MAX_OUTPUT_WIDTH,
): { width: number; height: number } {
  if (!videoWidth || !videoHeight) {
    return { width: 1, height: 1 };
  }
  if (videoWidth <= maxOutputWidth) {
    return { width: videoWidth, height: videoHeight };
  }
  const scale = maxOutputWidth / videoWidth;
  return {
    width: maxOutputWidth,
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}

export function validateVideoToGifParams(
  startSec: number,
  endSec: number,
  fps: number,
  videoDuration?: number,
): VideoToGifValidation {
  const clipSec = endSec - startSec;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || clipSec <= 0) {
    return { ok: false, message: "请设置有效的起止时间（结束须大于开始）" };
  }
  if (clipSec > TOOLBOX_MAX_CLIP_SEC + 1e-6) {
    return { ok: false, message: `GIF 适合短片段，截取最多 ${TOOLBOX_MAX_CLIP_SEC} 秒` };
  }
  if (videoDuration != null && Number.isFinite(videoDuration)) {
    if (startSec < 0 || endSec > videoDuration + 0.05) {
      return { ok: false, message: "起止时间超出视频时长" };
    }
  }
  if (!Number.isFinite(fps) || fps <= 0 || fps > TOOLBOX_MAX_FPS + 1e-6) {
    return { ok: false, message: `帧率须在 1～${TOOLBOX_MAX_FPS} 之间` };
  }
  const frameCount = Math.max(1, Math.floor(clipSec * fps));
  if (frameCount > TOOLBOX_MAX_FRAMES) {
    return {
      ok: false,
      message: `帧数 ${frameCount} 超过上限 ${TOOLBOX_MAX_FRAMES}（约 ${TOOLBOX_MAX_CLIP_SEC}s×${TOOLBOX_MAX_FPS}fps）。请缩短片段或降低帧率`,
      frameCount,
      clipSec,
    };
  }
  return { ok: true, frameCount, clipSec };
}

export async function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const duration = Number.isFinite(video.duration) ? video.duration : time;
  const t = Math.max(0, Math.min(time, duration));
  if (Math.abs(video.currentTime - t) < 0.02) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频定位失败"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("视频定位超时"));
    }, 20000);
    signal?.addEventListener("abort", onAbort);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = t;
  });
}

export async function generateVideoGif(params: VideoToGifParams): Promise<Blob> {
  const { video, startSec, endSec, fps, maxOutputWidth, onProgress, signal } = params;
  const validation = validateVideoToGifParams(startSec, endSec, fps, video.duration);
  if (!validation.ok || validation.frameCount == null) {
    throw new Error(validation.message || "参数无效");
  }

  const frameCount = validation.frameCount;
  const { width, height } = computeOutputSize(video.videoWidth, video.videoHeight, maxOutputWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建画布");

  const encoder = GIFEncoder();
  const delayMs = Math.round(1000 / fps);
  const step = (endSec - startSec) / frameCount;

  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const t = i === frameCount - 1 ? Math.max(startSec, endSec - 0.001) : startSec + i * step;
    await seekVideo(video, t, signal);
    ctx.drawImage(video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, width, height, { palette, delay: delayMs });
    onProgress?.(i + 1, frameCount);
  }

  encoder.finish();
  const bytes = encoder.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "image/gif" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
