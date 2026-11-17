"use client";

export type TagSelectedChipProps = {
  label: string;
  onRemove: () => void;
  /** 追加到根 `span` 的 class（如 `max-w-full`） */
  className?: string;
};

/**
 * 已选标签芯片：与未整理「批量打标签」区一致（深蓝半透明底、天蓝描边、浅色正文与移除按钮）。
 * 上传队列等浅色面板也复用此样式，保证与 `/unorganized` 可读性一致。
 */
export function TagSelectedChip({ label, onRemove, className }: TagSelectedChipProps) {
  return (
    <span
      className={
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-sky-500/50 bg-sky-600/25 px-2 py-0.5 text-xs text-sky-100 " +
        (className ?? "")
      }
    >
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        className="shrink-0 rounded px-0.5 text-sky-200 hover:bg-sky-500/35 hover:text-white"
        aria-label={`移除 ${label}`}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}
