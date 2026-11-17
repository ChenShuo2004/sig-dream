"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createWorkflow } from "@/lib/api";

export default function CreateWorkflowForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createWorkflow({
        name,
        description,
        created_by: createdBy,
        definition: { nodes: [], edges: [] }
      });
      setName("");
      setDescription("");
      setCreatedBy("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">新建工作流</h2>
      <input required className="rounded-lg border border-slate-300 px-3 py-2" placeholder="工作流名称" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="创建人（可选）" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} />
      <button type="submit" disabled={isSubmitting} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
        {isSubmitting ? "创建中..." : "新建工作流"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
