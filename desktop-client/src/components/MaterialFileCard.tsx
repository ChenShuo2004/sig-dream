import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, SyntheticEvent } from "react";

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
  tagLine: string;
  fileSizeBytes?: number | null;
  resolutionLabel?: string | null;
  coverSrc: string;
  onCoverError: (e: SyntheticEvent<HTMLImageElement>) => void;
  onCardClick: () => void;
  checkboxChecked: boolean;
  onCheckboxChange: () => void;
  checkboxAriaLabel?: string;
  /** 根节点 mousedown 冒泡到父级用于网格「框选」；卡片自身阻止冒泡，仅网格间隙可起选框 */
  stopMouseDownPropagation?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  onMouseEnter?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  role?: "presentation" | "button";
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onTitleDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onTagsDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  titleSlot?: ReactNode;
  tagsSlot?: ReactNode;
};

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
  stopMouseDownPropagation = true,
  draggable = false,
  onDragStart,
  onDragEnd,
  onMouseEnter,
  onPointerDown,
  role = "presentation",
  tabIndex,
  onKeyDown,
  onTitleDoubleClick,
  onTagsDoubleClick,
  titleSlot,
  tagsSlot,
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
      onDragStart={(e: DragEvent<HTMLDivElement>) => onDragStart?.(e)}
      onDragEnd={(e: DragEvent<HTMLDivElement>) => onDragEnd?.(e)}
      className={`${shellClass[visualState]} min-w-0 cursor-pointer`}
      onMouseDown={(e) => {
        if (stopMouseDownPropagation) e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (stopMouseDownPropagation) e.stopPropagation();
        onPointerDown?.(e);
      }}
      onMouseEnter={onMouseEnter}
      onClick={onCardClick}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 cursor-default items-center justify-center rounded-md hover:bg-slate-500/15 active:bg-slate-500/25"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
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
      <div className="mx-auto mt-1.5 flex aspect-square w-[min(100%,5.75rem)] shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50">
        <img
          src={coverSrc}
          alt="文件缩略图"
          draggable={false}
          className="pointer-events-none h-full w-full object-contain opacity-90"
          onError={onCoverError}
        />
      </div>
      {draggable ? (
        <div
          className="mt-1 flex cursor-grab items-center justify-center gap-0.5 rounded border border-dashed border-slate-300 bg-slate-100 py-0.5 text-[10px] font-medium text-slate-600 active:cursor-grabbing"
          title="按住此处拖到文件夹或剪映"
          onMouseDown={(ev) => ev.stopPropagation()}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <span aria-hidden>⋮⋮</span>
          <span>拖到文件夹</span>
        </div>
      ) : null}
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
