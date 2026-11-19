import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getApiBaseUrl } from "@/lib/apiClient";
import { loadAuthSession } from "@/lib/auth";
import { getBootCacheRoot, usesNextApiProxyMode } from "@/lib/bootConfig";
import {
  checkDesktopAppUpdates,
  downloadDesktopAppUpdate,
  getDesktopAppVersion,
  quitAndInstallDesktopUpdate,
  subscribeDesktopAppUpdateStatus,
  type AppUpdateStatus,
} from "@/lib/appUpdate";
import { getMetadataSyncStats, runDesktopMetadataSync, type MetadataSyncProgress } from "@/lib/metadataSync";
import { defaultCacheRootForPlatform, loadDesktopSettings, saveDesktopSettings } from "@/lib/settingsStore";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export default function DesktopSettingsPage() {
  const [cacheRoot, setCacheRoot] = useState("");
  const [materialAssetsRoot, setMaterialAssetsRoot] = useState("");
  const [defaultMaterialAssetsRoot, setDefaultMaterialAssetsRoot] = useState("");
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [metaStats, setMetaStats] = useState<{ materialCount: number; fileCount: number; lastSyncedAt: string | null } | null>(
    null
  );
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updatePhase, setUpdatePhase] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    const s = loadDesktopSettings();
    setCacheRoot(s.cacheRoot || getBootCacheRoot() || defaultCacheRootForPlatform());
    setLoggedIn(Boolean(loadAuthSession()?.access_token));
    void (async () => {
      if (window.desktopClient?.getDesktopLocalSettings) {
        try {
          const local = await window.desktopClient.getDesktopLocalSettings();
          setMaterialAssetsRoot(local.material_assets_root || local.nasMountRoot || "");
          setDefaultMaterialAssetsRoot(local.defaultMaterialAssetsRoot || local.defaultNasMountRoot || "");
          setMetaStats(local.metadata);
        } catch {
          /* ignore */
        }
      } else {
        const stats = await getMetadataSyncStats();
        if (stats) setMetaStats(stats);
      }
    })();
    void (async () => {
      const v = await getDesktopAppVersion();
      if (v?.version) setAppVersion(v.version);
    })();
    const unsub = subscribeDesktopAppUpdateStatus((s: AppUpdateStatus) => {
      setUpdatePhase(s.phase);
      setUpdateStatus(s.message);
    });
    return () => unsub();
  }, []);

  async function testConnection() {
    const base = normalizeBase(getApiBaseUrl());
    if (!base) {
      setMessage("未配置请求根：请在 local.settings.json 中填写 webOrigin 或 apiBaseUrl，或在 local-env.bat 中设置 LCP_WEB_ORIGIN 或 LCP_API_BASE_URL 后重启。");
      return;
    }
    setMessage("");
    try {
      const resp = await fetch(`${base}/health`, { cache: "no-store" });
      const data = (await resp.json()) as { status?: string; version?: string };
      if (!resp.ok) throw new Error(`${resp.status}`);
      setHealth(`状态 ${data.status ?? "ok"} · 版本 ${data.version ?? "—"}`);
      setMessage("连接成功。");
    } catch {
      setHealth("");
      setMessage("无法访问 /health，请检查地址与网络。");
    }
  }

  async function save() {
    const prev = loadDesktopSettings();
    saveDesktopSettings({
      ...prev,
      cacheRoot: cacheRoot.trim(),
    });
    if (window.desktopClient?.saveDesktopLocalSettings) {
      await window.desktopClient.saveDesktopLocalSettings({
        material_assets_root: materialAssetsRoot.trim(),
        nasMountRoot: materialAssetsRoot.trim(),
      });
    }
    setMessage("已保存本机配置（material_assets_root + HTTP 缓存目录）。");
  }

  function useDefaultCache() {
    setCacheRoot(defaultCacheRootForPlatform());
  }

  function useDefaultMaterialAssetsRoot() {
    if (defaultMaterialAssetsRoot) setMaterialAssetsRoot(defaultMaterialAssetsRoot);
  }

  async function syncMetadata() {
    if (!loggedIn) {
      setMessage("请先登录后再同步元数据。");
      return;
    }
    setSyncBusy(true);
    setSyncProgress("准备同步…");
    setMessage("");
    try {
      const stats = await runDesktopMetadataSync((p: MetadataSyncProgress) => {
        setSyncProgress(p.message);
      });
      setMetaStats(stats);
      setMessage(`元数据同步完成：${stats.materialCount} 条素材，${stats.fileCount} 条 NAS 路径。`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
      setSyncProgress("");
    }
  }

  async function handleCheckUpdates() {
    setUpdateBusy(true);
    setMessage("");
    try {
      const r = await checkDesktopAppUpdates();
      if (!r.ok) setMessage(r.message || "检查更新失败");
      else if (!updateStatus) setMessage(r.updateInfo?.version ? `服务端版本 ${r.updateInfo.version}` : "已发起检查，请看下方状态");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleDownloadUpdate() {
    setUpdateBusy(true);
    try {
      const r = await downloadDesktopAppUpdate();
      if (!r.ok) setMessage(r.message || "下载更新失败");
    } finally {
      setUpdateBusy(false);
    }
  }

  function handleInstallUpdate() {
    void quitAndInstallDesktopUpdate();
  }

  const apiDisplay = normalizeBase(getApiBaseUrl());
  const isElectron = Boolean(typeof window !== "undefined" && window.desktopClient);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-white">本机连接与缓存</h1>
        <div className="flex gap-2 text-xs">
          <Link to="/login" className="text-sky-400 hover:text-sky-300">
            返回登录
          </Link>
          {loggedIn ? (
            <Link to="/materials" className="text-sky-400 hover:text-sky-300">
              进入素材库
            </Link>
          ) : null}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-5 backdrop-blur-xl">
        <p className="text-xs text-slate-400">
          {usesNextApiProxyMode()
            ? "当前为与 Web 一致模式：请求根为 Next 站点下的 /api-proxy（由 LCP_WEB_ORIGIN 或 local.settings.json 的 webOrigin 决定），由 next.config 转发到 FastAPI。修改后需重启 Vite/Electron，并保证 Next 已启动。"
            : "当前为直连 FastAPI 模式：请求根由 local.settings.json 的 apiBaseUrl 或 LCP_API_BASE_URL 提供。若要与 Web 完全一致，请配置 LCP_WEB_ORIGIN 并启动 frontend。"}{" "}
          缓存目录保存在本机 localStorage；NAS 挂载根保存在 Electron 用户目录。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-300">当前请求根（只读）</p>
            {apiDisplay ? (
              <p className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-xs text-sky-200">{apiDisplay}</p>
            ) : (
              <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                未配置。请复制 <span className="font-mono">local.settings.example.json</span> 为 <span className="font-mono">local.settings.json</span>，或复制{" "}
                <span className="font-mono">local-env.example.bat</span> 为 <span className="font-mono">local-env.bat</span>（配置{" "}
                <span className="font-mono">LCP_WEB_ORIGIN</span> 或 <span className="font-mono">LCP_API_BASE_URL</span>）后重新启动。
              </p>
            )}
          </div>
          {isElectron ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">material_assets_root（NAS 素材根，直拖剪映）</label>
                <input
                  className="w-full rounded-lg border border-slate-600 px-3 py-2 font-mono text-xs"
                  value={materialAssetsRoot}
                  onChange={(e) => setMaterialAssetsRoot(e.target.value)}
                  placeholder="\\\\YOUR_NAS_HOST\\nas-file\\material-assets"
                />
                <button type="button" className="mt-1 text-xs text-sky-400 hover:text-sky-300" onClick={useDefaultMaterialAssetsRoot}>
                  使用当前平台默认路径
                </button>
                <p className="mt-1 text-xs text-slate-500">
                  局域网<strong>每台电脑</strong>请填本机可打开的 UNC（如 \\YOUR_NAS_HOST\nas-file\material-assets），勿填仅个别机器才有的 Z: 盘符。保存后请同步元数据再拖放。
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-300">应用更新（GitHub Releases）</p>
                <p className="text-xs text-slate-400">
                  当前版本 {appVersion || "—"}
                  {updateStatus ? ` · ${updateStatus}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={updateBusy}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-40"
                    onClick={() => void handleCheckUpdates()}
                  >
                    检查更新
                  </button>
                  <button
                    type="button"
                    disabled={updateBusy || updatePhase !== "available"}
                    className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-600/20 disabled:opacity-40"
                    onClick={() => void handleDownloadUpdate()}
                  >
                    下载更新
                  </button>
                  <button
                    type="button"
                    disabled={updatePhase !== "downloaded"}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
                    onClick={handleInstallUpdate}
                  >
                    重启并安装
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">仅打包安装版可用；私有仓库需打包时写入更新凭据。更新来自 GitHub Releases。</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-300">素材元数据本机索引</p>
                <p className="text-xs text-slate-400">
                  {metaStats
                    ? `已缓存 ${metaStats.materialCount} 条素材 · ${metaStats.fileCount} 条 NAS 路径${
                        metaStats.lastSyncedAt ? ` · 上次同步 ${metaStats.lastSyncedAt}` : ""
                      }`
                    : "尚未同步。登录后拉取 file_relative_path 与标签（非整库 PostgreSQL）。"}
                </p>
                {syncProgress ? <p className="mt-1 text-xs text-sky-300">{syncProgress}</p> : null}
                <button
                  type="button"
                  disabled={syncBusy || !loggedIn}
                  className="mt-2 rounded-lg border border-sky-500/40 bg-sky-600/20 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-600/35 disabled:opacity-40"
                  onClick={() => void syncMetadata()}
                >
                  {syncBusy ? "同步中…" : "同步素材元数据"}
                </button>
              </div>
            </>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">HTTP 兜底缓存根目录</label>
            <input className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm" value={cacheRoot} onChange={(e) => setCacheRoot(e.target.value)} placeholder={defaultCacheRootForPlatform()} />
            <button type="button" className="mt-1 text-xs text-sky-400 hover:text-sky-300" onClick={useDefaultCache}>
              使用当前平台默认路径
            </button>
            <p className="mt-1 text-xs text-slate-500">SMB 不可用时的 HTTP 下载落盘目录（后续主进程缓存 IPC
            将写入此路径）。</p>
          </div>
          {health ? <p className="text-xs text-emerald-300">{health}</p> : null}
          {message ? <p className="text-xs text-amber-100">{message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-slate-600 px-4 py-2 text-sm text-white hover:bg-slate-500" onClick={testConnection}>
              测试连接
            </button>
            <button type="button" className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500" onClick={() => void save()}>
              保存
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
