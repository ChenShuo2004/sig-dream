import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { ensureAi007Channel, ensureApimartChannel, ensureCrunChannel, ensureDeepSeekChannel, ensureGeeknowChannel, ensureMetasoChannel, ensureOnionChannel, ensureRunningHubChannel, ensureVolcengineChannel, findRelayChannel, mergeOnionProfiles } from "@/lib/relay-stations";
import { canUseCanvas, fetchCanvasChannels, isLocalCanvasPreview, platformRole, saveCanvasChannels } from "@/services/api/canvas-channels";
import { fetchOnionModels } from "@/services/api/onion-relay";
import { startCanvasWorkspaceSync } from "@/services/api/canvas-workspace";
import { replaceConfigChannels, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

async function refreshOnionProfiles(role: string) {
    try {
        const profiles = await fetchOnionModels();
        if (!profiles.length) return;
        const merged = mergeOnionProfiles(useConfigStore.getState().config.channels, profiles);
        if (!merged.changed) return;
        useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, merged.channels) }));
        if (role === "super_admin") await saveCanvasChannels(merged.channels);
    } catch {
        // The id list still works when the display names cannot be loaded.
    }
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const sharedChannelsLoaded = useRef(false);
    const [role, setRole] = useState<string | null>(null);
    const [channelsReady, setChannelsReady] = useState(false);
    const apiConfigNotice = useConfigStore((state) => state.apiConfigNotice);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        setRole(platformRole());
    }, []);

    useEffect(() => {
        if (channelsReady) startCanvasWorkspaceSync();
    }, [channelsReady]);

    useEffect(() => {
        if (!apiConfigNotice) return;
        message.warning(apiConfigNotice);
        useConfigStore.setState({ apiConfigNotice: "" });
    }, [apiConfigNotice, message]);

    useEffect(() => {
        if (!role || !canUseCanvas(role)) return;
        // Local preview: don't block the UI on shared-channel sync (often 401 without a platform login).
        if (isLocalCanvasPreview()) {
            setChannelsReady(true);
            return;
        }
        let cancelled = false;
        const loadSharedChannels = async () => {
            if (sharedChannelsLoaded.current) return;
            sharedChannelsLoaded.current = true;
            try {
                const remote = await fetchCanvasChannels();
                if (cancelled) return;
                if (remote.some((channel) => channel.baseUrl?.trim() && channel.apiKey?.trim())) {
                    const withAi007 = role === "super_admin" ? ensureAi007Channel(remote) : { channels: remote, changed: false };
                    const withOnion = role === "super_admin" ? ensureOnionChannel(withAi007.channels) : withAi007;
                    const withGeeknow = role === "super_admin" ? ensureGeeknowChannel(withOnion.channels) : withOnion;
                    // Backfill curated RH models when channel already exists (any role); only super_admin can create the channel.
                    const withRh =
                        role === "super_admin" || findRelayChannel(withGeeknow.channels, "runninghub")
                            ? ensureRunningHubChannel(withGeeknow.channels)
                            : withGeeknow;
                    const withApimart = role === "super_admin" ? ensureApimartChannel(withRh.channels) : withRh;
                    const withMetaso =
                        role === "super_admin" || findRelayChannel(withApimart.channels, "metaso")
                            ? ensureMetasoChannel(withApimart.channels)
                            : withApimart;
                    const withVolc =
                        role === "super_admin" || findRelayChannel(withMetaso.channels, "volcengine")
                            ? ensureVolcengineChannel(withMetaso.channels)
                            : withMetaso;
                    const withCrun =
                        role === "super_admin" || findRelayChannel(withVolc.channels, "crun")
                            ? ensureCrunChannel(withVolc.channels)
                            : withVolc;
                    const seeded = role === "super_admin" ? ensureDeepSeekChannel(withCrun.channels) : withCrun;
                    useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, seeded.channels) }));
                    if (
                        withAi007.changed ||
                        withOnion.changed ||
                        withGeeknow.changed ||
                        withRh.changed ||
                        withApimart.changed ||
                        withMetaso.changed ||
                        withVolc.changed ||
                        withCrun.changed ||
                        seeded.changed
                    ) {
                        await saveCanvasChannels(seeded.channels);
                    }
                    await refreshOnionProfiles(role);
                    return;
                }
                if (role !== "super_admin") return;
                const local = ensureDeepSeekChannel(
                    ensureCrunChannel(
                        ensureVolcengineChannel(
                            ensureMetasoChannel(ensureApimartChannel(ensureRunningHubChannel(ensureGeeknowChannel(ensureOnionChannel(ensureAi007Channel(useConfigStore.getState().config.channels).channels).channels).channels).channels).channels).channels,
                        ).channels,
                    ).channels,
                ).channels;
                if (local.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim())) {
                    useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, local) }));
                    await saveCanvasChannels(local);
                }
            } catch {
                sharedChannelsLoaded.current = false;
            } finally {
                if (!cancelled) setChannelsReady(true);
            }
        };
        const persist = useConfigStore.persist;
        if (persist.hasHydrated()) void loadSharedChannels();
        const unsubscribe = persist.onFinishHydration(() => {
            void loadSharedChannels();
        });
        return () => {
            cancelled = true;
            sharedChannelsLoaded.current = false;
            unsubscribe();
        };
    }, [role]);

    useEffect(() => {
        if (!role || !canUseCanvas(role) || !channelsReady) return;
        const reload = () => {
            if (document.visibilityState === "hidden") return;
            void fetchCanvasChannels()
                .then((remote) => {
                    if (!remote.some((channel) => channel.baseUrl?.trim() && channel.apiKey?.trim())) return;
                    useConfigStore.setState((state) => ({ config: replaceConfigChannels(state.config, remote) }));
                })
                .catch(() => undefined);
        };
        window.addEventListener("focus", reload);
        document.addEventListener("visibilitychange", reload);
        return () => {
            window.removeEventListener("focus", reload);
            document.removeEventListener("visibilitychange", reload);
        };
    }, [channelsReady, role]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    if (role === null) {
        return <main className="grid h-full place-items-center bg-background text-sm text-stone-500">正在确认权限…</main>;
    }

    if (!canUseCanvas(role)) {
        return (
            <main className="grid h-full place-items-center bg-background px-6 text-center">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">画布</h1>
                    <p className="mt-3 text-sm text-stone-500">需要登录，且角色为素材管理员或超级管理员。</p>
                </div>
            </main>
        );
    }

    if (!channelsReady) {
        return <main className="grid h-full place-items-center bg-background text-sm text-stone-500">{t("config.loadingSharedApi")}</main>;
    }

    return <>{children}</>;
}
