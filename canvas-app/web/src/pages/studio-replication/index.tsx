import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Drawer } from "antd";
import { ScrollText } from "lucide-react";

import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { cn } from "@/lib/utils";
import { StudioLoading, StudioShell } from "@/studios/components/studio-shell";
import { REPLICATION_STEPS, type ReplicationSettings, type ReplicationStudioDocument } from "@/studios/replication/document";
import { useStudioProject } from "@/studios/use-studio-project";
import { useConfigStore } from "@/stores/use-config-store";

import { AnalysisStep } from "./analysis-step";
import { AssetsStep } from "./assets-step";
import { ReplicationSettingsPanel } from "./settings-panel";
import { SourceStep } from "./source-step";
import { StoryboardStep } from "./storyboard-step";
import { useReplicationRunner } from "./use-replication-runner";

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

export default function ReplicationStudio({ projectId }: { projectId: string }) {
    const handle = useStudioProject<ReplicationStudioDocument>(projectId);
    const runner = useReplicationRunner(handle);
    const navigate = useNavigate();
    const [logOpen, setLogOpen] = useState(false);
    const { project } = handle;

    useEffect(() => {
        if (!project || project.document.settings.textModel) return;
        const model = buildGenerationConfig(useConfigStore.getState().config, undefined, "text").model;
        if (model) handle.update((document) => ({ ...document, settings: { ...document.settings, textModel: model } }));
    }, [handle, project]);

    if (!project) return <StudioLoading error={handle.error} />;
    const document = project.document;
    const busy = Boolean(runner.busy);
    const updateSettings = (patch: Partial<ReplicationSettings>) => {
        handle.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
        if ("promptMode" in patch || "clipMaxSeconds" in patch) runner.replan();
    };
    const hasMedia = document.assets.some((asset) => asset.appearances.some((look) => look.imageKey)) || document.clips.some((clip) => clip.videoKey);
    const showSettings = document.step === "source" || document.step === "analysis";

    return (
        <StudioShell
            kind="replication"
            title={project.title}
            onRename={handle.rename}
            steps={REPLICATION_STEPS}
            step={document.step}
            onStep={(step) => handle.update((current) => ({ ...current, step }))}
            saving={handle.saving}
            error={handle.error}
            actions={
                <>
                    <Button size="small" icon={<ScrollText className="size-3.5" />} onClick={() => setLogOpen(true)}>
                        日志
                    </Button>
                    <Button
                        size="small"
                        disabled={busy || !hasMedia}
                        onClick={async () => {
                            const canvasId = await runner.syncCanvas();
                            if (canvasId) navigate(`/canvas/${canvasId}`);
                        }}
                    >
                        同步到画布
                    </Button>
                </>
            }
        >
            <div className="flex h-full min-h-0">
                {showSettings ? (
                    <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-auto border-r border-stone-200 p-5 dark:border-stone-800">
                        <ReplicationSettingsPanel settings={document.settings} disabled={busy} onChange={updateSettings} />
                    </aside>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
                    {busy ? (
                        <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-stone-50 px-6 py-2 text-xs dark:border-stone-800 dark:bg-stone-900">
                            <span className="size-2 animate-pulse rounded-full bg-stone-800 dark:bg-stone-200" />
                            <span className="font-medium">{runner.busy}</span>
                            <span className="min-w-0 flex-1 truncate text-stone-500">{runner.stream.slice(-160) || document.source?.message || document.logs[document.logs.length - 1]?.message}</span>
                            <Button size="small" danger onClick={runner.cancel}>
                                取消
                            </Button>
                        </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-auto p-6">
                        {document.step === "source" ? (
                            <SourceStep document={document} runner={runner} />
                        ) : document.step === "analysis" ? (
                            <AnalysisStep document={document} runner={runner} />
                        ) : document.step === "assets" ? (
                            <AssetsStep document={document} runner={runner} />
                        ) : (
                            <StoryboardStep document={document} runner={runner} />
                        )}
                    </div>
                </div>
            </div>
            <Drawer title="任务日志" open={logOpen} width={480} onClose={() => setLogOpen(false)}>
                <ol className="flex flex-col gap-2 text-xs">
                    {[...document.logs].reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className={cn("leading-5", entry.level === "error" ? "text-red-600" : entry.level === "warn" ? "text-amber-600" : "text-stone-600 dark:text-stone-300")}>
                            <span className="mr-2 text-stone-400">{formatTime(entry.at)}</span>
                            {entry.message}
                        </li>
                    ))}
                </ol>
            </Drawer>
        </StudioShell>
    );
}
