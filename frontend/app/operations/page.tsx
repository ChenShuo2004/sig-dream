"use client";

import { Suspense, useEffect, useMemo, useState } from "react";

import TutorialGate from "@/components/tutorials/TutorialGate";
import { loadAuthSession } from "@/lib/auth";

type OperationLogItem = {
  id: string;
  username: string | null;
  operation_type: string;
  target_type: string;
  target_name: string | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
};

type OperationLogListResponse = {
  items: OperationLogItem[];
  total: number;
  page: number;
  page_size: number;
};

type OperationLogEnumsResponse = {
  operation_types: string[];
  target_types: string[];
};

export default function OperationsPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [items, setItems] = useState<OperationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待查询...");

  const [operationType, setOperationType] = useState("");
  const [targetType, setTargetType] = useState("");
  const [username, setUsername] = useState("");
  const [targetName, setTargetName] = useState("");
  const [operationTypeOptions, setOperationTypeOptions] = useState<string[]>([]);
  const [targetTypeOptions, setTargetTypeOptions] = useState<string[]>([]);

  const btnPrimary =
    "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
  const btnSecondary =
    "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function queryLogs(nextPage: number = page) {
    if (!token) {
      setMessage("未登录，无法查询操作日志");
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (operationType.trim()) params.set("operation_type", operationType.trim());
      if (targetType.trim()) params.set("target_type", targetType.trim());
      if (username.trim()) params.set("username", username.trim());
      if (targetName.trim()) params.set("target_name", targetName.trim());
      params.set("page", String(nextPage));
      params.set("page_size", String(pageSize));

      const resp = await fetch(`${apiBaseUrl}/operation-logs?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = (await resp.json()) as OperationLogListResponse | { detail?: string };
      if (!resp.ok) throw new Error((data as { detail?: string }).detail || JSON.stringify(data));
      const typed = data as OperationLogListResponse;
      setItems(typed.items);
      setTotal(typed.total);
      setPage(typed.page);
      setMessage(`查询成功：共 ${typed.total} 条`);
    } catch (error) {
      setItems([]);
      setTotal(0);
      setMessage(`查询失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const session = loadAuthSession();
    if (!session) return;
    setToken(session.access_token);
    setPermissions(session.permissions || []);
  }, []);

  useEffect(() => {
    if (!token) return;
    void queryLogs(1);
    void queryEnums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function queryEnums() {
    try {
      const resp = await fetch(`${apiBaseUrl}/operation-logs/enums`, { headers: authHeaders() });
      const data = (await resp.json()) as OperationLogEnumsResponse | { detail?: string };
      if (!resp.ok) throw new Error((data as { detail?: string }).detail || JSON.stringify(data));
      const typed = data as OperationLogEnumsResponse;
      setOperationTypeOptions(typed.operation_types || []);
      setTargetTypeOptions(typed.target_types || []);
    } catch {
      setOperationTypeOptions([]);
      setTargetTypeOptions([]);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (token && !permissions.includes("log.view")) {
    return <main className="mx-auto max-w-5xl p-6">无访问权限</main>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-white/10 bg-slate-900/55 p-6 text-slate-100 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold">操作日志</h1>
        <p className="mt-2 text-sm text-slate-300">支持查询素材操作、标签操作，以及系统设置变更日志。</p>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4" data-tour="operation-logs-type-filter">
          <select className={inputClass} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
            <option value="">操作类型（全部）</option>
            {operationTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select className={inputClass} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">目标类型（全部）</option>
            {targetTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            data-tour="operation-logs-user-filter"
            className={inputClass}
            placeholder="操作人"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input className={inputClass} placeholder="目标名称" value={targetName} onChange={(e) => setTargetName(e.target.value)} />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void queryLogs(1)}>
            查询
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={() => {
              setOperationType("");
              setTargetType("");
              setUsername("");
              setTargetName("");
              void queryLogs(1);
            }}
          >
            重置
          </button>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-tour="operation-logs-list">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">操作类型</th>
                <th className="px-3 py-2">目标类型</th>
                <th className="px-3 py-2">目标名称</th>
                <th className="px-3 py-2">操作人</th>
                <th className="px-3 py-2" data-tour="operation-logs-time-filter">
                  时间
                </th>
                <th className="px-3 py-2" data-tour="operation-logs-detail">
                  结果
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{item.operation_type}</td>
                  <td className="px-3 py-2">{item.target_type}</td>
                  <td className="px-3 py-2">{item.target_name || "-"}</td>
                  <td className="px-3 py-2">{item.username || "system"}</td>
                  <td className="px-3 py-2">{item.created_at}</td>
                  <td className="px-3 py-2">
                    {item.success ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">成功</span>
                    ) : (
                      <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">失败</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">第 {page} / {totalPages} 页（共 {total} 条）</span>
          <div className="flex gap-2">
            <button className={btnSecondary + " !py-1.5"} disabled={busy || page <= 1} onClick={() => void queryLogs(page - 1)}>
              上一页
            </button>
            <button className={btnSecondary + " !py-1.5"} disabled={busy || page >= totalPages} onClick={() => void queryLogs(page + 1)}>
              下一页
            </button>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-700">{message}</div>
      </section>

      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="operation_logs" />
      </Suspense>
    </main>
  );
}
