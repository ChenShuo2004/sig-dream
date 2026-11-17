"use client";

import Link from "next/link";

import type { TutorialProgressRow } from "@/lib/tutorialProgressApi";
import type { TutorialConfig } from "@/lib/tutorials";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";

function statusLabel(
  allowed: boolean,
  status: TutorialProgressRow["status"]
): { text: string; tone: "muted" | "sky" | "emerald" | "amber" } {
  if (!allowed) return { text: "需要权限", tone: "amber" };
  if (status === "completed") return { text: "已完成", tone: "emerald" };
  if (status === "in_progress") return { text: "学习中", tone: "sky" };
  return { text: "未开始", tone: "muted" };
}

export default function TutorialCenterCard({
  tutorial,
  progress,
  permissions,
  onReplay,
}: {
  tutorial: TutorialConfig;
  progress: TutorialProgressRow | undefined;
  permissions: string[];
  onReplay: () => void | Promise<void>;
}) {
  const canLearn = tutorial.canLearn(permissions);
  const st = statusLabel(canLearn, progress?.status || "not_started");
  const toneClass =
    st.tone === "emerald"
      ? "text-emerald-600"
      : st.tone === "sky"
        ? "text-sky-600"
        : st.tone === "amber"
          ? "text-amber-700"
          : "text-slate-500";

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">教程</div>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">{tutorial.title}</h2>
      <p className="mt-2 text-sm text-slate-600">{tutorial.purpose}</p>
      <dl className="mt-3 grid gap-1 text-xs text-slate-500">
        <div className="flex justify-between gap-2">
          <dt>预计用时</dt>
          <dd className="text-slate-800">约 {tutorial.estimatedMinutes} 分钟</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>适用权限</dt>
          <dd className="text-right text-slate-800">{tutorial.applicableRolesHint}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>学习状态</dt>
          <dd className={`font-medium ${toneClass}`}>{st.text}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {canLearn ? (
          <Link href={tutorial.path} className={btnPrimary}>
            开始学习
          </Link>
        ) : (
          <button type="button" className={btnPrimary} disabled>
            开始学习
          </button>
        )}
        {canLearn && progress?.status === "completed" ? (
          <button type="button" className={btnSecondary} onClick={() => void onReplay()}>
            重新学习
          </button>
        ) : null}
      </div>
    </article>
  );
}
