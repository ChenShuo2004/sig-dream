import { createHashRouter, isRouteErrorResponse, Outlet, useRouteError } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import StudioListPage from "@/pages/studio";
import StudioProjectPage from "@/pages/studio/project";
import VideoPage from "@/pages/video";
import CoverAssistantPage from "@/pages/cover-assistant";
import SongPage from "@/pages/song";
import VoicePage from "@/pages/voice";

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
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/voice", element: <VoicePage /> },
            { path: "/song", element: <SongPage /> },
            { path: "/cover-assistant", element: <CoverAssistantPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/studio/:kind", element: <StudioListPage /> },
            { path: "/studio/:kind/:id", element: <StudioProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
