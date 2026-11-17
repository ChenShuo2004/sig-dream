import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TOOLBOX_DEFAULT_FPS,
  TOOLBOX_LARGE_FILE_WARN_BYTES,
  TOOLBOX_MAX_CLIP_SEC,
  TOOLBOX_MAX_FRAMES,
  TOOLBOX_MAX_FPS,
  TOOLBOX_MAX_OUTPUT_WIDTH,
} from "@/lib/toolbox/constants";
import { downloadBlob, generateVideoGif, validateVideoToGifParams } from "@/lib/toolbox/videoToGif";

function formatSec(sec: number) {
  if (!Number.isFinite(sec)) return "0.00";
  return sec.toFixed(2);
}

function baseName(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export default function VideoToGifTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(TOOLBOX_MAX_CLIP_SEC);
  const [fps, setFps] = useState(TOOLBOX_DEFAULT_FPS);
  const [maxWidth, setMaxWidth] = useState(TOOLBOX_MAX_OUTPUT_WIDTH);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState("选择本机视频文件，设置截取区间后生成 GIF。");
  const [warnLargeFile, setWarnLargeFile] = useState(false);

  const clipSec = Math.max(0, endSec - startSec);
  const validation = useMemo(
    () => validateVideoToGifParams(startSec, endSec, fps, duration || undefined),
    [startSec, endSec, fps, duration],
  );
  const frameCount = validation.frameCount ?? 0;

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    revokeObjectUrl();
    abortRef.current?.abort();
  }, [revokeObjectUrl]);

  function clampRange(nextStart: number, nextEnd: number, videoDuration: number) {
    const d = videoDuration > 0 ? videoDuration : TOOLBOX_MAX_CLIP_SEC;
    let s = Math.max(0, Math.min(nextStart, d));
    let e = Math.max(0, Math.min(nextEnd, d));
    if (e <= s) e = Math.min(d, s + 0.1);
    if (e - s > TOOLBOX_MAX_CLIP_SEC) e = s + TOOLBOX_MAX_CLIP_SEC;
    return { s, e };
  }

  function onPickFile(f: File | null) {
    revokeObjectUrl();
    abortRef.current?.abort();
    setFile(f);
    setDuration(0);
    setProgress(null);
    setBusy(false);
    if (!f) {
      setMessage("选择本机视频文件，设置截取区间后生成 GIF。");
      setWarnLargeFile(false);
      return;
    }
    setWarnLargeFile(f.size > TOOLBOX_LARGE_FILE_WARN_BYTES);
    const url = URL.createObjectURL(f);
    objectUrlRef.current = url;
    setMessage(`已选择：${f.name}`);
  }

  function onVideoLoaded() {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const d = v.duration;
    setDuration(d);
    const { s, e } = clampRange(0, Math.min(TOOLBOX_MAX_CLIP_SEC, d), d);
    setStartSec(s);
    setEndSec(e);
    setMaxWidth(Math.min(TOOLBOX_MAX_OUTPUT_WIDTH, v.videoWidth || TOOLBOX_MAX_OUTPUT_WIDTH));
    setMessage(`视频时长 ${formatSec(d)} 秒。请调整截取区间（最多 ${TOOLBOX_MAX_CLIP_SEC} 秒）。`);
  }

  function cancelGenerate() {
    abortRef.current?.abort();
    setBusy(false);
    setProgress(null);
    setMessage("已取消生成。");
  }

  async function onGenerate() {
    const v = videoRef.current;
    if (!v || !file) {
      setMessage("请先选择视频文件。");
      return;
    }
    if (!validation.ok) {
      setMessage(validation.message || "参数无效");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setProgress({ done: 0, total: frameCount });
    setMessage("正在生成 GIF，请稍候…");
    try {
      const blob = await generateVideoGif({
        video: v,
        startSec,
        endSec,
        fps,
        maxOutputWidth: showAdvanced
          ? Math.min(TOOLBOX_MAX_OUTPUT_WIDTH, Math.max(64, maxWidth))
          : v.videoWidth || TOOLBOX_MAX_OUTPUT_WIDTH,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const name = `${baseName(file.name)}_${formatSec(startSec)}-${formatSec(endSec)}.gif`;
      downloadBlob(blob, name);
      setMessage(`已生成并下载：${name}（约 ${(blob.size / 1024).toFixed(0)} KB）`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("已取消生成。");
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 sm:px-6 2xl:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <Link to="/toolbox" className="text-sky-400 hover:text-sky-300">
          工具箱
        </Link>
        <span>/</span>
        <span className="text-slate-200">视频片段转 GIF</span>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
        <h1 className="text-xl font-semibold text-white">视频片段转 GIF</h1>
        <p className="mt-1 text-xs text-slate-300">
          在本机浏览器中处理，不上传服务器。截取最多 {TOOLBOX_MAX_CLIP_SEC} 秒，帧数最多 {TOOLBOX_MAX_FRAMES} 帧。
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">视频文件</label>
            <input
              type="file"
              accept="video/*"
              disabled={busy}
              className="mt-1 block w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-sky-500"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            {warnLargeFile ? (
              <p className="mt-1 text-xs text-amber-300">文件较大，加载与抽帧可能较慢，但不限制选择与截取规则。</p>
            ) : null}
          </div>

          {objectUrlRef.current ? (
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
              <video
                ref={videoRef}
                src={objectUrlRef.current}
                className="max-h-[320px] w-full bg-black object-contain"
                controls
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={onVideoLoaded}
              />
            </div>
          ) : null}

          {duration > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-300">
                  开始（秒）
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    disabled={busy}
                    value={startSec}
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm text-white"
                    onChange={(e) => {
                      const { s, e: en } = clampRange(Number(e.target.value), endSec, duration);
                      setStartSec(s);
                      setEndSec(en);
                    }}
                  />
                </label>
                <label className="block text-xs text-slate-300">
                  结束（秒）
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    disabled={busy}
                    value={endSec}
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm text-white"
                    onChange={(e) => {
                      const { s, e: en } = clampRange(startSec, Number(e.target.value), duration);
                      setStartSec(s);
                      setEndSec(en);
                    }}
                  />
                </label>
              </div>

              <p className="text-xs text-slate-400">
                片段时长：<span className={clipSec > TOOLBOX_MAX_CLIP_SEC ? "text-amber-300" : "text-slate-200"}>{formatSec(clipSec)}</span> 秒
                · 预计帧数：<span className={!validation.ok ? "text-amber-300" : "text-slate-200"}>{frameCount}</span>
                · 帧率：{fps} fps
              </p>

              <label className="block text-xs text-slate-300">
                帧率（fps，默认 {TOOLBOX_DEFAULT_FPS}，最大 {TOOLBOX_MAX_FPS}）
                <input
                  type="range"
                  min={1}
                  max={TOOLBOX_MAX_FPS}
                  step={1}
                  disabled={busy}
                  value={fps}
                  className="mt-2 w-full accent-sky-500"
                  onChange={(e) => setFps(Number(e.target.value))}
                />
              </label>

              <button
                type="button"
                className="text-xs text-sky-400 hover:text-sky-300"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "收起高级选项" : "高级选项（输出宽度上限）"}
              </button>

              {showAdvanced ? (
                <label className="block text-xs text-slate-300">
                  输出宽度上限（px，最大 {TOOLBOX_MAX_OUTPUT_WIDTH}，高等比缩放）
                  <input
                    type="number"
                    min={64}
                    max={TOOLBOX_MAX_OUTPUT_WIDTH}
                    disabled={busy}
                    value={maxWidth}
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm text-white"
                    onChange={(e) => setMaxWidth(Number(e.target.value))}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !file || !validation.ok}
              onClick={() => void onGenerate()}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "生成中…" : "生成并下载 GIF"}
            </button>
            {busy ? (
              <button
                type="button"
                onClick={cancelGenerate}
                className="rounded-md border border-white/20 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                取消
              </button>
            ) : null}
          </div>

          {progress ? (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">
                {progress.done} / {progress.total} 帧
              </p>
            </div>
          ) : null}

          <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">{message}</p>
        </div>
      </div>
    </main>
  );
}
