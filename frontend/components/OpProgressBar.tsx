"use client";

type OpProgressBarProps = {
  label: string;
  done: number;
  total: number;
  detail?: string;
  /**
   * When set, replaces the right-hand "{done}/{total}（pct%）" text (that pattern is often mistaken for file chunks).
   */
  fractionLabel?: string | null;
  /** Busy state without a known completion ratio (e.g. open-ended NAS polling). */
  indeterminate?: boolean;
  /** 浅色底（白卡片）用 light；深色抽屉用 dark */
  variant?: "light" | "dark";
};

/**
 * 与上传队列页「整体进度」相同的条样式：底槽 + 蓝色占比，便于扫读。
 */
export function OpProgressBar({ label, done, total, detail, fractionLabel, indeterminate, variant = "light" }: OpProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 0;
  const rightText =
    fractionLabel != null && String(fractionLabel).trim() !== ""
      ? String(fractionLabel).trim()
      : indeterminate
        ? "进行中…"
        : `${done} / ${total}（${pct}%）`;
  const track = variant === "dark" ? "bg-slate-700" : "bg-slate-200";
  const fill = variant === "dark" ? "bg-blue-500" : "bg-blue-600";
  const border = variant === "dark" ? "border-slate-600 bg-slate-800/80" : "border-slate-200 bg-slate-50";
  const textMain = variant === "dark" ? "text-slate-100" : "text-slate-800";
  const textSub = variant === "dark" ? "text-slate-400" : "text-slate-600";
  const textMuted = variant === "dark" ? "text-slate-200" : "text-slate-600";

  return (
    <div className={`mt-2 rounded-lg border p-2 ${border}`}>
      <div className={`mb-1 flex items-baseline justify-between gap-2 text-[11px] ${textMuted}`}>
        <span className={`font-medium ${textMain}`}>{label}</span>
        <span className={`tabular-nums font-semibold ${textMain}`}>{rightText}</span>
      </div>
      {detail ? <div className={`mb-1 text-[10px] ${textSub}`}>{detail}</div> : null}
      <div
        className={`h-2.5 w-full overflow-hidden rounded-full ${track}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={indeterminate ? 100 : total}
        aria-valuenow={indeterminate ? undefined : done}
        aria-busy={indeterminate ? true : undefined}
        aria-label={indeterminate ? `${label} 进行中` : `${label} 进度 ${done} / ${total}`}
      >
        {indeterminate ? (
          <div className={`h-full w-full ${fill} animate-pulse opacity-80`} />
        ) : (
          <div className={`h-full min-w-0 rounded-full ${fill} transition-[width] duration-300 ease-out`} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}
