"use client";

export type AuthSession = {
  access_token: string;
  username: string;
  role: string;
  permissions?: string[];
};

const AUTH_KEY = "lcp_auth_session";
const AUTH_COOKIE = "lcp_auth_token";

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
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_KEY);
  document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
