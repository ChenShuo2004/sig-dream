import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Checkbox, Dropdown, Input, Modal, Spin } from "antd";
import { Archive, ArchiveRestore, ArrowDownWideNarrow, ArrowRight, ArrowUpNarrowWide, Download, Film, FolderInput, Mic, MoreHorizontal, Plus, Search, Settings2, Trash2, Upload, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { createStudioProject, deleteStudioProject, getStudioProject, listStudioProjects, saveStudioProject } from "@/studios/api";
import { REPLACEMENT_PROMPTS } from "@/studios/prompts/replacement.generated";
import { createReplacementDocument, type ReplacementSettings, type ReplacementStudioDocument } from "@/studios/replacement/document";
import { exportProjectPackage, importProjectPackage } from "@/studios/replacement/project-package";
import { downloadBlob } from "@/studios/replacement/stages";
import type { StudioProjectSummary } from "@/studios/types";

import { ReplacementSettingsPanel } from "./settings-panel";
import { DarkButton, DarkScope, inkOnWhiteStyle, SmallSelect } from "./ui";

const MAX_FILE_BYTES = 300 * 1024 * 1024;
const DEFAULTS_KEY = "replacement-studio:default-settings";

/** Media chosen on the home page, consumed once by the new project's page. */
export const pendingImports = new Map<string, { files: File[]; skipCuts: boolean; mode: "video" | "audio" }>();

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm,.mkv,.m4v,.avi";
const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.wma";

function loadDefaults(): Partial<ReplacementSettings> {
    try {
        return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") as Partial<ReplacementSettings>;
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

function formatSize(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default function ReplacementHome() {
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [importMode, setImportMode] = useState<"video" | "audio">("video");
    const [skipCuts, setSkipCuts] = useState(false);
    const [starting, setStarting] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [defaults, setDefaults] = useState<ReplacementSettings>(() => ({ ...createReplacementDocument(REPLACEMENT_PROMPTS.defaultVideoPrompt).settings, ...loadDefaults() }));
    const [query, setQuery] = useState("");
    const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt">("createdAt");
    const [order, setOrder] = useState<"desc" | "asc">("desc");
    const [showArchived, setShowArchived] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const packageInput = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setProjects(await listStudioProjects("replacement"));
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

    const addFiles = (list: FileList | File[] | null, mode = importMode) => {
        const picked = [...(list || [])];
        if (mode === "audio") {
            const audios = picked.filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg|wma)$/iu.test(file.name));
            const oversized = audios.filter((file) => file.size > MAX_AUDIO_BYTES);
            if (audios.length < picked.length) message.warning("仅声音模式下只能加入音频文件");
            if (oversized.length) message.warning(`单个音频不能超过 100MB：${oversized.map((file) => file.name).join("、")}`);
            setFiles((current) => [...current, ...audios.filter((file) => file.size <= MAX_AUDIO_BYTES)]);
            return;
        }
        const videos = picked.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v|avi)$/iu.test(file.name));
        const oversized = videos.filter((file) => file.size > MAX_FILE_BYTES);
        if (videos.length < picked.length) message.warning("只能加入视频文件");
        if (oversized.length) message.warning(`单个视频不能超过 300MB：${oversized.map((file) => file.name).join("、")}`);
        setFiles((current) => [...current, ...videos.filter((file) => file.size <= MAX_FILE_BYTES)]);
    };

    const switchMode = (mode: "video" | "audio") => {
        if (mode === importMode) return;
        setImportMode(mode);
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
    };

    const createProject = async (title: string) => {
        const document = createReplacementDocument(REPLACEMENT_PROMPTS.defaultVideoPrompt);
        return createStudioProject<ReplacementStudioDocument>("replacement", title, { ...document, settings: { ...document.settings, ...defaults } });
    };

    const start = async () => {
        if (!files.length) return message.warning(importMode === "audio" ? "请先加入音频" : "请先加入视频");
        setStarting(true);
        try {
            const fallback = importMode === "audio" ? `声音克隆项目 ${projects.length + 1}` : `人物替换项目 ${projects.length + 1}`;
            const project = await createProject(files[0].name.replace(/\.[^.]+$/u, "") || fallback);
            pendingImports.set(project.id, { files, skipCuts: importMode === "audio" ? true : skipCuts, mode: importMode });
            navigate(`/studio/replacement/${project.id}`);
        } catch (startError) {
            message.error(startError instanceof Error ? startError.message : "新建项目失败");
            setStarting(false);
        }
    };

    const createEmpty = async () => {
        try {
            const project = await createProject(`人物替换项目 ${projects.length + 1}`);
            navigate(`/studio/replacement/${project.id}`);
        } catch (createError) {
            message.error(createError instanceof Error ? createError.message : "新建项目失败");
        }
    };

    const importPackage = async (file?: File) => {
        if (!file) return;
        const hide = message.loading("正在导入项目…", 0);
        try {
            const project = await importProjectPackage(file, REPLACEMENT_PROMPTS.defaultVideoPrompt);
            message.success("项目已导入");
            navigate(`/studio/replacement/${project.id}`);
        } catch (importError) {
            message.error(importError instanceof Error ? importError.message : "导入失败");
        } finally {
            hide();
            if (packageInput.current) packageInput.current.value = "";
        }
    };

    const setArchived = async (summary: StudioProjectSummary, archived: boolean) => {
        try {
            const project = await getStudioProject<ReplacementStudioDocument>(summary.id);
            const document = { ...project.document, meta: { ...project.document.meta, archived } };
            await saveStudioProject(summary.id, { document });
            setProjects((items) => items.map((item) => (item.id === summary.id ? { ...item, meta: document.meta } : item)));
        } catch (archiveError) {
            message.error(archiveError instanceof Error ? archiveError.message : "操作失败");
        }
    };

    const exportProject = async (summary: StudioProjectSummary) => {
        const hide = message.loading("正在打包项目…", 0);
        try {
            const project = await getStudioProject<ReplacementStudioDocument>(summary.id);
            downloadBlob(await exportProjectPackage(project.title, project.document), `${project.title}.zip`);
        } catch (exportError) {
            message.error(exportError instanceof Error ? exportError.message : "导出失败");
        } finally {
            hide();
        }
    };

    const remove = (summary: StudioProjectSummary) =>
        modal.confirm({
            title: `删除「${summary.title}」？`,
            content: "项目和生成记录会一起删除，浏览器里缓存的素材不会自动清理。",
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

    return (
        <DarkScope className="h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-10 pt-8">
                <section className="flex flex-col items-center gap-4">
                    <h1 className="text-center text-3xl font-semibold tracking-tight text-white">完整替换视频中的人物与声音</h1>
                    <div className="flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
                        <button type="button" onClick={() => switchMode("video")} style={importMode === "video" ? inkOnWhiteStyle : undefined} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition", importMode === "video" ? "bg-white" : "text-neutral-300 hover:text-white")}>
                            <Film className="size-3.5" />
                            视频替换
                        </button>
                        <button type="button" onClick={() => switchMode("audio")} style={importMode === "audio" ? inkOnWhiteStyle : undefined} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition", importMode === "audio" ? "bg-white" : "text-neutral-300 hover:text-white")}>
                            <Mic className="size-3.5" />
                            只克隆声音
                        </button>
                    </div>
                    <div
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            addFiles(event.dataTransfer.files);
                        }}
                        className={cn("w-full max-w-3xl rounded-2xl border bg-[#141416] p-2.5 transition", dragging ? "border-white/60" : "border-white/[0.08]")}
                    >
                        {files.length ? (
                            <ul className="flex max-h-36 flex-col gap-1.5 overflow-auto p-2">
                                {files.map((file, index) => (
                                    <li key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                                        {importMode === "audio" ? <Mic className="size-4 shrink-0 text-neutral-400" /> : <Film className="size-4 shrink-0 text-neutral-400" />}
                                        <span className="min-w-0 flex-1 truncate text-neutral-100">{file.name}</span>
                                        <span className="text-xs text-neutral-500">{formatSize(file.size)}</span>
                                        <button type="button" onClick={() => setFiles((current) => current.filter((_, position) => position !== index))} className="text-neutral-500 hover:text-white" aria-label="移除">
                                            <X className="size-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <button type="button" onClick={() => fileInput.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl px-6 py-6 text-neutral-400 transition hover:bg-white/[0.03]">
                                <Upload className="size-5" />
                                <span className="text-sm text-neutral-200">{importMode === "audio" ? "拖入或点击加入音频" : "拖入或点击加入视频"}</span>
                                <span className="text-xs">
                                    {importMode === "audio" ? "支持 mp3 / wav / m4a 等，单个不超过 100MB；进入后直接分析与克隆" : "支持同时加入多个视频，单个不超过 300MB"}
                                </span>
                            </button>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-2 pt-2.5">
                            <DarkButton size="sm" onClick={() => fileInput.current?.click()}>
                                <Plus className="size-3.5" />
                                {importMode === "audio" ? "加入音频" : "加入视频"}
                            </DarkButton>
                            {importMode === "video" ? (
                                <Checkbox checked={skipCuts} onChange={(event) => setSkipCuts(event.target.checked)} className="!ml-1 !text-xs !text-neutral-300">
                                    跳过处理<span className="ml-1 text-neutral-500">（保留完整视频，只识别人物）</span>
                                </Checkbox>
                            ) : (
                                <span className="text-[11px] text-neutral-500">跳过切镜与人物识别，只做听写与声音克隆</span>
                            )}
                            <DarkButton size="sm" tone="ghost" onClick={() => setSettingsOpen(true)}>
                                <Settings2 className="size-3.5" />
                                设置
                            </DarkButton>
                            <DarkButton tone="primary" className="ml-auto" disabled={!files.length || starting} onClick={() => void start()}>
                                {starting ? "正在创建…" : importMode === "audio" ? "开始克隆声音" : "开始处理"}
                                <ArrowRight className="size-4" />
                            </DarkButton>
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            accept={importMode === "audio" ? AUDIO_ACCEPT : VIDEO_ACCEPT}
                            multiple
                            hidden
                            onChange={(event) => {
                                addFiles(event.target.files);
                                event.target.value = "";
                            }}
                        />
                    </div>
                </section>

                <section className="flex flex-col gap-5">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-medium text-white">{showArchived ? "已归档项目" : "我的人物替换项目"}</h2>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <DarkButton size="sm" onClick={() => packageInput.current?.click()}>
                                <FolderInput className="size-3.5" />
                                导入项目
                            </DarkButton>
                            <Input size="small" variant="filled" allowClear prefix={<Search className="size-3.5 text-neutral-500" />} placeholder="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)} className="!w-48" />
                            <SmallSelect value={sortBy} onChange={setSortBy} options={[{ value: "createdAt", label: "创建时间" }, { value: "updatedAt", label: "更新时间" }]} />
                            <DarkButton size="sm" tone="ghost" onClick={() => setOrder((current) => (current === "desc" ? "asc" : "desc"))}>
                                {order === "desc" ? <ArrowDownWideNarrow className="size-3.5" /> : <ArrowUpNarrowWide className="size-3.5" />}
                                {order === "desc" ? "降序" : "升序"}
                            </DarkButton>
                            <button type="button" onClick={() => setShowArchived((current) => !current)} style={showArchived ? inkOnWhiteStyle : undefined} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition", showArchived ? "bg-white" : "bg-white/[0.08] text-neutral-200 hover:bg-white/[0.14]")}>
                                <Archive className="size-3.5" />
                                已归档 {archivedCount}
                            </button>
                        </div>
                        <input ref={packageInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importPackage(event.target.files?.[0])} />
                    </div>

                    {loading ? (
                        <div className="flex min-h-[240px] items-center justify-center"><Spin /></div>
                    ) : error ? (
                        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-red-300">
                            {error}
                            <DarkButton size="sm" onClick={() => void load()}>重试</DarkButton>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {!showArchived ? (
                                <button type="button" onClick={() => void createEmpty()} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-neutral-400 transition hover:border-white/40 hover:text-white">
                                    <Plus className="size-6" />
                                    <span className="text-sm">新建</span>
                                </button>
                            ) : null}
                            {visible.map((project) => (
                                <article key={project.id} onClick={() => navigate(`/studio/replacement/${project.id}`)} className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#141416] transition hover:border-white/25">
                                    <div className="relative aspect-video bg-black">
                                        {project.meta.coverUrl ? <img src={project.meta.coverUrl} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-neutral-700"><Film className="size-8" /></div>}
                                        {project.meta.retryCount ? <span className="absolute left-2 top-2 rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-medium text-white">{project.meta.retryCount} 个任务需重试</span> : null}
                                        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
                                            <Dropdown
                                                trigger={["click"]}
                                                menu={{
                                                    items: [
                                                        { key: "export", icon: <Download className="size-3.5" />, label: "导出项目", onClick: () => void exportProject(project) },
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
                                        <h3 className="truncate text-sm font-medium text-neutral-100">{project.title}</h3>
                                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                                            {project.meta.stageLabel ? <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-neutral-200">{project.meta.stageLabel}</span> : null}
                                            <span className="ml-auto">{formatTime(project[sortBy])}</span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                    {!loading && !error && showArchived && !visible.length ? <p className="py-10 text-center text-sm text-neutral-500">没有已归档的项目</p> : null}
                </section>
            </div>
            <Modal title="新项目默认设置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={() => {
                localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
                setSettingsOpen(false);
            }} okText="保存" cancelText="取消" width={480}>
                <ReplacementSettingsPanel settings={defaults} disabled={false} onChange={(patch) => setDefaults((current) => ({ ...current, ...patch }))} />
            </Modal>
        </DarkScope>
    );
}
