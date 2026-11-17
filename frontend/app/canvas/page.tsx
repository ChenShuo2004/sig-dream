"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

function canUseCanvas(role: string) {
  return role === "super_admin" || role === "material_admin";
}

export default function CanvasPage() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(loadAuthSession()?.role || "");
  }, []);

  if (role === null) {
    return <main className="grid h-dvh place-items-center text-sm text-slate-300">正在确认权限…</main>;
  }

  if (!canUseCanvas(role)) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold text-white">画布</h1>
        <p className="mt-3 text-slate-300">需要登录，且角色为素材管理员或超级管理员。</p>
        <Link href="/" className="mt-4 inline-block text-sky-400 underline">
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <iframe
      title="画布"
      src="/canvas-app/index.html?v=20261111chfix"
      className="block h-dvh w-full border-0 bg-slate-950"
    />
  );
}
