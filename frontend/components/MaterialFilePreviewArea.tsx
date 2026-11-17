"use client";

import { useCallback, useEffect, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";

import { triggerBrowserDownload } from "@/lib/materialBrowserDownload";

/** 外框：素材库 / 未整理 / 素材集合 右侧「预览与文件信息」内预览容器（统一宽度） */
export const materialFilePreviewFrameClass =
  "mx-auto mt-1 w-full max-w-[min(100%,26rem)] rounded border border-slate-700 bg-slate-900 p-2 text-center text-xs text-slate-300";

/** 内图：与上框配套的最大可视高度 */
export const materialFilePreviewImgClass =
  "mx-auto max-h-[min(64vh,30rem)] w-full rounded object-contain";

export type MaterialFilePreviewMode = "image" | "video" | "generic";

const VIDEO_DECODE_FAIL_HINT =
  "当前浏览器无法播放该视频，可能是视频编码不兼容。请下载原文件后用本地播放器查看。";

export type MaterialFilePreviewAreaProps = {
  src: string;
  alt?: string;
  onError?: ImgHTMLAttributes<HTMLImageElement>["onError"];
  imgClassName?: string;
  showCaption?: boolean;
  largeImageSrc?: string | null;
  largeImageLoading?: boolean;
  largeImageError?: string | null;
  largeImagePlaceholderHint?: string | null;
  mode?: MaterialFilePreviewMode;
  /**
   * 可选：若以后启用派生预览片，可传入优先尝试的 URL；失败后自动改播 `videoStreamUrl`（原始文件）。
   * 默认不传，侧栏仅使用原始文件渐进播放。
   */
  videoFallbackPreviewUrl?: string | null;
  /** 原始文件播放/下载 URL（与 resolveMaterialDownload / download-route 一致） */
  videoStreamUrl?: string | null;
  videoStreamLoading?: boolean;
  videoStreamError?: string | null;
  videoPlaceholderHint?: string | null;
  /**
   * 若提供：在「下载原文件 / 下载原图」位置改为「选择目录保存…」，由父组件实现领票与 File System Access 写入。
   * 未提供时保持浏览器默认下载按钮。
   */
  onSaveOriginalToDirectory?: () => void | Promise<void>;
  saveToDirectoryDisabled?: boolean;
  saveToDirectoryTitle?: string;
};

/**
 * 右侧栏「预览区域」：三页共用。
 * - 图片：缩略图 + 点击全屏灯箱
 * - 视频：`<video src>` 直连原始文件 URL，浏览器按需 Range；失败则提示并引导下载原文件
 */
export function MaterialFilePreviewArea({
  src,
  alt = "预览缩略图",
  onError,
  imgClassName = "",
  showCaption = true,
  largeImageSrc,
  largeImageLoading = false,
  largeImageError,
  largeImagePlaceholderHint,
  mode = "generic",
  videoFallbackPreviewUrl = null,
  videoStreamUrl,
  videoStreamLoading = false,
  videoStreamError,
  videoPlaceholderHint,
  onSaveOriginalToDirectory,
  saveToDirectoryDisabled = false,
  saveToDirectoryTitle,
}: MaterialFilePreviewAreaProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  /** 已在 fallback 上失败过，下一步只播原始流 */
  const [fallbackExhausted, setFallbackExhausted] = useState(false);
  /** 原始流也播不了（或无任何可用 URL） */
  const [nativePlaybackFailed, setNativePlaybackFailed] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const fallback = (videoFallbackPreviewUrl || "").trim();
  const stream = (videoStreamUrl || "").trim();
  const originalForDownload = stream;

  useEffect(() => {
    setFallbackExhausted(false);
    setNativePlaybackFailed(false);
  }, [fallback, stream]);

  const activePlaySrc =
    fallback && !fallbackExhausted ? fallback : stream;

  const imgClasses = [materialFilePreviewImgClass, imgClassName].filter(Boolean).join(" ");
  const resolvedLarge = (largeImageSrc || "").trim();
  const thumbSrc = (src || "").trim();
  const canImageLightbox = mode === "image" && !!thumbSrc;
  const lightboxImgSrc = (resolvedLarge || thumbSrc).trim();
  const canDownloadOriginal =
    !!resolvedLarge &&
    (resolvedLarge.startsWith("http://") || resolvedLarge.startsWith("https://") || resolvedLarge.startsWith("/"));

  const canTriggerOriginalDownload =
    !!originalForDownload &&
    (originalForDownload.startsWith("http://") ||
      originalForDownload.startsWith("https://") ||
      originalForDownload.startsWith("/"));

  const saveDirLabel = "选择目录保存…";
  const useSaveToDir = typeof onSaveOriginalToDirectory === "function";
  const saveDirTitle =
    saveToDirectoryTitle ||
    (useSaveToDir ? "解析下载地址后写入本地目录（已记住目录时不再弹选择框）" : undefined);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, closeLightbox]);

  const onVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const el = e.currentTarget;
      const err = el.error;
      // eslint-disable-next-line no-console -- 验收要求记录解码错误码
      console.warn("[MaterialFilePreviewArea] video error", err?.code ?? "", err?.message ?? "");

      if (fallback && !fallbackExhausted && stream) {
        setFallbackExhausted(true);
        return;
      }
      setNativePlaybackFailed(true);
    },
    [fallback, fallbackExhausted, stream]
  );

  const posterOnly = (
    <div className={materialFilePreviewFrameClass}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`${imgClasses}${canImageLightbox ? " cursor-zoom-in" : ""}`}
        onError={onError}
        onClick={canImageLightbox ? () => setLightboxOpen(true) : undefined}
        role={canImageLightbox ? "button" : undefined}
        title={canImageLightbox ? "单击查看大图（解析原图）" : undefined}
      />
    </div>
  );

  const showVideoPlayer =
    mode === "video" &&
    !videoPlaceholderHint &&
    !nativePlaybackFailed &&
    !!activePlaySrc &&
    !videoStreamError &&
    !videoStreamLoading;

  return (
    <div>
      {showCaption ? <div className="text-slate-500">预览区域</div> : null}

      {mode === "video" ? (
        <div className="grid gap-2">
          {videoPlaceholderHint ? (
            <div className="text-center text-[11px] text-slate-400">{videoPlaceholderHint}</div>
          ) : null}
          {!videoPlaceholderHint && videoStreamLoading ? (
            <div className="text-center text-[11px] text-slate-400">正在解析播放地址…</div>
          ) : null}
          {!videoPlaceholderHint && videoStreamError ? (
            <div className="text-center text-[11px] text-amber-200/90">无法解析播放地址：{videoStreamError}</div>
          ) : null}

          {nativePlaybackFailed && !videoPlaceholderHint ? (
            <div className="grid gap-2">
              {posterOnly}
              <p className="text-center text-[11px] leading-snug text-amber-100/95">{VIDEO_DECODE_FAIL_HINT}</p>
              <button
                type="button"
                className={
                  useSaveToDir
                    ? "mx-auto w-full max-w-[min(100%,22rem)] rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40"
                    : "mx-auto rounded-lg border border-sky-400/50 bg-slate-800/90 px-3 py-2 text-[11px] font-medium text-sky-100 hover:bg-slate-700 disabled:opacity-40"
                }
                disabled={useSaveToDir ? saveToDirectoryDisabled : !canTriggerOriginalDownload}
                title={
                  useSaveToDir
                    ? saveDirTitle
                    : !canTriggerOriginalDownload
                      ? "暂无原始文件下载地址"
                      : "使用当前解析到的原文件链接触发浏览器下载"
                }
                onClick={() => {
                  if (useSaveToDir) void onSaveOriginalToDirectory?.();
                  else if (canTriggerOriginalDownload) triggerBrowserDownload(originalForDownload);
                }}
              >
                {useSaveToDir ? saveDirLabel : "下载原文件"}
              </button>
            </div>
          ) : null}

          {!nativePlaybackFailed && showVideoPlayer ? (
            <div className={materialFilePreviewFrameClass + " !p-1"}>
              <video
                key={activePlaySrc}
                className="mx-auto max-h-[min(64vh,30rem)] w-full rounded bg-black"
                controls
                playsInline
                preload="metadata"
                poster={thumbSrc && !thumbSrc.includes("/file-icons/") ? thumbSrc : undefined}
                src={activePlaySrc}
                onError={onVideoError}
              >
                您的浏览器不支持内嵌视频播放。
              </video>
            </div>
          ) : null}

          {!nativePlaybackFailed &&
          !videoPlaceholderHint &&
          !videoStreamLoading &&
          !activePlaySrc &&
          !videoStreamError &&
          !showVideoPlayer ? (
            posterOnly
          ) : null}
        </div>
      ) : (
        posterOnly
      )}

      {mode === "image" && largeImagePlaceholderHint && !largeImageLoading && !resolvedLarge ? (
        <p className="mt-1 text-center text-[11px] text-slate-400">{largeImagePlaceholderHint}</p>
      ) : null}

      {portalReady && lightboxOpen && canImageLightbox
        ? createPortal(
            <div
              className="fixed inset-0 z-[60000] flex items-center justify-center bg-black/90 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="大图预览"
              onClick={closeLightbox}
            >
              <div className="absolute right-4 top-4 z-[60001] flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className={
                    useSaveToDir
                      ? "rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40"
                      : "rounded-lg border border-white/30 bg-slate-900/90 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-slate-800"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (useSaveToDir) void onSaveOriginalToDirectory?.();
                    else if (canDownloadOriginal) triggerBrowserDownload(resolvedLarge);
                  }}
                  disabled={useSaveToDir ? saveToDirectoryDisabled : !canDownloadOriginal}
                  title={
                    useSaveToDir
                      ? saveDirTitle
                      : !canDownloadOriginal
                        ? "原图地址解析完成后可下载"
                        : "使用当前解析到的原文件链接触发浏览器下载"
                  }
                >
                  {useSaveToDir ? saveDirLabel : "下载原图"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-white/30 bg-slate-900/90 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-slate-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeLightbox();
                  }}
                >
                  关闭
                </button>
              </div>
              <div className="relative max-h-[92vh] max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
                {largeImageLoading && !resolvedLarge ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/70 text-sm text-slate-200">
                    正在加载原图…
                  </div>
                ) : null}
                {largeImageError ? (
                  <div className="mb-2 rounded border border-amber-500/40 bg-amber-950/80 px-3 py-2 text-center text-xs text-amber-100">
                    原图加载失败：{largeImageError}
                  </div>
                ) : null}
                {!largeImageLoading && !resolvedLarge && largeImagePlaceholderHint ? (
                  <p className="mb-2 max-w-[min(90vw,36rem)] text-center text-xs text-slate-300">{largeImagePlaceholderHint}</p>
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lightboxImgSrc}
                  alt={alt}
                  className="max-h-[92vh] max-w-[96vw] object-contain shadow-2xl"
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
