"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { collectMarqueeHitIds, type MarqueeBox, type MarqueeDrag } from "@/lib/materialGridMarquee";

export type MaterialGridToolbarMessage = { tone: "ok" | "warn"; text: string };

const MARQUEE_MIN_PX = 6;
const SUPPRESS_CARD_CLICK_MS = 450;
const DEFAULT_MESSAGE_CLEAR_MS = 8000;

type Options = {
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  /** 框选命中后追加勾选完成时回调（默认由 hook 写入 message） */
  onMarqueeAppended?: (hitIds: string[]) => void;
  messageClearMs?: number;
};

export function useMaterialGridMarqueeSelection({
  selectedIds,
  setSelectedIds,
  onMarqueeAppended,
  messageClearMs = DEFAULT_MESSAGE_CLEAR_MS,
}: Options) {
  const suppressNextCardClickUntilRef = useRef(0);
  const marqueeDragRef = useRef<MarqueeDrag | null>(null);
  const activeGridRef = useRef<HTMLElement | null>(null);
  const [marqueeActive, setMarqueeActive] = useState(false);
  const [marqueeBox, setMarqueeBox] = useState<MarqueeBox | null>(null);
  const [toolbarMessage, setToolbarMessage] = useState<MaterialGridToolbarMessage | null>(null);

  const appendSelectedIds = useCallback(
    (hitIds: string[]) => {
      if (hitIds.length === 0) return;
      setSelectedIds((prev) => [...new Set([...prev, ...hitIds])]);
      const msg: MaterialGridToolbarMessage = { tone: "ok", text: `已框选追加勾选 ${hitIds.length} 条。` };
      setToolbarMessage(msg);
      onMarqueeAppended?.(hitIds);
    },
    [setSelectedIds, onMarqueeAppended]
  );

  const selectAllIds = useCallback(
    (ids: string[], okMessage?: string) => {
      setSelectedIds(ids);
      setToolbarMessage({
        tone: "ok",
        text: okMessage ?? (ids.length > 0 ? `已全选本页 ${ids.length} 条。` : "当前列表无条目。"),
      });
    },
    [setSelectedIds]
  );

  const clearSelectedIds = useCallback(
    (okMessage?: string) => {
      setSelectedIds([]);
      setToolbarMessage({ tone: "ok", text: okMessage ?? "已清除勾选。" });
    },
    [setSelectedIds]
  );

  const shouldSuppressCardClick = useCallback(() => Date.now() < suppressNextCardClickUntilRef.current, []);

  useEffect(() => {
    if (!toolbarMessage || messageClearMs <= 0) return;
    const t = window.setTimeout(() => setToolbarMessage(null), messageClearMs);
    return () => window.clearTimeout(t);
  }, [toolbarMessage, messageClearMs]);

  useEffect(() => {
    if (!marqueeActive) return;
    const onMove = (e: MouseEvent) => {
      const m = marqueeDragRef.current;
      if (!m) return;
      m.x2 = e.clientX;
      m.y2 = e.clientY;
      setMarqueeBox({
        left: Math.min(m.x1, m.x2),
        top: Math.min(m.y1, m.y2),
        width: Math.abs(m.x2 - m.x1),
        height: Math.abs(m.y2 - m.y1),
      });
    };
    const onUp = () => {
      const m = marqueeDragRef.current;
      const grid = activeGridRef.current;
      setMarqueeActive(false);
      setMarqueeBox(null);
      marqueeDragRef.current = null;
      activeGridRef.current = null;
      if (!m) return;
      const w = Math.abs(m.x2 - m.x1);
      const h = Math.abs(m.y2 - m.y1);
      if (w >= MARQUEE_MIN_PX && h >= MARQUEE_MIN_PX) {
        suppressNextCardClickUntilRef.current = Date.now() + SUPPRESS_CARD_CLICK_MS;
        const hitIds = collectMarqueeHitIds(grid, m);
        appendSelectedIds(hitIds);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, [marqueeActive, appendSelectedIds]);

  const onGridMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest("[data-material-card]")) return;
    e.preventDefault();
    activeGridRef.current = e.currentTarget;
    const x1 = e.clientX;
    const y1 = e.clientY;
    marqueeDragRef.current = { x1, y1, x2: x1, y2: y1 };
    setMarqueeBox({ left: x1, top: y1, width: 0, height: 0 });
    setMarqueeActive(true);
  }, []);

  return {
    selectedIds,
    toolbarMessage,
    setToolbarMessage,
    marqueeActive,
    marqueeBox,
    onGridMouseDown,
    selectAllIds,
    clearSelectedIds,
    shouldSuppressCardClick,
  };
}
