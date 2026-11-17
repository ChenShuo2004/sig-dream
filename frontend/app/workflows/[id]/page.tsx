import Link from "next/link";

import WorkflowReadonlyView from "@/components/workflow/WorkflowReadonlyView";
import { getWorkflow } from "@/lib/api";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: PageProps) {
  const { id } = await params;
  const workflow = await getWorkflow(id);

  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6">
      <Link href="/workflows" className="text-sm font-medium text-blue-600 hover:text-blue-700">返回工作流列表</Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{workflow.name}</h1>
        <p className="mt-1 text-sm text-slate-600">{workflow.description ?? "无描述"}</p>
        <div className="mt-2 text-sm text-slate-600">状态：{workflow.status}</div>
        <div className="text-sm text-slate-600">创建人：{workflow.created_by ?? "-"}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Workflow Definition（只读画布）</h2>
        <WorkflowReadonlyView workflow={workflow} />
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">展开查看 Workflow JSON（调试）</summary>
        <pre className="mt-3 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-emerald-100">
          {JSON.stringify(workflow.definition, null, 2)}
        </pre>
      </details>
    </main>
  );
}