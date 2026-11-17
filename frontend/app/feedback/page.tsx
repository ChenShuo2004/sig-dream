"use client";

import { useEffect, useMemo, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

type FeedbackItem = {
  id: string;
  title: string;
  created_at: string;
  like_count: number;
  dislike_count: number;
  reply_count: number;
};

type FeedbackReply = {
  id: string;
  content: string;
  created_at: string;
};

type FeedbackDetail = FeedbackItem & {
  content: string;
  replies: FeedbackReply[];
};

const emojiHints = ["😀", "👍", "🎉", "💡", "🙏", "🔥"];

export default function FeedbackPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const [token, setToken] = useState("");
  const [list, setList] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"publish" | "detail">("publish");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState("所有意见均匿名展示，系统也不知道是谁发的。");

  function authHeaders(extra: Record<string, string> = {}) {
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function loadList() {
    if (!token) return;
    try {
      const resp = await fetch(`${apiBaseUrl}/feedbacks?page=1&page_size=100`, { headers: authHeaders() });
      const data = (await resp.json()) as { total: number; items: FeedbackItem[]; detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setList(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      setMessage(`[加载意见失败]\n${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadDetail(feedbackId: string) {
    if (!token) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/feedbacks/${feedbackId}`, { headers: authHeaders() });
      const data = (await resp.json()) as FeedbackDetail | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setDetail(data as FeedbackDetail);
      setSelectedId(feedbackId);
      setMode("detail");
      setReplyText("");
    } catch (error) {
      setMessage(`[加载详情失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function publishFeedback() {
    if (!title.trim() || !content.trim()) {
      setMessage("标题和内容不能为空。");
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/feedbacks`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      const data = (await resp.json()) as FeedbackDetail | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setTitle("");
      setContent("");
      setMessage("发表成功（匿名）。");
      await loadList();
      await loadDetail((data as FeedbackDetail).id);
    } catch (error) {
      setMessage(`[发表失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitReply() {
    if (!detail || !replyText.trim()) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/feedbacks/${detail.id}/replies`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ content: replyText.trim() }),
      });
      const data = (await resp.json()) as FeedbackReply | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setReplyText("");
      setMessage("回复成功（匿名）。");
      await loadDetail(detail.id);
      await loadList();
    } catch (error) {
      setMessage(`[回复失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function react(action: "like" | "dislike") {
    if (!detail) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/feedbacks/${detail.id}/react`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action }),
      });
      const data = (await resp.json()) as { status: string; detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      await loadDetail(detail.id);
      await loadList();
    } catch (error) {
      setMessage(`[反馈失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const session = loadAuthSession();
    if (session) setToken(session.access_token);
  }, []);

  useEffect(() => {
    if (token) void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 grid gap-5 lg:grid-cols-[340px,1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          disabled={busy}
          onClick={() => {
            setMode("publish");
            setSelectedId("");
            setDetail(null);
          }}
        >
          发表
        </button>
        <p className="mt-3 text-xs text-slate-500">全部匿名展示，系统也不知道是谁发的，共 {total} 条意见</p>
        <div className="mt-3 max-h-[70vh] overflow-auto space-y-2">
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void loadDetail(item.id)}
              className={
                selectedId === item.id
                  ? "w-full rounded-lg border border-sky-300/70 bg-sky-600/20 p-3 text-left shadow-sm"
                  : "w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"
              }
            >
              <div className="line-clamp-1 text-sm font-semibold text-slate-900">{item.title}</div>
              <div className="mt-1 text-[11px] text-slate-500">
                {item.created_at} · 👍 {item.like_count} · 👎 {item.dislike_count} · 回复 {item.reply_count}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {mode === "publish" ? (
          <div className="grid gap-3">
            <h1 className="text-xl font-semibold text-slate-900">发表意见（匿名）</h1>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="min-h-[220px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="请输入内容（支持 emoji 表情，如 😀🎉👍）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {emojiHints.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                  onClick={() => setContent((prev) => `${prev}${emoji}`)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-fit rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              disabled={busy}
              onClick={() => void publishFeedback()}
            >
              匿名发表
            </button>
          </div>
        ) : detail ? (
          <div className="grid gap-4">
            <h1 className="text-xl font-semibold text-slate-900">{detail.title}</h1>
            <p className="text-xs text-slate-500">匿名发布于 {detail.created_at}</p>
            <article className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              {detail.content}
            </article>
            <div className="flex gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" disabled={busy} onClick={() => void react("like")}>
                👍 点赞（{detail.like_count}）
              </button>
              <button type="button" className="rounded border px-3 py-1.5 text-sm" disabled={busy} onClick={() => void react("dislike")}>
                👎 不喜欢（{detail.dislike_count}）
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 text-sm font-semibold text-slate-800">回复（匿名，{detail.reply_count}）</div>
              <div className="max-h-[260px] overflow-auto space-y-2">
                {detail.replies.map((reply) => (
                  <div key={reply.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-sm">
                    <div className="whitespace-pre-wrap">{reply.content}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{reply.created_at}</div>
                  </div>
                ))}
              </div>
              <textarea
                className="mt-3 min-h-[90px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="匿名回复（支持 emoji）"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <button
                type="button"
                className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                disabled={busy || !replyText.trim()}
                onClick={() => void submitReply()}
              >
                发送回复
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">请选择左侧意见记录，或点击“发表”。</div>
        )}

        <pre className="mt-4 rounded bg-slate-900 p-3 text-xs text-emerald-100 whitespace-pre-wrap">{message}</pre>
      </section>
    </main>
  );
}
