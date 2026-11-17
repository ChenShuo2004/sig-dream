import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { fetchWithBase, getApiBaseUrl } from "@/lib/apiClient";
import { saveAuthSession } from "@/lib/auth";
import { getBootServerOrigin, usesNextApiProxyMode } from "@/lib/bootConfig";

type LoginResponse = { access_token: string; role: string };
type MeResponse = { username: string; role: string; permissions: string[] };

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [serverOrigin, setServerOrigin] = useState(() => getBootServerOrigin());
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const canSaveServer = typeof window !== "undefined" && Boolean(window.desktopClient?.saveServerOrigin);

  async function onSaveServer(e: FormEvent) {
    e.preventDefault();
    if (!window.desktopClient?.saveServerOrigin) return;
    setServerBusy(true);
    setServerMessage("");
    try {
      const r = await window.desktopClient.saveServerOrigin(serverOrigin);
      if (!r.ok) {
        setServerMessage(r.message || "保存失败");
        return;
      }
      window.location.reload();
    } finally {
      setServerBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const base = normalizeBase(getApiBaseUrl());
    if (!base) {
      setMessage(
        "未检测到请求根地址：请在 desktop-client 下配置 local.settings.json（webOrigin 或 apiBaseUrl），或 local-env.bat 中设置 LCP_WEB_ORIGIN（与 Web 一致走 /api-proxy）或 LCP_API_BASE_URL（直连 FastAPI）后重新一键启动。"
      );
      return;
    }
    if (!username.trim() || !password) {
      setMessage("请输入用户名和密码。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const loginResp = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const ct = loginResp.headers.get("content-type") || "";
      let loginData: (LoginResponse & { detail?: unknown }) | null = null;
      try {
        loginData = ct.includes("application/json") ? ((await loginResp.json()) as LoginResponse & { detail?: unknown }) : null;
      } catch {
        loginData = null;
      }
      if (!loginResp.ok) {
        if (loginResp.status === 404) {
          const viaProxy = base.includes("/api-proxy");
          throw new Error(
            viaProxy
              ? "返回 404：当前地址上可能没有 Next 的 /api-proxy 或未转发到后端。请确认 LCP_WEB_ORIGIN 为 Next 站点根（如 http://127.0.0.1:3000）、已在 frontend 目录启动 npm run dev，且 next.config 中 /api-proxy 仍指向 FastAPI。"
              : "返回 404：当前根地址上没有 /auth/login。请把 LCP_API_BASE_URL（或 local.settings.json 的 apiBaseUrl）设为 FastAPI 根地址，不要填 NAS 文件机的 :9001 等上传/下载服务地址；若要与 Web 完全一致，可改用 LCP_WEB_ORIGIN + /api-proxy 模式。"
          );
        }
        const d = loginData?.detail;
        throw new Error(typeof d === "string" ? d : d != null ? JSON.stringify(d) : `${loginResp.status} ${loginResp.statusText}`);
      }
      if (!loginData?.access_token) {
        throw new Error("登录响应异常：未返回 access_token。");
      }
      const token = loginData.access_token;
      const meResp = await fetchWithBase(base, "/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meData = (await meResp.json()) as MeResponse & { detail?: unknown };
      if (!meResp.ok) {
        throw new Error(typeof meData.detail === "string" ? meData.detail : JSON.stringify(meData.detail ?? meData));
      }
      saveAuthSession({
        access_token: token,
        username: meData.username,
        role: meData.role,
        permissions: Array.isArray(meData.permissions) ? meData.permissions : [],
      });
      setMessage("登录成功，正在进入素材库…");
      void navigate("/materials", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const net =
        raw === "Failed to fetch" ||
        raw.includes("NetworkError") ||
        (err instanceof TypeError && raw.toLowerCase().includes("fetch"));
      if (net) {
        const viaProxy = usesNextApiProxyMode();
        setMessage(
          viaProxy
            ? `无法连接到 ${base}（网络层失败）。请在本机启动 Next 前端（常见 cd frontend && npm run dev，监听 :3000），并确认 LCP_WEB_ORIGIN 与该站点根地址一致；桌面端请求路径与 Web 相同，均为「Next 站点根」下的 /api-proxy/*。`
            : `无法连接到 ${base}（网络层失败，常见为连接被拒绝）。请在本机启动 FastAPI（常见 :8000），或把 LCP_API_BASE_URL 改为可达的后端根；若要与 Web 一致经 Next 转发，可配置 LCP_WEB_ORIGIN 并启动 frontend。`
        );
      } else {
        setMessage(raw);
      }
    } finally {
      setBusy(false);
    }
  }

  const configuredBase = normalizeBase(getApiBaseUrl());

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-md flex-1 flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-6 backdrop-blur-xl">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
          <img src="/brand/youwendu-mark-white.svg" alt="" className="h-6 w-auto" />
          登录
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          {usesNextApiProxyMode()
            ? "与 Web 相同：请求发往 Next 的 /api-proxy，由 next.config 转发到 FastAPI。请保证 LCP_WEB_ORIGIN 指向已启动的 Next 站点（常见本机 :3000）。"
            : "直连 FastAPI 根地址（与 Web 的 /api-proxy 转发目标一致）。勿填 NAS 文件机的 :9001。若要与 Web 完全一致，可在 local-env.bat 中设置 LCP_WEB_ORIGIN 并启动 frontend。"}
        </p>
        {configuredBase ? (
          <p className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
            当前请求根：<span className="font-mono text-sky-200">{configuredBase}</span>
          </p>
        ) : (
          <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            尚未配置 API。请查看下方「本机连接与缓存」中的说明，或复制示例文件后重启应用。
          </p>
        )}
        {canSaveServer ? (
          <form className="mt-4 space-y-2" onSubmit={onSaveServer}>
            <label className="block text-xs font-medium text-slate-300">服务器地址</label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-slate-600 px-3 py-2 text-sm"
                placeholder="https://your-team.example.com"
                value={serverOrigin}
                onChange={(e) => setServerOrigin(e.target.value)}
                inputMode="url"
                autoComplete="url"
              />
              <button
                type="submit"
                disabled={serverBusy}
                className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                {serverBusy ? "保存中…" : "保存"}
              </button>
            </div>
            <p className="text-xs text-slate-500">填写团队部署的网站地址（与浏览器访问的地址相同）；留空则使用本机默认 http://127.0.0.1:8000。</p>
            {serverMessage ? <p className="text-xs text-amber-200">{serverMessage}</p> : null}
          </form>
        ) : null}
        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">用户名</label>
            <input
              className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">密码</label>
            <input
              className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {message ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 whitespace-pre-wrap">{message}</p>
          ) : null}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to="/desktop/app-config" className="text-sky-400 hover:text-sky-300">
            本机连接与缓存（Web 无此独立页）
          </Link>
        </p>
      </div>
    </main>
  );
}
