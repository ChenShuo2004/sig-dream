"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, useAssetLibrary } from "@/lib/assetLibrary";
import Link from "next/link";
import TutorialGate from "@/components/tutorials/TutorialGate";
import { tagCategoryHoverTitle, tagCategoryShort } from "@/lib/tagCategoryUi";

type TagItem = {
  id: string;
  name: string;
  category: string;
  description?: string;
  status: string;
  created_at: string;
};

function statusLabel(status: string): string {
  if (status === "pending") return "申请中";
  if (status === "active") return "启用";
  if (status === "inactive") return "已停用";
  if (status === "merged") return "已合并";
  return status;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function TagRequestsPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const { library } = useAssetLibrary();
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("等待操作...");

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setPermissions(session.permissions || []);
    }
  }, []);

  function authHeaders() {
    const headers: Record<string, string> = { ...assetLibraryHeaders({}, library) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function loadPending() {
    if (!token) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags?status=pending`, { headers: authHeaders() });
      const data = (await resp.json()) as (TagItem & { description?: string })[] | { detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      setTags(
        (data as TagItem[]).map((t) => ({
          ...t,
          description: typeof t.description === "string" ? t.description : "",
        }))
      );
      setResult(`[加载待审核标签成功] total=${(data as TagItem[]).length}`);
    } catch (error) {
      setResult(`[加载失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function review(tagId: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/${tagId}/review`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[审核成功]\n${pretty(data)}`);
      await loadPending();
    } catch (error) {
      setResult(`[审核失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    setTags([]);
    void loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, library]);

  if (token && !permissions.includes("tag.review")) {
    return <main className="mx-auto max-w-5xl p-6">无权限访问</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 grid gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">标签审核</h1>
        <p className="mt-1 text-sm text-slate-600">仅展示“申请中”标签并执行通过/拒绝。</p>
        <p data-tour="tag-request-duplicate-hint" className="mt-2 text-xs text-slate-500">
          若与已有标签重复，请拒绝申请并引导成员使用现有标签。
        </p>
        <Link href="/tags" className="mt-2 inline-block text-sm text-blue-600 underline">返回标签管理</Link>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm grid gap-2" data-tour="tag-requests-list">
        <button className="w-fit rounded border px-3 py-2" onClick={loadPending} disabled={busy}>刷新待审核</button>
        {tags.map((tag, idx) => (
          <div key={tag.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
            <span className="font-medium">{tag.name}</span>
            <span className="text-slate-500" title={tagCategoryHoverTitle(tag.category)}>
              {tagCategoryShort(tag.category)}
            </span>
            <span className="text-slate-500">{statusLabel(tag.status)}</span>
            <span data-tour={idx === 0 ? "tag-request-reason" : undefined} className="w-full text-xs text-slate-500">
              说明：{(tag.description || "").trim() || "—"}
            </span>
            <span className="w-full text-xs text-slate-400">申请标识：{tag.id}</span>
            <button
              data-tour={idx === 0 ? "tag-request-approve-button" : undefined}
              className="ml-auto rounded border px-2 py-1 text-xs"
              onClick={() => review(tag.id, "approve")}
              disabled={busy}
            >
              通过
            </button>
            <button
              data-tour={idx === 0 ? "tag-request-reject-button" : undefined}
              className="rounded border px-2 py-1 text-xs"
              onClick={() => review(tag.id, "reject")}
              disabled={busy}
            >
              拒绝
            </button>
          </div>
        ))}
      </section>

      <pre className="rounded bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{result}</pre>
      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="tag_requests" />
      </Suspense>
    </main>
  );
}
