"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { clearAuthSession, loadAuthSession } from "@/lib/auth";
import AssetLibrarySwitcher from "@/components/AssetLibrarySwitcher";

const baseMenuGroups = [
  {
    label: "画布",
    items: [{ href: "/canvas", label: "画布" }],
  },
  {
    label: "素材中心",
    items: [
      { href: "/materials", label: "素材库" },
      { href: "/collections", label: "素材集合" },
      { href: "/materials/upload", label: "上传队列" },
      { href: "/unorganized", label: "未整理" },
      { href: "/trash", label: "回收站" },
    ],
  },
  {
    label: "标签与日志",
    items: [
      { href: "/tags", label: "标签管理" },
      { href: "/tag-requests", label: "标签审核" },
    ],
  },
  {
    label: "工具箱",
    items: [{ href: "/toolbox", label: "工具箱" }],
  },
  {
    label: "系统管理",
    items: [
      { href: "/settings", label: "系统设置" },
      { href: "/settings/api", label: "API设置" },
      { href: "/sync-ops", label: "同步异常" },
      { href: "/file-machine", label: "文件机与队列" },
      { href: "/operations", label: "操作日志" },
    ],
  },
  {
    label: "意见",
    items: [
      { href: "/feedback", label: "意见" },
      { href: "/tutorials", label: "教程中心" },
    ],
  },
] as const;

const baseMobileQuickLinks = [
  { href: "/canvas", label: "画布" },
  { href: "/materials", label: "素材库" },
  { href: "/collections", label: "素材集合" },
  { href: "/materials/upload", label: "上传队列" },
  { href: "/tags", label: "标签" },
  { href: "/toolbox", label: "工具箱" },
  { href: "/unorganized", label: "未整理" },
  { href: "/trash", label: "回收站" },
  { href: "/operations", label: "日志" },
  { href: "/sync-ops", label: "同步异常" },
  { href: "/file-machine", label: "文件机与队列" },
  { href: "/settings", label: "系统设置" },
  { href: "/settings/api", label: "API设置" },
  { href: "/feedback", label: "意见" },
  { href: "/tutorials", label: "教程" },
] as const;

/** 顶栏菜单组触发器：有无下拉都用同一套，避免单链「工具箱」和按钮组高低/底色不一致 */
const navTriggerClass =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md border-0 bg-transparent px-3 text-sm leading-none text-slate-300 shadow-none outline-none transition hover:bg-white/10 hover:text-white";

export default function AppHeader() {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [backendVersion, setBackendVersion] = useState("");

  useEffect(() => {
    const session = loadAuthSession();
    setUsername(session?.username || "");
    setRole(session?.role || "");
    setPermissions(session?.permissions || []);
  }, []);

  const menuGroups = useMemo(() => {
    const canViewOperationLogs = permissions.includes("log.view");
    return baseMenuGroups
      .map((g) => {
        const nextItems = g.items.filter((item) => {
          if (item.href === "/operations") return canViewOperationLogs;
          if (item.href === "/collections") return permissions.includes("collection.view");
          if (item.href === "/canvas" || item.href === "/file-machine") return role === "super_admin" || role === "material_admin";
          if (item.href === "/settings/api") return role === "super_admin";
          return true;
        });
        return { ...g, items: nextItems };
      })
      .filter((g) => g.items.length > 0);
  }, [permissions, role]);

  const mobileQuickLinks = useMemo(() => {
    const canViewOperationLogs = permissions.includes("log.view");
    return baseMobileQuickLinks.filter((item) => {
      if (item.href === "/operations") return canViewOperationLogs;
      if (item.href === "/collections") return permissions.includes("collection.view");
      if (item.href === "/canvas" || item.href === "/file-machine") return role === "super_admin" || role === "material_admin";
      if (item.href === "/settings/api") return role === "super_admin";
      return true;
    });
  }, [permissions, role]);

  useEffect(() => {
    let cancelled = false;
    async function loadVersion() {
      try {
        const resp = await fetch("/api-proxy/health", { cache: "no-store" });
        const data = (await resp.json()) as { version?: string };
        if (!cancelled) {
          setBackendVersion((data.version || "").trim());
        }
      } catch {
        if (!cancelled) setBackendVersion("");
      }
    }
    void loadVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  function logout() {
    clearAuthSession();
    setUsername("");
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 max-w-7xl min-w-0 flex-nowrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-nowrap items-center gap-4">
          <Link href="/" className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold tracking-tight text-white hover:text-sky-300">
            {/* eslint-disable-next-line @next/next/no-img-element -- 品牌标静态 SVG */}
            <img src="/brand/youwendu-mark-white.svg" alt="" className="h-5 w-auto" />
            轻量内容流程平台
          </Link>
          <nav className="hidden flex-nowrap items-center gap-1 lg:flex">
            {menuGroups.map((group) =>
              group.items.length === 1 && group.items[0].label === group.label ? (
                <Link key={group.label} href={group.items[0].href} className={navTriggerClass}>
                  {group.label}
                </Link>
              ) : (
                <div key={group.label} className="group relative shrink-0">
                  <button type="button" className={navTriggerClass}>
                    {group.label}
                  </button>
                  <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-white/20 bg-slate-950/95 p-1 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block whitespace-nowrap rounded px-2.5 py-1.5 text-sm text-slate-200 transition hover:bg-white/10 hover:text-white"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ),
            )}
          </nav>
        </div>

        <div className="hidden shrink-0 flex-nowrap items-center gap-2 sm:flex">
          {username ? (
            <>
              <AssetLibrarySwitcher />
              <span className="shrink-0 whitespace-nowrap rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-200">{username}</span>
              <Link href="/login" className="shrink-0 whitespace-nowrap rounded-md border border-white/20 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10">修改密码</Link>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 whitespace-nowrap rounded-md border border-slate-400 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 transition hover:bg-white"
              >
                退出
              </button>
            </>
          ) : (
            <Link href="/login" className="shrink-0 whitespace-nowrap rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400">登录</Link>
          )}
          {backendVersion ? (
            <span className="max-w-[min(280px,22vw)] shrink-0 truncate rounded border border-white/20 px-2 py-0.5 text-[11px] text-slate-300" title={`版本 ${backendVersion}`}>
              版本 {backendVersion}
            </span>
          ) : null}
        </div>

        <nav className="flex max-w-[65vw] shrink-0 flex-wrap items-center justify-end gap-1 lg:hidden">
          {mobileQuickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/10 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-medium text-slate-950 hover:bg-sky-400">{username ? "账号" : "登录"}</Link>
        </nav>
      </div>
    </header>
  );
}
