import { Input, Modal } from "antd";
import { Check, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { DarkButton, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { SCRIPT_PRESETS } from "@/studios/prompts/script.generated";

export type ScriptStylePreset = {
    id: string;
    label: string;
    category: string;
    prompt: string;
    assetPrompt: string;
    thumbnail: string;
};

const STYLE_PRESETS = SCRIPT_PRESETS.stylePresets as unknown as readonly ScriptStylePreset[];

const CATEGORIES: Array<{ key: "all" | "live" | "2d" | "3d"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "live", label: "真人" },
    { key: "2d", label: "2D" },
    { key: "3d", label: "3D" },
];

export function styleThumbnailUrl(thumbnail: string) {
    if (!thumbnail) return "";
    if (/^(?:https?:|data:|blob:)/u.test(thumbnail)) return thumbnail;
    const path = thumbnail.replace(/^\//u, "");
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/u, "/");
    return `${base}${path}`;
}

export function findStylePreset(settings: { visualStyle?: string; stylePrompt?: string } | null | undefined) {
    if (!settings) return undefined;
    const byPrompt = STYLE_PRESETS.find((preset) => preset.prompt === settings.stylePrompt || preset.assetPrompt === settings.stylePrompt);
    if (byPrompt) return byPrompt;
    const label = (settings.visualStyle || "").trim();
    if (!label) return undefined;
    return STYLE_PRESETS.find((preset) => preset.label === label);
}

export function StyleLibraryModal({
    open,
    selectedId,
    onClose,
    onSelect,
}: {
    open: boolean;
    selectedId?: string;
    onClose: () => void;
    onSelect: (preset: ScriptStylePreset | null) => void;
}) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<"all" | "live" | "2d" | "3d">("all");
    const dark = useThemeStore((state) => state.theme === "dark");

    const visible = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return STYLE_PRESETS.filter((preset) => {
            if (category !== "all" && preset.category !== category) return false;
            if (!keyword) return true;
            return preset.label.toLowerCase().includes(keyword) || preset.id.toLowerCase().includes(keyword);
        });
    }, [category, query]);

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={980}
            centered
            destroyOnHidden
            title={
                <div className="pr-8">
                    <div className="text-base font-semibold text-stone-900 dark:text-neutral-100">风格库</div>
                    <p className="mt-1 text-xs font-normal text-stone-500 dark:text-neutral-500">为后续角色、场景、道具和分镜画面统一视觉方向</p>
                </div>
            }
            styles={{
                container: { background: dark ? "#121214" : "#ffffff", padding: 0 },
                header: { background: dark ? "#121214" : "#ffffff", margin: 0, padding: "16px 20px 8px", borderBottom: "none" },
                body: { padding: "0 20px 20px" },
            }}
        >
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-full bg-stone-900/[0.06] p-1 dark:bg-white/[0.06]">
                    {CATEGORIES.map((item) => {
                        const active = category === item.key;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setCategory(item.key)}
                                style={active ? inkOnWhiteStyle : undefined}
                                className={cn(
                                    "rounded-full px-3 py-1 text-xs font-medium transition",
                                    active
                                        ? "bg-white shadow-xs"
                                        : "text-stone-600 hover:bg-stone-900/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.08]",
                                )}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
                <Input
                    allowClear
                    size="middle"
                    className="!ml-auto !w-56"
                    prefix={<Search className="size-3.5 text-stone-400 dark:text-neutral-500" />}
                    placeholder="搜索风格"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>

            <div className="max-h-[62vh] overflow-auto pr-1">
                {visible.length ? (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {visible.map((preset) => {
                            const active = preset.id === selectedId;
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    title={preset.label}
                                    onClick={() => {
                                        onSelect(preset);
                                        onClose();
                                    }}
                                    className={cn(
                                        "group relative overflow-hidden rounded-xl border text-left transition",
                                        active
                                            ? "border-stone-900 ring-1 ring-stone-900/40 dark:border-white/70 dark:ring-white/40"
                                            : "border-stone-200 hover:border-stone-400 dark:border-white/[0.08] dark:hover:border-white/30",
                                    )}
                                >
                                    <div className="aspect-[4/3] bg-stone-200/70 dark:bg-black/50">
                                        <img src={styleThumbnailUrl(preset.thumbnail)} alt={preset.label} loading="lazy" className="size-full object-cover transition duration-200 group-hover:scale-[1.03]" />
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-2 pt-8">
                                        <div className="truncate text-[11px] font-medium text-white">{preset.label}</div>
                                    </div>
                                    {active ? (
                                        <span style={inkOnWhiteStyle} className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-white shadow-xs">
                                            <Check className="size-3" />
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-neutral-500">
                        <Sparkles className="size-5" />
                        没有匹配的风格
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-stone-200/80 pt-3 dark:border-white/[0.06]">
                <span className="text-[11px] text-stone-500 dark:text-neutral-500">共 {visible.length} 个风格</span>
                <div className="flex gap-2">
                    <DarkButton
                        size="sm"
                        tone="ghost"
                        onClick={() => {
                            onSelect(null);
                            onClose();
                        }}
                    >
                        清除风格
                    </DarkButton>
                    <DarkButton size="sm" onClick={onClose}>
                        关闭
                    </DarkButton>
                </div>
            </div>
        </Modal>
    );
}

export function StyleLibraryField({
    disabled,
    selected,
    onChange,
}: {
    disabled?: boolean;
    selected?: ScriptStylePreset;
    onChange: (preset: ScriptStylePreset | null) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className={cn("flex h-8 w-full min-w-[160px] items-center gap-2 overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 text-left transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-50")}
            >
                {selected ? (
                    <>
                        <img src={styleThumbnailUrl(selected.thumbnail)} alt="" className="size-6 shrink-0 rounded object-cover" />
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-100">{selected.label}</span>
                    </>
                ) : (
                    <>
                        <Sparkles className="size-3.5 shrink-0 text-neutral-500" />
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">视觉风格</span>
                    </>
                )}
                <Search className="size-3.5 shrink-0 text-neutral-500" />
            </button>
            <StyleLibraryModal open={open} selectedId={selected?.id} onClose={() => setOpen(false)} onSelect={onChange} />
        </>
    );
}
