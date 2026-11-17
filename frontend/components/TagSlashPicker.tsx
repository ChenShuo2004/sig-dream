"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TagSelectedChip } from "@/components/TagSelectedChip";

export type TagSlashActiveTag = { id: string; name: string; description?: string };
export type TagSlashActiveTagGroups = Record<string, TagSlashActiveTag[]>;

const STORAGE_KEY = "lcwp_tag_slash_recent_v1";
const LEGACY_STORAGE_KEY = "lcwp_unorganized_recent_tag_ids";
const MAX_RECENT = 30;

function readRecentFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    const ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    if (ids.length > 0 && !window.localStorage.getItem(STORAGE_KEY) && window.localStorage.getItem(LEGACY_STORAGE_KEY)) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch {
        /* ignore */
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/** 将一批 tag id 合并到「最近 / 检索」共用 localStorage（与 {@link TagSlashPicker} 同源）。 */
export function mergeTagSlashRecentStorage(idsToFront: string[]) {
  if (typeof window === "undefined" || idsToFront.length === 0) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    const prev = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    const next = [...idsToFront, ...prev.filter((id) => !idsToFront.includes(id))].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export type TagSlashPickerProps = {
  tagGroups: TagSlashActiveTagGroups;
  selectedTagIds: string[];
  onSelectedTagIdsChange: (ids: string[]) => void;
  theme?: "dark" | "light";
  className?: string;
  /** 可选：父级递增时清空输入框与下拉（如「清空选择」） */
  slashResetSeq?: number;
  inputDataTour?: string;
};

export function TagSlashPicker({
  tagGroups,
  selectedTagIds,
  onSelectedTagIdsChange,
  theme = "dark",
  className,
  slashResetSeq = 0,
  inputDataTour = "tag-slash-picker-input",
}: TagSlashPickerProps) {
  const [recentTagIds, setRecentTagIds] = useState<string[]>([]);
  const [replaceSlashInput, setReplaceSlashInput] = useState("");
  const [replaceSlashOpen, setReplaceSlashOpen] = useState(false);
  const [replaceSlashHighlight, setReplaceSlashHighlight] = useState(0);
  const replaceSlashWrapRef = useRef<HTMLDivElement>(null);
  const lastSlashResetSeq = useRef(0);

  useEffect(() => {
    setRecentTagIds(readRecentFromStorage());
  }, []);

  useEffect(() => {
    if (!slashResetSeq || slashResetSeq === lastSlashResetSeq.current) return;
    lastSlashResetSeq.current = slashResetSeq;
    setReplaceSlashInput("");
    setReplaceSlashOpen(false);
  }, [slashResetSeq]);

  const pushRecentTagIds = useCallback((idsToFront: string[]) => {
    if (idsToFront.length === 0) return;
    setRecentTagIds((prev) => {
      const next = [...idsToFront, ...prev.filter((id) => !idsToFront.includes(id))].slice(0, MAX_RECENT);
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const allTagsFlatForPicker = useMemo(
    () => Object.values(tagGroups).flat().filter((t) => t.name.trim() !== "未整理"),
    [tagGroups]
  );

  const replaceSlashQuery = useMemo(() => {
    const i = replaceSlashInput.lastIndexOf("/");
    if (i < 0) return null;
    return replaceSlashInput.slice(i + 1);
  }, [replaceSlashInput]);

  const replaceSlashSuggestions = useMemo(() => {
    if (!replaceSlashOpen || replaceSlashQuery === null) return [];
    const rawQ = replaceSlashQuery.trim();
    const qLower = rawQ.toLowerCase();
    const pool = allTagsFlatForPicker;
    if (!rawQ) {
      const out: TagSlashActiveTag[] = [];
      for (const id of recentTagIds) {
        const t = pool.find((x) => x.id === id);
        if (t) out.push(t);
      }
      for (const t of pool) {
        if (out.length >= 24) break;
        if (!out.some((x) => x.id === t.id)) out.push(t);
      }
      return out;
    }
    return pool
      .filter(
        (t) =>
          t.name.includes(rawQ) ||
          t.name.toLowerCase().includes(qLower) ||
          (t.description && (t.description.includes(rawQ) || t.description.toLowerCase().includes(qLower)))
      )
      .slice(0, 40);
  }, [replaceSlashOpen, replaceSlashQuery, allTagsFlatForPicker, recentTagIds]);

  useEffect(() => {
    setReplaceSlashHighlight(0);
  }, [replaceSlashSuggestions]);

  useEffect(() => {
    if (!replaceSlashOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = replaceSlashWrapRef.current;
      if (el && !el.contains(e.target as Node)) setReplaceSlashOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [replaceSlashOpen]);

  function addTagFromSlashPicker(tag: TagSlashActiveTag) {
    if (tag.name.trim() === "未整理") return;
    onSelectedTagIdsChange(selectedTagIds.includes(tag.id) ? selectedTagIds : [...selectedTagIds, tag.id]);
    pushRecentTagIds([tag.id]);
    setReplaceSlashInput("");
    setReplaceSlashOpen(false);
  }

  function removeTagId(id: string) {
    onSelectedTagIdsChange(selectedTagIds.filter((x) => x !== id));
  }

  const inputClass =
    theme === "light"
      ? "w-full rounded-lg border-2 border-sky-600/70 bg-white px-3 py-2.5 text-base text-slate-900 shadow-md shadow-slate-200/80 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-500 focus:shadow-lg focus:ring-4 focus:ring-sky-400/25"
      : "w-full rounded-lg border-2 border-sky-500/55 bg-slate-800 px-3 py-2.5 text-base text-slate-100 shadow-md shadow-black/30 outline-none transition-[border-color,box-shadow] placeholder:text-slate-500 focus:border-sky-400 focus:shadow-lg focus:shadow-sky-950/40 focus:ring-4 focus:ring-sky-500/30";

  const chipBoxClass =
    theme === "light"
      ? "flex min-h-[1.5rem] flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
      : "flex min-h-[1.5rem] flex-wrap gap-1.5 rounded-lg border border-white/15 bg-slate-950/40 p-2";

  const listClass =
    theme === "light"
      ? "absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
      : "absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-white/20 bg-slate-900 py-1 shadow-lg";

  const optIdle = theme === "light" ? "text-slate-800 hover:bg-slate-100" : "text-slate-200 hover:bg-white/10";
  const optHi = theme === "light" ? "bg-sky-500/25 text-slate-900" : "bg-sky-600/40 text-sky-50";

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        <div ref={replaceSlashWrapRef} className="relative">
          <input
            type="text"
            data-tour={inputDataTour}
            className={inputClass}
            placeholder="/ 检索标签…"
            value={replaceSlashInput}
            onChange={(e) => {
              const v = e.target.value;
              setReplaceSlashInput(v);
              setReplaceSlashOpen(v.includes("/"));
            }}
            onKeyDown={(e) => {
              if (!replaceSlashOpen || replaceSlashSuggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setReplaceSlashHighlight((h) => Math.min(replaceSlashSuggestions.length - 1, h + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setReplaceSlashHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const t = replaceSlashSuggestions[replaceSlashHighlight];
                if (t) addTagFromSlashPicker(t);
              } else if (e.key === "Escape") {
                setReplaceSlashOpen(false);
              }
            }}
          />
          {replaceSlashOpen && replaceSlashSuggestions.length > 0 ? (
            <ul className={listClass} role="listbox">
              {replaceSlashSuggestions.map((t, idx) => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === replaceSlashHighlight}
                    className={"w-full px-2 py-1.5 text-left text-sm " + (idx === replaceSlashHighlight ? optHi : optIdle)}
                    onMouseEnter={() => setReplaceSlashHighlight(idx)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => addTagFromSlashPicker(t)}
                    title={
                      (t.description || "").trim()
                        ? `${t.name} — ${(t.description || "").trim()}`
                        : t.name
                    }
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={chipBoxClass}>
          {selectedTagIds.map((id) => {
            const tag =
              allTagsFlatForPicker.find((t) => t.id === id) || Object.values(tagGroups).flat().find((t) => t.id === id);
            const label = tag?.name ?? id.slice(0, 8);
            return <TagSelectedChip key={id} label={label} onRemove={() => removeTagId(id)} />;
          })}
        </div>
      </div>
    </div>
  );
}
