import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, Modal } from "antd";
import { ScrollText, Settings2, Sparkles } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { cn } from "@/lib/utils";
import { DarkButton, DarkScope, IconButton } from "@/studios/components/studio-dark-ui";
import { StudioLoading } from "@/studios/components/studio-shell";
import { SCRIPT_STEPS, type ScriptSettings, type ScriptStep, type ScriptStudioDocument } from "@/studios/script/document";
import { useStudioProject } from "@/studios/use-studio-project";
import { useConfigStore } from "@/stores/use-config-store";

import { AssetsStep } from "./assets-step";
import { EpisodesStep } from "./episodes-step";
import { pendingScriptStarts } from "./home";
import { ScriptStep as ScriptStepView } from "./script-step";
import { ScriptSettingsPanel } from "./settings-panel";
import { ScriptShell } from "./shell";
import { useScriptRunner } from "./use-script-runner";

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

export default function ScriptStudio({ projectId }: { projectId: string }) {
    const handle = useStudioProject<ScriptStudioDocument>(projectId);
    const runner = useScriptRunner(handle);
    const navigate = useNavigate();
    const [logOpen, setLogOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const autoStarted = useRef(false);
    const { project } = handle;
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (!project || project.document.settings.textModel) return;
        const model = buildGenerationConfig(useConfigStore.getState().config, undefined, "text").model;
        if (model) handle.update((document) => ({ ...document, settings: { ...document.settings, textModel: model } }));
    }, [handle, project]);

    useEffect(() => {
        if (!project || autoStarted.current) return;
        const pending = pendingScriptStarts.get(projectId);
        if (!pending?.autoGenerate) return;
        pendingScriptStarts.delete(projectId);
        autoStarted.current = true;
        void runner.generateStory("summary");
        // Only kick off once when entering from the home import CTA.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project?.id, projectId]);

    if (!project) {
        return (
            <DarkScope className="h-full">
                <StudioLoading error={handle.error} />
            </DarkScope>
        );
    }

    const document = project.document;
    const busy = Boolean(runner.busy);
    const updateSettings = (patch: Partial<ScriptSettings>) => handle.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    const setStep = (step: ScriptStep) => handle.update((current) => ({ ...current, step }));
    const hasMedia = document.assets.some((asset) => asset.appearances.some((look) => look.imageKey)) || document.episodes.some((episode) => episode.clips.some((clip) => clip.videoKey));
    const nextStep = SCRIPT_STEPS[SCRIPT_STEPS.findIndex((item) => item.key === document.step) + 1];
    const scriptsReady = document.episodes.some((episode) => episode.script);
    const focusEpisode = document.episodes.find((episode) => episode.script) || document.episodes[0];
    const contextLabel = focusEpisode ? `第 ${focusEpisode.number} 集 · ${document.summary?.title || project.title}` : project.title;

    const nextAction = () => {
        if (!nextStep) return null;
        if (document.step === "script") {
            return {
                label: "下一步：提取角色、场景与道具",
                disabled: busy || !scriptsReady,
                onClick: () => {
                    setStep("assets");
                    if (!document.assets.length && scriptsReady) void runner.extract();
                },
            };
        }
        if (document.step === "assets") {
            return {
                label: nextStep.label,
                disabled: busy || !document.assets.length,
                onClick: () => setStep(nextStep.key),
            };
        }
        return null;
    };

    return (
        <DarkScope className="h-full">
            <ScriptShell
                title={project.title}
                contextLabel={contextLabel}
                step={document.step}
                onStep={setStep}
                saving={handle.saving}
                error={handle.error}
                busy={runner.busy || undefined}
                onCancel={runner.cancel}
                next={nextAction()}
                actions={
                    <>
                        {document.step === "script" ? (
                            <div className="hidden min-w-[160px] max-w-[220px] sm:block">
                                <ModelPicker config={config} value={document.settings.textModel} onChange={(value) => updateSettings({ textModel: value })} capability="text" fullWidth onMissingConfig={() => openConfigDialog(true)} />
                            </div>
                        ) : null}
                        <IconButton title="设置" onClick={() => setSettingsOpen(true)}>
                            <Settings2 className="size-3.5" />
                        </IconButton>
                        <IconButton title="日志" onClick={() => setLogOpen(true)}>
                            <ScrollText className="size-3.5" />
                        </IconButton>
                        <DarkButton
                            size="sm"
                            disabled={busy || !hasMedia}
                            onClick={async () => {
                                const canvasId = await runner.syncCanvas();
                                if (canvasId) navigate(`/canvas/${canvasId}`);
                            }}
                        >
                            同步项目
                        </DarkButton>
                    </>
                }
            >
                <div className="flex h-full min-h-0 flex-col">
                    {document.step === "script" ? (
                        <ScriptStepView document={document} runner={runner} onOpenSettings={() => setSettingsOpen(true)} />
                    ) : document.step === "assets" ? (
                        <AssetsStep document={document} runner={runner} />
                    ) : (
                        <EpisodesStep document={document} runner={runner} projectId={project.id} />
                    )}
                </div>
            </ScriptShell>

            <Modal
                title="剧本设置"
                open={settingsOpen}
                onCancel={() => setSettingsOpen(false)}
                footer={
                    <div className="flex justify-end gap-2">
                        <DarkButton size="sm" tone="ghost" onClick={() => setSettingsOpen(false)}>
                            关闭
                        </DarkButton>
                        <DarkButton
                            size="sm"
                            tone="primary"
                            disabled={busy}
                            onClick={() => {
                                setSettingsOpen(false);
                                void runner.generateStory("summary");
                            }}
                        >
                            <Sparkles className="size-3.5" />
                            {document.summary ? "重新生成剧本" : "生成剧本"}
                        </DarkButton>
                    </div>
                }
                width={520}
                destroyOnHidden
            >
                <div className="max-h-[70vh] overflow-auto py-1">
                    <ScriptSettingsPanel settings={document.settings} disabled={busy} onChange={updateSettings} />
                </div>
            </Modal>

            <Drawer title="任务日志" open={logOpen} width={480} onClose={() => setLogOpen(false)}>
                <ol className="flex flex-col gap-2 text-xs">
                    {[...document.logs].reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className={cn("leading-5", entry.level === "error" ? "text-red-300" : entry.level === "warn" ? "text-amber-300" : "text-neutral-300")}>
                            <span className="mr-2 text-neutral-500">{formatTime(entry.at)}</span>
                            {entry.message}
                        </li>
                    ))}
                </ol>
            </Drawer>
        </DarkScope>
    );
}
