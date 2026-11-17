"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

import { BUSINESS_ACCEPTANCE_ITEMS } from "./checklist";

const STORAGE_KEY = "lcp_business_acceptance_checklist_v1";

type RowState = { checked: boolean; note: string };

function loadStates(): Record<string, RowState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, RowState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStates(next: Record<string, RowState>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export default function BusinessAcceptancePage() {
  const [role, setRole] = useState("");
  const [token, setToken] = useState("");
  const [states, setStates] = useState<Record<string, RowState>>({});

  useEffect(() => {
    const s = loadAuthSession();
    setToken(s?.access_token || "");
    setRole(s?.role || "");
    setStates(loadStates());
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof BUSINESS_ACCEPTANCE_ITEMS>();
    for (const item of BUSINESS_ACCEPTANCE_ITEMS) {
      const list = map.get(item.group) || [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<RowState>) => {
    setStates((prev) => {
      const cur = prev[id] || { checked: false, note: "" };
      const next = { ...prev, [id]: { ...cur, ...patch } };
      saveStates(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    if (!window.confirm("确认清空本页所有勾选与备注？（仅本浏览器）")) return;
    setStates({});
    saveStates({});
  }, []);

  if (!token) {
    return <main className="mx-auto max-w-5xl p-6 text-slate-200">请先登录。</main>;
  }

  if (role !== "super_admin") {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold text-white">业务验收测试</h1>
        <p className="mt-3 text-slate-300">仅超级管理员可访问本页。</p>
        <Link href="/" className="mt-4 inline-block text-sky-400 underline">
          返回首页
        </Link>
      </main>
    );
  }

  const total = BUSINESS_ACCEPTANCE_ITEMS.length;
  const done = BUSINESS_ACCEPTANCE_ITEMS.filter((i) => states[i.id]?.checked).length;

  return (
    <main className="mx-auto max-w-6xl p-6 text-slate-100">
      <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold">业务验收测试清单</h1>
        <p className="mt-2 text-sm text-slate-400">
          范围：除「流程中心」下的工作流、任务中心、接口测试外的主要业务流程。每项请按步骤实机操作，勾选完成并填写备注（仅保存在本浏览器 localStorage）。
        </p>
        <p className="mt-2 text-sm text-amber-200/90">
          进度：{done} / {total} 项已勾选
        </p>
        <button
          type="button"
          className="mt-3 rounded border border-slate-500 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5"
          onClick={resetAll}
        >
          清空全部勾选与备注
        </button>
      </div>

      <div className="space-y-8">
        {grouped.map(([groupName, items]) => (
          <section key={groupName} className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <h2 className="text-lg font-semibold text-sky-300">{groupName}</h2>
            <ul className="mt-4 space-y-6">
              {items.map((item) => {
                const st = states[item.id] || { checked: false, note: "" };
                return (
                  <li key={item.id} className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
                        <input
                          type="checkbox"
                          checked={st.checked}
                          onChange={(e) => updateRow(item.id, { checked: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-500"
                        />
                        <span className="text-sm font-medium text-white">{item.title}</span>
                      </label>
                      {item.href ? (
                        <Link href={item.href} className="text-sm text-sky-400 underline" target="_blank" rel="noreferrer">
                          打开相关页面
                        </Link>
                      ) : null}
                    </div>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-400">
                      {item.steps.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ol>
                    <label className="mt-3 block text-xs text-slate-500">
                      备注
                      <textarea
                        className="mt-1 min-h-[72px] w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                        placeholder="测试结果、问题单号、截图路径等…"
                        value={st.note}
                        onChange={(e) => updateRow(item.id, { note: e.target.value })}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
