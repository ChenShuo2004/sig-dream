"use client";

import { useEffect, useState } from "react";

import { pickReachableMediaUrl } from "@/lib/materialBrowserDownload";
import { thumbnailAccessContextHeaders } from "@/lib/thumbnailAccessContext";

type Args = {
  apiBaseUrl: string;
  materialId: string | null | undefined;
  fileId: string | null | undefined;
  enabled: boolean;
  token: string;
};

const POLL_MS = 3_000;
const GIVE_UP_MS = 90_000;

function toAbsoluteUrl(apiBaseUrl: string, maybeRelativeUrl: string): string {
  if (!maybeRelativeUrl) return "";
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  return `${apiBaseUrl.replace(/\/$/, "")}${maybeRelativeUrl}`;
}

/**
 * 浏览器内嵌播放优先走 H.264 预览片 `GET .../preview-video-url`（asset.view）。
 * HTTPS 站点用 public 上下文，避免拿到 http 局域网地址被混合内容拦截。
 */
export function useMaterialPreviewVideoUrl(args: Args) {
  const { apiBaseUrl, materialId, fileId, enabled, token } = args;
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
    const mid = materialId.trim();
    const fid = fileId.trim();
    let stopped = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setUrl(null);

    async function pull(): Promise<"ready" | "pending" | "failed"> {
      const resp = await fetch(
        `${apiBaseUrl}/materials/${mid}/files/${fid}/preview-video-url`,
        {
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            ...thumbnailAccessContextHeaders(),
          },
          signal: ac.signal,
        }
      );
      const data = (await resp.json()) as {
        status?: string;
        url?: string | null;
        alternate_urls?: string[] | null;
        message?: string | null;
        detail?: unknown;
      };
      if (!resp.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(data));
      }
      if (data.status === "ready" && data.url) {
        const abs = toAbsoluteUrl(apiBaseUrl, data.url);
        const alts = (data.alternate_urls || []).map((u) => toAbsoluteUrl(apiBaseUrl, u));
        const picked = await pickReachableMediaUrl([abs, ...alts], ac.signal);
        if (!picked) {
          return "pending";
        }
        setUrl(picked);
        return "ready";
      }
      if (data.status === "failed") {
        setError(data.message || "预览视频不可用");
        return "failed";
      }
      return "pending";
    }

    void (async () => {
      const started = Date.now();
      try {
        let state = await pull();
        while (!stopped && state === "pending" && Date.now() - started < GIVE_UP_MS) {
          await new Promise((r) => window.setTimeout(r, POLL_MS));
          if (stopped) return;
          state = await pull();
        }
        if (!stopped && state === "pending") {
          setError("预览片准备超时，请稍后重试或下载原文件。");
        }
      } catch (e) {
        if (!ac.signal.aborted && !stopped) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    })();

    return () => {
      stopped = true;
      ac.abort();
    };
  }, [apiBaseUrl, enabled, fileId, materialId, token]);

  return { previewUrl: url, previewLoading: loading, previewError: error };
}
