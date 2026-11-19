import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clapperboard, Copy, Maximize2, UserRoundCog } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";

const MODES = [
    { key: "canvas", label: "无限画布", path: "/canvas", icon: Maximize2 },
    { key: "script", label: "剧本工作室", path: "/studio/script", icon: Clapperboard },
    { key: "replication", label: "复刻工作室", path: "/studio/replication", icon: Copy },
    { key: "replacement", label: "替换工作室", path: "/studio/replacement", icon: UserRoundCog },
] as const;

export function StudioModeSwitch() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const current = MODES.find((mode) => mode.key !== "canvas" && pathname.startsWith(mode.path)) || (pathname.startsWith("/canvas") ? MODES[0] : undefined);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", close);
        return () => window.removeEventListener("mousedown", close);
    }, [open]);

    return (
        <div ref={rootRef} className="relative flex h-10 shrink-0 items-center">
            {/* Same underline selection language as sibling top-nav links — no filled pill. */}
            <button
                type="button"
                className={cn(
                    "relative flex h-10 items-center gap-1 text-xs leading-none transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                    current
                        ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                        : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                )}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                <span>画布模式{current ? `：${current.label}` : ""}</span>
                <ChevronDown className={cn("size-3 transition", open && "rotate-180")} />
            </button>
            {open ? (
                <div className="absolute left-0 top-10 z-50 w-44 overflow-hidden rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900" role="listbox">
                    {MODES.map((mode) => {
                        const Icon = mode.icon;
                        const selected = current?.key === mode.key;
                        return (
                            <button
                                key={mode.key}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition",
                                    // Selected = deeper fill + light text (readable); avoid light pill + washed ink.
                                    selected ? "bg-stone-800 font-medium text-white dark:bg-stone-700" : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
                                )}
                                onClick={() => {
                                    setOpen(false);
                                    navigate(mode.path);
                                }}
                            >
                                <Icon className="size-3.5" />
                                {mode.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
