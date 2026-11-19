import { Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { channelModelsFromNames, onionModelPatch, RELAY_STATIONS, relayStationOf, type RelayStationId } from "@/lib/relay-stations";
import { apimartCapabilityOf, apimartLabelOf } from "@/services/api/apimart-relay";
import { authorizedFetch } from "@/services/api/canvas-channels";
import type { OnionModelProfile } from "@/services/api/onion-relay";
import { defaultBaseUrlForApiFormat, formatModelPoints, guessCapability, normalizeChannelApiKeys, normalizeChannelModels, type ApiCallFormat, type ChannelApiKey, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose, onSwitchStation }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void; onSwitchStation?: (station: RelayStationId, channel: ModelChannel) => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [accessOpen, setAccessOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [accounts, setAccounts] = useState<string[]>([]);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
        if (!open) setAccessOpen(false);
    }, [open, channel]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void authorizedFetch("/api-proxy/settings/users")
            .then(async (response) => (response.ok ? ((await response.json()) as Array<{ username?: string; status?: string }>) : []))
            .then((rows) => {
                if (cancelled) return;
                setAccounts(rows.filter((row) => row.status !== "disabled" && row.username).map((row) => row.username as string));
            })
            .catch(() => {
                if (!cancelled) setAccounts([]);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[], profiles: OnionModelProfile[] = []) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        const live = new Map(profiles.map((profile) => [profile.id, profile]));
        const station = relayStationOf(draft);
        const presets = new Map(channelModelsFromNames(names, draft.models).map((model) => [model.name, model]));
        setModels(
            names.map((name) => {
                const profile = live.get(name);
                const previous = map.get(name);
                if (profile) return { ...previous, name, capability: "video", script: previous?.script, ...onionModelPatch(profile) };
                if (previous) return previous;
                const preset = presets.get(name);
                if (preset) return preset;
                const capability = (station === "apimart" && apimartCapabilityOf(name)) || guessCapability(name);
                const label = station === "apimart" ? apimartLabelOf(name) : "";
                return { name, capability, ...(label ? { label } : {}) };
            }),
        );
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setLabel = (name: string, label: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, label } : model)));
    const setAllowedUsers = (name: string, allowedUsers: string[]) => setModels(draft.models.map((model) => (model.name === name ? { ...model, allowedUsers: allowedUsers.length ? allowedUsers : undefined } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const apiKeys = draft.apiKeys || [];
    const setApiKeys = (next: ChannelApiKey[]) => patch({ apiKeys: next });
    const addApiKey = () => setApiKeys([...apiKeys, { id: nanoid(), label: "", key: "", users: [] }]);
    const patchApiKey = (id: string, value: Partial<ChannelApiKey>) => setApiKeys(apiKeys.map((item) => (item.id === id ? { ...item, ...value } : item)));
    const setKeyUsers = (id: string, users: string[]) => {
        setApiKeys(apiKeys.map((item) => (item.id === id ? { ...item, users } : { ...item, users: item.users.filter((name) => !users.includes(name)) })));
    };
    const save = () => {
        onSave({
            ...draft,
            name: draft.name.trim() || t("config.channels.unnamed"),
            models: normalizeChannelModels(draft.models),
            apiKeys: normalizeChannelApiKeys(draft.apiKeys, draft.apiKey),
        });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            {onSwitchStation ? (
                <label className="mb-4 block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channels.station")}</span>
                    <Select
                        className="w-full"
                        value={relayStationOf(draft) || undefined}
                        placeholder={t("config.channels.station")}
                        options={RELAY_STATIONS.map((station) => ({ value: station.id, label: station.label }))}
                        onChange={(station: RelayStationId) => {
                            if (station === relayStationOf(draft)) return;
                            onSwitchStation(station, { ...draft, models: normalizeChannelModels(draft.models) });
                        }}
                    />
                </label>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.defaultApiKey")}</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                    <span className="mt-1 block text-xs text-stone-500">{t("config.channelEditor.defaultApiKeyHint")}</span>
                </label>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button onClick={() => setAccessOpen(true)}>{t("config.channelEditor.accessPage")}</Button>
                    <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                        {t("config.channelEditor.selectModels")}
                    </Button>
                </div>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-col gap-1.5 rounded-md px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    size="small"
                                    className="min-w-0 flex-1"
                                    value={model.label || ""}
                                    placeholder={t("config.channelEditor.displayLabelPlaceholder")}
                                    aria-label={t("config.channelEditor.displayLabel")}
                                    onChange={(event) => setLabel(model.name, event.target.value)}
                                />
                                <div className="flex shrink-0 items-center gap-2">
                                    <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>
                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                                </div>
                            </div>
                            <div className="truncate text-[11px] text-stone-400" title={model.name}>
                                {t("config.channelEditor.modelId")}: {model.name}
                                {typeof model.price === "number" ? <span className="ml-2 text-stone-500 dark:text-stone-300">{formatModelPoints(model.price, model.billingMode)}</span> : null}
                                {model.allowedUsers?.length ? <span className="ml-2">{t("config.channelEditor.allowedUsersCount", { count: model.allowedUsers.length })}</span> : null}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <Drawer
                open={accessOpen}
                width={640}
                title={t("config.channelEditor.accessPage")}
                onClose={() => setAccessOpen(false)}
                styles={{ body: { paddingTop: 16 } }}
                extra={
                    <Button type="primary" onClick={() => setAccessOpen(false)}>
                        {t("common.done")}
                    </Button>
                }
            >
                <p className="mb-4 text-xs text-stone-500">{t("config.channelEditor.accessPageHint")}</p>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-sm font-semibold">{t("config.channelEditor.extraApiKeys")}</div>
                        <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.extraApiKeysHint")}</div>
                    </div>
                    <Button icon={<Plus className="size-4" />} onClick={addApiKey}>
                        {t("config.channelEditor.addApiKey")}
                    </Button>
                </div>
                {apiKeys.length ? (
                    <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                        {apiKeys.map((item, index) => (
                            <div key={item.id} className="grid gap-2 rounded-md px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                <div className="flex items-center gap-2">
                                    <Input size="small" className="w-36" value={item.label} placeholder={t("config.channelEditor.apiKeyLabel", { index: index + 1 })} onChange={(event) => patchApiKey(item.id, { label: event.target.value })} />
                                    <Input.Password size="small" className="min-w-0 flex-1" value={item.key} placeholder="sk-..." onChange={(event) => patchApiKey(item.id, { key: event.target.value })} />
                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => setApiKeys(apiKeys.filter((entry) => entry.id !== item.id))} />
                                </div>
                                <Select
                                    mode="multiple"
                                    size="small"
                                    className="w-full"
                                    value={item.users}
                                    placeholder={t("config.channelEditor.apiKeyUsers")}
                                    options={Array.from(new Set([...item.users, ...accounts])).map((username) => ({ value: username, label: username }))}
                                    onChange={(users) => setKeyUsers(item.id, users)}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-stone-200 px-3 py-6 text-center text-sm text-stone-500 dark:border-stone-800">{t("config.channelEditor.extraApiKeysEmpty")}</div>
                )}

                <div className="mt-6 mb-3">
                    <div className="text-sm font-semibold">{t("config.channelEditor.allowedUsers")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.allowedUsersHint")}</div>
                </div>
                <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                    {draft.models.length ? (
                        draft.models.map((model) => (
                            <label key={model.name} className="block rounded-md px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                <span className="mb-1 block truncate text-xs text-stone-500" title={model.name}>
                                    {model.label?.trim() || model.name}
                                </span>
                                <Select
                                    mode="multiple"
                                    size="small"
                                    className="w-full"
                                    value={model.allowedUsers || []}
                                    placeholder={t("config.channelEditor.allowedUsersPlaceholder")}
                                    options={Array.from(new Set([...(model.allowedUsers || []), ...accounts])).map((username) => ({ value: username, label: username }))}
                                    onChange={(usernames) => setAllowedUsers(model.name, usernames)}
                                />
                            </label>
                        ))
                    ) : (
                        <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                    )}
                </div>
            </Drawer>

            <ModelSelectModal
                open={selectOpen}
                channel={draft}
                selectedNames={draft.models.map((model) => model.name)}
                onConfirm={applySelection}
                onClose={() => setSelectOpen(false)}
                onSwitchStation={
                    onSwitchStation
                        ? (station, names) => {
                              setSelectOpen(false);
                              onSwitchStation(station, { ...draft, models: channelModelsFromNames(names, draft.models) });
                          }
                        : undefined
                }
            />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
