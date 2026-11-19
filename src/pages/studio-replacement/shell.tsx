import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Input } from "antd";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { REPLACEMENT_STEPS, type ReplacementStep } from "@/studios/replacement/document";

import { DarkButton, inkOnWhiteStyle } from "./ui";

export function ReplacementShell({
    title,
    onRename,
    step,
    onStep,
    saving,
    error,
    actions,
    status,
    busy,
    onCancel,
    next,
    steps = REPLACEMENT_STEPS,
    homeLabel = "人物替换项目",
    children,
}: {
    title: string;
    onRename: (title: string) => void;
    step: ReplacementStep;
    onStep: (step: ReplacementStep) => void;
    saving: boolean;
    error: string;
    actions?: ReactNode;
    status?: ReactNode;
    busy?: string;
    onCancel?: () => void;
    next?: { label: string; disabled?: boolean; onClick: () => void } | null;
    steps?: Array<{ key: ReplacementStep; label: string }>;
    homeLabel?: string;
    children: ReactNode;
}) {
    const index = steps.findIndex((item) => item.key === step);
    const previous = steps[index - 1];
    return (
        <main className="relative flex h-full flex-col overflow-hidden">
            {/* One flat toolbar row — avoid nested padded shells that inflate height. */}
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
                <Link to="/studio/replacement" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-neutral-300 transition hover:bg-white/[0.08] hover:text-white">
                    <ArrowLeft className="size-3.5" />
                    {homeLabel}
                </Link>
                <Input
                    variant="borderless"
                    title="项目名称（可修改）"
                    placeholder="项目名称"
                    className="!h-7 !min-w-0 !max-w-[140px] !truncate !border-b !border-transparent !px-1 !text-xs !text-neutral-400 hover:!border-white/20 focus:!border-white/30 focus:!text-neutral-200"
                    value={title}
                    onChange={(event) => onRename(event.target.value)}
                />
                <nav className="mx-auto flex h-7 items-center gap-0.5 rounded-full bg-white/[0.06] p-0.5">
                    {steps.map((item, position) => {
                        const selected = item.key === step;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => onStep(item.key)}
                                style={selected ? inkOnWhiteStyle : undefined}
                                className={cn("flex h-6 items-center gap-1 rounded-full px-2 text-[11px] leading-none transition", selected ? "bg-white font-medium" : "text-neutral-300 hover:bg-white/[0.08] hover:text-white")}
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
                    <span className={cn("hidden truncate text-[11px] xl:inline", error ? "text-red-300" : "text-neutral-500")}>{error || (saving ? "保存中…" : "已保存")}</span>
                    {actions}
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-12">{children}</div>
            <footer className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-3">
                <div className="pointer-events-auto flex h-9 w-full max-w-3xl items-center gap-2 rounded-full border border-white/[0.08] bg-[#1b1b1e]/95 px-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur">
                    <DarkButton size="sm" tone="ghost" disabled={!previous} onClick={() => previous && onStep(previous.key)}>
                        <ArrowLeft className="size-3.5" />
                        上一步
                    </DarkButton>
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] text-neutral-300">
                        {busy ? (
                            <>
                                <Loader2 className="size-3 shrink-0 animate-spin" />
                                <span className="shrink-0 font-medium text-white">{busy}</span>
                                <span className="min-w-0 truncate text-neutral-400">{status}</span>
                                {onCancel ? (
                                    <button type="button" onClick={onCancel} className="shrink-0 rounded-full px-1.5 py-0.5 text-red-300 hover:bg-red-500/15">
                                        取消
                                    </button>
                                ) : null}
                            </>
                        ) : (
                            <span className="min-w-0 truncate">{status}</span>
                        )}
                    </div>
                    {next ? (
                        <DarkButton size="sm" tone="primary" disabled={next.disabled} onClick={next.onClick}>
                            {next.label}
                            <ArrowRight className="size-3.5" />
                        </DarkButton>
                    ) : (
                        <span className="w-[72px]" />
                    )}
                </div>
            </footer>
        </main>
    );
}
