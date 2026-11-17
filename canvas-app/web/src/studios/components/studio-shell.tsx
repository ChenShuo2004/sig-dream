import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Input, Spin } from "antd";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { STUDIO_LABELS, type StudioKind } from "../types";

type Step<TKey extends string> = { key: TKey; label: string };

export function StudioShell<TKey extends string>({
    kind,
    title,
    onRename,
    steps,
    step,
    onStep,
    saving,
    error,
    actions,
    children,
}: {
    kind: StudioKind;
    title: string;
    onRename: (title: string) => void;
    steps: Step<TKey>[];
    step: TKey;
    onStep: (step: TKey) => void;
    saving: boolean;
    error: string;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <main className="flex h-full flex-col overflow-hidden bg-background text-stone-950 dark:text-stone-100">
            <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-stone-200 px-6 py-3 dark:border-stone-800">
                <Link to={`/studio/${kind}`} className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-950 dark:hover:text-stone-100">
                    <ArrowLeft className="size-4" />
                    {STUDIO_LABELS[kind]}
                </Link>
                <Input variant="borderless" className="!w-72 !px-1 text-base font-medium" value={title} onChange={(event) => onRename(event.target.value)} />
                <nav className="flex items-center gap-1">
                    {steps.map((item, index) => {
                        const selected = item.key === step;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={cn(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition",
                                    // Dark selected: deepen fill (not light pill) so ink stays readable under color-scheme:dark.
                                    selected ? "bg-stone-800 font-medium text-white dark:bg-stone-700 dark:text-white" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
                                )}
                                onClick={() => onStep(item.key)}
                            >
                                <span className={cn("text-xs", selected ? "text-stone-300 dark:text-stone-300" : "text-stone-400")}>{index + 1}</span>
                                {item.label}
                            </button>
                        );
                    })}
                </nav>
                <div className="ml-auto flex items-center gap-3 text-xs text-stone-500">
                    {error ? <span className="text-red-600">{error}</span> : saving ? <span>保存中…</span> : <span>已保存</span>}
                    {actions}
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </main>
    );
}

export function StudioLoading({ error }: { error: string }) {
    return <main className="flex h-full items-center justify-center text-sm text-stone-500">{error ? <span className="text-red-600">{error}</span> : <Spin />}</main>;
}
