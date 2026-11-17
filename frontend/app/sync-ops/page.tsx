"use client";

import { useEffect, useState } from "react";
import { loadAuthSession } from "@/lib/auth";
import { isNasTransferReady, nasStatusFetchFailed, type NasClientStatus } from "@/lib/nasClientStatus";

type SyncItem = {
  id: string;
  operation_id: string;
  operation_type: string;
  target_type: string;
  target_id: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  updated_at: string;
};

type SyncListResponse = {
  items: SyncItem[];
  total: number;
};
type MaintenanceStatus = {
  enabled: boolean;
  announcement: string;
  announcement_published?: boolean;
  started_at?: string | null;
  started_by?: string | null;
};

function statusLabel(value: string): string {
  const mapping: Record<string, string> = {
    sync_pending: "待同步",
    sync_running: "同步中",
    sync_failed: "同步失败",
    sync_deadletter: "死信",
    synced: "已同步",
  };
  return mapping[value] || value;
}

function actionLabel(value: string): string {
  const mapping: Record<string, string> = {
    "upload.store_original": "上传-原文件入 NAS",
    "upload.ingest_from_nas": "局域网上传入库",
    "delete.move_to_trash": "删除-移入回收站",
    "download.prepare_cache": "下载-缓存准备",
    "reconcile.material_file": "对账-素材文件",
  };
  return mapping[value] || value;
}

function toErrorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
    const text = JSON.stringify(payload);
    if (text && text !== "{}") return text;
  }
  return fallback;
}

