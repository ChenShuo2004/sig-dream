"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

export default function ApiSettingsPage() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(loadAuthSession()?.role || "");
  }, []);

  if (role === null) {
    return <main className="mx-auto max-w-5xl p-6 text-slate-300">正在确认权限…</main>;
  }

  if (role !== "super_admin") {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold text-white">API设置</h1>
        <p className="mt-3 text-slate-300">仅超级管理员可修改 API 设置。</p>
        <Link href="/" className="mt-4 inline-block text-sky-400 underline">
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <iframe
      title="API设置"
      src="/canvas-app/index.html?v=20261105songaj#/config?scope=api"
      className="block h-[calc(100dvh-3.5rem)] w-full border-0 bg-white"
    />
  );
}
