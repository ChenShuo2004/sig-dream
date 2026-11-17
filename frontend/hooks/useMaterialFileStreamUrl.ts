"use client";

import { useEffect, useState } from "react";

import { resolveMaterialDownload } from "@/lib/materialBrowserDownload";

type Args = {
  apiBaseUrl: string;
  materialId: string | null | undefined;
  fileId: string | null | undefined;
  filename: string;
  enabled: boolean;
  /** 与页面其它请求一致的 Bearer；空字符串时不发起解析 */
  token: string;
};

const RESOLVE_TIMEOUT_MS = 90_000;

/**
 * 与「下载选路」一致解析主文件直链：供 `<video src>` 或灯箱原图 `<img src>`（文件机多支持 Range）。
 * 注意：effect 清理时 `abort` 后仍须在 `finally` 里 `setLoading(false)`，否则界面会永久停在「正在解析…」。
 */
export function useMaterialFileStreamUrl(args: Args) {
  const { apiBaseUrl, materialId, fileId, filename, enabled, token } = args;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !materialId?.trim() || !fileId?.trim() || !token.trim()) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let timedOut = false;
    let cleanedUp = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    const timer = window.setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, RESOLVE_TIMEOUT_MS);
    void (async () => {
      try {
        const r = await resolveMaterialDownload({
          apiBaseUrl,
          materialId: materialId.trim(),
          fileId: fileId.trim(),
          filename: filename.trim() || "media.bin",
          authHeaders: () => {
            const t = token.trim();
            const h: Record<string, string> = {};
            if (t) h.Authorization = `Bearer ${t}`;
            return h;
          },
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setUrl(r.absoluteUrl);
      } catch (e) {
        if (ac.signal.aborted) {
          if (timedOut && !cleanedUp) {
            setError("解析地址超时（90s），请检查网络或在素材库使用「下载」。");
          }
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        window.clearTimeout(timer);
        setLoading(false);
      }
    })();
    return () => {
      cleanedUp = true;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [apiBaseUrl, enabled, fileId, filename, materialId, token]);

  return { streamUrl: url, streamLoading: loading, streamError: error };
}
