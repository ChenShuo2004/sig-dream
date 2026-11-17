import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiJson } from "@/lib/apiClient";
import { clearAuthSession, loadAuthSession } from "@/lib/auth";

/** 与 `frontend/app/login/page.tsx` 已登录态改密：同一接口与校验语义；桌面独立路由 `#/account/change-password`。 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [sessionRole, setSessionRole] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const session = loadAuthSession();
    if (session?.access_token) {
      setUsername(session.username);
      setSessionRole(session.role);
      setMessage(`已登录：${session.username}（${session.role}）。请填写原密码与新密码。`);
    } else {
      setUsername("");
      setSessionRole("");
    }
    setAuthChecked(true);
  }, []);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const session = loadAuthSession();
    if (!session) {
      setMessage("请先登录");
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
      const data = await apiJson<{ message?: string }>("/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: cur, new_password: newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      const raw = typeof data.message === "string" ? data.message : "";
      if (raw === "Password updated successfully") {
        setMessage("密码修改成功");
      } else {
        setMessage(raw || "密码修改成功");
      }
    } catch (error) {
      let msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Current password is incorrect")) msg = "原密码不正确，请重新输入";
      setMessage(`修改密码失败\n${msg}`);
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    clearAuthSession();
    void navigate("/login", { replace: true });
  }

  if (!authChecked) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-400">
        加载中…
      </main>
    );
  }

  const session = loadAuthSession();
  if (!session?.access_token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-6 backdrop-blur-xl">
        <h1 className="text-xl font-semibold text-white">修改密码</h1>
        <p className="mt-2 text-sm text-slate-400">
          当前账号：<span className="font-medium text-slate-200">{username}</span>
          {sessionRole ? `（${sessionRole}）` : null}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          提交前须填写<strong className="font-medium text-slate-300">原密码</strong>，服务端校验通过后才会更新为新密码（与 Web 账号中心一致）。
        </p>
        <form onSubmit={onChangePassword} className="mt-6 grid gap-4">
          <label className="grid gap-1 text-xs font-medium text-slate-300">
            原密码（核实身份）
            <input
              className="rounded-lg border border-slate-600 bg-slate-950/50 px-3 py-2 text-sm text-white"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入当前登录密码"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-300">
            新密码（至少 6 位）
            <input
              className="rounded-lg border border-slate-600 bg-slate-950/50 px-3 py-2 text-sm text-white"
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
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "提交中…" : "提交修改"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-500 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              onClick={() => onLogout()}
            >
              退出账号
            </button>
            <Link
              to="/materials"
              className="inline-flex items-center rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
            >
              返回素材库
            </Link>
          </div>
        </form>
      </div>
      {message.trim() ? (
        <p className="mt-6 rounded-lg border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-emerald-100 whitespace-pre-wrap">{message}</p>
      ) : null}
    </main>
  );
}
