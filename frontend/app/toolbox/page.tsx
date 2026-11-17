import ToolboxToolGrid from "@/components/toolbox/ToolboxToolGrid";

export default function ToolboxPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold text-white">工具箱</h1>
        <p className="mt-1 text-xs text-slate-300">实用小工具：在本机浏览器中完成，默认不上传、不写素材库。</p>
      </div>
      <div className="mt-4">
        <ToolboxToolGrid />
      </div>
    </main>
  );
}
