"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import TutorialCenterCard from "@/components/tutorials/TutorialCenterCard";
import { loadAuthSession } from "@/lib/auth";
import { fetchTutorialProgress, resetTutorialProgress, type TutorialProgressRow } from "@/lib/tutorialProgressApi";
import { tutorials, type TutorialKey } from "@/lib/tutorials";

export default function TutorialsPage() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [progress, setProgress] = useState<TutorialProgressRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    const s = loadAuthSession();
    setToken(s?.access_token || "");
    setPermissions(s?.permissions || []);
  }, []);

  const reload = useCallback(async () => {
    const s = loadAuthSession();
    if (!s?.access_token) {
      setProgress([]);
      return;
    }
    try {
      setLoadErr(null);
      const rows = await fetchTutorialProgress(s.access_token);
      setProgress(rows);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, token]);

  const byKey = useMemo(() => {
    const m = new Map<TutorialKey, TutorialProgressRow>();
    for (const r of progress) m.set(r.tutorial_key, r);
    return m;
  }, [progress]);

  async function handleReplay(key: TutorialKey) {
    const s = loadAuthSession();
    if (!s?.access_token) return;
    await resetTutorialProgress(s.access_token, key);
    await reload();
    const path = tutorials.find((t) => t.key === key)?.path;
    if (path) window.location.assign(path);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="rounded-2xl border border-white/10 bg-slate-900/55 p-6 text-slate-100 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold">教程中心</h1>
        <p className="mt-2 text-sm text-slate-300">按页面学习系统功能，点击后系统会自动跳转并一步一步引导操作。</p>
        {!token ? (
          <p className="mt-3 text-sm text-amber-200">请先登录后再查看学习进度。</p>
        ) : null}
        {loadErr ? <p className="mt-3 text-sm text-red-300">加载进度失败：{loadErr}</p> : null}
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tutorials.map((t) => (
          <TutorialCenterCard
            key={t.key}
            tutorial={t}
            progress={byKey.get(t.key)}
            permissions={permissions}
            onReplay={() => handleReplay(t.key)}
          />
        ))}
      </div>
    </main>
  );
}
