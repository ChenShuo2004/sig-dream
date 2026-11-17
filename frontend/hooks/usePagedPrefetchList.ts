"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PageResult<T> = {
  items: T[];
  total: number;
};

type Options = {
  prefetchPages?: number[];
  enabled?: boolean;
  /** 服务端分页每页条数；appendMode=false 时用于总页数与 hasMore */
  pageSize?: number;
  /**
   * true（默认）：向后合并追加（未整理/回收站 + 预取）
   * false：每页仅展示该页数据，翻页用 goToPage / loadNext 整页替换（素材库）
   */
  appendMode?: boolean;
  /** 底部哨兵自动拉下一页；分页模式建议 false */
  autoLoadSentinel?: boolean;
};

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function usePagedPrefetchList<T>(options?: Options) {
  const prefetchPages = options?.prefetchPages ?? [2, 3];
  const enabled = options?.enabled ?? true;
  const pageSize = options?.pageSize ?? 20;
  const appendMode = options?.appendMode ?? true;
  const autoLoadSentinel = options?.autoLoadSentinel ?? true;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const requestSeqRef = useRef(0);
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadNextRef = useRef<(() => Promise<void>) | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(Math.max(0, total) / pageSize)), [total, pageSize]);

  const hasMore = useMemo(() => {
    if (!appendMode) {
      return total > 0 && page < totalPages;
    }
    return total > 0 && items.length < total;
  }, [appendMode, items.length, page, total, totalPages]);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean, seq: number, fetcher: (p: number) => Promise<PageResult<T>>) => {
      const data = await fetcher(targetPage);
      if (seq !== requestSeqRef.current) return false;
      const nextItems = Array.isArray(data.items) ? data.items : [];
      const totalNum = Math.max(0, Number(data.total || 0));
      setTotal(totalNum);

      if (!append) {
        loadedPagesRef.current = new Set([targetPage]);
        setItems(nextItems);
        setPage(nextItems.length > 0 ? targetPage : 1);
        return nextItems.length < totalNum && nextItems.length > 0;
      }

      loadedPagesRef.current.add(targetPage);
      if (nextItems.length === 0) {
        return false;
      }

      setItems((prev) => [...prev, ...nextItems]);
      setPage((prev) => Math.max(prev, targetPage));
      const mergedLen = items.length + nextItems.length;
      return mergedLen < totalNum && nextItems.length > 0;
    },
    [items.length]
  );

  const goToPage = useCallback(
    async (targetPage: number, fetcher: (p: number) => Promise<PageResult<T>>) => {
      if (!enabled || targetPage < 1) return;
      const seq = ++requestSeqRef.current;
      setBusy(true);
      setLoadingMore(false);
      setError("");
      loadedPagesRef.current = new Set([targetPage]);
      try {
        const data = await fetcher(targetPage);
        if (seq !== requestSeqRef.current) return;
        const nextItems = Array.isArray(data.items) ? data.items : [];
        const totalNum = Math.max(0, Number(data.total || 0));
        setItems(nextItems);
        setTotal(totalNum);
        const maxPage = Math.max(1, Math.ceil(totalNum / pageSize));
        const clamped = Math.min(targetPage, maxPage);
        setPage(clamped);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        if (isAbortError(e)) return;
        setItems([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === requestSeqRef.current) setBusy(false);
      }
    },
    [enabled, pageSize]
  );

  const resetAndLoad = useCallback(
    async (fetcher: (p: number) => Promise<PageResult<T>>) => {
      if (!enabled) return;
      if (!appendMode) {
        await goToPage(1, fetcher);
        return;
      }
      const seq = ++requestSeqRef.current;
      loadedPagesRef.current = new Set();
      setBusy(true);
      setLoadingMore(false);
      setError("");
      try {
        const maybeHasMore = await fetchPage(1, false, seq, fetcher);
        if (maybeHasMore) {
          for (const p of prefetchPages) {
            if (seq !== requestSeqRef.current) break;
            // eslint-disable-next-line no-await-in-loop
            const hasMoreMore = await fetchPage(p, true, seq, fetcher);
            if (!hasMoreMore) break;
          }
        }
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        if (isAbortError(e)) return;
        setItems([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === requestSeqRef.current) setBusy(false);
      }
    },
    [appendMode, enabled, fetchPage, goToPage, prefetchPages]
  );

  const loadNext = useCallback(
    async (fetcher: (p: number) => Promise<PageResult<T>>) => {
      if (!enabled || busy || loadingMore) return;
      if (!hasMore) return;

      if (!appendMode) {
        const next = page + 1;
        if (next > totalPages) return;
        setLoadingMore(true);
        const seq = ++requestSeqRef.current;
        try {
          await fetchPage(next, false, seq, fetcher);
        } finally {
          if (seq === requestSeqRef.current) setLoadingMore(false);
        }
        return;
      }

      const loaded = Array.from(loadedPagesRef.current);
      const next = loaded.length === 0 ? 1 : Math.max(...loaded) + 1;
      if (loadedPagesRef.current.has(next)) return;
      setLoadingMore(true);
      const seq = requestSeqRef.current;
      try {
        await fetchPage(next, true, seq, fetcher);
      } finally {
        if (seq === requestSeqRef.current) setLoadingMore(false);
      }
    },
    [appendMode, busy, enabled, fetchPage, hasMore, loadingMore, page, totalPages]
  );

  useEffect(() => {
    if (!enabled || !autoLoadSentinel) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && loadNextRef.current) {
          void loadNextRef.current();
        }
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [autoLoadSentinel, enabled]);

  const bindLoadNext = useCallback((runner: () => Promise<void>) => {
    loadNextRef.current = runner;
  }, []);

  const invalidateInFlight = useCallback(() => {
    requestSeqRef.current += 1;
    setBusy(false);
    setLoadingMore(false);
  }, []);

  return {
    items,
    total,
    page,
    totalPages,
    busy,
    loadingMore,
    error,
    hasMore,
    sentinelRef,
    setItems,
    setTotal,
    setError,
    resetAndLoad,
    loadNext,
    goToPage,
    bindLoadNext,
    invalidateInFlight,
  };
}
