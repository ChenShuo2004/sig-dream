import { useEffect, useState } from "react";

import { materialDownloadAuthHeaders } from "@/lib/materialDownloadAuth";
import { resolveMaterialDownload } from "@/lib/materialBrowserDownload";

type Args = {
  apiBaseUrl: string;
  materialId: string | null | undefined;
  fileId: string | null | undefined;
  filename: string;
  enabled: boolean;
  token: string;
};

const RESOLVE_TIMEOUT_MS = 90_000;

/**
 * 与下载选路一致解析主文件直链：供 `<video src>` 或灯箱原图 `<img src>`（文件机多支持 Range）。
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
          authHeaders: materialDownloadAuthHeaders,
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setUrl(r.absoluteUrl);
      } catch (e) {
        if (ac.signal.aborted) {
          if (timedOut && !cleanedUp) {
            setError("解析地址超时（90s），请检查网络或稍后重试（选择目录保存 / 拖出保存）。");
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
