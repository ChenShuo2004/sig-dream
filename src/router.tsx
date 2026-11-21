import { createHashRouter, isRouteErrorResponse, Outlet, useRouteError } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";

function RouteErrorPage() {
    const error = useRouteError();
    const message = isRouteErrorResponse(error)
        ? error.statusText
        : error instanceof Error
          ? error.message
          : String(error ?? "未知错误");
    const stack = error instanceof Error ? error.stack : "";
    if (stack) console.error("[canvas route error]", error);
    const staleChunk = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(
        message,
    );
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-6 text-center text-white">
            <h1 className="text-lg font-medium">{staleChunk ? "页面资源已更新" : "页面出错了"}</h1>
            <p className="max-w-md text-sm text-white/60">
                {staleChunk ? "发版后旧缓存失效，请刷新后重试。" : message}
            </p>
            <button
                type="button"
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium"
                style={{ color: "#171717", WebkitTextFillColor: "#171717" }}
                onClick={() => window.location.reload()}
            >
                刷新页面
            </button>
        </div>
    );
}

export const router = createHashRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", lazy: () => import("@/pages/image").then((module) => ({ Component: module.default })) },
            { path: "/video", lazy: () => import("@/pages/video").then((module) => ({ Component: module.default })) },
            { path: "/assets", lazy: () => import("@/pages/assets").then((module) => ({ Component: module.default })) },
            { path: "/prompts", lazy: () => import("@/pages/prompts").then((module) => ({ Component: module.default })) },
            { path: "/canvas", lazy: () => import("@/pages/canvas").then((module) => ({ Component: module.default })) },
            { path: "/canvas/:id", lazy: () => import("@/pages/canvas/project").then((module) => ({ Component: module.default })) },
            { path: "/studio/:kind", lazy: () => import("@/pages/studio").then((module) => ({ Component: module.default })) },
            { path: "/studio/:kind/:id", lazy: () => import("@/pages/studio/project").then((module) => ({ Component: module.default })) },
            { path: "/config", lazy: () => import("@/pages/config").then((module) => ({ Component: module.default })) },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
