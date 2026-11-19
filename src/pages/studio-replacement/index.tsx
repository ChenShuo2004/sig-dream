import { useEffect, useRef, useState } from "react";
import { App, Drawer, Dropdown, Modal } from "antd";
import { ChevronDown, Download, Film, LayoutGrid, Loader2, ScrollText, Settings2, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { StudioLoading } from "@/studios/components/studio-shell";
import { REPLACEMENT_PROMPTS } from "@/studios/prompts/replacement.generated";
import {
    characterImageKey,
    DOCUMENT_VERSION,
    isAudioOnlyDocument,
    orderedShots,
    personTarget,
    shotImageKey,
    shotVideoKey,
    stepsForDocument,
    upgradeReplacementDocument,
    type ReplacementSettings,
    type ReplacementStep,
    type ReplacementStudioDocument,
} from "@/studios/replacement/document";
import { shotFileName } from "@/studios/replacement/stages";
import { useStudioProject } from "@/studios/use-studio-project";
import { decodeChannelModel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";

import { AssetsStep, pickFiles } from "./assets-step";
import { ComposeStep } from "./compose-step";
import { pendingImports } from "./home";
import { ImageStep, type ShotSelection } from "./image-step";
import { ReplacementSettingsPanel } from "./settings-panel";
import { ReplacementShell } from "./shell";
import { ShotCutEditor, SourcesDrawer } from "./sources";
import { addStudioMediaToCanvas, DarkButton, DarkScope, IconButton } from "./ui";
import { useReplacementRunner } from "./use-replacement-runner";
import { VideoStep } from "./video-step";
import { VoiceStep } from "./voice-step";

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

function isCurrent(document: ReplacementStudioDocument) {
    return document.version >= DOCUMENT_VERSION && Array.isArray(document.sources);
}

export default function ReplacementStudio({ projectId }: { projectId: string }) {
    const { message } = App.useApp();
    const handle = useStudioProject<ReplacementStudioDocument>(projectId);
    const runner = useReplacementRunner(handle);
    const [logOpen, setLogOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const [cutSourceId, setCutSourceId] = useState("");
    const [shotId, setShotId] = useState("");
    const [checked, setChecked] = useState<string[]>([]);
    const startedRef = useRef(false);
    const { project } = handle;
    const outdated = Boolean(project && !isCurrent(project.document));

    useEffect(() => {
        if (outdated) handle.update((document) => upgradeReplacementDocument(document, REPLACEMENT_PROMPTS.defaultVideoPrompt));
    }, [handle, outdated]);

    useEffect(() => {
        if (!project || outdated || project.document.settings.imageModel) return;
        const preferred = selectableModelsByCapability(useConfigStore.getState().config, "image").find((value) => /gpt-image-2/i.test(decodeChannelModel(value)?.model || value));
        if (preferred) handle.update((document) => ({ ...document, settings: { ...document.settings, imageModel: preferred } }));
    }, [handle, outdated, project]);

    useEffect(() => {
        if (!project || outdated || startedRef.current) return;
        startedRef.current = true;
        const pending = pendingImports.get(project.id);
        if (pending) {
            pendingImports.delete(project.id);
            if (pending.mode === "audio") void runner.addAudioSources(pending.files);
            else void runner.addSources(pending.files, pending.skipCuts);
            return;
        }
        const unfinished = project.document.sources.find((source) => source.jobId && (source.status === "pending" || source.status === "running"));
        if (unfinished) void runner.retrySource(unfinished.id);
    }, [outdated, project, runner]);

    // Audio-only projects only have voice/compose; snap stray steps back.
    useEffect(() => {
        if (!project || outdated) return;
        if (!isAudioOnlyDocument(project.document)) return;
        if (project.document.step === "voice" || project.document.step === "compose") return;
        handle.update((current) => ({ ...current, step: "voice" }));
    }, [handle, outdated, project]);

    if (!project || outdated) return <DarkScope className="h-full"><StudioLoading error={handle.error} /></DarkScope>;
    const document = project.document;
    const audioOnly = isAudioOnlyDocument(document);
    const steps = stepsForDocument(document);
    const shots = orderedShots(document);
    const currentShot = shots.find((shot) => shot.id === shotId) || shots[0];
    const selection: ShotSelection = { shotId: currentShot?.id || "", setShotId, checked, setChecked, onEditCuts: setCutSourceId };
    const setStep = (step: ReplacementStep) => handle.update((current) => ({ ...current, step }));
    const updateSettings = (patch: Partial<ReplacementSettings>) => handle.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    const nextStep = steps[steps.findIndex((item) => item.key === document.step) + 1];
    const processing = document.sources.filter((source) => source.status !== "done" && source.status !== "failed");
    const failedSources = document.sources.filter((source) => source.status === "failed");
    const selectedShots = checked.length ? shots.filter((shot) => checked.includes(shot.id)) : currentShot ? [currentShot] : [];
    const shotNumberOf = (id: string) => shots.findIndex((shot) => shot.id === id) + 1;

    const stepStatus = () => {
        const characters = document.characters.filter((item) => item.kind === "character" && item.appearances.length);
        switch (document.step) {
            case "assets": {
                const bound = shots.some((shot) => shot.persons.some((person) => personTarget(person, document.identities)));
                return characters.length ? (bound ? "替换素材已应用" : `已准备 ${characters.length} 个替换人物，下一步把它们拖到人物框上`) : "上传或生成替换人物的形象";
            }
            case "image":
                return `已生成 ${shots.filter((shot) => shot.imageResults.length).length}/${shots.length} 个关键帧`;
            case "video":
                return `已生成 ${shots.filter((shot) => shot.videoResults.length).length}/${shots.length} 段视频`;
            case "voice":
                return `已配音 ${document.lines.filter((line) => line.audioKey).length}/${document.lines.length} 句`;
            default:
                if (audioOnly) {
                    return document.compose?.audioKey
                        ? `已合成音频：${document.compose.message}`
                        : document.compose?.status === "failed"
                          ? `合成失败：${document.compose.error}`
                          : "混音克隆结果与背景声，导出最终音频";
                }
                return document.compose?.status === "done" ? `已合成：${document.compose.message}` : document.compose?.status === "failed" ? `合成失败：${document.compose.error}` : "确认镜头后合成完整视频";
        }
    };

    const addToCanvas = async () => {
        const items: Array<{ key: string; title: string; kind: "image" | "video" | "audio" }> = [];
        if (document.step === "assets") for (const character of document.characters) items.push({ key: characterImageKey(character), title: character.name || "替换素材", kind: "image" });
        if (document.step === "image") for (const shot of selectedShots) items.push({ key: shotImageKey(shot), title: shotFileName(shotNumberOf(shot.id), "关键帧"), kind: "image" });
        if (document.step === "video") for (const shot of selectedShots) items.push({ key: shotVideoKey(shot), title: shotFileName(shotNumberOf(shot.id), "替换视频"), kind: "video" });
        if (document.step === "voice" || document.step === "compose") {
            if (audioOnly) items.push({ key: document.compose?.audioKey || "", title: `${project.title}-最终音频`, kind: "audio" });
            else items.push({ key: document.compose?.videoKey || "", title: `${project.title}-完整视频`, kind: "video" });
        }
        const usable = items.filter((item) => item.key);
        if (!usable.length) {
            return message.warning(
                audioOnly
                    ? document.step === "voice" || document.step === "compose"
                        ? "请先「合成最终音频」再加入画布"
                        : "当前步骤还没有可加入画布的内容"
                    : document.step === "voice"
                      ? "声音需要先合成视频再加入画布"
                      : "当前步骤还没有可加入画布的内容",
            );
        }
        const hide = message.loading("正在加入画布素材库…", 0);
        try {
            const added = await addStudioMediaToCanvas(usable);
            message.success(`已加入画布素材库 ${added} 项，可在画布左侧素材里使用`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加入画布失败");
        } finally {
            hide();
        }
    };

    const exportItems = audioOnly
        ? [
              { key: "mix-final", label: "合成并下载最终音频", onClick: () => void runner.composeMix() },
              { key: "mix", label: "下载最终音频（若已合成）", disabled: !document.compose?.audioKey, onClick: () => void runner.exportMedia(document.compose?.audioKey, `${project.title}-最终音频`, "wav") },
              { type: "divider" as const },
              { key: "all", label: "全部素材（zip）", onClick: () => void runner.exportAll() },
              { key: "package", label: "项目包（可导入）", onClick: () => void runner.exportPackage() },
          ]
        : [
              { key: "shot-video", label: "当前镜头：替换视频", disabled: !currentShot || !shotVideoKey(currentShot), onClick: () => currentShot && void runner.exportMedia(shotVideoKey(currentShot), shotFileName(shotNumberOf(currentShot.id), "替换视频"), "mp4") },
              { key: "shot-image", label: "当前镜头：关键帧", disabled: !currentShot || !shotImageKey(currentShot), onClick: () => currentShot && void runner.exportMedia(shotImageKey(currentShot), shotFileName(shotNumberOf(currentShot.id), "关键帧"), "png") },
              { type: "divider" as const },
              { key: "full", label: "完整视频", disabled: !document.compose?.videoKey, onClick: () => void runner.exportMedia(document.compose?.videoKey, `${project.title}-完整视频`, "mp4") },
              { key: "mix", label: "替换音频", onClick: () => void runner.exportMix() },
              { key: "all", label: "全部素材（zip）", onClick: () => void runner.exportAll() },
              { key: "premiere", label: "Premiere 工程（XML）", onClick: () => void runner.exportPremiere() },
              { type: "divider" as const },
              { key: "package", label: "项目包（可导入）", onClick: () => void runner.exportPackage() },
          ];

    const busyStatus = runner.stream.slice(-160) || document.compose?.message || processing[0]?.message || document.logs[document.logs.length - 1]?.message;

    return (
        <DarkScope className="h-full">
            <ReplacementShell
                title={project.title}
                onRename={handle.rename}
                step={document.step}
                onStep={setStep}
                steps={steps}
                homeLabel={audioOnly ? "声音克隆项目" : "人物替换项目"}
                saving={handle.saving}
                error={handle.error}
                busy={runner.busy}
                onCancel={runner.cancel}
                status={runner.busy ? busyStatus : stepStatus()}
                next={nextStep ? { label: `进入${nextStep.label}`, onClick: () => setStep(nextStep.key) } : null}
                actions={
                    <>
                        <DarkButton size="sm" onClick={() => setSourcesOpen(true)} className={cn(failedSources.length && "!bg-red-500/20 !text-red-200")}>
                            {processing.length ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
                            {audioOnly ? `原声音 ${document.sources.length}` : `原视频 ${document.sources.length}`}
                        </DarkButton>
                        <IconButton onClick={() => setSettingsOpen(true)} title="设置">
                            <Settings2 className="size-3.5" />
                        </IconButton>
                        <IconButton onClick={() => setLogOpen(true)} title="任务日志">
                            <ScrollText className="size-3.5" />
                        </IconButton>
                        {document.step === "compose" || (audioOnly && document.step === "voice") ? (
                            <Dropdown trigger={["click"]} menu={{ items: exportItems }}>
                                <DarkButton size="sm">
                                    <Download className="size-3.5" />
                                    导出
                                    <ChevronDown className="size-3" />
                                </DarkButton>
                            </Dropdown>
                        ) : null}
                        <DarkButton size="sm" tone="primary" onClick={() => void addToCanvas()}>
                            <LayoutGrid className="size-3.5" />
                            加入画布
                        </DarkButton>
                    </>
                }
            >
                <div className="flex h-full min-h-0 flex-col gap-2">
                    {!document.sources.length ? (
                        <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-dashed border-white/15 px-3 text-xs text-neutral-300">
                            <Film className="size-3.5 shrink-0 text-neutral-500" />
                            <span className="min-w-0 truncate">{audioOnly ? "还没有加入音频" : "还没有加入视频，替换前需要先处理原视频"}</span>
                            <DarkButton
                                size="sm"
                                className="ml-auto"
                                disabled={Boolean(runner.busy)}
                                onClick={() =>
                                    pickFiles(audioOnly ? "audio/*" : "video/*", true, (files) => {
                                        if (!files.length) return;
                                        if (audioOnly) void runner.addAudioSources(files);
                                        else void runner.addSources(files, false);
                                    })
                                }
                            >
                                <Upload className="size-3" />
                                {audioOnly ? "加入音频" : "加入视频"}
                            </DarkButton>
                        </div>
                    ) : processing.length || failedSources.length ? (
                        <button type="button" onClick={() => setSourcesOpen(true)} className={cn("flex h-7 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-[11px]", failedSources.length && !processing.length ? "bg-red-500/10 text-red-200" : "bg-white/[0.05] text-neutral-300")}>
                            {processing.length ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
                            <span className="min-w-0 truncate">{processing.length ? `正在处理 ${processing.length} 个视频：${processing[0].fileName} · ${processing[0].message}` : `${failedSources.length} 个视频处理失败：${failedSources[0].error || ""}`}</span>
                            <span className="ml-auto shrink-0 text-neutral-500">查看</span>
                        </button>
                    ) : null}
                    <div className="min-h-0 flex-1">
                        {document.step === "assets" ? (
                            <AssetsStep document={document} runner={runner} />
                        ) : document.step === "image" ? (
                            <ImageStep document={document} runner={runner} selection={selection} />
                        ) : document.step === "video" ? (
                            <VideoStep document={document} runner={runner} selection={selection} />
                        ) : document.step === "voice" ? (
                            <VoiceStep document={document} runner={runner} />
                        ) : (
                            <ComposeStep document={document} runner={runner} selection={selection} />
                        )}
                    </div>
                </div>
            </ReplacementShell>

            <SourcesDrawer open={sourcesOpen} onClose={() => setSourcesOpen(false)} document={document} runner={runner} onEditCuts={(id) => {
                setSourcesOpen(false);
                setCutSourceId(id);
            }} />
            {cutSourceId ? <ShotCutEditor source={document.sources.find((source) => source.id === cutSourceId)} document={document} runner={runner} onClose={() => setCutSourceId("")} /> : null}
            <Modal title="项目设置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null} width={480}>
                <ReplacementSettingsPanel settings={document.settings} disabled={Boolean(runner.busy)} onChange={updateSettings} />
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
