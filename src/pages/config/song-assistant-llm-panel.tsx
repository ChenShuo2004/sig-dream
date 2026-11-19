import { useEffect, useMemo, useState } from "react";
import { Button, Select, Space, message } from "antd";

import { authorizedFetch, readDetail, readableError } from "@/services/api/canvas-channels";
import { useConfigStore, type ModelChannel } from "@/stores/use-config-store";

type TextChannel = {
    id: string;
    name: string;
    baseUrl: string;
    has_key: boolean;
    models: Array<{ name: string; label?: string; capability?: string }>;
};

type BindingResponse = {
    channel_id?: string;
    model?: string;
    max_tokens?: number;
    ready?: boolean;
    channel_name?: string;
    channels?: TextChannel[];
    sync?: { ok?: boolean; detail?: string };
};

function textChannelsFromStore(channels: ModelChannel[]): TextChannel[] {
    return channels
        .filter((channel) => (channel.apiFormat || "openai") !== "gemini" && channel.baseUrl.trim())
        .map((channel) => {
            const models = (channel.models || [])
                .filter((model) => (model.capability || "text") === "text" && model.name.trim())
                .map((model) => ({ name: model.name, label: model.label || model.name, capability: "text" }));
            return {
                id: channel.id,
                name: channel.name || "未命名渠道",
                baseUrl: channel.baseUrl.trim().replace(/\/+$/, ""),
                has_key: Boolean(channel.apiKey?.trim() || channel.apiKeys?.some((item) => item.key?.trim())),
                models,
            };
        })
        .filter((channel) => channel.models.length > 0);
}

export function SongAssistantLlmPanel() {
    const storeChannels = useConfigStore((state) => state.config.channels);
    const [remoteChannels, setRemoteChannels] = useState<TextChannel[] | null>(null);
    const [channelId, setChannelId] = useState("");
    const [model, setModel] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncNote, setSyncNote] = useState("");

    const channels = useMemo(() => {
        const fromRemote = remoteChannels && remoteChannels.length ? remoteChannels : textChannelsFromStore(storeChannels);
        return fromRemote;
    }, [remoteChannels, storeChannels]);

    const selected = channels.find((item) => item.id === channelId) || null;
    const modelOptions = (selected?.models || []).map((item) => ({
        value: item.name,
        label: item.label || item.name,
    }));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const response = await authorizedFetch("/api-proxy/canvas-lan/yue2/assistant-llm");
                if (!response.ok) throw new Error(readableError(await readDetail(response), "读取创作助手渠道失败"));
                const payload = (await response.json()) as BindingResponse;
                if (cancelled) return;
                setRemoteChannels(Array.isArray(payload.channels) ? payload.channels : []);
                setChannelId(payload.channel_id || "");
                setModel(payload.model || "");
                if (payload.sync && payload.sync.ok === false) setSyncNote(String(payload.sync.detail || ""));
            } catch (error) {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取创作助手渠道失败");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!channelId && channels[0]) setChannelId(channels[0].id);
    }, [channelId, channels]);

    useEffect(() => {
        if (!selected) return;
        if (!model || !selected.models.some((item) => item.name === model)) {
            setModel(selected.models[0]?.name || "");
        }
    }, [selected, model]);

    const save = async () => {
        if (!channelId || !model) {
            message.warning("请先选择渠道和文本模型");
            return;
        }
        setSaving(true);
        setSyncNote("");
        try {
            const response = await authorizedFetch("/api-proxy/canvas-lan/yue2/assistant-llm", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel_id: channelId, model }),
            });
            if (!response.ok) throw new Error(readableError(await readDetail(response), "保存失败"));
            const payload = (await response.json()) as BindingResponse;
            setRemoteChannels(Array.isArray(payload.channels) ? payload.channels : remoteChannels);
            if (payload.sync?.ok === false) {
                setSyncNote(String(payload.sync.detail || "已保存到平台，但同步到歌曲机失败（文件机暂不可达时仍可稍后再试）"));
                message.warning("已保存；同步到歌曲机失败，生成助手时会再试");
            } else {
                message.success("已保存：创作助手将使用该渠道模型");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
            <div className="mb-3">
                <h2 className="text-base font-semibold text-stone-950 dark:text-stone-100">AI歌曲 · 创作助手渠道</h2>
                <p className="mt-1 text-sm text-stone-500">
                    直接选用上方已添加的 OpenAI 兼容<strong>文本</strong>渠道与模型，无需再单独填写地址和 API Key。音乐生成仍走局域网 YuE2。
                    创作助手在云端服务器调用渠道，请优先选 ECS 能直连的地址（如 DeepSeek 官方）；部分中转站仅本机浏览器可访问时会失败。
                </p>
            </div>
            <Space direction="vertical" size="middle" className="w-full">
                <div>
                    <div className="mb-1 text-sm text-stone-600 dark:text-stone-300">渠道</div>
                    <Select
                        className="w-full"
                        loading={loading}
                        placeholder={channels.length ? "选择渠道" : "请先在上方添加带文本模型的渠道"}
                        value={channelId || undefined}
                        options={channels.map((item) => ({
                            value: item.id,
                            label: `${item.name}${item.has_key ? "" : "（缺 Key）"}`,
                        }))}
                        onChange={(value) => setChannelId(value)}
                    />
                </div>
                <div>
                    <div className="mb-1 text-sm text-stone-600 dark:text-stone-300">文本模型</div>
                    <Select
                        className="w-full"
                        loading={loading}
                        placeholder="选择模型"
                        value={model || undefined}
                        options={modelOptions}
                        onChange={(value) => setModel(value)}
                        disabled={!selected}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="primary" onClick={() => void save()} loading={saving} disabled={!channelId || !model}>
                        保存创作助手渠道
                    </Button>
                    {selected ? (
                        <span className="text-xs text-stone-500">
                            {selected.name} · {model || "未选模型"}
                            {selected.has_key ? "" : " · 请先给该渠道保存 API Key"}
                        </span>
                    ) : null}
                </div>
                {syncNote ? <p className="text-xs text-amber-700 dark:text-amber-300">{syncNote}</p> : null}
            </Space>
        </section>
    );
}
