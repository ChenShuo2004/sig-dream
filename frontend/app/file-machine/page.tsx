"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

type FileNode = {
  node_id: string;
  pool_id: string;
  status: string;
  healthy: boolean;
  last_seen_at: string | null;
  age_seconds: number | null;
};

type QueueCount = {
  job_type: string;
  pending: number;
  running: number;
  success_today: number;
  failed_today: number;
};

type QueueJob = {
  id: string;
  job_type: string;
  status: string;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  retry_count: number;
  error_message: string | null;
};

type QueueBoard = {
  server_time: string;
  overall: string;
  worker_polling: boolean;
  worker_last_poll_at: string | null;
  worker_age_seconds: number | null;
  worker_online_window_seconds: number;
  file_stale_seconds: number;
  file_nodes: FileNode[];
  pending_total: number;
  running_total: number;
  queues: QueueCount[];
  active_jobs: QueueJob[];
  recent_jobs: QueueJob[];
};

const JOB_LABELS: Record<string, string> = {
  store_original: "原文件入库",
  prepare_download: "下载缓存",
  move_to_trash: "移入回收站",
  restore_from_trash: "从回收站恢复",
  generate_derivatives: "缩略图与预览",
  analyze_content: "内容识别",
  lan_tts: "语音合成",
  lan_asr: "语音识别",
  lan_voice_convert: "声音转换",
  lan_seedvc: "音色替换",
  lan_svs_remake: "歌声重制",
  lan_comfy: "局域网绘图",
  lan_voice_design: "声音设计",
  ai007_forward: "AI007 转发",
  replication_intake: "复刻入库",
  replacement_intake: "换人入库",
  replacement_compose: "换人合成",
  replacement_media: "换人成片",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "排队",
  running: "执行中",
  success: "成功",
  failed: "失败",
};

