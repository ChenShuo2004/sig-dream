import type { TutorialKey } from "@/lib/tutorials";

export type TutorialProgressStatus = "not_started" | "in_progress" | "completed";

export type TutorialProgressRow = {
  tutorial_key: TutorialKey;
  status: TutorialProgressStatus;
  last_step: number;
  completed_at: string | null;
};

function authHeaders(token: string, extra: Record<string, string> = {}): HeadersInit {
  return { ...extra, Authorization: `Bearer ${token}` };
}

export async function fetchTutorialProgress(token: string): Promise<TutorialProgressRow[]> {
  const resp = await fetch("/api-proxy/tutorials/progress", { headers: authHeaders(token) });
  const data = (await resp.json()) as TutorialProgressRow[] | { detail?: string };
  if (!resp.ok) throw new Error(typeof (data as { detail?: string }).detail === "string" ? (data as { detail: string }).detail : JSON.stringify(data));
  return data as TutorialProgressRow[];
}

export async function startTutorialProgress(token: string, tutorial_key: TutorialKey): Promise<void> {
  const resp = await fetch("/api-proxy/tutorials/progress/start", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ tutorial_key }),
  });
  if (!resp.ok) {
    const data = (await resp.json()) as { detail?: string };
    throw new Error(data.detail || JSON.stringify(data));
  }
}

export async function updateTutorialProgress(token: string, tutorial_key: TutorialKey, last_step: number): Promise<void> {
  const resp = await fetch("/api-proxy/tutorials/progress/update", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ tutorial_key, last_step }),
  });
  if (!resp.ok) {
    const data = (await resp.json()) as { detail?: string };
    throw new Error(data.detail || JSON.stringify(data));
  }
}

export async function completeTutorialProgress(token: string, tutorial_key: TutorialKey): Promise<void> {
  const resp = await fetch("/api-proxy/tutorials/progress/complete", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ tutorial_key }),
  });
  if (!resp.ok) {
    const data = (await resp.json()) as { detail?: string };
    throw new Error(data.detail || JSON.stringify(data));
  }
}

export async function resetTutorialProgress(token: string, tutorial_key: TutorialKey): Promise<void> {
  const resp = await fetch("/api-proxy/tutorials/progress/reset", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ tutorial_key }),
  });
  if (!resp.ok) {
    const data = (await resp.json()) as { detail?: string };
    throw new Error(data.detail || JSON.stringify(data));
  }
}
