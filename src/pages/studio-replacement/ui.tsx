import type { ReactNode } from "react";
import { Select } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { findRelayChannel, runninghubModelLabel, runninghubVideoCatalog } from "@/lib/relay-stations";
import { cn } from "@/lib/utils";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { getStudioMediaBlob } from "@/studios/media";
import {
    DarkButton,
    DarkScope,
    EmptyHint,
    IconButton,
    Pager,
    Panel,
    StatusBadge,
    Tabs,
    disabledPillStyle,
    inkOnWhiteStyle,
} from "@/studios/components/studio-dark-ui";
import { decodeChannelModel, encodeChannelModel, selectableModelsByCapability, useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";

export {
    DarkButton,
    DarkScope,
    EmptyHint,
    IconButton,
    Pager,
    Panel,
    StatusBadge,
    Tabs,
    disabledPillStyle,
    inkOnWhiteStyle,
};

export function useModelOptions(capability: ModelCapability) {
    const config = useConfigStore((state) => state.config);
    return selectableModelsByCapability(config, capability).map((value) => ({ value, label: decodeChannelModel(value)?.model || value }));
}

/**
 * Replacement studio video models — fixed RunningHub AI App catalog only
 * (Scail V1/V2、V5.4、Animate2、Bernini、Hailuo H3 Edit). Never mixes other channels.
 */
export function useRunningHubVideoOptions() {
    const config = useConfigStore((state) => state.config);
    const channel = findRelayChannel(config.channels, "runninghub");
    return runninghubVideoCatalog("edit").map((model) => ({
        value: channel ? encodeChannelModel(channel.id, model.name) : model.name,
        label: model.label || runninghubModelLabel(model.name) || model.name,
    }));
}

/** Map a saved videoModel (bare id / channel::id / stale non-RH) onto a catalog option value. */
export function resolveRunningHubVideoOptionValue(value: string, options: Array<{ value: string; label: string }>) {
    const raw = (value || "").trim();
    if (!raw) return "";
    if (options.some((item) => item.value === raw)) return raw;
    const bare = decodeChannelModel(raw)?.model || raw.replace(/^runninghub\//i, "");
    const matched = options.find((item) => {
        const name = decodeChannelModel(item.value)?.model || item.value;
        return name === bare;
    });
    return matched?.value || "";
}

export const QUALITY_OPTIONS = [
    { value: "auto", label: "自动质量" },
    { value: "high", label: "高质量" },
    { value: "medium", label: "中等质量" },
    { value: "low", label: "低质量" },
];

export const RATIO_OPTIONS = ["9:16", "3:4", "1:1", "4:3", "16:9"].map((value) => ({ value, label: value }));

export function ModelSelect({
    capability,
    value,
    onChange,
    placeholder,
    className,
    options: optionsOverride,
}: {
    capability: ModelCapability;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    options?: Array<{ value: string; label: string }>;
}) {
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    // Locked catalogs (e.g. RunningHub-only video) keep a flat Select; otherwise provider → model.
    if (optionsOverride) {
        return (
            <Select
                size="small"
                variant="filled"
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                className={cn("min-w-[150px]", className)}
                placeholder={placeholder || "默认模型"}
                value={value || undefined}
                onChange={(next) => onChange(next || "")}
                allowClear
                options={optionsOverride}
            />
        );
    }
    return (
        <ModelPicker
            className={cn("min-w-[150px]", className)}
            config={config}
            value={value}
            onChange={onChange}
            capability={capability}
            placeholder={placeholder || "默认模型"}
            onMissingConfig={() => openConfigDialog(true)}
        />
    );
}

export function SmallSelect<T extends string>({ value, onChange, options, className }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string }) {
    return <Select size="small" variant="filled" popupMatchSelectWidth={false} className={cn("min-w-[92px]", className)} value={value} onChange={onChange} options={options} />;
}

/** Copies studio media into the canvas asset library (the 素材库 shared with canvas projects). */
export async function addStudioMediaToCanvas(items: Array<{ key: string; title: string; kind: "image" | "video" | "audio" }>) {
    const { addAsset } = useAssetStore.getState();
    let added = 0;
    for (const item of items) {
        const blob = item.key ? await getStudioMediaBlob(item.key) : null;
        if (!blob) continue;
        if (item.kind === "image") {
            const image = await uploadImage(blob);
            addAsset({ kind: "image", title: item.title, coverUrl: image.url, tags: ["人物替换"], source: "替换工作室", data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
        } else if (item.kind === "audio") {
            const media = await uploadMediaFile(blob, "audio");
            addAsset({ kind: "audio", title: item.title, coverUrl: "", tags: ["声音克隆"], source: "替换工作室", data: { url: media.url, storageKey: media.storageKey, width: 0, height: 0, bytes: media.bytes, mimeType: media.mimeType } });
        } else {
            const media = await uploadMediaFile(blob, "video");
            addAsset({ kind: "video", title: item.title, coverUrl: "", tags: ["人物替换"], source: "替换工作室", data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
        }
        added += 1;
    }
    return added;
}
