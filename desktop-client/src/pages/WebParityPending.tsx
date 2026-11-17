/** 与 Web 对齐中的占位页：路由与标题与 frontend 一致，实现须迁移或复用 Web 逻辑。 */
export default function WebParityPending({ title, refPath }: { title: string; refPath?: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-6 backdrop-blur-xl">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-300">
          本页正按 Web 端同等界面与功能在桌面壳中实现；行为与布局请以{" "}
          <code className="rounded bg-slate-800 px-1 text-sky-300">frontend</code> 对应路由为准
          {refPath ? (
            <>
              ，参考 <code className="break-all text-sky-300">{refPath}</code>
            </>
          ) : null}
          。
        </p>
      </div>
    </main>
  );
}
