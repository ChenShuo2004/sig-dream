import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Button, Empty, Popconfirm, Spin } from "antd";
import { Plus, Trash2 } from "lucide-react";

import { createStudioProject, deleteStudioProject, listStudioProjects } from "@/studios/api";
import { StudioLoading } from "@/studios/components/studio-shell";
import { createStudioDocument, isStudioKind } from "@/studios/registry";
import { STUDIO_DESCRIPTIONS, STUDIO_LABELS, type StudioProjectSummary } from "@/studios/types";
import NotFound from "@/pages/not-found";

function formatTime(value: string) {
    const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

const ReplacementHome = lazy(() => import("@/pages/studio-replacement/home"));
const ScriptHome = lazy(() => import("@/pages/studio-script/home"));

export default function StudioListRoute() {
    const { kind } = useParams();
    if (kind === "replacement") {
        return (
            <Suspense fallback={<StudioLoading error="" />}>
                <ReplacementHome />
            </Suspense>
        );
    }
    if (kind === "script") {
        return (
            <Suspense fallback={<StudioLoading error="" />}>
                <ScriptHome />
            </Suspense>
        );
    }
    return <StudioListPage />;
}

function StudioListPage() {
    const { kind } = useParams();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        if (!isStudioKind(kind)) return;
        setLoading(true);
        try {
            setProjects(await listStudioProjects(kind));
            setError("");
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "读取项目失败");
        } finally {
            setLoading(false);
        }
    }, [kind]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!isStudioKind(kind)) return <NotFound />;

    const create = async () => {
        setCreating(true);
        try {
            const project = await createStudioProject(kind, `${STUDIO_LABELS[kind]}项目 ${projects.length + 1}`, createStudioDocument(kind));
            navigate(`/studio/${kind}/${project.id}`);
        } catch (createError) {
            message.error(createError instanceof Error ? createError.message : "新建项目失败");
        } finally {
            setCreating(false);
        }
    };

    const remove = async (id: string) => {
        try {
            await deleteStudioProject(id);
            setProjects((items) => items.filter((item) => item.id !== id));
        } catch (removeError) {
            message.error(removeError instanceof Error ? removeError.message : "删除项目失败");
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">画布模式</p>
                        <h1 className="mt-3 text-3xl font-semibold">{STUDIO_LABELS[kind]}</h1>
                        <p className="mt-2 text-sm text-stone-500">{STUDIO_DESCRIPTIONS[kind]}</p>
                    </div>
                    <Button type="primary" loading={creating} icon={<Plus className="size-4" />} onClick={() => void create()}>
                        新建项目
                    </Button>
                </header>

                {loading ? (
                    <section className="flex min-h-[320px] items-center justify-center">
                        <Spin />
                    </section>
                ) : error ? (
                    <section className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-sm text-red-600">
                        <p>{error}</p>
                        <Button onClick={() => void load()}>重试</Button>
                    </section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <article
                                key={project.id}
                                className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-stone-200 p-5 transition hover:border-stone-500 dark:border-stone-800 dark:hover:border-stone-500"
                                onClick={() => navigate(`/studio/${kind}/${project.id}`)}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="line-clamp-2 text-base font-medium">{project.title}</h2>
                                    <Popconfirm title="删除这个项目？" okText="删除" cancelText="取消" onConfirm={() => void remove(project.id)}>
                                        <button type="button" className="text-stone-400 opacity-0 transition hover:text-red-600 group-hover:opacity-100" onClick={(event) => event.stopPropagation()} aria-label="删除项目">
                                            <Trash2 className="size-4" />
                                        </button>
                                    </Popconfirm>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-stone-500">
                                    {project.meta.stageLabel ? <span className="rounded bg-stone-800 px-2 py-0.5 text-white dark:bg-stone-700 dark:text-white">{project.meta.stageLabel}</span> : null}
                                    {project.meta.episodeCount ? <span>{project.meta.episodeCount} 集</span> : null}
                                    {project.meta.clipCount ? <span>{project.meta.clipCount} 个片段</span> : null}
                                </div>
                                <p className="mt-auto text-xs text-stone-400">更新于 {formatTime(project.updatedAt)}</p>
                            </article>
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[320px] flex-col items-center justify-center border-y border-stone-200 dark:border-stone-800">
                        <Empty description="还没有项目" />
                        <Button type="primary" className="mt-6" loading={creating} icon={<Plus className="size-4" />} onClick={() => void create()}>
                            新建项目
                        </Button>
                    </section>
                )}
            </div>
        </main>
    );
}
