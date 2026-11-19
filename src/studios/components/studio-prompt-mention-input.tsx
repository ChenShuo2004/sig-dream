import { Image } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";

import { isImeComposing } from "@/lib/keyboard-event";
import { cn } from "@/lib/utils";
import { resolveStudioMedia } from "@/studios/media";

export type StudioMentionOption = {
    id: string;
    /** Display name without @, e.g. 李云东 */
    label: string;
    /** Full token inserted into prompt, e.g. @李云东 */
    mention: string;
    kindLabel: string;
    mediaKey?: string;
    /** Direct preview URL (workbench dataUrl / blob URL); preferred over mediaKey when set. */
    previewUrl?: string;
    /** Controls chip/menu thumb: image uses preview; video/audio show kind badge. */
    mediaKind?: "image" | "video" | "audio";
};

type Props = {
    value: string;
    disabled?: boolean;
    options: StudioMentionOption[];
    placeholder?: string;
    minRows?: number;
    maxRows?: number;
    /** Fill parent height and scroll inside the editor (e.g. fixed reference rail above). */
    fill?: boolean;
    /** studio = dark script/replacement panels; workbench = light/dark stone cards. */
    tone?: "studio" | "workbench";
    className?: string;
    onChange: (value: string) => void;
    /** Fired when user picks from @ menu (after text insert). */
    onPick?: (option: StudioMentionOption) => void;
};

type MentionState = {
    query: string;
    rect: DOMRect | null;
};

type Token = { type: "text"; value: string } | { type: "reference"; label: string };

