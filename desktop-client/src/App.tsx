import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import AppHeader from "@/components/AppHeader";
import { AssetLibraryProvider } from "@/lib/assetLibrary";
import { loadAuthSession } from "@/lib/auth";
import { resolveBootConfig } from "@/lib/bootConfig";
import CanvasPage from "@/pages/CanvasPage";
import ApiSettingsPage from "@/pages/ApiSettingsPage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import CollectionsPage from "@/pages/CollectionsPage";
import DesktopSettingsPage from "@/pages/DesktopSettingsPage";
import HomePage from "@/pages/HomePage";
import LoginPage from "@/pages/LoginPage";
import ToolboxPage from "@/pages/ToolboxPage";
import VideoToGifPage from "@/pages/VideoToGifPage";
import MaterialsPage from "@/pages/MaterialsPage";
import WebParityPending from "@/pages/WebParityPending";
import WorkflowEditorPage from "@/pages/WorkflowEditorPage";

function ShellLayout() {
  const { pathname } = useLocation();
  const hidePlatformHeader = pathname === "/canvas" || pathname.startsWith("/canvas/");

  return (
    <AssetLibraryProvider>
      <div className="flex min-h-screen flex-col">
        {hidePlatformHeader ? null : <AppHeader />}
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
    </AssetLibraryProvider>
  );
}

function RequireAuth() {
  const loc = useLocation();
  const session = loadAuthSession();
  if (!session?.access_token) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <Outlet />;
}

function BootGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void resolveBootConfig().finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 text-sm text-slate-300">
        正在加载本机配置…
      </div>
    );
  }
  return children;
}

export default function App() {
  const pending = (title: string, refPath: string) => <WebParityPending title={title} refPath={refPath} />;

  return (
    <BootGate>
      <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/desktop/app-config" element={<DesktopSettingsPage />} />
        <Route path="/" element={<HomePage />} />

        <Route element={<RequireAuth />}>
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/materials/upload" element={pending("上传队列", "frontend/app/materials/upload/page.tsx")} />
          <Route path="/unorganized" element={pending("未整理", "frontend/app/unorganized/page.tsx")} />
          <Route path="/trash" element={pending("回收站", "frontend/app/trash/page.tsx")} />
          <Route path="/tags" element={pending("标签管理", "frontend/app/tags/page.tsx")} />
          <Route path="/tag-requests" element={pending("标签审核", "frontend/app/tag-requests/page.tsx")} />
          <Route path="/toolbox" element={<ToolboxPage />} />
          <Route path="/toolbox/video-to-gif" element={<VideoToGifPage />} />
          <Route path="/settings" element={pending("系统设置", "frontend/app/settings/page.tsx")} />
          <Route path="/settings/api" element={<ApiSettingsPage />} />
          <Route path="/sync-ops" element={pending("同步异常", "frontend/app/sync-ops/page.tsx")} />
          <Route path="/file-machine" element={pending("文件机与队列", "frontend/app/file-machine/page.tsx")} />
          <Route path="/operations" element={pending("操作日志", "frontend/app/operations/page.tsx")} />
          <Route path="/feedback" element={pending("意见反馈", "frontend/app/feedback/page.tsx")} />
          <Route path="/tutorials" element={pending("教程中心", "frontend/app/tutorials/page.tsx")} />
          <Route path="/tasks" element={pending("任务中心", "frontend/app/tasks/page.tsx")} />
          <Route path="/workflows/:id" element={<WorkflowEditorPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </BootGate>
  );
}
