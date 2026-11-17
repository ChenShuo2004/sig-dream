export type NasClientStatus = {
  nas_client_online: boolean;
  nas_client_last_poll_at: string | null;
  lan_direct_enabled: boolean;
  message: string;
  transfer_ready?: boolean;
  default_storage_pool_id?: string;
  file_service_healthy_nodes?: number;
  file_service_registry_active?: boolean;
  file_service_stale_seconds?: number;
};

export function isNasTransferReady(status: NasClientStatus | null | undefined): boolean {
  if (!status) return false;
  if (typeof status.transfer_ready === "boolean") return status.transfer_ready;
  const nodes = status.file_service_healthy_nodes ?? 0;
  return Boolean(
    status.nas_client_online ||
      status.lan_direct_enabled ||
      nodes > 0 ||
      status.file_service_registry_active,
  );
}

export function nasStatusFetchFailed(httpStatus?: number, payload?: unknown): NasClientStatus {
  let extra = "";
  if (httpStatus && httpStatus > 0) extra = `（HTTP ${httpStatus}`;
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      extra = extra ? `${extra}：${detail.trim()}` : `（${detail.trim()}`;
    }
  }
  if (extra && !extra.endsWith("）")) extra = `${extra}）`;
  return {
    nas_client_online: false,
    nas_client_last_poll_at: null,
    lan_direct_enabled: false,
    transfer_ready: false,
    message: extra ? `请联系管理员：NAS客户端状态检测失败${extra}` : "请联系管理员：NAS客户端状态检测失败",
  };
}
