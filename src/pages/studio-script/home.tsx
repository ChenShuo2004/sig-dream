import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Dropdown, Input, InputNumber, Modal, Select, Spin } from "antd";
import { Archive, ArchiveRestore, ArrowDownWideNarrow, ArrowRight, ArrowUpNarrowWide, Clapperboard, MoreHorizontal, Plus, Search, Trash2, Upload } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { cn } from "@/lib/utils";
import { createStudioProject, deleteStudioProject, getStudioProject, listStudioProjects, saveStudioProject } from "@/studios/api";
import { DarkButton, DarkScope, inkOnWhiteStyle } from "@/studios/components/studio-dark-ui";
import { createScriptDocument, type ScriptSettings, type ScriptSourceMode, type ScriptStudioDocument } from "@/studios/script/document";
import type { StudioProjectSummary } from "@/studios/types";
import { useConfigStore } from "@/stores/use-config-store";

import { ScriptSettingsPanel } from "./settings-panel";
import { findStylePreset, StyleLibraryField } from "./style-library-modal";

const DEFAULTS_KEY = "script-studio:default-settings";
const MAX_SOURCE_CHARS = 100_000;
const MAX_REWRITE_CHARS = 5_000;

/** Home form payload applied once when the new project page mounts. */
export const pendingScriptStarts = new Map<string, { autoGenerate: boolean }>();

type HomeTab = ScriptSourceMode;

const TABS: Array<{ key: HomeTab; label: string }> = [
    { key: "upload", label: "上传剧本" },
    { key: "rewrite", label: "快速创作" },
    { key: "generate", label: "AI 协作创作" },
];

function loadDefaults(): Partial<ScriptSettings> {
    try {
        return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") as Partial<ScriptSettings>;
    } catch {
        return {};
    }
}

function parseTime(value: string) {
    const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatTime(value: string) {
    const time = parseTime(value);
    return time ? new Date(time).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : value;
}

function titleFromSource(text: string, fallback: string) {
    const first = text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
    if (!first) return fallback;
    return first.replace(/^《|》$/gu, "").slice(0, 40) || fallback;
}

const EPISODE_PRESETS = [1, 3, 6, 12, 24, 30, 60] as const;
const MAX_EPISODE_COUNT = 200;

function clampEpisodeCount(value: number | null | undefined, fallback = 6) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(MAX_EPISODE_COUNT, n);
}

