import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { ApiCallLogPanel } from "@/pages/config/api-call-log-panel";
import { SongAssistantLlmPanel } from "@/pages/config/song-assistant-llm-panel";

function platformRole(): string {
    try {
        const raw = window.localStorage.getItem("lcp_auth_session");
        if (!raw) return "";
        const parsed = JSON.parse(raw) as { role?: unknown };
        return typeof parsed.role === "string" ? parsed.role : "";
    } catch {
        return "";
    }
}

export default function ConfigPage() {
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();
    const apiOnly = searchParams.get("scope") === "api";
    const [role, setRole] = useState<string | null>(apiOnly ? null : "skip");

    useEffect(() => {
        if (!apiOnly) return;
        setRole(platformRole());
    }, [apiOnly]);

    if (apiOnly && role === null) {
        return <main className="h-full bg-background p-6 text-sm text-stone-500">正在确认权限…</main>;
    }

    if (apiOnly && role !== "super_admin") {
        return (
            <main className="h-full bg-background p-6">
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">API设置</h1>
                <p className="mt-3 text-sm text-stone-500">仅超级管理员可修改 API 设置。</p>
            </main>
        );
    }

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{apiOnly ? "API设置" : t("config.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{apiOnly ? "仅超级管理员可修改。保存后，画布会使用这里的接口地址和 API Key。一个渠道可以有多把 Key，并把某把指定给某些账号。某个模型如果限定了用户，只有这些账号能在画布里看到并调用。" : t("config.description")}</p>
                </div>
                <AppConfigPanel onlyChannels={apiOnly} />
                {apiOnly ? (
                    <div className="mt-8">
                        <SongAssistantLlmPanel />
                    </div>
                ) : null}
                {apiOnly ? <ApiCallLogPanel /> : null}
            </div>
        </main>
    );
}
