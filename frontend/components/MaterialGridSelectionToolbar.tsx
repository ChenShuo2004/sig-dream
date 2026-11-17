"use client";

import type { MaterialGridToolbarMessage } from "@/hooks/useMaterialGridMarqueeSelection";

export type MaterialGridSelectionToolbarProps = {
  theme?: "light" | "dark";
  disabled?: boolean;
  selectAllDisabled?: boolean;
  clearDisabled?: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  message?: MaterialGridToolbarMessage | null;
  hint?: string;
  className?: string;
};

const shellClass = {
  light: "flex flex-wrap items-center gap-2 border-b border-sky-500/35 bg-slate-950 px-3 py-2 text-xs text-slate-200",
  dark: "mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/35 bg-slate-950/80 px-2.5 py-2 text-xs text-slate-200",
};

const hintClass = {
  light: "min-w-0 flex-[1_1_12rem] leading-snug text-slate-300",
  dark: "min-w-0 flex-[1_1_10rem] leading-snug text-slate-300",
};

const btnClass =
  "rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-40";

export const MATERIAL_GRID_MARQUEE_HINT = "在卡片间隙按下拖动可框选追加勾选。";

export function MaterialGridSelectionToolbar({
  theme = "light",
  disabled = false,
  selectAllDisabled = false,
  clearDisabled = false,
  onSelectAll,
  onClearSelection,
  message = null,
  hint = MATERIAL_GRID_MARQUEE_HINT,
  className = "",
}: MaterialGridSelectionToolbarProps) {
  return (
    <div className={`${shellClass[theme]} ${className}`.trim()}>
      <span className={hintClass[theme]}>{hint}</span>
      <ToolbarButtons
        disabled={disabled}
        selectAllDisabled={selectAllDisabled}
        clearDisabled={clearDisabled}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
      />
      {message ? (
        <span
          className={
            message.tone === "ok"
              ? "max-w-full flex-[1_1_8rem] text-amber-200 [overflow-wrap:anywhere]"
              : "max-w-full flex-[1_1_8rem] text-amber-300 [overflow-wrap:anywhere]"
          }
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}

function ToolbarButtons({
  disabled,
  selectAllDisabled,
  clearDisabled,
  onSelectAll,
  onClearSelection,
}: Pick<
  MaterialGridSelectionToolbarProps,
  "disabled" | "selectAllDisabled" | "clearDisabled" | "onSelectAll" | "onClearSelection"
>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btnClass} disabled={disabled || selectAllDisabled} onClick={onSelectAll}>
        全选本页
      </button>
      <button type="button" className={btnClass} disabled={disabled || clearDisabled} onClick={onClearSelection}>
        清除勾选
      </button>
    </div>
  );
}
