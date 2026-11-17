import Link from "next/link";

import CreateWorkflowForm from "./CreateWorkflowForm";
import { getWorkflows } from "@/lib/api";

export default async function WorkflowsPage() {
  let workflows = [] as Awaited<ReturnType<typeof getWorkflows>>;
  let loadError = "";
  try {
    workflows = await getWorkflows();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/55 p-6 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold text-white">工作流页面</h1>
        <p className="mt-1 text-sm text-slate-300">按设计文档：左侧节点库，中间画布入口，右侧配置与运行结果。</p>
        {loadError ? (
          <p className="mt-3 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            当前无法连接后端，已切换为本地 UI 调试模式（仅样式预览）。错误：{loadError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px,1fr,300px]">
        <aside className="h-fit rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-slate-200 backdrop-blur-xl">
          <div className="mb-3 text-sm font-semibold">节点库</div>
          <ul className="space-y-1 text-sm text-slate-300">
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">素材检索节点</li>
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">素材集合输入节点</li>
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">项目素材包输入节点</li>
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">任务素材包输入节点</li>
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">任务素材包创建节点</li>
            <li className="rounded-lg px-3 py-2 hover:bg-white/5">素材下载准备节点</li>
          </ul>
        </aside>

        <section>
          <div className="mb-5">
            <CreateWorkflowForm />
          </div>
          <ul className="grid gap-3">
            {workflows.map((item) => (
              <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-base font-semibold text-slate-900">{item.name}</div>
                <div className="mt-1 text-sm text-slate-600">状态：{item.status}</div>
                <div className="text-sm text-slate-600">创建人：{item.created_by ?? "-"}</div>
                <Link href={`/workflows/${item.id}`} className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
                  查看详情 →
                </Link>
              </li>
            ))}
          </ul>
          {workflows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
              当前无可展示工作流数据。
            </div>
          ) : null}
        </section>

        <aside className="h-fit rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-slate-200 backdrop-blur-xl">
          <div className="mb-3 text-sm font-semibold">节点配置 / 运行结果</div>
          <div className="space-y-3 text-xs text-slate-300">
            <p>这里用于显示选中节点配置、输入输出与运行日志摘要。</p>
            <p>当前版本在详情页展示画布与 JSON，后续可把运行日志下沉到本区域。</p>
            <p>对应文档结构：左节点库 / 中画布 / 右配置 / 底部日志。</p>
          </div>
        </aside>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-xs text-slate-300 backdrop-blur-xl">
        底部运行日志（预留区域）：将承接节点执行顺序、错误详情与耗时信息。
      </div>
    </main>
  );
}
