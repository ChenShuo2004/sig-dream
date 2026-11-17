import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getBootApiBaseUrl } from "@/lib/bootConfig";
import { loadAuthSession } from "@/lib/auth";

function canvasAppUrl() {
  const base = getBootApiBaseUrl();
  if (!base.includes("/api-proxy")) return "";
  return `${base.replace(/\/api-proxy$/, "")}/canvas-app/index.html?v=20261104songq`;
}

function canUseCanvas(role: string) {
  return role === "super_admin" || role === "material_admin";
}

export default function CanvasPage() {
  const [role, setRole] = useState<string | null>(null);
  const src = canvasAppUrl();

  useEffect(() => {
    setRole(loadAuthSession()?.role || "");
  }, []);

  if (role === null) {
    return <div className="grid h-dvh place-items-center text-sm text-slate-300">正在确认权限…</div>;
  }

  if (!canUseCanvas(role)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-sm leading-6 text-slate-300">
        <h1 className="text-xl font-semibold text-white">画布</h1>
        <p className="mt-3">需要登录，且角色为素材管理员或超级管理员。</p>
        <Link to="/" className="mt-4 inline-block text-sky-400 underline">
          返回首页
        </Link>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-sm leading-6 text-slate-300">
        画布挂在 Web 平台上。请把桌面端请求根配成 Next 站点的 <span className="font-mono">/api-proxy</span> 后再打开。
      </div>
    );
  }
  return <iframe title="画布" src={src} className="block h-dvh w-full border-0 bg-slate-950" />;
}
