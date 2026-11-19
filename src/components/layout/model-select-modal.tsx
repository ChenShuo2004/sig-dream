import { App, Button, Checkbox, Input, Modal, Select, Spin } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { modelCategories, modelVendor, type ModelCategory } from "@/lib/model-catalog";
import { ai007CatalogNames, apimartCatalogNames, crunCatalogNames, deepseekCatalogNames, metasoCatalogNames, onionCatalogNames, RELAY_STATIONS, relayStationOf, runninghubCatalogNames, runninghubModelLabel, volcengineCatalogNames, type RelayStationId } from "@/lib/relay-stations";
import { cn } from "@/lib/utils";
import { fetchChannelModels } from "@/services/api/image";
import { fetchOnionModels, type OnionModelProfile } from "@/services/api/onion-relay";
import { formatModelPoints, type ModelChannel } from "@/stores/use-config-store";

function uniqueNames(names: string[]) {
    return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
}

// Channel catalog: load every model the provider exposes, then keep only the ones the admin checks.
export function ModelSelectModal({ open, channel, selectedNames, onConfirm, onClose, onSwitchStation }: { open: boolean; channel: ModelChannel | null; selectedNames: string[]; onConfirm: (names: string[], profiles?: OnionModelProfile[]) => void; onClose: () => void; onSwitchStation?: (station: RelayStationId, names: string[]) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [catalog, setCatalog] = useState<string[]>([]);
    const [profiles, setProfiles] = useState<Map<string, OnionModelProfile>>(new Map());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [vendor, setVendor] = useState("all");
    const [category, setCategory] = useState<"all" | ModelCategory>("all");
    const [loading, setLoading] = useState(false);

    const loadCatalog = async (target: ModelChannel, enabled: string[]) => {
        const station = relayStationOf(target);
        const preset =
            station === "ai007"
                ? ai007CatalogNames()
                : station === "runninghub"
                  ? runninghubCatalogNames()
                  : station === "metaso"
                    ? metasoCatalogNames()
                    : station === "volcengine"
                      ? volcengineCatalogNames()
                      : station === "crun"
                        ? crunCatalogNames()
                      : station === "apimart"
                        ? apimartCatalogNames()
                        : station === "deepseek"
                          ? deepseekCatalogNames()
                          : station === "onion"
                            ? onionCatalogNames()
                            : [];
        // RunningHub / Metaso / Volcano curated catalogs are not listed via OpenAI /models.
        if (station === "runninghub" || station === "metaso" || station === "volcengine") {
            setCatalog(uniqueNames([...preset, ...enabled]));
            return;
        }
        if (station === "onion") {
            if (!target.apiKey.trim()) {
                setProfiles(new Map());
                setCatalog(uniqueNames([...preset, ...enabled]));
                message.error(t("config.modelSelect.missingConfig"));
                return;
            }
            setLoading(true);
            try {
                const rows = await fetchOnionModels(target.apiKey);
                const live = new Map(rows.map((row) => [row.id, row]));
                const compact = (value: string) => value.replace(/\s+/g, "").toLowerCase();
                const foldId = (value: string) => value.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-").toLowerCase();
                const byLabel = new Map(rows.map((row) => [compact(row.label), row.id]));
                const byFoldedId = new Map(rows.map((row) => [foldId(row.id), row.id]));
                const nextSelected = new Set<string>();
                const extras: string[] = [];
                enabled.forEach((name) => {
                    const folded = byFoldedId.get(foldId(name));
                    if (live.has(name)) nextSelected.add(name);
                    else if (folded) nextSelected.add(folded);
                    else if (byLabel.has(compact(name))) nextSelected.add(byLabel.get(compact(name)) || name);
                    else {
                        extras.push(name);
                        nextSelected.add(name);
                    }
                });
                setProfiles(live);
                setSelected(nextSelected);
                setCatalog(uniqueNames([...rows.map((row) => row.id), ...extras]));
                message.success(t("config.modelSelect.fetched", { count: rows.length }));
            } catch (error) {
                setProfiles(new Map());
                setCatalog(uniqueNames([...preset, ...enabled]));
                message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
            } finally {
                setLoading(false);
            }
            return;
        }
        if (!target.baseUrl.trim() || !target.apiKey.trim()) {
            setProfiles(new Map());
            setCatalog(uniqueNames([...preset, ...enabled]));
            if (!preset.length) message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(target);
            setProfiles(new Map());
            setCatalog(uniqueNames([...models, ...preset, ...enabled]));
            message.success(t("config.modelSelect.fetched", { count: models.length }));
        } catch (error) {
            setProfiles(new Map());
            setCatalog(uniqueNames([...preset, ...enabled]));
            message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open || !channel) return;
        const enabled = uniqueNames(selectedNames);
        setCatalog(enabled);
        setSelected(new Set(enabled));
        setSearch("");
        setManual("");
        setVendor("all");
        setCategory("all");
        void loadCatalog(channel, enabled);
        // Reload when the dialog opens for this channel. selectedNames is snapshotted here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, channel?.id, channel?.baseUrl, channel?.apiKey, channel?.apiFormat]);

    const vendors = useMemo(() => {
        const counts = new Map<string, number>();
        catalog.forEach((name) => {
            const label = modelVendor(name);
            counts.set(label, (counts.get(label) || 0) + 1);
        });
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
    }, [catalog]);
    const categories = (["all", "text", "image", "vision", "video", "audio", "embedding", "other"] as const).filter((item) => item === "all" || catalog.some((name) => modelCategories(name).includes(item)));
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return catalog.filter((name) => {
            if (vendor !== "all" && modelVendor(name) !== vendor) return false;
            if (category !== "all" && (profiles.has(name) ? category !== "video" : !modelCategories(name).includes(category))) return false;
            if (!keyword) return true;
            const profile = profiles.get(name);
            const label = (profile?.label || channel?.models.find((model) => model.name === name)?.label?.trim() || runninghubModelLabel(name)).toLowerCase();
            const points = profile && typeof profile.price === "number" ? formatModelPoints(profile.price, profile.billingMode).toLowerCase() : "";
            return name.toLowerCase().includes(keyword) || (label && label.includes(keyword)) || points.includes(keyword);
        });
    }, [catalog, category, channel?.models, profiles, search, vendor]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        setCatalog((current) => uniqueNames([name, ...current]));
        setSelected((current) => new Set(current).add(name));
        setManual("");
    };

    const confirm = () => {
        onConfirm(catalog.filter((name) => selected.has(name)), Array.from(profiles.values()));
        onClose();
    };

    return (
        <Modal
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    {t("config.modelSelect.title")} <span className="ml-2 text-xs font-normal text-stone-500">{t("config.modelSelect.selected", { selected: selected.size, total: catalog.length })}</span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {t("common.cancel")}
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    {t("config.modelSelect.confirm")}
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.modelSelect.search")} prefix={<Search className="size-4 text-stone-400" />} allowClear />
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("config.modelSelect.modelName")} />
                <Button onClick={addManual}>{t("config.modelSelect.add")}</Button>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => channel && void loadCatalog(channel, catalog)}>
                    {t("config.modelSelect.fetch")}
                </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {onSwitchStation ? (
                    <Select
                        value={relayStationOf(channel) || undefined}
                        placeholder={t("config.modelSelect.station")}
                        onChange={(station: RelayStationId) => {
                            if (!channel || station === relayStationOf(channel)) return;
                            onSwitchStation(station, catalog.filter((name) => selected.has(name)));
                        }}
                        className="min-w-[160px]"
                        popupMatchSelectWidth={false}
                        options={RELAY_STATIONS.map((station) => ({ value: station.id, label: station.label }))}
                    />
                ) : null}
                <Select
                    value={vendor}
                    onChange={setVendor}
                    className="min-w-[180px]"
                    popupMatchSelectWidth={false}
                    options={[{ value: "all", label: t("config.modelSelect.allVendors") }, ...vendors.map(([label, count]) => ({ value: label, label: `${label} (${count})` }))]}
                />
                {categories.map((item) => {
                    const active = category === item;
                    return (
                        <button
                            key={item}
                            type="button"
                            onClick={() => setCategory(item)}
                            className={cn(
                                "rounded-md border px-2.5 py-1 text-xs font-medium",
                                active ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950" : "border-stone-300 bg-transparent text-stone-600 dark:border-stone-600 dark:text-stone-200",
                            )}
                        >
                            {t(`config.modelSelect.categories.${item}`)}
                        </button>
                    );
                })}
            </div>
            <div className="mt-2 text-xs text-stone-500">{t("config.modelSelect.description")}</div>

            <div className="mb-3 mt-4 flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500">{t("config.modelSelect.visibleSelected", { selected: visibleSelectedCount, total: visibleList.length })}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("config.modelSelect.selectVisible")}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("config.modelSelect.clearVisible")}
                    </Button>
                </div>
            </div>

            {loading && !catalog.length ? (
                <div className="flex justify-center py-10">
                    <Spin />
                </div>
            ) : visibleList.length ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                    {visibleList.map((name) => {
                        const profile = profiles.get(name);
                        const label = profile?.label || channel?.models.find((model) => model.name === name)?.label?.trim() || runninghubModelLabel(name);
                        const points = profile && typeof profile.price === "number" ? formatModelPoints(profile.price, profile.billingMode) : "";
                        const showId = Boolean(label && label !== name);
                        const title = [label || name, points, showId ? name : ""].filter(Boolean).join(" · ");
                        return (
                            <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)}>
                                <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-2" title={title}>
                                    <span>{label || name}</span>
                                    {points ? <span className="text-[11px] text-stone-500 dark:text-stone-300">{points}</span> : null}
                                    {showId ? <span className="text-[11px] text-stone-400">{name}</span> : null}
                                </span>
                            </Checkbox>
                        );
                    })}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">{t("config.modelSelect.fetchedEmpty")}</div>
            )}
        </Modal>
    );
}
