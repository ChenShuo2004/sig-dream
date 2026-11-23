import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

/** Studio surface container that follows the global light / dark app theme. */
export function DarkScope({ children, className }: { children: ReactNode; className?: string }) {
    const dark = useThemeStore((state) => state.theme === "dark");
    return (
        <div
            className={cn(
                "studio-scope",
                dark ? "dark bg-[#0b0b0c] text-neutral-100 [color-scheme:dark]" : "studio-light bg-[#f5f5f4] text-stone-900 [color-scheme:light]",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function Panel({ title, extra, children, className, bodyClassName }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
    return (
        <section className={cn("flex min-h-0 flex-col rounded-xl border border-stone-200/90 bg-white dark:border-white/[0.07] dark:bg-[#141416]", className)}>
            {title || extra ? (
                <header className="flex h-8 shrink-0 items-center gap-1.5 px-3">
                    <h3 className="min-w-0 shrink truncate text-xs font-medium text-stone-900 dark:text-neutral-100">{title}</h3>
                    <div className="ml-auto flex min-w-0 max-w-[78%] flex-wrap items-center justify-end gap-1">{extra}</div>
                </header>
            ) : null}
            <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
        </section>
    );
}

type ButtonTone = "primary" | "ghost" | "subtle" | "danger";

const DISABLED_BG = "#6e6e73";
const DISABLED_INK = "#1c1c1e";
const PRIMARY_INK = "#0a0a0a";

export const inkOnWhiteStyle = { color: PRIMARY_INK, WebkitTextFillColor: PRIMARY_INK } as const;
export const disabledPillStyle = { backgroundColor: DISABLED_BG, color: DISABLED_INK, WebkitTextFillColor: DISABLED_INK, opacity: 1 } as const;

export function DarkButton({ tone = "subtle", size = "md", className, children, disabled, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: "sm" | "md" | "lg" }) {
    return (
        <button
            type="button"
            disabled={disabled}
            {...props}
            style={style}
            className={cn(
                "inline-flex shrink-0 items-center justify-center gap-1 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-100",
                size === "sm" ? "h-6 px-2.5 text-[11px]" : size === "lg" ? "h-9 px-5 text-sm" : "h-7 px-3 text-xs",
                disabled
                    ? "bg-stone-200 text-stone-400 dark:bg-[#6e6e73] dark:text-[#1c1c1e] [&_svg]:text-current"
                    : tone === "primary"
                      ? "studio-btn-primary bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-[#0a0a0a] dark:hover:bg-neutral-200 [&_svg]:text-current"
                      : tone === "subtle"
                        ? "bg-stone-900/[0.07] text-stone-800 hover:bg-stone-900/[0.12] dark:bg-white/[0.1] dark:text-neutral-100 dark:hover:bg-white/[0.16] [&_svg]:text-current"
                        : tone === "ghost"
                          ? "bg-transparent text-stone-600 hover:bg-stone-900/[0.06] hover:text-stone-950 dark:text-neutral-300 dark:hover:bg-white/[0.08] dark:hover:text-white [&_svg]:text-current"
                          : "bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25 [&_svg]:text-current",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function IconButton({ className, children, active, disabled, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            {...props}
            style={style}
            className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-100",
                disabled
                    ? "bg-stone-200 text-stone-400 dark:bg-[#6e6e73] dark:text-[#1c1c1e] [&_svg]:text-current"
                    : active
                      ? "studio-btn-primary bg-stone-900 text-white dark:bg-white dark:text-[#0a0a0a] [&_svg]:text-current"
                      : "text-stone-600 hover:bg-stone-900/[0.08] hover:text-stone-950 dark:text-neutral-300 dark:hover:bg-white/[0.1] dark:hover:text-white [&_svg]:text-current",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function Tabs<T extends string>({ items, value, onChange }: { items: Array<{ key: T; label: ReactNode }>; value: T; onChange: (key: T) => void }) {
    return (
        <div className="inline-flex items-center gap-0.5 rounded-full bg-stone-900/[0.06] p-0.5 dark:bg-white/[0.06]">
            {items.map((item) => {
                const selected = value === item.key;
                return (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => onChange(item.key)}
                        className={cn(
                            "h-6 rounded-full px-2.5 text-[11px] font-medium leading-none transition",
                            selected
                                ? "bg-white text-stone-950 shadow-xs dark:bg-white dark:text-[#0a0a0a]"
                                : "text-stone-600 hover:text-stone-950 dark:text-neutral-300 dark:hover:text-white",
                        )}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

export function Pager({ index, total, onChange }: { index: number; total: number; onChange: (index: number) => void }) {
    if (total <= 1) return total === 1 ? <span className="text-xs tabular-nums text-stone-500 dark:text-neutral-400">1/1</span> : null;
    return (
        <div className="flex items-center gap-1 text-xs tabular-nums text-stone-600 dark:text-neutral-300">
            <IconButton className="size-6" disabled={index <= 0} onClick={() => onChange(index - 1)} aria-label="上一个">
                <ChevronLeft className="size-3.5" />
            </IconButton>
            {index + 1}/{total}
            <IconButton className="size-6" disabled={index >= total - 1} onClick={() => onChange(index + 1)} aria-label="下一个">
                <ChevronRight className="size-3.5" />
            </IconButton>
        </div>
    );
}

export function EmptyHint({ icon, title, hint, children, className }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string }) {
    return (
        <div className={cn("flex h-full min-h-[140px] flex-col items-center justify-center gap-1.5 px-4 text-center", className)}>
            {icon ? <div className="text-stone-400 dark:text-neutral-500">{icon}</div> : null}
            <p className="text-xs text-stone-700 dark:text-neutral-200">{title}</p>
            {hint ? <p className="max-w-sm text-[11px] leading-4 text-stone-500 dark:text-neutral-500">{hint}</p> : null}
            {children ? <div className="mt-2 flex items-center gap-2">{children}</div> : null}
        </div>
    );
}

export function StatusBadge({ status, error }: { status?: string; error?: string }) {
    if (!status) return null;
    const map: Record<string, [string, string]> = {
        running: ["生成中", "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"],
        pending: ["排队中", "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"],
        uploading: ["上传中", "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"],
        done: ["已完成", "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"],
        failed: ["需重试", "bg-red-500/15 text-red-700 dark:bg-red-500/25 dark:text-red-200"],
    };
    const [label, className] = map[status] || [status, "bg-stone-900/10 text-stone-700 dark:bg-white/10 dark:text-neutral-200"];
    return (
        <span title={error} className={cn("shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium", className)}>
            {label}
        </span>
    );
}
