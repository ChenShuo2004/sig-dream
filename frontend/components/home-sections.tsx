"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

type HomeItem = { href: string; title: string; desc: string };
type HomeSection = { title: string; gradient: string; items: readonly HomeItem[] };

export default function HomeSections({ sections }: { sections: readonly HomeSection[] }) {
  const [role, setRole] = useState("");

  useEffect(() => {
    setRole(loadAuthSession()?.role || "");
  }, []);

  return (
    <div className="grid gap-2">
      {sections.map((section) => {
        const items = section.items.filter((item) => {
          if (item.href === "/settings/api") return role === "super_admin";
          if (item.href === "/canvas" || item.href === "/file-machine") return role === "super_admin" || role === "material_admin";
          return true;
        });
        if (!items.length) return null;
        return (
          <section key={section.title} className="rounded-xl border border-white/10 bg-slate-900/50 p-3 backdrop-blur-xl">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-300">{section.title}</h2>
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {items.map(({ href, title, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className={`group relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${section.gradient} p-4 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/20`}
                >
                  <div className="absolute inset-0 bg-slate-950/55" />
                  <div className="relative">
                    <h3 className="text-xl font-semibold text-white">{title}</h3>
                    <p className="mt-1 text-xs text-slate-300">{desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