export default function SyncOpsPage() {
  const [token, setToken] = useState("");
  const [role, setRole] = useState("");
  const [items, setItems] = useState<SyncItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("等待操作...");
  const [importing, setImporting] = useState(false);
  const [autoBackupBeforeImport, setAutoBackupBeforeImport] = useState(true);
  const [nasStatus, setNasStatus] = useState<NasClientStatus | null>(null);
  const [reconcileLimit, setReconcileLimit] = useState(200);
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);
  const [maintenanceAnnouncement, setMaintenanceAnnouncement] = useState(
    "系统维护中：正在执行手动对账，暂时禁止上传/删除/标签修改。"
  );

  const isAdmin = role === "super_admin" || role === "material_admin";
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    const session = loadAuthSession();
    if (!session) return;
    setToken(session.access_token);
    setRole(session.role);
  }, []);

  async function loadDeadletters(opts?: { silent?: boolean }) {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await fetch("/api-proxy/nas-jobs/sync/deadletters?status_filter=sync_deadletter&limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as SyncListResponse | { detail?: unknown };
      if (!resp.ok) {
        throw new Error(JSON.stringify(data));
      }
      const typed = data as SyncListResponse;
      setItems(typed.items || []);
      if (!opts?.silent) {
        setMessage(`加载完成：死信数量=${typed.total}`);
      }
    } catch (error) {
      setMessage(`加载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadNasStatus() {
    if (!token) return;
    try {
      const resp = await fetch("/api-proxy/nas-jobs/client-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      let data: unknown = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
      if (!resp.ok) {
        setNasStatus(nasStatusFetchFailed(resp.status, data));
        return;
      }
      setNasStatus(data as NasClientStatus);
    } catch {
      setNasStatus(nasStatusFetchFailed());
    }
  }

  async function loadMaintenanceStatus() {
    if (!token) return;
    try {
      const resp = await fetch("/api-proxy/nas-jobs/sync/maintenance-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as MaintenanceStatus | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setMaintenanceStatus(data as MaintenanceStatus);
    } catch {
      setMaintenanceStatus(null);
    }
  }

  async function publishMaintenanceAnnouncement() {
    if (!token) return;
    const text = maintenanceAnnouncement.trim();
    if (!text) {
      setMessage("发布失败：请先填写维护公告文案");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ announcement: text });
      const resp = await fetch(`/api-proxy/nas-jobs/sync/maintenance-announcement/publish?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as MaintenanceStatus | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setMaintenanceStatus(data as MaintenanceStatus);
      setMessage("维护公告已发布（当前仅公告，不影响业务写操作）");
    } catch (error) {
      setMessage(`发布公告失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function withdrawMaintenanceAnnouncement() {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await fetch("/api-proxy/nas-jobs/sync/maintenance-announcement/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as MaintenanceStatus | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      setMaintenanceStatus(data as MaintenanceStatus);
      setMessage("维护公告已撤回");
    } catch (error) {
      setMessage(`撤回公告失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function triggerReconcile() {
    if (!token) return;
    if (nasStatus?.nas_client_online) {
      const go = window.confirm(
        "检测到 NAS worker/download_server 仍在线。为避免用户操作导致对账期间异常，建议先停止这两个服务后再执行对账。\n\n是否仍继续执行手动对账？"
      );
      if (!go) return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(Math.max(10, Math.min(reconcileLimit, 1000))),
        announcement: maintenanceAnnouncement.trim() || "系统维护中：正在执行手动对账，暂时禁止上传/删除/标签修改。",
      });
      const resp = await fetch(`/api-proxy/nas-jobs/sync/reconcile-with-maintenance?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as { checked?: number; created?: number; elapsed_ms?: number; scope?: string } | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const typed = data as { checked?: number; created?: number; elapsed_ms?: number; scope?: string };
      const checked = typed.checked ?? 0;
      const created = typed.created ?? 0;
      const elapsed = typed.elapsed_ms ?? 0;
      if (created > 0) {
        setMessage(`对账完成：检查=${checked}，新增修复任务=${created}，耗时=${elapsed}ms。范围：${typed.scope || "-"}`);
      } else {
        setMessage(`对账完成：检查=${checked}，未发现新增修复任务，耗时=${elapsed}ms。范围：${typed.scope || "-"}`);
      }
      await loadDeadletters({ silent: true });
      await loadMaintenanceStatus();
    } catch (error) {
      setMessage(`对账失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function actionSync(id: string, action: "requeue" | "resolved" | "ignore") {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api-proxy/nas-jobs/sync/${id}/action`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, note: `from-ui:${action}` }),
      });
      const data = (await resp.json()) as { status?: string } | { detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const actionText = action === "requeue" ? "重排队" : action === "resolved" ? "标记已修复" : "忽略";
      setMessage(`操作成功：${actionText}`);
      await loadDeadletters({ silent: true });
    } catch (error) {
      setMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function exportDatabase() {
    if (!token || !isSuperAdmin) return;
    setLoading(true);
    try {
      const resp = await fetch("/api-proxy/nas-jobs/sync/db/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(toErrorText(data, `HTTP ${resp.status} ${resp.statusText || "导出失败"}`));
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecs-db-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMessage("导出成功：已下载 ECS 数据库备份 SQL");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`导出失败：${text || "未知错误（无详情返回）"}`);
    } finally {
      setLoading(false);
    }
  }

  async function importDatabase(file: File | null) {
    if (!file || !token || !isSuperAdmin) return;
    if (!window.confirm("确认导入数据库备份？该操作会覆盖当前 ECS 数据库数据。")) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("backup_file", file);
      const resp = await fetch(`/api-proxy/nas-jobs/sync/db/import?auto_backup_before_import=${autoBackupBeforeImport ? "true" : "false"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = (await resp.json()) as { message?: string; pre_import_backup_file?: string | null; detail?: unknown };
      if (!resp.ok) throw new Error(JSON.stringify(data));
      const backupNote = data.pre_import_backup_file ? `；导入前备份：${data.pre_import_backup_file}` : "";
      setMessage(`导入成功：${data.message || "数据库已恢复"}${backupNote}`);
      await loadDeadletters({ silent: true });
    } catch (error) {
      setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    if (token && isSuperAdmin) {
      void loadDeadletters();
      void loadNasStatus();
      void loadMaintenanceStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isSuperAdmin]);

  if (!token) {
    return <main className="mx-auto max-w-5xl p-6">请先登录后访问。</main>;
  }

  if (!isSuperAdmin) {
    return <main className="mx-auto max-w-5xl p-6">无访问权限</main>;
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">同步异常管理（管理员）</h1>
      <p className="mt-2 text-sm text-slate-500">
        手动对账会扫描 ECS 中 `storage_type=nas` 且 `status=available` 的素材文件记录，生成待修复同步任务。
      </p>
      <div className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        维护模式状态：{maintenanceStatus?.enabled ? "进行中" : "关闭"}
        {maintenanceStatus?.announcement_published ? "；公告状态：已发布" : "；公告状态：未发布"}
        {(maintenanceStatus?.enabled || maintenanceStatus?.announcement_published) && maintenanceStatus?.announcement
          ? `；公告：${maintenanceStatus.announcement}`
          : ""}
      </div>
      {nasStatus?.nas_client_online ? (
        <div className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          检测到 NAS 服务在线。建议先停止 `run-worker.ps1` 与 `run-download-server.ps1`，再执行手动对账。
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={maintenanceAnnouncement}
          onChange={(e) => setMaintenanceAnnouncement(e.target.value)}
          className="w-[520px] rounded border px-2 py-2 text-sm"
          placeholder="维护公告（开始对账时生效）"
        />
        <button className="rounded bg-indigo-600 px-3 py-2 text-sm text-white" disabled={loading} onClick={() => void publishMaintenanceAnnouncement()}>
          发布公告
        </button>
        <button className="rounded bg-slate-600 px-3 py-2 text-sm text-white" disabled={loading} onClick={() => void withdrawMaintenanceAnnouncement()}>
          撤回公告
        </button>
        <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" disabled={loading} onClick={() => void loadDeadletters()}>
          刷新死信列表
        </button>
        <input
          type="number"
          min={10}
          max={1000}
          value={reconcileLimit}
          onChange={(e) => setReconcileLimit(Number(e.target.value || 200))}
          className="w-28 rounded border px-2 py-2 text-sm"
          title="对账扫描上限（10-1000）"
        />
        <button className="rounded bg-slate-700 px-3 py-2 text-sm text-white" disabled={loading} onClick={() => void triggerReconcile()}>
          手动对账
        </button>
        {isSuperAdmin ? (
          <>
            <button className="rounded bg-emerald-700 px-3 py-2 text-sm text-white" disabled={loading} onClick={() => void exportDatabase()}>
              导出ECS数据库
            </button>
            <label className="inline-flex items-center gap-2 rounded border border-slate-400 px-3 py-2 text-sm text-slate-100">
              <input
                type="checkbox"
                checked={autoBackupBeforeImport}
                onChange={(e) => setAutoBackupBeforeImport(e.target.checked)}
                disabled={loading || importing}
              />
              导入前自动备份当前库
            </label>
            <label className="rounded bg-amber-700 px-3 py-2 text-sm text-white cursor-pointer">
              {importing ? "导入中..." : "导入ECS数据库"}
              <input
                type="file"
                accept=".sql,.dump,.backup"
                className="hidden"
                disabled={loading || importing}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  e.currentTarget.value = "";
                  void importDatabase(f);
                }}
              />
            </label>
          </>
        ) : null}
      </div>
      <div className="mt-3 rounded bg-slate-900 p-3 text-sm text-emerald-200">{message}</div>

      <div className="mt-4 overflow-x-auto rounded border border-slate-700">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2">操作ID</th>
              <th className="px-3 py-2">操作类型</th>
              <th className="px-3 py-2">目标对象</th>
              <th className="px-3 py-2">同步状态</th>
              <th className="px-3 py-2">重试次数</th>
              <th className="px-3 py-2">错误信息</th>
              <th className="px-3 py-2">更新时间</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-700">
                <td className="px-3 py-2">{item.operation_id}</td>
                <td className="px-3 py-2">{actionLabel(item.operation_type)}</td>
                <td className="px-3 py-2">{item.target_type}:{item.target_id || "-"}</td>
                <td className="px-3 py-2">{statusLabel(item.status)}</td>
                <td className="px-3 py-2">{item.retry_count}/{item.max_retries}</td>
                <td className="px-3 py-2">{item.last_error || "-"}</td>
                <td className="px-3 py-2">{item.updated_at}</td>
                <td className="px-3 py-2 space-x-2">
                  <button className="rounded border px-2 py-1" disabled={loading} onClick={() => void actionSync(item.id, "requeue")}>
                    重排队
                  </button>
                  <button className="rounded border px-2 py-1" disabled={loading} onClick={() => void actionSync(item.id, "resolved")}>
                    标记已修复
                  </button>
                  <button className="rounded border px-2 py-1" disabled={loading} onClick={() => void actionSync(item.id, "ignore")}>
                    忽略
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-slate-500" colSpan={8}>
                  暂无死信
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
