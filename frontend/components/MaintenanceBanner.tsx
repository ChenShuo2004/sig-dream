"use client";

import { useEffect, useMemo, useState } from "react";

type MaintenanceStatus = {
  enabled: boolean;
  announcement: string;
  announcement_published?: boolean;
};

type Props = {
  token: string;
};

export default function MaintenanceBanner({ token }: Props) {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(`${apiBaseUrl}/nas-jobs/sync/maintenance-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await resp.json()) as MaintenanceStatus | { detail?: unknown };
        if (!resp.ok) return;
        if (!cancelled) setStatus(data as MaintenanceStatus);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiBaseUrl, token]);

  const shouldShow = Boolean(status?.enabled || status?.announcement_published);
  if (!shouldShow) return null;
  const announcement = status?.announcement || "系统维护中：部分写操作已临时关闭，请稍后再试。";
  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {announcement}
    </div>
  );
}
