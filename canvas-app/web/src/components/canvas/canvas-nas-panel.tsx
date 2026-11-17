import { useEffect, useMemo, useRef, useState } from "react";
import { App, Empty, Input, Modal, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Image as ImageIcon, Music2, Search, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { writeCanvasInsertDrag } from "@/lib/canvas/canvas-drag-insert";
import { uploadMediaFile, resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { currentNasLibrary, fetchNasMediaBlob, listMyNasMedia, type NasMediaItem, type NasMediaKind } from "@/services/api/nas-media";

import type { InsertAssetPayload } from "./asset-picker-modal";

const GROUPS: { kind: NasMediaKind; icon: typeof ImageIcon }[] = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Video },
    { kind: "audio", icon: Music2 },
];

type StoredPull = {
    kind: NasMediaKind;
    title: string;
    storageKey: string;
    width?: number;
    height?: number;
    mimeType?: string;
};

type PulledView = { payload: InsertAssetPayload; cover: string };

const PULL_KEY = "canvas-nas-pulled";

function readPulls(library: string) {
    try {
        const all = JSON.parse(localStorage.getItem(PULL_KEY) || "{}") as Record<string, Record<string, StoredPull>>;
        return all[library] || {};
    } catch {
        return {};
    }
}

function writePull(library: string, id: string, record: StoredPull) {
    const all = (() => {
        try {
            return JSON.parse(localStorage.getItem(PULL_KEY) || "{}") as Record<string, Record<string, StoredPull>>;
        } catch {
            return {};
        }
    })();
    all[library] = { ...(all[library] || {}), [id]: record };
    localStorage.setItem(PULL_KEY, JSON.stringify(all));
}

function forgetPull(library: string, id: string) {
    try {
        const all = JSON.parse(localStorage.getItem(PULL_KEY) || "{}") as Record<string, Record<string, StoredPull>>;
        if (!all[library]) return;
        delete all[library][id];
        localStorage.setItem(PULL_KEY, JSON.stringify(all));
    } catch {
        /* keep the in-memory card */
    }
}

async function viewFromRecord(record: StoredPull): Promise<PulledView | null> {
    if (record.kind === "image") {
        const url = await resolveImageUrl(record.storageKey, "");
        if (!url) return null;
        return { cover: url, payload: { kind: "image", dataUrl: url, storageKey: record.storageKey, title: record.title } };
    }
    const url = await resolveMediaUrl(record.storageKey, "");
    if (!url) return null;
    if (record.kind === "video") return { cover: url, payload: { kind: "video", url, storageKey: record.storageKey, title: record.title, width: record.width, height: record.height } };
    return { cover: "", payload: { kind: "audio", url, storageKey: record.storageKey, title: record.title, mimeType: record.mimeType } };
}