function jobLabel(jobType: string) {
  return JOB_LABELS[jobType] || jobType;
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function ageText(seconds: number | null) {
  if (seconds == null) return "没有记录";
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

function overallText(overall: string) {
  if (overall === "ok") return "文件服务和任务进程都在运行";
  if (overall === "worker_down") return "文件服务在线，任务进程没有在领任务";
  if (overall === "file_down") return "任务进程在领任务，文件服务心跳已过期";
  return "文件服务和任务进程都没有在运行";
}

export default function FileMachinePage() {
  const [token, setToken] = useState("");
  const [role, setRole] = useState("");
  const [board, setBoard] = useState<QueueBoard | null>(null);
  const [message, setMessage] = useState("正在读取…");
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    const session = loadAuthSession();
    setToken(session?.access_token || "");
    setRole(session?.role || "");
  }, []);

  const loadBoard = useCallback(async () => {
    if (!token) return;
    try {
      const resp = await fetch("/api-proxy/nas-jobs/queue-board", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await resp.json()) as QueueBoard | { detail?: unknown };
      if (!resp.ok) {
        const detail = data && typeof data === "object" && "detail" in data ? String(data.detail || "") : "";
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      setBoard(data as QueueBoard);
      setUpdatedAt(formatTime(new Date().toISOString()));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadBoard();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadBoard();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [token, loadBoard]);

  const allowed = role === "super_admin" || role === "material_admin";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-white/10 bg-slate-900/55 p-6 text-slate-100 backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">文件机与队列</h1>
            <p className="mt-2 text-sm text-slate-300">
              看文件服务心跳和任务进程是否在跑，以及哪些任务正在执行、哪些还在排队。每 5 秒刷新。不显示文件路径和任务正文。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadBoard()}
            className="rounded-lg border border-white/15 bg-slate-800 px-3 py-1.5 text-sm text-slate-100"
          >
            立即刷新
          </button>
        </div>
        {updatedAt ? <p className="mt-3 text-xs text-slate-400">上次刷新 {updatedAt}</p> : null}
        {message ? <p className="mt-3 text-sm text-amber-200">{message}</p> : null}
        {!token ? (
          <p className="mt-4 text-sm text-slate-200">
            请先<Link className="mx-1 text-white underline" href="/login">登录</Link>后再看。超级管理员和素材管理员可以打开这一页。
          </p>
        ) : null}
        {token && role && !allowed ? <p className="mt-4 text-sm text-amber-200">当前账号不能查看文件机队列。</p> : null}
      </section>

      {board ? (
        <>
          <section className="mt-4 grid gap-3 md:grid-cols-3">
            <StatusCard
              title="总览"
              ok={board.overall === "ok"}
              value={overallText(board.overall)}
              detail={`排队 ${board.pending_total} · 执行中 ${board.running_total}`}
            />
            <StatusCard
              title="任务进程"
              ok={board.worker_polling}
              value={board.worker_polling ? "正在领任务" : "没有在领任务"}
              detail={board.worker_polling ? `最近一次 ${ageText(board.worker_age_seconds)}` : `超过 ${board.worker_online_window_seconds} 秒没有轮询`}
            />
            <StatusCard
              title="文件服务"
              ok={board.file_nodes.some((node) => node.healthy)}
              value={board.file_nodes.some((node) => node.healthy) ? "心跳正常" : "心跳过期"}
              detail={board.file_nodes.length ? `${board.file_nodes.filter((node) => node.healthy).length} 台健康 / ${board.file_nodes.length} 台登记` : "还没有文件机登记"}
            />
          </section>

          <section className="mt-4 rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-slate-100">
            <h2 className="text-sm font-semibold text-white">文件机</h2>
            <p className="mt-1 text-xs text-slate-400">心跳超过 {board.file_stale_seconds} 秒视为过期。心跳正常只说明文件服务在上报，不代表任务进程在领任务。</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="px-2 py-2 font-medium">节点</th>
                    <th className="px-2 py-2 font-medium">池</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-2 py-2 font-medium">最近心跳</th>
                  </tr>
                </thead>
                <tbody>
                  {board.file_nodes.map((node) => (
                    <tr key={`${node.pool_id}-${node.node_id}`} className="border-t border-white/10">
                      <td className="px-2 py-2 text-white">{node.node_id}</td>
                      <td className="px-2 py-2">{node.pool_id}</td>
                      <td className="px-2 py-2">{node.healthy ? "正常" : "过期"}</td>
                      <td className="px-2 py-2">{ageText(node.age_seconds)}</td>
                    </tr>
                  ))}
                  {!board.file_nodes.length ? (
                    <tr>
                      <td className="px-2 py-3 text-slate-400" colSpan={4}>没有登记的文件机</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-slate-100">
            <h2 className="text-sm font-semibold text-white">队列</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="px-2 py-2 font-medium">任务类型</th>
                    <th className="px-2 py-2 font-medium">排队</th>
                    <th className="px-2 py-2 font-medium">执行中</th>
                    <th className="px-2 py-2 font-medium">今日成功</th>
                    <th className="px-2 py-2 font-medium">今日失败</th>
                  </tr>
                </thead>
                <tbody>
                  {board.queues.map((item) => (
                    <tr key={item.job_type} className="border-t border-white/10">
                      <td className="px-2 py-2 text-white">{jobLabel(item.job_type)}</td>
                      <td className="px-2 py-2">{item.pending}</td>
                      <td className="px-2 py-2">{item.running}</td>
                      <td className="px-2 py-2">{item.success_today}</td>
                      <td className="px-2 py-2">{item.failed_today}</td>
                    </tr>
                  ))}
                  {!board.queues.length ? (
                    <tr>
                      <td className="px-2 py-3 text-slate-400" colSpan={5}>今天还没有队列记录</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <JobTable title="正在执行和排队" jobs={board.active_jobs} empty="当前没有排队或正在执行的任务" />
          <JobTable title="今天已结束" jobs={board.recent_jobs} empty="今天还没有结束的任务" />
        </>
      ) : null}
    </main>
  );
}

function StatusCard({ title, ok, value, detail }: { title: string; ok: boolean; value: string; detail: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/55 p-4">
      <p className="text-xs text-slate-400">{title}</p>
      <p className={`mt-2 text-base font-semibold ${ok ? "text-emerald-300" : "text-amber-200"}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </section>
  );
}

function JobTable({ title, jobs, empty }: { title: string; jobs: QueueJob[]; empty: string }) {
  return (
    <section className="mt-4 rounded-2xl border border-white/10 bg-slate-900/55 p-4 text-slate-100">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">类型</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">创建</th>
              <th className="px-2 py-2 font-medium">开始</th>
              <th className="px-2 py-2 font-medium">结束</th>
              <th className="px-2 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={`${job.id}-${job.status}`} className="border-t border-white/10 align-top">
                <td className="px-2 py-2 text-white">{jobLabel(job.job_type)}</td>
                <td className="px-2 py-2">{statusLabel(job.status)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{formatTime(job.created_at)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{formatTime(job.started_at)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{formatTime(job.finished_at)}</td>
                <td className="px-2 py-2 text-slate-300">{job.error_message || "—"}</td>
              </tr>
            ))}
            {!jobs.length ? (
              <tr>
                <td className="px-2 py-3 text-slate-400" colSpan={6}>{empty}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
