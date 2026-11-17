import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { saveStudioMedia } from "@/studios/media";

import { createCoverDocument, loadCoverDocument, saveCoverDocument, type CoverDocument, type CoverLine } from "./document";
import {
    alignLyricsToLines,
    audioDuration,
    cloneCoverLine,
    convertCoverLine,
    exportCoverMix,
    linesFromLyricsOnly,
    remakeCoverLine,
    separateCoverSource,
    transcribeCover,
    type CoverContext,
} from "./pipeline";
import { ORIGINAL_VOICE_REF } from "./document";

function isAbort(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function useCoverRunner() {
    const { message } = App.useApp();
    const [document, setDocument] = useState<CoverDocument>(() => loadCoverDocument());
    const [busy, setBusy] = useState("");
    const [logLines, setLogLines] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);
    const busyRef = useRef("");
    const documentRef = useRef(document);
    documentRef.current = document;

    useEffect(() => {
        saveCoverDocument(document);
    }, [document]);

    const update = useCallback((mutate: (current: CoverDocument) => CoverDocument) => {
        setDocument((current) => mutate(current));
    }, []);

    const log = useCallback((text: string, _level: "info" | "warn" | "error" = "info") => {
        setLogLines((current) => [...current.slice(-80), text]);
    }, []);

    const run = useCallback(
        async (label: string, task: (context: CoverContext) => Promise<void>) => {
            if (busyRef.current) {
                message.warning(`正在执行：${busyRef.current}`);
                return;
            }
            const controller = new AbortController();
            abortRef.current = controller;
            busyRef.current = label;
            setBusy(label);
            const context: CoverContext = { signal: controller.signal, log };
            try {
                await task(context);
                log(`${label}完成`);
            } catch (error) {
                if (isAbort(error) || controller.signal.aborted) log(`${label}已取消`, "warn");
                else {
                    log(`${label}失败：${errorText(error)}`, "error");
                    message.error(errorText(error));
                }
            } finally {
                busyRef.current = "";
                abortRef.current = null;
                setBusy("");
            }
        },
        [log, message],
    );

    const clearActiveLineStatuses = useCallback((reason = "已取消") => {
        update((current) => ({
            ...current,
            lines: current.lines.map((line) =>
                line.status === "running" || line.status === "pending" || line.status === "uploading"
                    ? { ...line, status: "idle", error: reason }
                    : line,
            ),
        }));
    }, [update]);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        busyRef.current = "";
        setBusy("");
        clearActiveLineStatuses("已取消");
        message.info("已停止当前任务");
    }, [clearActiveLineStatuses, message]);

    /** Unstick UI when a line is「生成中」but no runner is alive (refresh / lost abort). */
    const clearStuck = useCallback(() => {
        abortRef.current?.abort();
        busyRef.current = "";
        setBusy("");
        clearActiveLineStatuses("");
        message.success("已清除卡住的「生成中」状态");
    }, [clearActiveLineStatuses, message]);

    const reset = useCallback(() => {
        abortRef.current?.abort();
        busyRef.current = "";
        setBusy("");
        const next = createCoverDocument();
        setDocument(next);
        setLogLines([]);
        message.success("已新建翻唱项目");
    }, [message]);

    const uploadSong = useCallback(
        (file: File) =>
            run("上传歌曲", async () => {
                const key = await saveStudioMedia(file, "audio");
                const durationSec = await audioDuration(key);
                update((current) => ({
                    ...current,
                    source: { fileName: file.name, audioKey: key, durationSec },
                    lines: [],
                }));
            }),
        [run, update],
    );

    const uploadRef = useCallback(
        (file: File) =>
            run("上传参考音色", async () => {
                const key = await saveStudioMedia(file, "audio");
                const durationSec = await audioDuration(key);
                const ref = { id: nanoid(8), name: file.name.replace(/\.[^.]+$/u, ""), key, durationSec };
                update((current) => ({ ...current, refs: [...current.refs, ref] }));
            }),
        [run, update],
    );

    const separate = useCallback(
        () =>
            run("提取清晰人声", async (context) => {
                update((current) => ({
                    ...current,
                    source: current.source
                        ? { ...current.source, separation: { status: "uploading", message: "正在上传", vocalsKey: "", backgroundKey: "" } }
                        : current.source,
                }));
                try {
                    const result = await separateCoverSource(
                        documentRef.current,
                        (text, jobId) =>
                            update((current) => ({
                                ...current,
                                source: current.source
                                    ? {
                                          ...current.source,
                                          separation: {
                                              status: jobId ? "running" : "uploading",
                                              message: text,
                                              jobId: jobId || current.source.separation?.jobId,
                                              vocalsKey: current.source.separation?.vocalsKey,
                                              backgroundKey: current.source.separation?.backgroundKey,
                                          },
                                      }
                                    : current.source,
                            })),
                        context.signal,
                    );
                    update((current) => ({
                        ...current,
                        source: current.source
                            ? {
                                  ...current.source,
                                  separation: {
                                      status: "done",
                                      message: "已分离人声和伴奏",
                                      jobId: result.jobId,
                                      vocalsKey: result.vocalsKey,
                                      backgroundKey: result.backgroundKey,
                                  },
                              }
                            : current.source,
                    }));
                } catch (error) {
                    if (!isAbort(error)) {
                        update((current) => ({
                            ...current,
                            source: current.source
                                ? { ...current.source, separation: { status: "failed", error: errorText(error), message: "" } }
                                : current.source,
                        }));
                    }
                    throw error;
                }
            }),
        [run, update],
    );

    const transcribe = useCallback(
        () =>
            run("分析句子", async (context) => {
                const lines = await transcribeCover(documentRef.current, context);
                update((current) => ({ ...current, lines }));
            }),
        [run, update],
    );

    const patchLine = useCallback(
        (id: string, patch: Partial<CoverLine>) =>
            update((current) => ({
                ...current,
                lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
            })),
        [update],
    );

    const runLines = useCallback(
        (
            ids: string[],
            label: string,
            worker: (doc: CoverDocument, line: CoverLine, signal?: AbortSignal) => Promise<string>,
            options?: { requireTranslation?: boolean },
        ) =>
            run(label, async (context) => {
                const total = ids.length;
                let index = 0;
                for (const id of ids) {
                    if (context.signal?.aborted) {
                        clearActiveLineStatuses("已取消");
                        return;
                    }
                    index += 1;
                    const doc = documentRef.current;
                    const line = doc.lines.find((item) => item.id === id);
                    if (!line) continue;
                    if (options?.requireTranslation && !line.translation?.trim()) {
                        patchLine(id, { status: "failed", error: "请先填写改词（译文/改词栏），或用「完整歌词」对齐" });
                        context.log(`第 ${index}/${total} 句跳过：未填改词`, "warn");
                        continue;
                    }
                    busyRef.current = `${label}（${index}/${total}）`;
                    setBusy(`${label}（${index}/${total}）`);
                    patchLine(id, { status: "running", error: "" });
                    try {
                        const audioKey = await worker(documentRef.current, line, context.signal);
                        patchLine(id, { status: "done", audioKey, error: "" });
                    } catch (error) {
                        if (isAbort(error) || context.signal?.aborted) {
                            clearActiveLineStatuses("已取消");
                            throw error;
                        }
                        patchLine(id, { status: "failed", error: errorText(error) });
                        context.log(`「${(line.translation || line.text).slice(0, 16)}」失败：${errorText(error)}`, "error");
                    }
                }
            }),
        [clearActiveLineStatuses, patchLine, run],
    );

    const convertLines = useCallback((ids: string[]) => runLines(ids, ids.length > 1 ? `歌声转换 ${ids.length} 句` : "歌声转换", convertCoverLine), [runLines]);
    const cloneLines = useCallback((ids: string[]) => runLines(ids, ids.length > 1 ? `克隆 ${ids.length} 句` : "克隆配音", cloneCoverLine), [runLines]);
    const remakeLines = useCallback(
        (ids: string[]) => runLines(ids, ids.length > 1 ? `改词翻唱 ${ids.length} 句` : "改词翻唱", remakeCoverLine, { requireTranslation: true }),
        [runLines],
    );

    const exportMix = useCallback(
        () =>
            run("导出翻唱混音", async () => {
                await exportCoverMix(documentRef.current, documentRef.current.source?.fileName?.replace(/\.[^.]+$/u, "") || "翻唱混音");
                message.success("混音已下载");
            }),
        [message, run],
    );

    /** Paste full lyrics: align onto ASR timing, or create even slots if no analysis yet. */
    const applyFullLyrics = useCallback(
        (lyricsText: string) => {
            const current = documentRef.current;
            if (!current.source) {
                message.warning("请先上传歌曲");
                return;
            }
            try {
                if (current.lines.length) {
                    const lines = alignLyricsToLines(current.lines, lyricsText).map((line) => ({
                        ...line,
                        voiceAudioId: line.voiceAudioId || ORIGINAL_VOICE_REF,
                    }));
                    update((doc) => ({ ...doc, lines }));
                    message.success(`已按一行一句对齐 ${lines.length} 句（写入改词栏）`);
                } else {
                    const lines = linesFromLyricsOnly(current.source.durationSec, lyricsText);
                    update((doc) => ({ ...doc, lines }));
                    message.success(`已按歌词生成 ${lines.length} 句均分时间轴；建议再「开始分析」用 ASR 时间精修`);
                }
            } catch (error) {
                message.error(errorText(error));
            }
        },
        [message, update],
    );

    return {
        document,
        busy,
        logLines,
        update,
        cancel,
        clearStuck,
        reset,
        uploadSong,
        uploadRef,
        separate,
        transcribe,
        patchLine,
        convertLines,
        cloneLines,
        remakeLines,
        exportMix,
        applyFullLyrics,
    };
}

export type CoverRunner = ReturnType<typeof useCoverRunner>;
