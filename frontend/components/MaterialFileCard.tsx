"use client";

import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, SyntheticEvent } from "react";

import { formatBytes } from "@/lib/formatBytes";

export type MaterialFileCardVisualState = "default" | "preview" | "checked";

const shellClass: Record<MaterialFileCardVisualState, string> = {
  preview: "rounded-lg border border-sky-300 bg-sky-500/20 p-2 text-left text-sky-900 shadow-sm",
  checked: "rounded-lg border border-emerald-300/50 bg-emerald-50/40 p-2 text-left text-slate-900 shadow-sm",
  default: "rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-slate-300",
};

export type MaterialFileCardProps = {
  visualState: MaterialFileCardVisualState;
  displayName: string;
  /** 已格式化的标签一行文案（空串时组件内显示「无标签」） */
  tagLine: string;
  fileSizeBytes?: number | null;
  /** 已格式化的分辨率文案（如 1920×1080）；仅由父组件在图片/视频且有数据时传入 */
  resolutionLabel?: string | null;
  coverSrc: string;
  onCoverError: (e: SyntheticEvent<HTMLImageElement>) => void;
  onCardClick: () => void;
  checkboxChecked: boolean;
  onCheckboxChange: () => void;
  checkboxAriaLabel?: string;
  role?: "presentation" | "button";
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** 双击文件名区域（未使用 titleSlot 时生效） */
  onTitleDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  /** 双击标签行（未使用 tagsSlot 时生效） */
  onTagsDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  /** 替换默认标题展示（如内联编辑输入框） */
  titleSlot?: ReactNode;
  /** 替换默认标签行（如 TagSlashPicker） */
  tagsSlot?: ReactNode;
  /** 为 true 时根节点可拖动（用于集合内引用拖至其它集合等） */
  draggable?: boolean;
  onDragStartCard?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEndCard?: (e: DragEvent<HTMLDivElement>) => void;
  /** 若传入，根节点带 `data-material-card` / `data-material-id`，供素材库框选命中 */
  marqueeCardId?: string;
  /** 缩略图上的状态条，如「正在识别 40%」 */
  coverBadge?: string | null;
};

/**
 * 素材库 / 未整理 / 集合内缩略图网格的共用文件卡片（勾选 + 文件名 + 方缩略图 + 标签行 + 大小 [+ 分辨率]）。
 * 文件名仅在顶部展示一行，不在下方重复。
 */
export function MaterialFileCard({
  visualState,
  displayName,
  tagLine,
  fileSizeBytes,
  resolutionLabel,
  coverSrc,
  onCoverError,
  onCardClick,
  checkboxChecked,
  onCheckboxChange,
  checkboxAriaLabel,
  role = "presentation",
  tabIndex,
  onKeyDown,
  onTitleDoubleClick,
  onTagsDoubleClick,
  titleSlot,
  tagsSlot,
  draggable = false,
  onDragStartCard,
  onDragEndCard,
  marqueeCardId,
  coverBadge,
}: MaterialFileCardProps) {
  const tagsShown = tagLine.trim() || "无标签";
  const sizeShown = formatBytes(fileSizeBytes ?? null);
  const res = (resolutionLabel || "").trim();

  return (
    <div
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      draggable={draggable}
      onDragStart={onDragStartCard}
      onDragEnd={onDragEndCard}
      {...(marqueeCardId
        ? ({ "data-material-card": "", "data-material-id": marqueeCardId } as Record<string, string>)
        : {})}
      className={`${shellClass[visualState]} min-w-0 ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      onClick={onCardClick}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 cursor-default items-center justify-center rounded-md hover:bg-slate-500/15 active:bg-slate-500/25"
          onMouseDown={(e) => e.stopPropagation()}
          title="勾选 / 取消勾选"
        >
          <input
            className="h-4 w-4 cursor-default accent-blue-600"
            type="checkbox"
            draggable={false}
            checked={checkboxChecked}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onCheckboxChange()}
            aria-label={checkboxAriaLabel}
          />
        </span>
        <div
          className={
            titleSlot
              ? "min-w-0 flex-1 text-xs font-semibold leading-tight text-slate-900 [overflow-wrap:anywhere]"
              : "min-w-0 flex-1 break-words text-xs font-semibold leading-tight text-slate-900 [overflow-wrap:anywhere] line-clamp-2"
          }
        >
          {titleSlot ? (
            <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
              {titleSlot}
            </div>
          ) : (
            <div
              className="min-w-0 cursor-text"
              title={displayName}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onTitleDoubleClick?.(e);
              }}
            >
              {displayName}
            </div>
          )}
        </div>
      </div>
      <div className="relative mx-auto mt-1.5 flex aspect-square w-[min(100%,5.75rem)] shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element -- 动态缩略图 URL，与素材库/集合一致 */}
        <img src={coverSrc} alt="文件缩略图" className="h-full w-full object-contain opacity-90" onError={onCoverError} />
        {coverBadge ? (
          <div className="absolute inset-x-0 bottom-0 bg-violet-900/90 px-1 py-0.5 text-center text-[10px] font-medium leading-tight text-violet-50">
            {coverBadge}
          </div>
        ) : null}
      </div>
      <div className="mt-1 min-h-[1.25rem] text-[11px] leading-tight text-slate-700 [overflow-wrap:anywhere]">
        {tagsSlot ? (
          <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
            {tagsSlot}
          </div>
        ) : (
          <div
            className="line-clamp-1 cursor-text break-words"
            title={tagsShown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onTagsDoubleClick?.(e);
            }}
          >
            {tagsShown}
          </div>
        )}
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-slate-500" title={res ? `大小 ${sizeShown}，分辨率 ${res}` : `大小 ${sizeShown}`}>
        大小 {sizeShown}
        {res ? ` ${res}` : ""}
      </div>
    </div>
  );
}
