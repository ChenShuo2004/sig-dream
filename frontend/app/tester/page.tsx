"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadAuthSession } from "@/lib/auth";
import { TAG_CATEGORY_BACKEND_ORDER, tagCategoryHoverTitle, tagCategoryShort } from "@/lib/tagCategoryUi";

function toPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function TesterPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);

  const [token, setToken] = useState("");
  const [tagName, setTagName] = useState("测试标签A");
  const [tagCategory, setTagCategory] = useState("外观");
  const [materialTitle, setMaterialTitle] = useState("测试素材A");
  const [reviewTagId, setReviewTagId] = useState("");
  const [reviewDecision, setReviewDecision] = useState("approve");
  const [accessContext, setAccessContext] = useState("public");
  const [result, setResult] = useState("等待操作...");
  const [loading, setLoading] = useState(false);
  const [sessionText, setSessionText] = useState("未登录");

  useEffect(() => {
    const session = loadAuthSession();
    if (!session) return;
    setToken(session.access_token);
    setSessionText(`${session.username} (${session.role})`);
  }, []);

  function withAuth(headers: Record<string, string> = {}): Record<string, string> {
    if (!token) {
      return headers;
    }
    return { ...headers, Authorization: `Bearer ${token}` };
  }

  async function runRequest(label: string, runner: () => Promise<Response>) {
    setLoading(true);
    try {
      const resp = await runner();
      const text = await resp.text();
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = text;
      }
      setResult(`[${label}] status=${resp.status}\n${toPretty(payload)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(`[${label}] 请求异常\n${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">接口测试台</h1>
        <p className="mt-1 text-sm text-slate-600">用于快速验证登录、权限、tags/materials 接口。</p>
        <div className="mt-3 text-xs text-slate-500">当前会话：{sessionText}</div>
      </section>

      <section className="grid gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <strong className="text-sm text-slate-500">Token / access context</strong>
          {!token ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              未检测到登录会话，请先前往 <Link href="/login" className="font-medium underline">登录页</Link> 登录。
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            <textarea className="min-h-[92px] rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" rows={3} />
            <input className="rounded-lg border border-slate-300 px-3 py-2" value={accessContext} onChange={(e) => setAccessContext(e.target.value)} placeholder="X-Access-Context: public/internal" />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <strong className="text-sm text-slate-500">接口动作</strong>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("GET /auth/me", () => fetch(`${apiBaseUrl}/auth/me`, { headers: withAuth() }))}>测试 /auth/me</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("GET /tags", () => fetch(`${apiBaseUrl}/tags`))}>读取 tags</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("POST /tags/apply", () => fetch(`${apiBaseUrl}/tags/apply`, { method: "POST", headers: withAuth({ "Content-Type": "application/json" }), body: JSON.stringify({ name: tagName, category: tagCategory, synonyms: [] }) }))}>申请 tag（成员）</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("PATCH /tags/{id}/review", () => fetch(`${apiBaseUrl}/tags/${reviewTagId}/review`, { method: "PATCH", headers: withAuth({ "Content-Type": "application/json" }), body: JSON.stringify({ decision: reviewDecision }) }))}>审核 tag（管理员）</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("POST /tags", () => fetch(`${apiBaseUrl}/tags`, { method: "POST", headers: withAuth({ "Content-Type": "application/json" }), body: JSON.stringify({ name: tagName, category: tagCategory, synonyms: [] }) }))}>新建 tag</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("GET /materials", () => fetch(`${apiBaseUrl}/materials`))}>读取 materials</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("POST /materials", () => fetch(`${apiBaseUrl}/materials`, { method: "POST", headers: withAuth({ "Content-Type": "application/json" }), body: JSON.stringify({ title: materialTitle, description: "前端测试创建", tag_ids: [] }) }))}>新建 material</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={loading} onClick={() => runRequest("DELETE /materials/{id} 示例", () => fetch(`${apiBaseUrl}/materials/00000000-0000-0000-0000-000000000000`, { method: "DELETE", headers: withAuth({ "X-Access-Context": accessContext }) }))}>删除示例（internal）</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <strong className="text-sm text-slate-500">快速输入</strong>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input className="rounded-lg border border-slate-300 px-3 py-2" value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="tag 名称" />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={tagCategory}
            onChange={(e) => setTagCategory(e.target.value)}
            aria-label="tag 分类"
          >
            {TAG_CATEGORY_BACKEND_ORDER.map((c) => (
              <option key={c} value={c} title={tagCategoryHoverTitle(c)}>
                {tagCategoryShort(c)}
              </option>
            ))}
          </select>
          <input className="rounded-lg border border-slate-300 px-3 py-2" value={reviewTagId} onChange={(e) => setReviewTagId(e.target.value)} placeholder="审核用 tag id" />
          <input className="rounded-lg border border-slate-300 px-3 py-2" value={reviewDecision} onChange={(e) => setReviewDecision(e.target.value)} placeholder="审核决策：approve / reject" />
          <input className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2" value={materialTitle} onChange={(e) => setMaterialTitle(e.target.value)} placeholder="material 标题" />
        </div>
      </section>

      <pre className="rounded-xl bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{result}</pre>
    </main>
  );
}