/** contentEditable prompt: @ references become inline thumbnail chips (SHUO canvas style). */
export function StudioPromptMentionInput({ value, disabled, options, placeholder, minRows = 8, maxRows = 18, fill = false, tone = "studio", className, onChange, onPick }: Props) {
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const previewUrls = useResolvedPreviewUrls(options);
    const workbench = tone === "workbench";

    const resolvePreview = (option: StudioMentionOption) => option.previewUrl || (option.mediaKey ? previewUrls[option.mediaKey] || "" : "") || previewUrls[option.id] || "";

    const optionByMention = useMemo(() => {
        const map = new Map<string, StudioMentionOption>();
        for (const option of options) {
            map.set(option.mention, option);
            map.set(`@${option.label}`, option);
        }
        return map;
    }, [options]);

    const activeLabels = useMemo(() => {
        const labels = new Set<string>();
        for (const option of options) {
            labels.add(option.mention);
            labels.add(`@${option.label}`);
        }
        return Array.from(labels).sort((a, b) => b.length - a.length);
    }, [options]);

    const tokens = useMemo(() => parseTokens(value, activeLabels), [value, activeLabels]);

    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return options;
        return options.filter((item) => `${item.label} ${item.kindLabel} ${item.mention}`.toLowerCase().includes(query));
    }, [mention, options]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        // External value wins (e.g. H3 中/英切换). Only skip when focused and already in sync,
        // so we do not clobber in-progress typing — but never keep stale DOM after parent swap.
        if (document.activeElement === editor && value === lastEmittedRef.current) return;
        if (value === lastEmittedRef.current && editor.childNodes.length > 0 && serializeEditor(editor) === value) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const option = optionByMention.get(token.label);
            if (option) {
                editor.append(createReferenceChip(option, resolvePreview(option), setImagePreview, workbench));
            } else {
                editor.append(document.createTextNode(token.label));
            }
        });
        lastEmittedRef.current = value;
    }, [tokens, optionByMention, previewUrls, value, workbench, options]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        emit(serializeEditor(editor));
        syncMention();
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = () => {
        if (disabled || !options.length) {
            closeMention();
            return;
        }
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/u.exec(text);
        if (!match) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "", rect: caretRect() });
        setActiveIndex(0);
    };

    const insertOption = (option: StudioMentionOption) => {
        const editor = editorRef.current;
        if (!editor || disabled) return;
        removeActiveMention();
        const chip = createReferenceChip(option, resolvePreview(option), setImagePreview, workbench);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeEditor(editor));
        onPick?.(option);
    };

    const showPlaceholder = !value.trim();
    const linePx = 20;
    const minHeight = Math.max(40, minRows * linePx);
    const maxHeight = Math.max(minHeight, maxRows * linePx);

    return (
        <div className={cn("relative w-full min-w-0", fill ? "flex min-h-0 flex-1 flex-col" : "", className)}>
            {showPlaceholder && placeholder ? (
                <div className={cn("pointer-events-none absolute left-2.5 top-2 z-[1]", workbench ? "text-sm leading-6 text-stone-400" : "text-xs leading-5 text-neutral-500")}>{placeholder}</div>
            ) : null}
            <div
                ref={editorRef}
                contentEditable={!disabled}
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-disabled={disabled || undefined}
                className={cn(
                    "w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md px-2.5 py-2 outline-none",
                    workbench
                        ? "border border-stone-300 bg-white text-sm leading-6 text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                        : "border border-white/10 bg-black/30 text-xs leading-5 text-neutral-100",
                    fill ? "min-h-0 flex-1" : "",
                    disabled ? "cursor-not-allowed opacity-60" : workbench ? "cursor-text focus:border-stone-500 dark:focus:border-stone-400" : "cursor-text focus:border-white/25",
                )}
                style={fill ? { minHeight } : { minHeight, maxHeight }}
                onInput={() => {
                    if (!composingRef.current) syncFromEditor();
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncFromEditor();
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (disabled) return;
                    if (isImeComposing(event)) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter" || event.key === "Tab") {
                            event.preventDefault();
                            insertOption(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                        event.preventDefault();
                        requestAnimationFrame(syncFromEditor);
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onClick={() => {
                    if (!disabled) requestAnimationFrame(syncMention);
                }}
                onBlur={() => window.setTimeout(closeMention, 120)}
            />
            {mention && candidates.length ? (
                <MentionMenu
                    rect={mention.rect}
                    options={candidates}
                    activeIndex={Math.min(activeIndex, candidates.length - 1)}
                    resolvePreview={resolvePreview}
                    tone={tone}
                    onSelect={insertOption}
                />
            ) : null}
            {imagePreview ? (
                <Image src={imagePreview} alt="参考图预览" style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} />
            ) : null}
        </div>
    );
}

function useResolvedPreviewUrls(options: StudioMentionOption[]) {
    const keys = useMemo(() => Array.from(new Set(options.map((item) => item.mediaKey).filter(Boolean) as string[])).sort(), [options]);
    const keySig = keys.join("|");
    const [urls, setUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        if (!keys.length) {
            setUrls({});
            return;
        }
        void (async () => {
            const next: Record<string, string> = {};
            await Promise.all(
                keys.map(async (key) => {
                    const url = await resolveStudioMedia(key);
                    if (url) next[key] = url;
                }),
            );
            if (!cancelled) setUrls(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [keySig, keys]);

    return urls;
}

function MentionMenu({
    rect,
    options,
    activeIndex,
    resolvePreview,
    tone,
    onSelect,
}: {
    rect: DOMRect | null;
    options: StudioMentionOption[];
    activeIndex: number;
    resolvePreview: (option: StudioMentionOption) => string;
    tone: "studio" | "workbench";
    onSelect: (option: StudioMentionOption) => void;
}) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);
    const workbench = tone === "workbench";

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, options]);

    const selectOption = (option: StudioMentionOption) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(option);
    };

    const stop = (event: PointerEvent | MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    const anchor = rect || new DOMRect(16, 16, 0, 0);
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const showAbove = anchor.bottom + gap + maxMenuHeight > window.innerHeight && anchor.top - gap - maxMenuHeight >= 0;
    const top = showAbove ? anchor.top - gap - maxMenuHeight : anchor.bottom + gap;

    return createPortal(
        <div
            className={cn(
                "fixed z-[1100] max-h-56 w-64 overflow-y-auto rounded-xl p-1 shadow-2xl backdrop-blur-md",
                workbench ? "border border-stone-200 bg-white/95 dark:border-stone-700 dark:bg-stone-900/95" : "border border-white/15 bg-[#16161a]/95",
            )}
            style={{ left, top }}
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={(event) => event.stopPropagation()}
        >
            <div className={cn("px-2 py-1 text-[10px]", workbench ? "text-stone-500" : "text-neutral-500")}>选择参考</div>
            {options.map((option, index) => {
                const previewUrl = resolvePreview(option);
                const kind = option.mediaKind || (previewUrl ? "image" : "image");
                return (
                    <button
                        key={option.id}
                        ref={index === activeIndex ? activeItemRef : undefined}
                        type="button"
                        className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
                            workbench
                                ? index === activeIndex
                                    ? "bg-stone-100 dark:bg-stone-800"
                                    : "hover:bg-stone-50 dark:hover:bg-stone-800/70"
                                : index === activeIndex
                                  ? "bg-white/10"
                                  : "hover:bg-white/[0.06]",
                        )}
                        onPointerDown={(event) => {
                            stop(event);
                            selectOption(option);
                        }}
                        onClick={(event) => {
                            stop(event);
                            selectOption(option);
                        }}
                    >
                        <span
                            className={cn(
                                "size-9 shrink-0 overflow-hidden rounded-md border",
                                workbench ? "border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800" : "border-white/10 bg-black/40",
                            )}
                        >
                            {kind === "image" && previewUrl ? (
                                <img src={previewUrl} alt="" className="size-full object-cover" />
                            ) : (
                                <span className={cn("grid size-full place-items-center text-[10px] font-medium", workbench ? "text-stone-500" : "text-neutral-400")}>
                                    {kindBadge(kind)}
                                </span>
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className={cn("block truncate font-medium", workbench ? "text-stone-900 dark:text-stone-100" : "text-neutral-100")}>{option.mention}</span>
                            <span className={cn("block truncate text-[10px]", workbench ? "text-stone-500" : "text-neutral-500")}>{option.kindLabel}</span>
                        </span>
                    </button>
                );
            })}
        </div>,
        document.body,
    );
}

