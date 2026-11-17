"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { clearAuthSession, loadAuthSession, saveAuthSession } from "@/lib/auth";

type LoginResponse = {
  access_token: string;
  role: string;
};

type MeResponse = {
  username: string;
  role: string;
  permissions: string[];
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatChangePasswordError(data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    if (typeof d === "string") {
      if (d === "Current password is incorrect") return "原密码不正确，请重新输入";
      return d;
    }
    if (Array.isArray(d)) {
      return d.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg: unknown }).msg) : pretty(x))).join("\n");
    }
  }
  return pretty(data);
}

export default function LoginPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [sessionRole, setSessionRole] = useState("");
  const [message, setMessage] = useState("");
  const [redirectTo, setRedirectTo] = useState("/materials");
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    const authRequired = params.get("auth") === "required";
    const nextPath = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/materials";
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
      setRedirectTo(nextPath);
    }
    const session = loadAuthSession();
    if (!session?.access_token) {
      setLoggedIn(false);
      if (authRequired) setMessage("请先登录后访问页面。");
      setAuthChecked(true);
      return;
    }
    void (async () => {
      try {
        const resp = await fetch(`${apiBaseUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${session.access_token}`, "X-Access-Context": "internal" },
        });
        if (cancelled) return;
        if (!resp.ok) {
          clearAuthSession();
          setLoggedIn(false);
          setUsername("");
          setSessionRole("");
          setMessage("登录已过期，请重新登录。");
          setAuthChecked(true);
          return;
        }
        const me = (await resp.json()) as MeResponse;
        if (cancelled) return;
        if (authRequired) {
          saveAuthSession({
            access_token: session.access_token,
            username: me.username,
            role: me.role,
            permissions: me.permissions || [],
          });
          window.location.href = nextPath;
          return;
        }
        setUsername(me.username);
        setSessionRole(me.role);
        setLoggedIn(true);
        setMessage(`已登录：${me.username}（${me.role}）。请填写原密码与新密码。`);
        setAuthChecked(true);
      } catch {
        if (cancelled) return;
        setLoggedIn(false);
        setMessage("暂时无法确认登录状态，请重新登录。");
        setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const loginResp = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const loginData = (await loginResp.json()) as LoginResponse | { detail?: unknown };
      if (!loginResp.ok) throw new Error(pretty(loginData));

      const token = (loginData as LoginResponse).access_token;
      const meResp = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, "X-Access-Context": "internal" },
      });
      const meData = (await meResp.json()) as MeResponse | { detail?: unknown };
      if (!meResp.ok) throw new Error(pretty(meData));
      const me = meData as MeResponse;

      saveAuthSession({ access_token: token, username: me.username, role: me.role, permissions: me.permissions || [] });
      setLoggedIn(true);
      setSessionRole(me.role);
      setMessage(`登录成功：${me.username} (${me.role})`);
      // Force full reload so global header/session state updates immediately.
      window.location.href = redirectTo;
    } catch (error) {
      setMessage(`登录失败\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    clearAuthSession();
    window.location.href = "/login";
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const session = loadAuthSession();
    if (!session) {
      setMessage("请先登录");
      setLoggedIn(false);
      return;
    }
    const cur = currentPassword.trim();
    if (!cur) {
      setMessage("请输入原密码以核实身份。");
      return;
    }
    if (newPassword.length < 6) {
      setMessage("新密码至少 6 位。");
      return;
    }
    if (cur === newPassword) {
      setMessage("新密码不能与原密码相同。");
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ current_password: cur, new_password: newPassword }),
      });
      const data = (await resp.json()) as { message?: string; detail?: unknown };
      if (!resp.ok) throw new Error(formatChangePasswordError(data));
      setCurrentPassword("");
      setNewPassword("");
      setMessage(typeof data.message === "string" ? data.message : "密码修改成功");
    } catch (error) {
      setMessage(`修改密码失败\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-600">
        加载中…
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element -- 品牌标静态 SVG */}
            <img src="/brand/youwendu-mark-black.svg" alt="" className="h-7 w-auto" />
            账号中心
          </h1>
          <p className="mt-2 text-sm text-slate-600">登录后可访问素材管理；登录后可通过顶栏「修改密码」进入修改密码页面。</p>
          <form onSubmit={onLogin} className="mt-6 grid gap-3" autoComplete="off">
            <label className="grid gap-1 text-sm">
              用户名
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="grid gap-1 text-sm">
              密码
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                登录
              </button>
            </div>
          </form>
        </section>
        {message.trim() ? (
          <pre className="mt-6 rounded-xl bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{message}</pre>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">修改密码</h1>
        <p className="mt-2 text-sm text-slate-600">
          当前账号：<span className="font-medium text-slate-800">{username}</span>
          {sessionRole ? `（${sessionRole}）` : null}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          提交前须填写<strong className="font-medium text-slate-700">原密码</strong>，服务端会校验通过后才更新为新密码。
        </p>
        <form onSubmit={onChangePassword} className="mt-6 grid gap-3">
          <label className="grid gap-1 text-sm">
            原密码（核实身份）
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入当前登录密码"
            />
          </label>
          <label className="grid gap-1 text-sm">
            新密码（至少 6 位）
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              提交修改
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              onClick={() => onLogout()}
            >
              退出账号
            </button>
          </div>
        </form>
      </section>
      {message.trim() ? (
        <pre className="mt-6 rounded-xl bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{message}</pre>
      ) : null}
    </main>
  );
}
