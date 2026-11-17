import Link from "next/link";

import { TOOLBOX_TOOLS } from "@/lib/toolbox/registry";

export default function ToolboxToolGrid() {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {TOOLBOX_TOOLS.map((tool) => (
        <Link
          key={tool.id}
          href={tool.path}
          className="group relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-rose-400/25 to-pink-600/10 p-4 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/20"
        >
          <div className="absolute inset-0 bg-slate-950/55" />
          <div className="relative">
            <h3 className="text-lg font-semibold text-white">{tool.title}</h3>
            <p className="mt-1 text-xs text-slate-300">{tool.description}</p>
            <p className="mt-2 text-[11px] text-slate-500">本机处理 · 无需上传</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
