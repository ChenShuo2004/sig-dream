/** 与 Web `frontend/lib/auth.ts` 字段对齐，便于同一后端、同一 localStorage 键共存（桌面与浏览器勿混用同一配置文件即可）。 */

export type AuthSession = {
  access_token: string;
  username: string;
  role: string;
  permissions?: string[];
};

const AUTH_KEY = "lcp_auth_session";

export function loadAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.access_token || !parsed.role || !parsed.username) return null;
    return {
      access_token: parsed.access_token,
      role: parsed.role,
      username: parsed.username,
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession): void {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_KEY);
}

export function hasPermission(perm: string): boolean {
  const p = loadAuthSession()?.permissions ?? [];
  return p.includes(perm);
}
