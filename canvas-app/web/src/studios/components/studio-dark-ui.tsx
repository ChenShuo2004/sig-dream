import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ConfigProvider } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { getAntThemeConfig } from "@/lib/app-theme";
import { cn } from "@/lib/utils";

const darkTheme = getAntThemeConfig(true);

/** Studio surfaces that are always dark, independent of the app theme. */
export function DarkScope({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <ConfigProvider theme={darkTheme}>
            <div className={cn("dark bg-[#0b0b0c] text-neutral-100 [color-scheme:dark]", className)}>{children}</div>
        </ConfigProvider>
    );
}

export function Panel({ title, extra, children, className, bodyClassName }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
    return (
        <section className={cn("flex min-h-0 flex-col rounded-xl border border-white/[0.07] bg-[#141416]", className)}>
            {title || extra ? (
                <header className="flex h-8 shrink-0 items-center gap-1.5 px-3">
                    <h3 className="min-w-0 shrink truncate text-xs font-medium text-neutral-100">{title}</h3>
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
    const forced = disabled ? disabledPillStyle : tone === "primary" ? inkOnWhiteStyle : undefined;
    return (
        <button
            type="button"
            disabled={disabled}
            {...props}
            style={forced ? { ...style, ...forced } : style}
            className={cn(
                "inline-flex shrink-0 items-center justify-center gap-1 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-100",
                size === "sm" ? "h-6 px-2.5 text-[11px]" : size === "lg" ? "h-9 px-5 text-sm" : "h-7 px-3 text-xs",
                disabled
                    ? "[&_svg]:text-current"
                    : tone === "primary"
                      ? "bg-white hover:bg-neutral-200 [&_svg]:text-current"
                      : tone === "subtle"
                        ? "bg-white/[0.1] text-neutral-100 hover:bg-white/[0.16] [&_svg]:text-current"
                        : tone === "ghost"
                          ? "bg-transparent text-neutral-300 hover:bg-white/[0.08] hover:text-white [&_svg]:text-current"
                          : "bg-red-500/15 text-red-300 hover:bg-red-500/25 [&_svg]:text-current",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function IconButton({ className, children, active, disabled, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
    const forced = disabled ? disabledPillStyle : active ? inkOnWhiteStyle : undefined;
    return (
        <button
            type="button"
            disabled={disabled}
            {...props}
            style={forced ? { ...style, ...forced } : style}
            className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-100",
                disabled ? "[&_svg]:text-current" : active ? "bg-white [&_svg]:text-current" : "text-neutral-300 hover:bg-white/[0.1] hover:text-white [&_svg]:text-current",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function Tabs<T extends string>({ items, value, onChange }: { items: Array<{ key: T; label: ReactNode }>; value: T; onChange: (key: T) => void }) {
    return (
        <div className="inline-flex items-center gap-0.5 rounded-full bg-white/[0.06] p-0.5">
            {items.map((item) => {
                const selected = value === item.key;
                return (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => onChange(item.key)}
                        style={selected ? inkOnWhiteStyle : undefined}
                        className={cn("h-6 rounded-full px-2.5 text-[11px] font-medium leading-none transition", selected ? "bg-white" : "text-neutral-300 hover:text-white")}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

export function Pager({ index, total, onChange }: { index: number; total: number; onChange: (index: number) => void }) {
    if (total <= 1) return total === 1 ? <span className="text-xs tabular-nums text-neutral-400">1/1</span> : null;
    return (
        <div className="flex items-center gap-1 text-xs tabular-nums text-neutral-300">
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
            {icon ? <div className="text-neutral-500">{icon}</div> : null}
            <p className="text-xs text-neutral-200">{title}</p>
            {hint ? <p className="max-w-sm text-[11px] leading-4 text-neutral-500">{hint}</p> : null}
            {children ? <div className="mt-2 flex items-center gap-2">{children}</div> : null}
        </div>
    );
}

export function StatusBadge({ status, error }: { status?: string; error?: string }) {
    if (!status) return null;
    const map: Record<string, [string, string]> = {
        running: ["生成中", "bg-sky-500/20 text-sky-200"],
        pending: ["排队中", "bg-sky-500/20 text-sky-200"],
        uploading: ["上传中", "bg-sky-500/20 text-sky-200"],
        done: ["已完成", "bg-emerald-500/20 text-emerald-200"],
        failed: ["需重试", "bg-red-500/25 text-red-200"],
    };
    const [label, className] = map[status] || [status, "bg-white/10 text-neutral-200"];
    return (
        <span title={error} className={cn("shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium", className)}>
            {label}
        </span>
    );
}
