import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Input, Select, Table, Tag } from "antd";

import { fetchApiCallLogs, fetchApiCallSummary, type ApiCallLogItem, type ApiCallLogQuery, type ApiCallSummary } from "@/services/api/api-call-log";

const capabilityOptions = [
    { value: "", label: "全部类型" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "text", label: "文本" },
    { value: "audio", label: "音频" },
];

const statusOptions = [
    { value: "", label: "全部状态" },
    { value: "success", label: "成功" },
    { value: "failed", label: "失败" },
    { value: "cancelled", label: "已取消" },
];

const actionLabel: Record<string, string> = {
    generate: "生成",
    edit: "改图",
    question: "问答",
    structured: "文本",
    submit: "提交任务",
    complete: "任务完成",
    describe: "声音描述",
};

const capabilityLabel: Record<string, string> = { image: "图片", video: "视频", text: "文本", audio: "音频" };

function statusTag(status: string) {
    if (status === "success") return <Tag color="green">成功</Tag>;
    if (status === "cancelled") return <Tag>已取消</Tag>;
    return <Tag color="red">失败</Tag>;
}

function formatDuration(ms: number) {
    if (!ms) return "—";
    if (ms < 1000) return `${ms} ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatTokens(value: number) {
    return value ? value.toLocaleString("zh-CN") : "—";
}

function formatConsumption(item: { total_tokens?: number; credits?: number }) {
    const parts: string[] = [];
    if (item.total_tokens) parts.push(`${item.total_tokens.toLocaleString("zh-CN")} token`);
    if (item.credits) parts.push(`${item.credits.toLocaleString("zh-CN")} 积分`);
    return parts.join(" · ") || "—";
}

const emptySummary: ApiCallSummary = {
    total: 0,
    success: 0,
    failed: 0,
    cancelled: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    credits: 0,
    by_user: [],
    by_model: [],
    by_day: [],
};

export function ApiCallLogPanel() {
    const [username, setUsername] = useState("");
    const [capability, setCapability] = useState("");
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [status, setStatus] = useState("");
    const [q, setQ] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [items, setItems] = useState<ApiCallLogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [summary, setSummary] = useState<ApiCallSummary>(emptySummary);
    const [selected, setSelected] = useState<ApiCallLogItem | null>(null);

    const load = useCallback(async (nextPage: number, overrides?: Partial<ApiCallLogQuery>) => {
        const query: ApiCallLogQuery = {
            username: username.trim(),
            capability,
            provider: provider.trim(),
            model: model.trim(),
            status,
            q: q.trim(),
            date_from: dateFrom,
            date_to: dateTo,
            page: nextPage,
            page_size: 20,
            ...overrides,
        };
        setLoading(true);
        setError("");
        try {
            const [list, stats] = await Promise.all([fetchApiCallLogs(query), fetchApiCallSummary(query)]);
            setItems(list.items);
            setTotal(list.total);
            setSummary(stats);
            setPage(nextPage);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "读取调用记录失败");
        } finally {
            setLoading(false);
        }
    }, [capability, dateFrom, dateTo, model, provider, q, status, username]);

    useEffect(() => {
        void load(1);
        // Filters apply when the user clicks 查询, not on each keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <section className="mt-8 border-t border-stone-200 pt-6 dark:border-stone-800">
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">调用记录</h2>
            <p className="mt-1 text-sm text-stone-500">保存在服务器。可按账号、类型、供应商和模型筛选。火山引擎视频完成时记下 token，RunningHub 完成时记下积分。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Metric label="调用次数" value={summary.total.toLocaleString("zh-CN")} />
                <Metric label="成功 / 失败 / 取消" value={`${summary.success} / ${summary.failed} / ${summary.cancelled}`} />
                <Metric label="总 token" value={formatTokens(summary.total_tokens)} />
                <Metric label="输入 / 输出 token" value={`${formatTokens(summary.prompt_tokens)} / ${formatTokens(summary.completion_tokens)}`} />
                <Metric label="总积分" value={summary.credits ? summary.credits.toLocaleString("zh-CN") : "—"} />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <Input value={username} placeholder="账号" allowClear onChange={(event) => setUsername(event.target.value)} />
                <Select value={capability} options={capabilityOptions} onChange={setCapability} />
                <Input value={provider} placeholder="供应商，如 runninghub" allowClear onChange={(event) => setProvider(event.target.value)} />
                <Input value={model} placeholder="模型" allowClear onChange={(event) => setModel(event.target.value)} />
                <Select value={status} options={statusOptions} onChange={setStatus} />
                <Input value={q} placeholder="提示词关键词" allowClear onChange={(event) => setQ(event.target.value)} />
                <input type="date" value={dateFrom} aria-label="开始日期" className="h-8 rounded-md border border-stone-300 bg-transparent px-2 text-sm text-stone-900 dark:border-stone-700 dark:text-stone-100" onChange={(event) => setDateFrom(event.target.value)} />
                <input type="date" value={dateTo} aria-label="结束日期" className="h-8 rounded-md border border-stone-300 bg-transparent px-2 text-sm text-stone-900 dark:border-stone-700 dark:text-stone-100" onChange={(event) => setDateTo(event.target.value)} />
            </div>
            <div className="mt-3">
                <Button type="primary" loading={loading} onClick={() => void load(1)}>
                    查询
                </Button>
            </div>
            {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
            <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <StatTable
                    title="按账号"
                    rows={summary.by_user.map((item) => ({ key: item.username, primary: item.username, count: item.count, tokens: item.total_tokens, credits: item.credits, failed: item.failed }))}
                    onPick={(key) => {
                        setUsername(key);
                        void load(1, { username: key });
                    }}
                />
                <StatTable
                    title="按模型"
                    rows={summary.by_model.map((item) => ({ key: `${item.provider}:${item.model}`, primary: item.model || item.provider, secondary: item.provider, count: item.count, tokens: item.total_tokens, credits: item.credits, failed: item.failed }))}
                    onPick={(key) => {
                        const nextModel = key.split(":").slice(1).join(":");
                        setModel(nextModel);
                        void load(1, { model: nextModel });
                    }}
                />
                    <StatTable title="按日期" rows={summary.by_day.map((item) => ({ key: item.day, primary: item.day, count: item.count, tokens: item.total_tokens, credits: item.credits, failed: 0 }))} />
            </div>
            <Table
                className="mt-4"
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={items}
                scroll={{ x: 1100 }}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (next) => void load(next) }}
                onRow={(record) => ({ onClick: () => setSelected(record) })}
                columns={[
                    { title: "时间", dataIndex: "created_at", width: 170 },
                    { title: "账号", dataIndex: "username", width: 120 },
                    { title: "来源", dataIndex: "source", width: 110 },
                    { title: "类型", dataIndex: "capability", width: 70, render: (value: string) => capabilityLabel[value] || value },
                    { title: "动作", dataIndex: "action", width: 90, render: (value: string) => actionLabel[value] || value },
                    { title: "供应商", dataIndex: "provider", width: 110 },
                    { title: "模型", dataIndex: "model", ellipsis: true },
                    { title: "状态", dataIndex: "status", width: 80, render: (value: string) => statusTag(value) },
                    { title: "消耗", width: 150, render: (_value: unknown, record: ApiCallLogItem) => formatConsumption(record) },
                    { title: "耗时", dataIndex: "duration_ms", width: 90, render: (value: number) => formatDuration(value) },
                    { title: "提示词", dataIndex: "prompt_excerpt", ellipsis: true },
                ]}
            />
            <Drawer title="调用详情" open={Boolean(selected)} width={560} onClose={() => setSelected(null)}>
                {selected ? <CallDetail item={selected} /> : null}
            </Drawer>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
            <div className="text-xs text-stone-500">{label}</div>
            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{value}</div>
        </div>
    );
}

function StatTable({ title, rows, onPick }: { title: string; rows: { key: string; primary: string; secondary?: string; count: number; tokens: number; credits?: number; failed: number }[]; onPick?: (key: string) => void }) {
    return (
        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-2 text-sm font-medium text-stone-950 dark:text-stone-100">{title}</div>
            <div className="max-h-48 space-y-1 overflow-y-auto text-xs">
                {rows.length ? (
                    rows.map((row) => (
                        <button key={row.key} type="button" className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-900" onClick={() => onPick?.(row.key)}>
                            <span className="min-w-0 truncate">
                                {row.primary}
                                {row.secondary ? <span className="ml-1 text-stone-400">{row.secondary}</span> : null}
                            </span>
                            <span className="shrink-0 text-stone-500">
                                {row.count} 次 · {formatConsumption({ total_tokens: row.tokens, credits: row.credits })}
                                {row.failed ? ` · 失败 ${row.failed}` : ""}
                            </span>
                        </button>
                    ))
                ) : (
                    <div className="text-stone-400">暂无</div>
                )}
            </div>
        </div>
    );
}

function CallDetail({ item }: { item: ApiCallLogItem }) {
    return (
        <div className="space-y-3 text-sm text-stone-800 dark:text-stone-100">
            <DetailRow label="时间" value={item.created_at} />
            <DetailRow label="账号" value={item.username} />
            <DetailRow label="来源" value={item.source} />
            <DetailRow label="类型" value={`${capabilityLabel[item.capability] || item.capability} · ${actionLabel[item.action] || item.action}`} />
            <DetailRow label="供应商" value={item.provider} />
            <DetailRow label="模型" value={item.model} />
            <DetailRow label="接口" value={item.endpoint || "—"} />
            <DetailRow label="任务 ID" value={item.task_id || "—"} />
            <DetailRow label="状态" value={item.status === "success" ? "成功" : item.status === "cancelled" ? "已取消" : "失败"} />
            <DetailRow label="耗时" value={formatDuration(item.duration_ms)} />
            <DetailRow label="输入 token" value={formatTokens(item.prompt_tokens)} />
            <DetailRow label="输出 token" value={formatTokens(item.completion_tokens)} />
            <DetailRow label="总 token" value={formatTokens(item.total_tokens)} />
            <DetailRow label="积分" value={item.credits ? item.credits.toLocaleString("zh-CN") : "—"} />
            {item.error_message ? <DetailRow label="错误" value={item.error_message} /> : null}
            <div>
                <div className="text-xs text-stone-500">参数</div>
                <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-stone-100 p-3 text-xs text-stone-900 dark:bg-stone-900 dark:text-stone-100">{JSON.stringify(item.parameters, null, 2)}</pre>
            </div>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-xs text-stone-500">{label}</div>
            <div className="break-all">{value}</div>
        </div>
    );
}
