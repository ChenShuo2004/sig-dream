import { Trash2 } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ReferenceImage } from "@/types/image";

type Props = {
    references: ReferenceImage[];
    previewUrl: (item: ReferenceImage) => string;
    badge: (index: number) => ReactNode;
    emptyText: string;
    dropText: string;
    removeLabel: string;
    dragActive: boolean;
    onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
    onDropFiles: (event: DragEvent<HTMLDivElement>) => void;
    onReorder: (from: number, to: number) => void;
    onRemove: (id: string) => void;
    /** Smaller strip for single-viewport workbench layouts. */
    compact?: boolean;
};

/** Horizontal reference strip: file-drop to add, HTML5 drag to reorder. */
export function WorkbenchReferenceStrip({
    references,
    previewUrl,
    badge,
    emptyText,
    dropText,
    removeLabel,
    dragActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDropFiles,
    onReorder,
    onRemove,
    compact = false,
}: Props) {
    const dragIndexRef = useRef<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const onItemDragStart = (index: number) => (event: DragEvent<HTMLDivElement>) => {
        dragIndexRef.current = index;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/workbench-ref-index", String(index));
        // Avoid the strip treating this as an external file drop.
        event.dataTransfer.setData("text/plain", `ref:${index}`);
    };

    const onItemDragOver = (index: number) => (event: DragEvent<HTMLDivElement>) => {
        if (dragIndexRef.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOverIndex(index);
    };

    const onItemDrop = (index: number) => (event: DragEvent<HTMLDivElement>) => {
        if (dragIndexRef.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragIndexRef.current;
        dragIndexRef.current = null;
        setOverIndex(null);
        if (from === index) return;
        onReorder(from, index);
    };

    const onItemDragEnd = () => {
        dragIndexRef.current = null;
        setOverIndex(null);
    };

    return (
        <div
            className={cn(
                "hover-scrollbar hover-scrollbar-hint flex w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed overscroll-x-contain transition-colors",
                compact ? "min-h-14 p-1.5" : "min-h-24 p-2 pb-3",
                dragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700",
            )}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(event) => {
                if (dragIndexRef.current !== null) {
                    event.preventDefault();
                    dragIndexRef.current = null;
                    setOverIndex(null);
                    return;
                }
                onDropFiles(event);
            }}
            onWheel={(event) => {
                if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                event.preventDefault();
                event.currentTarget.scrollLeft += event.deltaY;
            }}
        >
            {references.map((item, index) => (
                <div
                    key={item.id}
                    draggable
                    onDragStart={onItemDragStart(index)}
                    onDragOver={onItemDragOver(index)}
                    onDrop={onItemDrop(index)}
                    onDragEnd={onItemDragEnd}
                    className={cn(
                        "group relative shrink-0 cursor-grab overflow-hidden rounded-md border bg-black/20 active:cursor-grabbing",
                        compact ? "size-12" : "size-20",
                        overIndex === index ? "border-sky-400 ring-2 ring-sky-400/40" : "border-stone-200 dark:border-stone-800",
                    )}
                    title="拖动调整顺序"
                >
                    <img src={previewUrl(item)} alt={item.name} className="pointer-events-none size-full object-cover" draggable={false} />
                    <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{badge(index)}</span>
                    <button
                        type="button"
                        className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                        onClick={() => onRemove(item.id)}
                        aria-label={removeLabel}
                    >
                        <Trash2 className="size-3.5" />
                    </button>
                </div>
            ))}
            {!references.length ? <div className={cn("flex min-w-full items-center justify-center text-stone-500", compact ? "text-xs" : "text-sm")}>{dragActive ? dropText : emptyText}</div> : null}
        </div>
    );
}

export function reorderReferences(items: ReferenceImage[], from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}
