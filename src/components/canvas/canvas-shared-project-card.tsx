import { App, Button } from "antd";
import { CopyPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { copySharedCanvasToMine, unshareCanvas, type SharedCanvasItem } from "@/services/api/canvas-shares";

export function CanvasSharedProjectCard({
    item,
    onChanged,
}: {
    item: SharedCanvasItem;
    onChanged: () => void;
}) {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);

    const useShared = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const id = await copySharedCanvasToMine(item.shareId);
            message.success(t("canvas.share.copied"));
            navigate(`/canvas/${id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.share.copyFailed"));
        } finally {
            setBusy(false);
        }
    };

    const removeShare = () => {
        modal.confirm({
            title: t("canvas.share.deleteTitle"),
            content: t("canvas.share.deleteDescription"),
            okText: t("canvas.project.delete"),
            okButtonProps: { danger: true },
            cancelText: t("canvas.share.cancel"),
            onOk: async () => {
                try {
                    await unshareCanvas(item.shareId);
                    message.success(t("canvas.share.deleted"));
                    onChanged();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("canvas.share.deleteFailed"));
                    throw error;
                }
            },
        });
    };

    return (
        <article className="flex min-h-44 flex-col justify-between rounded-2xl border border-dashed border-stone-300 bg-[#f7f4ef] p-5 dark:border-stone-700 dark:bg-white/[0.03]">
            <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t("canvas.share.badge")}</p>
                <h2 className="mt-2 truncate text-xl font-semibold">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
                    {t("canvas.project.stats", { nodes: item.nodeCount, connections: item.connectionCount })}
                </p>
                <p className="mt-1 text-xs text-stone-500">{t("canvas.share.owner", { name: item.owner })}</p>
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-stone-500">
                    {t("canvas.project.updated", {
                        date: new Date(item.updatedAt || item.createdAt).toLocaleString(i18n.resolvedLanguage, {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                        }),
                    })}
                </p>
                <div className="flex items-center gap-1">
                    <Button type="primary" size="small" loading={busy} icon={<CopyPlus className="size-4" />} onClick={() => void useShared()}>
                        {t("canvas.share.use")}
                    </Button>
                    {item.isOwner ? (
                        <Button type="text" size="small" shape="circle" danger icon={<Trash2 className="size-4" />} onClick={removeShare} aria-label={t("canvas.share.delete")} />
                    ) : null}
                </div>
            </div>
        </article>
    );
}
