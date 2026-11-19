import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { DarkButton, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { SCRIPT_STEPS, type ScriptStep } from "@/studios/script/document";

export function ScriptShell({
    title,
    contextLabel,
    step,
    onStep,
    saving,
    error,
    actions,
    busy,
    onCancel,
    next,
    children,
}: {
    title: string;
    contextLabel?: string;
    step: ScriptStep;
    onStep: (step: ScriptStep) => void;
    saving: boolean;
    error: string;
    actions?: ReactNode;
    busy?: string;
    onCancel?: () => void;
    next?: { label: string; disabled?: boolean; onClick: () => void } | null;
    children: ReactNode;
}) {
    return (
        <main className="relative flex h-full flex-col overflow-hidden">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
                <Link to="/studio/script" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-neutral-300 transition hover:bg-white/[0.08] hover:text-white">
                    <ArrowLeft className="size-3.5" />
                    剧本项目
                </Link>
                <nav className="mx-auto flex h-7 items-center gap-0.5 rounded-full bg-white/[0.06] p-0.5">
                    {SCRIPT_STEPS.map((item, position) => {
                        const selected = item.key === step;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => onStep(item.key)}
                                style={selected ? inkOnWhiteStyle : undefined}
                                className={cn("flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] leading-none transition", selected ? "bg-white font-medium" : "text-neutral-300 hover:bg-white/[0.08] hover:text-white")}
                            >
                                <span
                                    className={cn("flex size-3.5 items-center justify-center rounded-full text-[9px]", selected ? "bg-[#0a0a0a]" : "bg-white/10 text-neutral-300")}
                                    style={selected ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}
                                >
                                    {position + 1}
                                </span>
                                {item.label}
                            </button>
                        );
                    })}
                </nav>
                <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
                    {busy ? (
                        <span className="mr-1 inline-flex max-w-[220px] items-center gap-1 truncate text-[11px] text-neutral-300">
                            <Loader2 className="size-3 shrink-0 animate-spin" />
                            <span className="truncate">{busy}</span>
                            {onCancel ? (
                                <button type="button" onClick={onCancel} className="shrink-0 rounded-full px-1.5 py-0.5 text-red-300 hover:bg-red-500/15">
                                    取消
                                </button>
                            ) : null}
                        </span>
                    ) : (
                        <span className={cn("hidden max-w-[220px] truncate text-[11px] xl:inline", error ? "text-red-300" : "text-neutral-400")}>{error || contextLabel || title || (saving ? "保存中…" : "")}</span>
                    )}
                    {actions}
                    {next ? (
                        <DarkButton size="sm" tone="primary" disabled={next.disabled} onClick={next.onClick}>
                            {next.label}
                            <ArrowRight className="size-3.5" />
                        </DarkButton>
                    ) : null}
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">{children}</div>
        </main>
    );
}
