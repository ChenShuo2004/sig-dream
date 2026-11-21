import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Select } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import { CANVAS_AGENT_PACKAGE, buildAgentClients, quoteShell } from "@/lib/agent/agent-clients";

export function AgentClientSetup({ theme, codexPluginReminder, url }: { url: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; codexPluginReminder: ReactNode }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [packageSpec, setPackageSpec] = useState(CANVAS_AGENT_PACKAGE);
    useEffect(() => {
        const controller = new AbortController();
        void fetch("/runtime-info", { signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (typeof data?.packageSpec === "string") setPackageSpec(data.packageSpec);
            })
            .catch(() => {});
        return () => controller.abort();
    }, []);
    const shell = /Windows/i.test(navigator.userAgent) ? "powershell" : "posix";
    const clients = buildAgentClients(packageSpec, shell);
    const selectedClientId = useAgentStore((state) => state.selectedClientId);
    const client = clients.find((item) => item.id === selectedClientId) || clients[0];
    const clientId = client.id;
    const setClientId = (id: string) => {
        localStorage.setItem("canvas-agent-client", id);
        useAgentStore.getState().setAgentState({ selectedClientId: id });
    };
    const copy = async (value: string) => {
        try {
            if (await copyToClipboard(value)) message.success(t("agent.connect.setup.copied"));
            else message.error(t("agent.connect.setup.copyFailed"));
        } catch {
            message.error(t("agent.connect.setup.copyFailed"));
        }
    };
    const snippet = (label: string, value: string) => (
        <div className="mt-2 min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                <span>{label}</span>
                <Button size="small" type="text" aria-label={`${t("agent.connect.setup.copy")} ${label}`} icon={<Copy className="size-3.5" />} onClick={() => copy(value)}>
                    {t("agent.connect.setup.copy")}
                </Button>
            </div>
            <pre className="thin-scrollbar m-0 max-h-64 overflow-auto rounded-md border p-2 text-[11px] leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                <code>{value}</code>
            </pre>
        </div>
    );
    return (
        <div className="min-w-0 space-y-3">
            <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="text-sm font-medium">{t("agent.connect.setup.startTitle")}</div>
                <p className="my-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                    {t("agent.connect.setup.startText")}
                </p>
                {snippet(t("agent.connect.setup.startCommand"), `npx --yes --package ${quoteShell(packageSpec, shell)} -- canvas-agent`)}
            </div>
            <div className="min-w-0 rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <label htmlFor="canvas-agent-client" className="mb-2 block text-sm font-medium">
                    {t("agent.connect.setup.clientTitle")}
                </label>
                <Select
                    virtual={false}
                    id="canvas-agent-client"
                    className="w-full"
                    value={clientId}
                    onChange={setClientId}
                    options={clients.map((item) => ({ value: item.id, label: item.id === "generic" ? t("agent.connect.setup.generic") : item.name }))}
                />
                <p className="my-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                    {t(`agent.connect.setup.notes.${client.id}`)}
                </p>
                {client.command ? snippet(t("agent.connect.setup.installCommand"), client.command) : null}
                <details className="mt-3 text-xs" open={client.command ? undefined : true} key={client.id}>
                    <summary className="cursor-pointer leading-5">{t("agent.connect.setup.manualConfig")}</summary>
                    <div className="mt-2 break-words leading-5" style={{ color: theme.node.muted }}>
                        {client.configPath}
                    </div>
                    <p className="my-1 leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.setup.mergeHint")}
                    </p>
                    {snippet(t("agent.connect.setup.config"), client.config)}
                </details>
                {clientId === "generic" ? snippet(t("agent.connect.setup.httpConfig"), JSON.stringify({ mcpServers: { "infinite-canvas": { url: `${url.trim().replace(/\/$/, "")}/mcp`, headers: { Authorization: "Bearer <Connect token>" } } } }, null, 2)) : null}
                {client.verify ? snippet(t("agent.connect.setup.verify"), client.verify) : null}
                {client.docs ? (
                    <a className="mt-2 inline-block text-xs underline" href={client.docs} target="_blank" rel="noreferrer">
                        {t("agent.connect.setup.docs")}
                    </a>
                ) : null}
            </div>
            <div className="rounded-lg border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                <div className="font-medium" style={{ color: theme.node.text }}>
                    {t("agent.connect.setup.checkTitle")}
                </div>
                <p className="my-1">{t("agent.connect.setup.checkText")}</p>
                <Button size="small" onClick={() => copy(t("agent.connect.setup.testPrompt"))}>
                    {t("agent.connect.setup.copyPrompt")}
                </Button>
                <p className="mb-0 mt-2">{t("agent.connect.setup.boundary")}</p>
            </div>
            {clientId === "codex" ? (
                <details className="text-xs">
                    <summary className="cursor-pointer">{t("agent.connect.pluginTitle")}</summary>
                    <p className="leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.pluginText")}
                    </p>
                    {codexPluginReminder}
                </details>
            ) : null}
        </div>
    );
}
