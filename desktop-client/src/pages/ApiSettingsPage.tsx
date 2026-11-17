import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { loadAuthSession } from "@/lib/auth";
import { getBootApiBaseUrl } from "@/lib/bootConfig";

function apiSettingsUrl() {
  const base = getBootApiBaseUrl();
  if (!base.includes("/api-proxy")) return "";
  return `${base.replace(/\/api-proxy$/, "")}/canvas-app/index.html?v=20261104songq#/config?scope=api`;
}

export default function ApiSettingsPage() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(loadAuthSession()?.role || "");
  }, []);

  if (role === null) {
    return <div className="mx-auto max-w-xl px-6 py-16 text-sm text-slate-300">正在确认权限…</div>;
  }

  if (role !== "super_admin") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-sm leading-6 text-slate-300">
        <h1 className="text-xl font-semibold text-white">API设置</h1>
        <p className="mt-3">仅超级管理员可修改 API 设置。</p>
        <Link to="/" className="mt-4 inline-block text-sky-400 underline">
          返回首页
        </Link>
      </div>
    );
  }

  const src = apiSettingsUrl();
  if (!src) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-sm leading-6 text-slate-300">
        API 设置挂在 Web 平台上。请把桌面端请求根配成 Next 站点的 <span className="font-mono">/api-proxy</span> 后再打开。
      </div>
    );
  }
  return <iframe title="API设置" src={src} className="block h-[calc(100dvh-3.5rem)] w-full border-0 bg-white" />;
}