function kindBadge(kind: "image" | "video" | "audio") {
    if (kind === "video") return "视";
    if (kind === "audio") return "音";
    return "图";
}

function createReferenceChip(option: StudioMentionOption, previewUrl: string, onImagePreview: (url: string) => void, workbench = false) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.refLabel = option.mention;
    wrapper.title = `${option.kindLabel} · ${option.label}`;
    wrapper.className = workbench
        ? "mx-0.5 inline-flex h-7 max-w-[12rem] items-center gap-1 overflow-hidden rounded border border-stone-300 bg-stone-100 px-1 align-middle text-xs leading-none text-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
        : "mx-0.5 inline-flex h-6 max-w-[12rem] items-center gap-1 overflow-hidden rounded border border-white/15 bg-white/10 px-1 align-middle text-[11px] leading-none text-neutral-100";

    const kind = option.mediaKind || (previewUrl ? "image" : "image");
    if (kind === "image" && previewUrl) {
        const image = document.createElement("img");
        image.src = previewUrl;
        image.alt = option.label;
        image.className = "size-5 shrink-0 rounded object-cover";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(previewUrl);
        });
    } else {
        const badge = document.createElement("span");
        badge.className = workbench
            ? "grid size-5 shrink-0 place-items-center rounded bg-stone-200 text-[10px] font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-100"
            : "grid size-5 shrink-0 place-items-center rounded bg-white/15 text-[10px] font-medium text-neutral-100";
        badge.textContent = kindBadge(kind);
        wrapper.appendChild(badge);
    }

    const text = document.createElement("span");
    text.className = "min-w-0 truncate";
    text.textContent = option.mention.replace(/^@/, "");
    wrapper.appendChild(text);
    return wrapper;
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const label = node.dataset.refLabel;
        if (label) result += label;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/u.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) {
        current = previous ? current.previousSibling : current.nextSibling;
    }
    return current instanceof HTMLElement && current.dataset.refLabel ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height || rect.left || rect.top) return rect;
    const editor = closestEditor(range.startContainer);
    return editor ? editor.getBoundingClientRect() : null;
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function parseTokens(value: string, labels: string[]): Token[] {
    if (!labels.length) return value ? [{ type: "text", value }] : [];
    const escaped = labels.map(escapeRegExp).join("|");
    const pattern = new RegExp(`(${escaped})`, "g");
    const tokens: Token[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "reference", label: match[0] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