export function CanvasNasTab({ theme }: { theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [queryText, setQueryText] = useState("");
    const [library, setLibrary] = useState(currentNasLibrary);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [pulled, setPulled] = useState<Record<string, PulledView>>({});
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<{ kind: NasMediaKind; title: string; src: string } | null>(null);
    const pulledRef = useRef(pulled);
    const busyRef = useRef(busyIds);
    pulledRef.current = pulled;
    busyRef.current = busyIds;

    useEffect(() => {
        const timer = window.setTimeout(() => setQueryText(keyword.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    useEffect(() => {
        const sync = () => setLibrary(currentNasLibrary());
        window.addEventListener("focus", sync);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener("focus", sync);
            window.removeEventListener("storage", sync);
        };
    }, []);
    useEffect(() => {
        const records = readPulls(library);
        let cancelled = false;
        void (async () => {
            const next: Record<string, PulledView> = {};
            for (const [id, record] of Object.entries(records)) {
                const view = await viewFromRecord(record).catch(() => null);
                if (!view) forgetPull(library, id);
                else next[id] = view;
            }
            if (!cancelled) setPulled(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [library]);

    const query = useQuery({
        queryKey: ["canvas-nas-media", library, queryText],
        queryFn: () => listMyNasMedia(queryText),
        staleTime: 30_000,
    });
    const items = query.data?.items || [];
    const truncated = Boolean(query.data?.truncated);
    const groups = useMemo(() => GROUPS.map((group) => ({ ...group, items: items.filter((item) => item.kind === group.kind) })).filter((group) => group.items.length > 0), [items]);
    const pendingItems = items.filter((item) => !pulled[item.id]);

    const markBusy = (id: string, on: boolean) => {
        const next = new Set(busyRef.current);
        if (on) next.add(id);
        else next.delete(id);
        busyRef.current = next;
        setBusyIds(next);
    };

    const pullItem = async (item: NasMediaItem): Promise<"ok" | "login" | "fail"> => {
        if (pulledRef.current[item.id] || busyRef.current.has(item.id)) return "ok";
        markBusy(item.id, true);
        try {
            const blob = await fetchNasMediaBlob(item);
            let view: PulledView;
            let stored: StoredPull;
            if (item.kind === "image") {
                const image = await uploadImage(blob);
                if (!image.storageKey) throw new Error("store");
                stored = { kind: "image", title: item.title, storageKey: image.storageKey };
                view = { cover: image.url, payload: { kind: "image", dataUrl: image.url, storageKey: image.storageKey, title: item.title } };
            } else {
                const media = await uploadMediaFile(blob, item.kind);
                if (item.kind === "video") {
                    stored = { kind: "video", title: item.title, storageKey: media.storageKey, width: item.width || media.width, height: item.height || media.height };
                    view = { cover: media.url, payload: { kind: "video", url: media.url, storageKey: media.storageKey, title: item.title, width: stored.width, height: stored.height } };
                } else {
                    stored = { kind: "audio", title: item.title, storageKey: media.storageKey, mimeType: media.mimeType };
                    view = { cover: "", payload: { kind: "audio", url: media.url, storageKey: media.storageKey, title: item.title, mimeType: media.mimeType } };
                }
            }
            writePull(library, item.id, stored);
            setPulled((current) => ({ ...current, [item.id]: view }));
            return "ok";
        } catch (error) {
            return error instanceof Error && error.message === "login" ? "login" : "fail";
        } finally {
            markBusy(item.id, false);
        }
    };

    const pullAll = async () => {
        const queue = items.filter((item) => !pulledRef.current[item.id] && !busyRef.current.has(item.id));
        if (!queue.length) return;
        let done = 0;
        let failed = 0;
        const total = queue.length;
        const report = () => message.open({ key: "nas-pull-all", type: "loading", duration: 0, content: t("canvas.sidePanel.nasPulling", { done, total }) });
        report();
        const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
            while (queue.length) {
                const item = queue.shift();
                if (!item) return;
                const result = await pullItem(item);
                if (result === "ok") done += 1;
                else failed += 1;
                report();
            }
        });
        await Promise.all(workers);
        message.destroy("nas-pull-all");
        if (failed) message.warning(t("canvas.sidePanel.nasPullAllPartial", { failed }));
        else message.success(t("canvas.sidePanel.nasPullAllDone", { count: done }));
    };

    const loginError = query.error instanceof Error && query.error.message === "login";
    const pullStyle = { color: theme.canvas.background, WebkitTextFillColor: theme.canvas.background, background: theme.node.text } as const;

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchNas")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <button type="button" disabled={!pendingItems.length || busyIds.size > 0} onClick={() => void pullAll()} className="h-7 shrink-0 rounded-md px-2 text-xs font-semibold disabled:opacity-40" style={pullStyle}>
                    {t("canvas.sidePanel.nasPullAll")}
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {query.isLoading ? (
                    <div className="flex justify-center pt-16">
                        <Spin />
                    </div>
                ) : loginError ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.nasLogin")} className="pt-16" />
                ) : query.isError ? (
                    <button type="button" onClick={() => void query.refetch()} className="block w-full py-16 text-center text-xs text-red-500">
                        {t("canvas.sidePanel.loadFailedRetry")}
                    </button>
                ) : groups.length ? (
                    <div className="space-y-1">
                        {truncated ? <div className="px-1.5 pb-1 text-[11px] leading-4 opacity-60">{t("canvas.sidePanel.nasTruncated")}</div> : null}
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button type="button" onClick={() => setCollapsed((current) => ({ ...current, [group.kind]: !current[group.kind] }))} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{t(`assets.kinds.${group.kind}`)}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((item) => (
                                                <NasCard
                                                    key={item.id}
                                                    item={item}
                                                    pulled={pulled[item.id]}
                                                    busy={busyIds.has(item.id)}
                                                    theme={theme}
                                                    pullStyle={pullStyle}
                                                    onPull={() =>
                                                        void pullItem(item).then((result) => {
                                                            if (result === "login") message.error(t("canvas.sidePanel.nasLogin"));
                                                            else if (result === "fail") message.error(t("canvas.sidePanel.nasInsertFailed"));
                                                        })
                                                    }
                                                    onOpen={() => {
                                                        const view = pulled[item.id];
                                                        const src = view?.cover || (view?.payload.kind === "audio" ? view.payload.url : "");
                                                        if (src) setPreview({ kind: item.kind, title: item.title, src });
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={queryText ? t("canvas.sidePanel.nasNoMatch") : t("canvas.sidePanel.noNas")} className="pt-16" />
                )}
            </div>
            <Modal title={preview?.title} open={Boolean(preview)} centered footer={null} width="auto" zIndex={1400} destroyOnHidden onCancel={() => setPreview(null)} styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}>
                {preview?.kind === "image" ? (
                    <img src={preview.src} alt={preview.title} className="max-h-[80vh] max-w-[min(80vw,960px)] object-contain" />
                ) : preview?.kind === "video" ? (
                    <video key={preview.src} src={preview.src} controls autoPlay className="max-h-[80vh] max-w-[min(80vw,960px)] bg-black" />
                ) : preview?.kind === "audio" ? (
                    <audio key={preview.src} src={preview.src} controls autoPlay className="w-[min(80vw,480px)]" />
                ) : null}
            </Modal>
        </div>
    );
}

function NasCard({
    item,
    pulled,
    busy,
    theme,
    pullStyle,
    onPull,
    onOpen,
}: {
    item: NasMediaItem;
    pulled?: PulledView;
    busy: boolean;
    theme: CanvasTheme;
    pullStyle: { color: string; WebkitTextFillColor: string; background: string };
    onPull: () => void;
    onOpen: () => void;
}) {
    const { t } = useTranslation();
    const ready = Boolean(pulled);
    return (
        <div
            className="group relative aspect-square overflow-hidden rounded-xl border"
            style={{ borderColor: theme.node.stroke, background: theme.node.panel, cursor: ready ? "grab" : undefined }}
            draggable={ready}
            title={ready ? t("canvas.sidePanel.nasDrag") : undefined}
            onDragStart={(event) => {
                if (!pulled) return;
                event.stopPropagation();
                writeCanvasInsertDrag(event.dataTransfer, pulled.payload);
            }}
        >
            <button type="button" className="size-full" disabled={!ready} onClick={onOpen} aria-label={item.title}>
                {pulled?.cover && item.kind !== "audio" ? (
                    item.kind === "video" ? (
                        <video src={`${pulled.cover}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                    ) : (
                        <img src={pulled.cover} alt="" className="size-full object-cover" />
                    )
                ) : (
                    <span className="grid size-full place-items-center gap-2 p-3 text-center text-[11px] leading-snug" style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}>
                        {item.kind === "video" ? <Video className="size-5 opacity-70" /> : item.kind === "audio" ? <Music2 className="size-5 opacity-70" /> : <ImageIcon className="size-5 opacity-70" />}
                        <span className="line-clamp-3">{item.title}</span>
                    </span>
                )}
            </button>
            {pulled?.cover && item.kind !== "audio" ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-left text-[11px] leading-4">
                    <span className="line-clamp-2" style={{ color: "#f5f5f4", WebkitTextFillColor: "#f5f5f4" }}>
                        {item.title}
                    </span>
                </div>
            ) : null}
            {ready ? null : (
                <button type="button" disabled={busy} onClick={onPull} className="absolute bottom-2 left-1/2 h-7 -translate-x-1/2 rounded-full px-3 text-xs font-semibold disabled:opacity-60" style={pullStyle}>
                    {busy ? t("canvas.sidePanel.nasPullingOne") : t("canvas.sidePanel.nasPull")}
                </button>
            )}
        </div>
    );
}
