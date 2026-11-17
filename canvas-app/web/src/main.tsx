import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { requestPersistentStorage } from "@/studios/media";

initAnalytics();
requestPersistentStorage();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

/** After deploy, old tabs may request removed hashed chunks — reload once to pick up new index.html. */
const CHUNK_RELOAD_KEY = "canvas-app:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;
function isChunkLoadFailure(reason: unknown): boolean {
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|error loading dynamically imported module/i.test(
        message,
    );
}
function reloadOnceForStaleChunk(): void {
    try {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
        if (Number.isFinite(last) && Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
        /* ignore */
    }
    window.location.reload();
}
window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForStaleChunk();
});
window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadFailure(event.reason)) return;
    event.preventDefault();
    reloadOnceForStaleChunk();
});

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
