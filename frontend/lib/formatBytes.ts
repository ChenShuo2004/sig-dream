/** Human-readable byte size for UI (B / KB / MB / GB). */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  const v = Math.floor(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10 * 1024 ? 2 : 1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Bytes per second for throughput lines (e.g. "2.3 MB/s"). */
export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}
