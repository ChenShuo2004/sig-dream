import { BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Pause, Play, Plus, Sparkles, Square, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { WorkbenchReferenceStrip, reorderReferences } from "@/components/workbench-reference-strip";
import { CanvasVideoSettingsPopover } from "@/components/canvas/canvas-video-settings-popover";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { audioReferenceLabel, imageReferenceLabel, videoReferenceLabel } from "@/lib/image-reference-prompt";
import { clampVideoSeconds } from "@/lib/media-size";
import {
    rewritePromptToMinimaxH3,
    submitPromptForMinimaxH3,
    translateMinimaxH3Prompt,
    type MinimaxH3Lang,
    type MinimaxH3PromptPair,
} from "@/lib/minimax-h3-prompt";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { isRunningHubH3CinematicGen, isRunningHubH3FamilyGen } from "@/lib/relay-stations";
import { deleteStoredMedia, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { markWorkbenchDeleted, syncWorkbenchLogs } from "@/services/api/workbench-sync";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { cancelRunningHubTask, createVideoGenerationTask, holdVolcanoSeedanceUntilDone, pollVideoGenerationTask, storeGeneratedVideoOnce, videoPollPlan, type VideoGenerationTask } from "@/services/api/video";
import { StudioPromptMentionInput, type StudioMentionOption } from "@/studios/components/studio-prompt-mention-input";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, modelOptionLabel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";

const MAX_REF_IMAGES = 9;
const MAX_REF_VIDEOS = 3;
const MAX_REF_AUDIOS = 3;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videos?: ReferenceVideo[];
    audios?: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "runningHubInstanceType" | "h3DeOilStrength">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

const videoJobs = new Map<string, AbortController>();
const videoRhTasks = new Map<string, string>();
const videoJobListeners = new Set<() => void>();

function notifyVideoJobs() {
    videoJobListeners.forEach((listener) => listener());
}

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const [cancelling, setCancelling] = useState(false);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videos, setVideos] = useState<ReferenceVideo[]>([]);
    const [audios, setAudios] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const followLogIdRef = useRef("");
    const [formattingH3, setFormattingH3] = useState(false);
    const [h3Pair, setH3Pair] = useState<MinimaxH3PromptPair | null>(null);
    const [h3Lang, setH3Lang] = useState<MinimaxH3Lang>("zh");
    const [h3DirtyLang, setH3DirtyLang] = useState<MinimaxH3Lang | null>(null);
    const [h3Original, setH3Original] = useState("");
    const [originalPromptOpen, setOriginalPromptOpen] = useState(false);
    const [syncingH3, setSyncingH3] = useState(false);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const modelName = modelOptionName(model || "");
    const h3FamilyModel = isRunningHubH3FamilyGen(modelName);
    const h3CinematicModel = isRunningHubH3CinematicGen(modelName);
    const editorPrompt = h3Pair ? (h3Lang === "en" ? h3Pair.en : h3Pair.zh) : prompt;
    const canGenerate = Boolean(submitPromptForMinimaxH3(h3Pair, prompt));

    const resolveTextModel = () => {
        const textModel = effectiveConfig.textModel || effectiveConfig.model;
        if (!textModel) {
            message.warning(t("videoWorkbench.formatH3NeedTextModel"));
            openConfigDialog(true);
            return "";
        }
        if (!isAiConfigReady(effectiveConfig, textModel)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return "";
        }
        return textModel;
    };

    const formatPromptForH3 = async () => {
        const text = (h3Pair ? h3Pair.zh || h3Pair.en : prompt).trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return;
        }
        const textModel = resolveTextModel();
        if (!textModel) return;
        setFormattingH3(true);
        try {
            const next = await rewritePromptToMinimaxH3({
                prompt: text,
                textModel,
                slots: {
                    imageCount: references.length,
                    videoCount: h3CinematicModel ? 0 : videos.length,
                    audioCount: h3CinematicModel ? 0 : audios.length,
                },
            });
            if (!h3Pair) setH3Original(text);
            setH3Pair(next);
            setH3Lang("zh");
            setH3DirtyLang(null);
            setPrompt(next.zh);
            message.success(t("videoWorkbench.formatH3Done"));
        } catch (error) {
            message.error(t("videoWorkbench.formatH3Failed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setFormattingH3(false);
        }
    };

    const syncH3Language = async (to: MinimaxH3Lang) => {
        if (!h3Pair) return null;
        const textModel = resolveTextModel();
        if (!textModel) return null;
        const from: MinimaxH3Lang = to === "en" ? "zh" : "en";
        const source = (from === "en" ? h3Pair.en : h3Pair.zh).trim();
        if (!source) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        setSyncingH3(true);
        try {
            const translated = await translateMinimaxH3Prompt({ source, from, to, textModel });
            const next = to === "en" ? { ...h3Pair, en: translated } : { ...h3Pair, zh: translated };
            setH3Pair(next);
            setH3DirtyLang(null);
            if (to === "zh") setPrompt(translated);
            message.success(t("videoWorkbench.formatH3SyncDone"));
            return next;
        } catch (error) {
            message.error(t("videoWorkbench.formatH3SyncFailed", { error: error instanceof Error ? error.message : String(error) }));
            return null;
        } finally {
            setSyncingH3(false);
        }
    };

    const onEditorPromptChange = (next: string) => {
        if (h3Pair) {
            setH3Pair(h3Lang === "en" ? { ...h3Pair, en: next } : { ...h3Pair, zh: next });
            setH3DirtyLang(h3Lang);
            if (h3Lang === "zh") setPrompt(next);
            return;
        }
        setPrompt(next);
    };
    const mentionOptions = useMemo<StudioMentionOption[]>(() => {
        const imageOptions = references.map((item, index) => {
            const label = imageReferenceLabel(index);
            return {
                id: item.id,
                label,
                mention: `@${label}`,
                kindLabel: item.name || t("videoWorkbench.references"),
                previewUrl: previewUrlFor(item.storageKey) || item.dataUrl || "",
                mediaKind: "image" as const,
            };
        });
        const videoOptions = h3CinematicModel
            ? []
            : videos.map((item, index) => {
                  const label = videoReferenceLabel(index);
                  return {
                      id: item.id,
                      label,
                      mention: `@${label}`,
                      kindLabel: item.name || t("videoWorkbench.videoReferences"),
                      previewUrl: item.url || "",
                      mediaKind: "video" as const,
                  };
              });
        const audioOptions = h3CinematicModel
            ? []
            : audios.map((item, index) => {
                  const label = audioReferenceLabel(index);
                  return {
                      id: item.id,
                      label,
                      mention: `@${label}`,
                      kindLabel: item.name || t("videoWorkbench.audioReferences"),
                      mediaKind: "audio" as const,
                  };
              });
        return [...imageOptions, ...videoOptions, ...audioOptions];
    }, [references, videos, audios, h3CinematicModel, t]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
        const onJob = () => {
            void refreshLogs().then((logs) => {
                if (!videoJobs.size) {
                    setRunning(false);
                    setStartedAt(0);
                }
                const next = logs.find((log) => log.id === followLogIdRef.current);
                if (!next || next.status === "pending") return;
                setPreviewLog(next);
                setResults(next.video ? [{ id: next.video.id, status: "success", video: next.video }] : [{ id: next.id, status: "failed", error: next.error || t("workbench.generationFailed") }]);
            });
        };
        videoJobListeners.add(onJob);
        return () => {
            videoJobListeners.delete(onJob);
        };
    }, []);

    useEffect(() => {
        if (!h3CinematicModel) return;
        setVideos([]);
        setAudios([]);
    }, [h3CinematicModel]);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        if (!selectedFiles.length) return;
        const images = selectedFiles.filter((file) => file.type.startsWith("image/"));
        const videoFiles = h3CinematicModel ? [] : selectedFiles.filter((file) => file.type.startsWith("video/"));
        const audioFiles = h3CinematicModel ? [] : selectedFiles.filter((file) => file.type.startsWith("audio/"));
        const unsupported = selectedFiles.length - images.length - videoFiles.length - audioFiles.length;
        if (unsupported > 0) message.warning(t("videoWorkbench.unsupportedFiles"));

        if (images.length) {
            const imageFiles = images.slice(0, MAX_REF_IMAGES - references.length);
            const nextReferences = await Promise.all(
                imageFiles.map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, MAX_REF_IMAGES));
        }
        if (videoFiles.length) {
            const oversized = videoFiles.filter((file) => file.size > MAX_VIDEO_BYTES);
            if (oversized.length) message.warning(t("videoWorkbench.videoTooLarge"));
            const accepted = videoFiles.filter((file) => file.size <= MAX_VIDEO_BYTES).slice(0, MAX_REF_VIDEOS - videos.length);
            const nextVideos = await Promise.all(
                accepted.map(async (file) => {
                    const stored = await uploadMediaFile(file, "video");
                    return { id: nanoid(), name: file.name, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs };
                }),
            );
            setVideos((value) => [...value, ...nextVideos].slice(0, MAX_REF_VIDEOS));
        }
        if (audioFiles.length) {
            const oversized = audioFiles.filter((file) => file.size > MAX_AUDIO_BYTES);
            if (oversized.length) message.warning(t("videoWorkbench.audioTooLarge"));
            const accepted = audioFiles.filter((file) => file.size <= MAX_AUDIO_BYTES).slice(0, MAX_REF_AUDIOS - audios.length);
            const nextAudios = await Promise.all(
                accepted.map(async (file) => {
                    const stored = await uploadMediaFile(file, "audio");
                    return { id: nanoid(), name: file.name, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, durationMs: stored.durationMs };
                }),
            );
            setAudios((value) => [...value, ...nextAudios].slice(0, MAX_REF_AUDIOS));
        }
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepthRef.current += 1;
        setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, MAX_REF_IMAGES - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, MAX_REF_IMAGES));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        let pairForSubmit = h3Pair;
        if (pairForSubmit && h3DirtyLang === "zh") {
            message.info(t("videoWorkbench.formatH3SyncingBeforeSubmit"));
            pairForSubmit = await syncH3Language("en");
            if (!pairForSubmit) {
                if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.formatH3SyncFailed", { error: "" }) });
                return;
            }
        }
        const snapshot = buildRequestSnapshot(pairForSubmit);
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, { videos: snapshot.videos, audios: snapshot.audios });
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videos: snapshot.videos, audios: snapshot.audios, durationMs: 0, status: "pending", task });
            await saveLog(log, false);
            void pollGenerationLog(log, snapshot.config, agentTaskId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog(buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videos: snapshot.videos, audios: snapshot.audios, durationMs: performance.now() - batchStartedAt, status: "failed", error: errorMessage }));
            message.error(errorMessage);
            setRunning(false);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") {
            setPrompt(videoCommand.prompt);
            setH3Pair(null);
            setH3DirtyLang(null);
            setH3Original("");
        }
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = (pairOverride?: MinimaxH3PromptPair | null) => {
        const text = submitPromptForMinimaxH3(pairOverride === undefined ? h3Pair : pairOverride, prompt);
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references], videos: [...videos], audios: [...audios] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
            setH3Pair(null);
            setH3DirtyLang(null);
            setH3Original("");
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, MAX_REF_IMAGES));
        } else if (payload.kind === "video") {
            if (h3CinematicModel) {
                message.warning(t("videoWorkbench.cinematicNoAvRefs"));
                setAssetPickerOpen(false);
                return;
            }
            const stored = await uploadMediaFile(payload.url, "video");
            setVideos((value) =>
                [
                    ...value,
                    {
                        id: nanoid(),
                        name: payload.title,
                        type: stored.mimeType,
                        url: stored.url,
                        storageKey: stored.storageKey || payload.storageKey,
                        bytes: stored.bytes,
                        width: stored.width || payload.width,
                        height: stored.height || payload.height,
                        durationMs: stored.durationMs,
                    },
                ].slice(0, MAX_REF_VIDEOS),
            );
        } else if (payload.kind === "audio") {
            const stored = await uploadMediaFile(payload.url, "audio");
            setAudios((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType || payload.mimeType || "audio/mpeg", url: stored.url, storageKey: stored.storageKey || payload.storageKey, durationMs: stored.durationMs }].slice(0, MAX_REF_AUDIOS));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setH3Pair(null);
        setH3Lang("zh");
        setH3DirtyLang(null);
        setH3Original("");
        setReferences([]);
        setVideos([]);
        setAudios([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        markWorkbenchDeleted("video", selectedLogIds);
        void Promise.all([deleteStoredMedia(mediaKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(() => refreshLogs());
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        await logStore.setItem(log.id, serializeLog(log));
        await refreshLogs(resumePending);
    };

    const refreshLogs = async (resumePending = true) => {
        await syncWorkbenchLogs("video", logStore).catch(() => undefined);
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status !== "pending" || !log.task) continue;
            if (log.video?.storageKey) continue;
            if (videoJobs.has(log.id)) {
                followLogIdRef.current = log.id;
                setRunning(true);
                setStartedAt((value) => value || performance.now());
                setPreviewLog(log);
                setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
                continue;
            }
            void pollGenerationLog(log, undefined, undefined, true);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, queryFirst = false) => {
        if (!log.task || videoJobs.has(log.id)) return;
        followLogIdRef.current = log.id;
        const controller = new AbortController();
        videoJobs.set(log.id, controller);
        if (log.task.provider === "runninghub" && log.task.id) videoRhTasks.set(log.id, log.task.id);
        notifyVideoJobs();
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        const { intervalMs, timeoutMs } = videoPollPlan(log.task.provider);
        const deadline = Date.now() + timeoutMs;
        const finishVideo = async (result: Extract<Awaited<ReturnType<typeof pollVideoGenerationTask>>, { status: "completed" }>) => {
            const stored = await storeGeneratedVideoOnce(log.task?.id || "", result.result, { prompt: log.prompt });
            if (stored.nasWarning) message.warning(stored.nasWarning);
            const nextVideo: GeneratedVideo = {
                id: nanoid(),
                url: stored.url,
                storageKey: stored.storageKey,
                durationMs: Date.now() - log.createdAt,
                width: stored.width || 1280,
                height: stored.height || 720,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
            setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
            await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
            message.success(t("videoWorkbench.generated"));
        };
        const showGenerating = () => {
            setRunning(true);
            setStartedAt((value) => value || performance.now());
            setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        };
        try {
            if (!queryFirst) showGenerating();
            while (true) {
                if (controller.signal.aborted) throw new DOMException(t("videoWorkbench.cancelled"), "AbortError");
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, { signal: controller.signal });
                if (state.status === "completed") {
                    await finishVideo(state);
                    return;
                }
                if (state.status === "failed") throw new Error(state.error || t("workbench.generationFailed"));
                if (queryFirst) showGenerating();
                if (Date.now() >= deadline) throw new Error(t("videoWorkbench.timeout"));
                await delay(intervalMs);
                if (controller.signal.aborted) throw new DOMException(t("videoWorkbench.cancelled"), "AbortError");
            }
        } catch (error) {
            const aborted = (error instanceof DOMException && error.name === "AbortError") || controller.signal.aborted;
            const errorMessage = aborted
                ? t("videoWorkbench.cancelled")
                : error instanceof Error
                  ? error.message
                  : t("workbench.generationFailed");
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            if (!aborted) message.error(errorMessage);
            else message.info(errorMessage);
        } finally {
            if (log.task.provider === "volcengine") holdVolcanoSeedanceUntilDone(log.task.id);
            videoJobs.delete(log.id);
            videoRhTasks.delete(log.id);
            notifyVideoJobs();
            if (!videoJobs.size) {
                setRunning(false);
                setStartedAt(0);
                setCancelling(false);
            }
        }
    };

    const cancelRunningGeneration = async () => {
        if (!running || cancelling) return;
        setCancelling(true);
        const rhTaskIds = [...videoRhTasks.values()];
        const controllers = [...videoJobs.values()];
        await Promise.all(
            rhTaskIds.map((taskId) =>
                cancelRunningHubTask(taskId).catch(() => undefined),
            ),
        );
        for (const controller of controllers) controller.abort();
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setH3Pair(null);
        setH3Original("");
        setH3DirtyLang(null);
        setH3Lang("zh");
        setReferences(log.references || []);
        setVideos(log.videos || []);
        setAudios(log.audios || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
        if (log.config.runningHubInstanceType) updateConfig("runningHubInstanceType", log.config.runningHubInstanceType);
        if (log.config.h3DeOilStrength) updateConfig("h3DeOilStrength", log.config.h3DeOilStrength);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("workbench.generationFailed") }]);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
                </aside>

                <section className="grid h-full min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-card p-3 shadow-sm dark:border-stone-800">
                        <div className="mb-2 flex shrink-0 justify-end gap-2 lg:hidden">
                            <Button size="small" icon={<History className="size-3.5" />} onClick={() => setLogsOpen(true)}>
                                {t("workbench.logs")}
                            </Button>
                        </div>

                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                                        {h3FamilyModel && h3Pair ? (
                                            <>
                                                <div className="inline-flex overflow-hidden rounded-md border border-stone-200 dark:border-stone-700">
                                                    <Button
                                                        size="small"
                                                        type={h3Lang === "zh" ? "primary" : "default"}
                                                        className="!rounded-none"
                                                        disabled={formattingH3 || syncingH3 || running}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => setH3Lang("zh")}
                                                    >
                                                        {t("videoWorkbench.formatH3LangZh")}
                                                        {h3DirtyLang === "zh" ? " *" : ""}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        type={h3Lang === "en" ? "primary" : "default"}
                                                        className="!rounded-none !border-l-0"
                                                        disabled={formattingH3 || syncingH3 || running}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => setH3Lang("en")}
                                                    >
                                                        {t("videoWorkbench.formatH3LangEn")}
                                                        {h3DirtyLang === "en" ? " *" : ""}
                                                    </Button>
                                                </div>
                                                <Button
                                                    size="small"
                                                    disabled={formattingH3 || syncingH3 || running}
                                                    loading={syncingH3}
                                                    onClick={() => void syncH3Language(h3Lang === "zh" ? "en" : "zh")}
                                                >
                                                    {h3Lang === "zh" ? t("videoWorkbench.formatH3SyncToEn") : t("videoWorkbench.formatH3SyncToZh")}
                                                </Button>
                                            </>
                                        ) : null}
                                        {h3FamilyModel ? (
                                            <Button size="small" icon={formattingH3 ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} disabled={formattingH3 || syncingH3 || running || !editorPrompt.trim()} onClick={() => void formatPromptForH3()}>
                                                {t("videoWorkbench.formatH3")}
                                            </Button>
                                        ) : null}
                                        {h3FamilyModel ? (
                                            <Button size="small" onClick={() => setOriginalPromptOpen(true)}>
                                                {t("videoWorkbench.viewOriginalPrompt")}
                                            </Button>
                                        ) : null}
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <StudioPromptMentionInput
                                    key={h3Pair ? `video-h3-${h3Lang}` : "video-prompt"}
                                    tone="workbench"
                                    fill
                                    value={editorPrompt}
                                    minRows={3}
                                    maxRows={12}
                                    placeholder={t("videoWorkbench.promptPlaceholder")}
                                    options={mentionOptions}
                                    onChange={onEditorPromptChange}
                                    className="min-h-0 min-w-0 flex-1"
                                />
                            </div>

                            <div className="min-w-0 shrink-0">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <span className="text-sm font-semibold">{t("videoWorkbench.references")}</span>
                                    <div className="flex gap-1.5">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <WorkbenchReferenceStrip
                                    compact
                                    references={references}
                                    previewUrl={(item) => previewUrlFor(item.storageKey) || item.dataUrl}
                                    badge={(index) => index + 1}
                                    emptyText={t("videoWorkbench.noImages")}
                                    dropText={t("videoWorkbench.dropReferences")}
                                    removeLabel={t("videoWorkbench.removeImage")}
                                    dragActive={referenceDragTarget}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        if (event.dataTransfer.types.includes("Files")) event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDropFiles={handleReferenceDrop}
                                    onReorder={(from, to) => setReferences((value) => reorderReferences(value, from, to))}
                                    onRemove={(id) => setReferences((value) => value.filter((ref) => ref.id !== id))}
                                />
                            </div>

                            {h3CinematicModel ? null : (
                                <>
                                    <div className="min-w-0 shrink-0">
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold">{t("videoWorkbench.videoReferences")}</span>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => videoInputRef.current?.click()}>
                                                {t("workbench.upload")}
                                            </Button>
                                        </div>
                                        <MediaRefStrip
                                            compact
                                            kind="video"
                                            emptyText={t("videoWorkbench.noVideos")}
                                            items={videos.map((item, index) => ({
                                                id: item.id,
                                                label: item.name,
                                                hint: item.durationMs ? formatDuration(item.durationMs) : undefined,
                                                url: item.url,
                                                badge: index + 1,
                                            }))}
                                            removeLabel={t("videoWorkbench.removeVideo")}
                                            previewLabel={t("videoWorkbench.previewVideo")}
                                            onRemove={(id) => setVideos((value) => value.filter((item) => item.id !== id))}
                                        />
                                    </div>

                                    <div className="min-w-0 shrink-0">
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold">{t("videoWorkbench.audioReferences")}</span>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => audioInputRef.current?.click()}>
                                                {t("workbench.upload")}
                                            </Button>
                                        </div>
                                        <MediaRefStrip
                                            compact
                                            kind="audio"
                                            emptyText={t("videoWorkbench.noAudio")}
                                            items={audios.map((item, index) => ({
                                                id: item.id,
                                                label: item.name,
                                                hint: item.durationMs ? formatDuration(item.durationMs) : undefined,
                                                url: item.url,
                                                badge: index + 1,
                                            }))}
                                            removeLabel={t("videoWorkbench.removeAudio")}
                                            previewLabel={t("videoWorkbench.previewAudio")}
                                            onRemove={(id) => setAudios((value) => value.filter((item) => item.id !== id))}
                                        />
                                    </div>
                                </>
                            )}

                            <div className="flex shrink-0 items-end gap-2">
                                <label className="block min-w-0 flex-1">
                                    <span className="mb-1 block text-sm font-semibold">{t("workbench.model")}</span>
                                    <ModelPicker config={effectiveConfig} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
                                </label>
                                <CanvasVideoSettingsPopover
                                    config={effectiveConfig}
                                    onConfigChange={(key, value) => updateConfig(key, value)}
                                    placement="topRight"
                                    buttonClassName="!h-10 !max-w-[200px] !justify-start !rounded-lg !border !border-stone-200 !bg-stone-50 !px-2.5 dark:!border-stone-700 dark:!bg-stone-900"
                                />
                            </div>
                        </div>

                        <div className="flex shrink-0 gap-2 pt-2">
                            {running ? (
                                <Button size="large" danger block icon={<Square className="size-3.5 fill-current" />} loading={cancelling} disabled={cancelling} onClick={() => void cancelRunningGeneration()}>
                                    {t("videoWorkbench.cancelTask")}
                                </Button>
                            ) : (
                                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={() => void generate()}>
                                    {t("workbench.generate")}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} onCancel={() => void cancelRunningGeneration()} cancelling={cancelling} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={audioInputRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp3,audio/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <Modal title={t("videoWorkbench.viewOriginalPromptTitle")} open={originalPromptOpen} centered width={640} footer={null} onCancel={() => setOriginalPromptOpen(false)} destroyOnHidden>
                <div className="max-h-[60dvh] overflow-auto whitespace-pre-wrap text-sm leading-6">{h3Original.trim() || t("videoWorkbench.viewOriginalPromptEmpty")}</div>
            </Modal>
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ onCancel, cancelling }: { onCancel?: () => void; cancelling?: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
                {onCancel ? (
                    <Button size="small" danger icon={<Square className="size-3 fill-current" />} loading={cancelling} disabled={cancelling} onClick={onCancel}>
                        {t("videoWorkbench.cancelTask")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard key={log.id} log={log} selected={selectedLogIds.includes(log.id)} active={activeLogId === log.id} onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} onClick={() => onPreviewLog(log)} />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`} onClick={onClick}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                        {t(`workbench.${log.status === "success" ? "success" : log.status === "pending" ? "generating" : "failed"}`)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const videos = await Promise.all(
        (log.videos || []).map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) })),
    );
    const audios = await Promise.all(
        (log.audios || []).map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videos,
        audios,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videos: (log.videos || []).map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        audios: (log.audios || []).map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
        runningHubInstanceType: log.config?.runningHubInstanceType || "default",
        h3DeOilStrength: log.config?.h3DeOilStrength || "",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    videos,
    audios,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videos?: ReferenceVideo[];
    audios?: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
        runningHubInstanceType: config.runningHubInstanceType || "default",
        h3DeOilStrength: config.h3DeOilStrength || "0.4",
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        videos: videos || [],
        audios: audios || [],
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function MediaRefStrip({
    kind,
    items,
    emptyText,
    removeLabel,
    previewLabel,
    onRemove,
    compact = false,
}: {
    kind: "video" | "audio";
    items: Array<{ id: string; label: string; hint?: string; url: string; badge: number }>;
    emptyText: string;
    removeLabel: string;
    previewLabel: string;
    onRemove: (id: string) => void;
    compact?: boolean;
}) {
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [videoPreview, setVideoPreview] = useState<{ url: string; label: string } | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (playingId && !items.some((entry) => entry.id === playingId)) {
            setPlayingId(null);
        }
    }, [items, playingId]);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        if (!playingId) {
            el.pause();
            el.removeAttribute("src");
            el.load();
            return;
        }
        const item = items.find((entry) => entry.id === playingId);
        if (!item?.url) return;
        if (el.src !== item.url) {
            el.src = item.url;
        }
        void el.play().catch(() => setPlayingId(null));
    }, [playingId, items]);

    if (kind === "video") {
        return (
            <>
                <div
                    className={`hover-scrollbar hover-scrollbar-hint flex w-full min-w-0 max-w-full gap-2 overflow-x-auto overflow-y-hidden rounded-lg border border-dashed border-stone-300 dark:border-stone-700 ${compact ? "min-h-14 p-1.5" : "min-h-24 p-2"}`}
                >
                    {items.map((item) => (
                        <div key={item.id} className={`group relative shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black/40 dark:border-stone-800 ${compact ? "size-12" : "size-20"}`}>
                            <video src={item.url} className="pointer-events-none size-full object-cover" muted preload="metadata" playsInline />
                            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{item.badge}</span>
                            <button
                                type="button"
                                className="absolute inset-0 grid place-items-center bg-black/25 text-white transition hover:bg-black/40"
                                onClick={() => setVideoPreview({ url: item.url, label: item.label })}
                                aria-label={previewLabel}
                                title={previewLabel}
                            >
                                <span className={`grid place-items-center rounded-full bg-black/65 ${compact ? "size-6" : "size-8"}`}>
                                    <Play className={`fill-current ${compact ? "size-3" : "size-4"}`} />
                                </span>
                            </button>
                            <button
                                type="button"
                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                onClick={() => onRemove(item.id)}
                                aria-label={removeLabel}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    ))}
                    {!items.length ? <div className={`flex min-w-full items-center justify-center text-stone-500 ${compact ? "text-xs" : "text-sm"}`}>{emptyText}</div> : null}
                </div>
                <Modal open={Boolean(videoPreview)} title={videoPreview?.label || previewLabel} footer={null} onCancel={() => setVideoPreview(null)} width={720} destroyOnHidden>
                    {videoPreview ? <video src={videoPreview.url} className="max-h-[70vh] w-full rounded-md bg-black" controls autoPlay playsInline /> : null}
                </Modal>
            </>
        );
    }

    return (
        <div className={`flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 ${compact ? "min-h-14 p-1.5" : "min-h-16 gap-2 p-2"}`}>
            <div className="flex flex-wrap gap-1.5">
                {items.map((item) => {
                    const active = playingId === item.id;
                    return (
                        <div key={item.id} className={`group flex max-w-full items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 text-xs dark:border-stone-700 dark:bg-stone-900 ${compact ? "px-1.5 py-1" : "gap-2 px-2 py-1.5"}`}>
                            <span className="rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">{item.badge}</span>
                            <Music2 className="size-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 truncate font-medium text-stone-800 dark:text-stone-100">{item.label}</span>
                            {item.hint ? <span className="shrink-0 text-stone-400">{item.hint}</span> : null}
                            <button
                                type="button"
                                className="grid size-6 shrink-0 place-items-center rounded-full bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100"
                                onClick={() => setPlayingId((value) => (value === item.id ? null : item.id))}
                                aria-label={previewLabel}
                                title={previewLabel}
                            >
                                {active ? <Pause className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
                            </button>
                            <button
                                type="button"
                                className="hidden size-5 items-center justify-center rounded text-stone-500 group-hover:flex hover:text-red-500"
                                onClick={() => {
                                    setPlayingId((value) => (value === item.id ? null : value));
                                    onRemove(item.id);
                                }}
                                aria-label={removeLabel}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    );
                })}
                {!items.length ? <div className={`flex w-full items-center justify-center text-stone-500 ${compact ? "min-h-10 text-xs" : "min-h-12 text-sm"}`}>{emptyText}</div> : null}
            </div>
            <audio ref={audioRef} className={playingId ? "w-full" : "hidden"} controls onEnded={() => setPlayingId(null)} />
        </div>
    );
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
        runningHubInstanceType: config.runningHubInstanceType || "default",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