function EpisodeCountPicker({ value, onChange }: { value: number; onChange: (count: number) => void }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<number | null>(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const presetOptions = useMemo(() => {
        const list: number[] = [...EPISODE_PRESETS];
        if (!list.includes(value)) list.push(value);
        list.sort((a, b) => a - b);
        return list.map((count) => ({ value: count, label: `${count} 集` }));
    }, [value]);

    const applyCustom = () => {
        const next = clampEpisodeCount(draft, value);
        onChange(next);
        setDraft(next);
        setOpen(false);
    };

    return (
        <Select
            className="min-w-[116px]"
            open={open}
            onOpenChange={setOpen}
            value={value}
            onChange={(next) => {
                onChange(clampEpisodeCount(next, value));
                setOpen(false);
            }}
            options={presetOptions}
            popupMatchSelectWidth={false}
            popupRender={(menu) => (
                <div className="min-w-[196px]">
                    {menu}
                    <div
                        className="mt-1 flex items-center gap-1.5 border-t border-white/[0.08] px-2 pb-1 pt-2"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <InputNumber
                            size="small"
                            min={1}
                            max={MAX_EPISODE_COUNT}
                            precision={0}
                            value={draft}
                            onChange={(next) => setDraft(next)}
                            onPressEnter={applyCustom}
                            placeholder="自定义"
                            suffix="集"
                            className="!w-24"
                        />
                        <DarkButton size="sm" tone="primary" className="!h-6 !px-2.5 !text-[11px]" onClick={applyCustom}>
                            确定
                        </DarkButton>
                    </div>
                </div>
            )}
        />
    );
}

export default function ScriptHome() {
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<HomeTab>("upload");
    const [sourceText, setSourceText] = useState("");
    const [idea, setIdea] = useState("");
    const [rewriteInstruction, setRewriteInstruction] = useState("");
    const [fileName, setFileName] = useState("");
    const [starting, setStarting] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [defaults, setDefaults] = useState<ScriptSettings>(() => {
        const base = createScriptDocument().settings;
        const saved = loadDefaults();
        const currentConfig = useConfigStore.getState().config;
        const textModel = saved.textModel || buildGenerationConfig(currentConfig, undefined, "text").model || "";
        const imageModel = saved.imageModel || buildGenerationConfig(currentConfig, undefined, "image").model || "";
        const videoModel = saved.videoModel || buildGenerationConfig(currentConfig, undefined, "video").model || "";
        return { ...base, ...saved, textModel, imageModel, videoModel, sourceMode: "upload" };
    });
    const [query, setQuery] = useState("");
    const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt">("createdAt");
    const [order, setOrder] = useState<"desc" | "asc">("desc");
    const [showArchived, setShowArchived] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setProjects(await listStudioProjects("script"));
            setError("");
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "读取项目失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const selectedStyle = findStylePreset(defaults);

    const patchDefaults = (patch: Partial<ScriptSettings>) => setDefaults((current) => ({ ...current, ...patch }));

    const readFile = async (file?: File) => {
        if (!file) return;
        const text = await file.text();
        setSourceText(text.slice(0, MAX_SOURCE_CHARS));
        setFileName(file.name);
    };

    const createProject = async (title: string, settings: ScriptSettings) => {
        const document = createScriptDocument();
        return createStudioProject<ScriptStudioDocument>("script", title, {
            ...document,
            settings: { ...document.settings, ...settings },
            meta: { ...document.meta, stage: "script", stageLabel: "原始剧本" },
        });
    };

    const start = async () => {
        if (tab === "upload" && !sourceText.trim()) return message.warning("请先粘贴或上传剧本文本");
        if (tab === "rewrite" && !sourceText.trim()) return message.warning("请先提供参考剧本");
        if (tab === "rewrite" && !rewriteInstruction.trim()) return message.warning("请填写改写要求");
        if (tab === "generate" && !idea.trim()) return message.warning("请先填写创意");
        if (!defaults.textModel.trim()) return message.warning("请先选择文本模型");

        setStarting(true);
        try {
            const settings: ScriptSettings = {
                ...defaults,
                sourceMode: tab,
                sourceText: tab === "generate" ? "" : sourceText.trim(),
                fileName: tab === "generate" ? "" : fileName,
                rewriteInstruction: tab === "rewrite" ? rewriteInstruction.trim() : "",
                idea: tab === "generate" ? idea.trim() : "",
            };
            const fallback = `剧本项目 ${projects.length + 1}`;
            const title = tab === "generate" ? titleFromSource(idea, fallback) : titleFromSource(sourceText, fallback);
            const project = await createProject(title, settings);
            pendingScriptStarts.set(project.id, { autoGenerate: true });
            navigate(`/studio/script/${project.id}`);
        } catch (startError) {
            message.error(startError instanceof Error ? startError.message : "新建项目失败");
            setStarting(false);
        }
    };

    const createEmpty = async () => {
        try {
            const project = await createProject(`剧本项目 ${projects.length + 1}`, { ...defaults, sourceMode: "upload" });
            navigate(`/studio/script/${project.id}`);
        } catch (createError) {
            message.error(createError instanceof Error ? createError.message : "新建项目失败");
        }
    };

    const setArchived = async (summary: StudioProjectSummary, archived: boolean) => {
        try {
            const project = await getStudioProject<ScriptStudioDocument>(summary.id);
            const document = { ...project.document, meta: { ...project.document.meta, archived } };
            await saveStudioProject(summary.id, { document });
            setProjects((items) => items.map((item) => (item.id === summary.id ? { ...item, meta: document.meta } : item)));
        } catch (archiveError) {
            message.error(archiveError instanceof Error ? archiveError.message : "操作失败");
        }
    };

    const remove = (summary: StudioProjectSummary) =>
        modal.confirm({
            title: `删除「${summary.title}」？`,
            content: "项目和生成记录会一起删除。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteStudioProject(summary.id);
                setProjects((items) => items.filter((item) => item.id !== summary.id));
            },
        });

    const archivedCount = projects.filter((project) => project.meta.archived).length;
    const visible = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return projects
            .filter((project) => Boolean(project.meta.archived) === showArchived)
            .filter((project) => !keyword || project.title.toLowerCase().includes(keyword))
            .sort((a, b) => (parseTime(a[sortBy]) - parseTime(b[sortBy])) * (order === "desc" ? -1 : 1));
    }, [order, projects, query, showArchived, sortBy]);

    const ctaLabel = tab === "upload" ? "导入剧本" : tab === "rewrite" ? "开始改写" : "开始创作";
    const sourceCount = sourceText.length;
    const rewriteCount = rewriteInstruction.length;

    return (
        <DarkScope className="h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-10 pt-8">
                <section className="rounded-2xl border border-white/[0.08] bg-[#141416] p-4">
                    <div className="flex items-center gap-1 border-b border-white/[0.06] pb-3">
                        {TABS.map((item) => {
                            const active = tab === item.key;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => setTab(item.key)}
                                    className={cn("relative rounded-md px-3 py-1.5 text-sm font-medium transition", active ? "text-white" : "text-neutral-400 hover:text-neutral-200")}
                                >
                                    {item.label}
                                    {active ? <span className="absolute inset-x-3 -bottom-3 h-0.5 rounded-full bg-sky-400" /> : null}
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                        {tab === "generate" ? (
                            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                                <Input.TextArea
                                    variant="borderless"
                                    autoSize={{ minRows: 8, maxRows: 16 }}
                                    className="!text-sm !text-neutral-100"
                                    value={idea}
                                    onChange={(event) => setIdea(event.target.value.slice(0, MAX_REWRITE_CHARS))}
                                    placeholder="描述你想创作的故事：人物、冲突、结局都可以写进来"
                                />
                                <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                                    <span>AI 将按创意生成故事蓝图、分集大纲与剧本</span>
                                    <span>
                                        {idea.length} / {MAX_REWRITE_CHARS}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className={cn("grid gap-3", tab === "rewrite" ? "lg:grid-cols-2" : "")}>
                                <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                                    {tab === "upload" ? <p className="mb-2 text-xs font-medium text-neutral-300">粘贴剧本文本</p> : null}
                                    {tab === "rewrite" ? (
                                        <button type="button" onClick={() => fileInput.current?.click()} className="mb-3 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-white/15 px-4 py-8 text-neutral-400 transition hover:border-white/35 hover:text-neutral-200">
                                            <Upload className="size-5" />
                                            <span className="text-sm">.txt · 粘贴文本</span>
                                        </button>
                                    ) : null}
                                    <Input.TextArea
                                        variant="borderless"
                                        autoSize={{ minRows: tab === "rewrite" ? 6 : 10, maxRows: 18 }}
                                        className="!text-sm !text-neutral-100"
                                        value={sourceText}
                                        onChange={(event) => setSourceText(event.target.value.slice(0, MAX_SOURCE_CHARS))}
                                        placeholder={tab === "upload" ? "把完整剧本文本粘贴到这里" : "粘贴参考剧本文本，或点击上方上传 .txt"}
                                    />
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <DarkButton size="sm" onClick={() => fileInput.current?.click()}>
                                            <Upload className="size-3.5" />
                                            上传剧本
                                        </DarkButton>
                                        <DarkButton
                                            size="sm"
                                            tone={sourceText ? "subtle" : "primary"}
                                            onClick={async () => {
                                                try {
                                                    const text = await navigator.clipboard.readText();
                                                    if (!text.trim()) return message.warning("剪贴板没有文本");
                                                    setSourceText(text.slice(0, MAX_SOURCE_CHARS));
                                                    setFileName("粘贴文本");
                                                } catch {
                                                    message.error("无法读取剪贴板，请直接粘贴到输入框");
                                                }
                                            }}
                                        >
                                            粘贴文本
                                        </DarkButton>
                                        <span className="ml-auto text-[11px] text-neutral-500">
                                            {sourceCount} / {MAX_SOURCE_CHARS}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-[11px] text-neutral-500">支持最多 10 万字；按章节导入，不会扩写或重新分集。</p>
                                    {fileName ? <p className="mt-1 text-[11px] text-neutral-400">已读取：{fileName}</p> : null}
                                </div>
                                {tab === "rewrite" ? (
                                    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                                        <p className="mb-2 text-xs font-medium text-neutral-300">填写改写要求</p>
                                        <Input.TextArea
                                            variant="borderless"
                                            autoSize={{ minRows: 10, maxRows: 18 }}
                                            className="!text-sm !text-neutral-100"
                                            value={rewriteInstruction}
                                            onChange={(event) => setRewriteInstruction(event.target.value.slice(0, MAX_REWRITE_CHARS))}
                                            placeholder="描述你希望如何改写这份剧本，例如：改成海外爆款短剧风格，强化冲突与集尾钩子。"
                                        />
                                        <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                                            <span>参考剧本会原样保留；AI 将按要求生成新的故事蓝图与世界观。</span>
                                            <span>
                                                {rewriteCount} / {MAX_REWRITE_CHARS}
                                            </span>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}

                        <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
                            <div className="grid gap-2 sm:grid-cols-3">
                                <div className="flex flex-col gap-1">
                                    <span className="px-1 text-[11px] text-neutral-400">文本模型</span>
                                    <ModelPicker
                                        config={config}
                                        value={defaults.textModel}
                                        onChange={(value) => patchDefaults({ textModel: value })}
                                        capability="text"
                                        fullWidth
                                        placeholder="选择文本模型"
                                        onMissingConfig={() => openConfigDialog(true)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="px-1 text-[11px] text-neutral-400">图片模型</span>
                                    <ModelPicker
                                        config={config}
                                        value={defaults.imageModel}
                                        onChange={(value) => patchDefaults({ imageModel: value })}
                                        capability="image"
                                        fullWidth
                                        placeholder="使用画布默认图片模型"
                                        onMissingConfig={() => openConfigDialog(true)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="px-1 text-[11px] text-neutral-400">视频模型</span>
                                    <ModelPicker
                                        config={config}
                                        value={defaults.videoModel}
                                        onChange={(value) => patchDefaults({ videoModel: value })}
                                        capability="video"
                                        fullWidth
                                        placeholder="使用画布默认视频模型"
                                        onMissingConfig={() => openConfigDialog(true)}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-[180px] flex-1">
                                    <StyleLibraryField
                                        selected={selectedStyle}
                                        onChange={(preset) => patchDefaults(preset ? { visualStyle: preset.label, stylePrompt: preset.prompt } : { visualStyle: "", stylePrompt: "" })}
                                    />
                                </div>
                                <Select
                                    className="min-w-[165px]"
                                    value={defaults.promptMode}
                                    onChange={(value) => patchDefaults({ promptMode: value, clipMaxSeconds: Math.min(defaults.clipMaxSeconds, value === "seedance-2.5" ? 30 : 15) })}
                                    options={[
                                        { value: "seedance-2.0", label: "Seedance 2.0 提示词" },
                                        { value: "seedance-2.5", label: "Seedance 2.5 提示词" },
                                    ]}
                                />
                                {tab === "rewrite" || tab === "generate" ? (
                                    <EpisodeCountPicker
                                        value={defaults.episodeCount}
                                        onChange={(episodeCount) => patchDefaults({ episodeCount })}
                                    />
                                ) : null}
                                <Select
                                    className="min-w-[110px]"
                                    value={defaults.scriptMode}
                                    onChange={(value) => patchDefaults({ scriptMode: value })}
                                    options={[
                                        { value: "plot", label: "剧情模式" },
                                        { value: "narration", label: "解说模式" },
                                    ]}
                                />
                                <DarkButton
                                    tone="primary"
                                    className="ml-auto"
                                    disabled={starting}
                                    onClick={() => {
                                        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
                                        void start();
                                    }}
                                >
                                    {starting ? "正在创建…" : ctaLabel}
                                    <ArrowRight className="size-4" />
                                </DarkButton>
                            </div>
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".txt,.md,text/plain,text/markdown"
                            hidden
                            onChange={(event) => {
                                void readFile(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </div>
                </section>

                <section className="flex flex-col gap-5">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-medium text-white">{showArchived ? "已归档项目" : "我的剧本项目"}</h2>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <DarkButton size="sm" onClick={() => setSettingsOpen(true)}>
                                默认设置
                            </DarkButton>
                            <Input size="small" variant="filled" allowClear prefix={<Search className="size-3.5 text-neutral-500" />} placeholder="搜索项目名称" value={query} onChange={(event) => setQuery(event.target.value)} className="!w-48" />
                            <Select
                                size="small"
                                value={sortBy}
                                onChange={setSortBy}
                                options={[
                                    { value: "createdAt", label: "创建时间" },
                                    { value: "updatedAt", label: "更新时间" },
                                ]}
                                className="!min-w-[110px]"
                            />
                            <DarkButton size="sm" tone="ghost" onClick={() => setOrder((current) => (current === "desc" ? "asc" : "desc"))}>
                                {order === "desc" ? <ArrowDownWideNarrow className="size-3.5" /> : <ArrowUpNarrowWide className="size-3.5" />}
                                {order === "desc" ? "降序" : "升序"}
                            </DarkButton>
                            <button type="button" onClick={() => setShowArchived((current) => !current)} style={showArchived ? inkOnWhiteStyle : undefined} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition", showArchived ? "bg-white" : "bg-white/[0.08] text-neutral-200 hover:bg-white/[0.14]")}>
                                <Archive className="size-3.5" />
                                已归档 {archivedCount}
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <Spin />
                        </div>
                    ) : error ? (
                        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-red-300">
                            {error}
                            <DarkButton size="sm" onClick={() => void load()}>
                                重试
                            </DarkButton>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {visible.map((project) => (
                                <article key={project.id} onClick={() => navigate(`/studio/script/${project.id}`)} className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#141416] transition hover:border-white/25">
                                    <div className="relative aspect-video bg-black">
                                        {project.meta.coverUrl ? <img src={project.meta.coverUrl} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-neutral-700"><Clapperboard className="size-8" /></div>}
                                        {project.meta.retryCount ? <span className="absolute left-2 top-2 rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-medium text-white">{project.meta.retryCount}个任务需处理</span> : null}
                                        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
                                            <Dropdown
                                                trigger={["click"]}
                                                menu={{
                                                    items: [
                                                        project.meta.archived
                                                            ? { key: "restore", icon: <ArchiveRestore className="size-3.5" />, label: "取消归档", onClick: () => void setArchived(project, false) }
                                                            : { key: "archive", icon: <Archive className="size-3.5" />, label: "归档", onClick: () => void setArchived(project, true) },
                                                        { type: "divider" },
                                                        { key: "delete", icon: <Trash2 className="size-3.5" />, label: "删除", danger: true, onClick: () => remove(project) },
                                                    ],
                                                }}
                                            >
                                                <button type="button" className="flex size-7 items-center justify-center rounded-full bg-black/70 text-white" aria-label="更多">
                                                    <MoreHorizontal className="size-4" />
                                                </button>
                                            </Dropdown>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3.5">
                                        <p className="text-[11px] text-neutral-500">个人剧本</p>
                                        <h3 className="truncate text-sm font-medium text-neutral-100">{project.title}</h3>
                                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                                            <span>最近更新 · {project.meta.episodeCount || 0} 集</span>
                                            <span className="ml-auto">{formatTime(project[sortBy])}</span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                            {!showArchived ? (
                                <button type="button" onClick={() => void createEmpty()} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-neutral-400 transition hover:border-white/40 hover:text-white">
                                    <Plus className="size-6" />
                                    <span className="text-sm">新建剧本项目</span>
                                </button>
                            ) : null}
                        </div>
                    )}
                    {!loading && !error && showArchived && !visible.length ? <p className="py-10 text-center text-sm text-neutral-500">没有已归档的项目</p> : null}
                </section>
            </div>

            <Modal
                title="新项目默认设置"
                open={settingsOpen}
                onCancel={() => setSettingsOpen(false)}
                onOk={() => {
                    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
                    setSettingsOpen(false);
                }}
                okText="保存"
                cancelText="取消"
                width={520}
            >
                <ScriptSettingsPanel settings={defaults} disabled={false} onChange={patchDefaults} />
            </Modal>
        </DarkScope>
    );
}
