import { NextRequest, NextResponse } from "next/server";

const ALLOWLIST = ["/", "/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Desktop / 外部壳跨域调用 /api-proxy（与浏览器内同源 /api-proxy 语义一致；Electron 来自 :5173 等）
  if (pathname.startsWith("/api-proxy")) {
    const reqHdr = request.headers.get("Access-Control-Request-Headers");
    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        reqHdr || "Content-Type, Authorization, X-Access-Context, X-NAS-Client-Token, X-Asset-Library",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: cors });
    }
    const res = NextResponse.next();
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  // Hashed canvas static files must not redirect to /login HTML — dynamic import()
  // would otherwise fail with "Failed to fetch dynamically imported module".
  const isCanvasStatic =
    pathname.startsWith("/canvas-app/assets/") ||
    pathname.startsWith("/canvas-app/icons/") ||
    pathname.startsWith("/canvas-app/plugins/") ||
    pathname.startsWith("/canvas-app/prompts/") ||
    pathname.startsWith("/canvas-app/yue2-studio/") ||
    pathname === "/canvas-app/config.js" ||
    pathname === "/canvas-app/favicon.ico" ||
    pathname === "/canvas-app/logo.svg";
  if (isCanvasStatic) {
    const res = NextResponse.next();
    if (pathname.startsWith("/canvas-app/assets/")) {
      res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    if (pathname.startsWith("/canvas-app/yue2-studio/")) {
      // Song studio copy is cache-busted via ?v= on the iframe src.
      res.headers.set("Cache-Control", "no-cache");
    }
    return res;
  }

  // Keep /canvas-app/index.html behind auth (has a "." but is the app shell).
  if (
    !pathname.startsWith("/canvas-app") &&
    (pathname.startsWith("/_next") ||
      pathname.startsWith("/api") ||
      pathname.includes("."))
  ) {
    return NextResponse.next();
  }

  if (ALLOWLIST.includes(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("lcp_auth_token")?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("auth", "required");
    if (pathname !== "/login") {
      url.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  if (pathname === "/canvas-app/index.html") {
    // Always re-fetch shell so ASR/VoiceStudio and other LAN updates are not stuck on an old HTML→JS graph.
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
