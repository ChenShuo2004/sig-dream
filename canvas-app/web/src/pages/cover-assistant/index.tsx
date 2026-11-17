import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Checkbox, Input, Popconfirm, Select } from "antd";
import { AudioLines, Languages, Mic, Music2, PenLine, Play, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { resolveStudioMedia, useStudioMedia } from "@/studios/media";
import { audioPeaks } from "@/studios/replacement/stages";
import { DarkButton, DarkScope, EmptyHint, IconButton, Panel, StatusBadge } from "@/studios/components/studio-dark-ui";
import { StudioAudio, Waveform } from "@/pages/studio-replacement/media";
import { SmallSelect } from "@/pages/studio-replacement/ui";

import { ORIGINAL_VOICE_REF, type CoverDocument, type CoverLine } from "./document";
import { lineClipBlob } from "./pipeline";
import { useCoverRunner } from "./runner";

const LANGUAGES = ["英语", "中文", "日语", "韩语", "西班牙语", "法语", "德语"];

/** Session cache of exact original line clips for A/B listen. */
const originalClipUrls = new Map<string, string>();

function pickFiles(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => onFiles(Array.from(input.files || []));
    input.click();
}

function usePeaks(key?: string) {
    const [peaks, setPeaks] = useState<number[]>([]);
    useEffect(() => {
        let cancelled = false;
        setPeaks([]);
        if (key) void audioPeaks(key, 240).then((value) => !cancelled && setPeaks(value));
        return () => {
            cancelled = true;
        };
    }, [key]);
    return peaks;
}

function playKey(key?: string) {
    if (!key) return;
    void resolveStudioMedia(key).then((url) => url && void new Audio(url).play());
}

function lineClipCacheKey(document: CoverDocument, line: CoverLine) {
    const sourceKey = document.source?.separation?.vocalsKey || document.source?.audioKey || "";
    return `${line.id}:${sourceKey}:${line.startSec.toFixed(3)}:${line.endSec.toFixed(3)}`;
}

function LineCompareAudio({ document, line }: { document: CoverDocument; line: CoverLine }) {
    const resultUrl = useStudioMedia(line.audioKey);
    const cacheKey = lineClipCacheKey(document, line);
    const hasSourceAudio = Boolean(document.source?.separation?.vocalsKey || document.source?.audioKey);
    const [originalUrl, setOriginalUrl] = useState(() => originalClipUrls.get(cacheKey) || "");
    const [loadingOriginal, setLoadingOriginal] = useState(false);
    const [originalError, setOriginalError] = useState("");
    const [comparing, setComparing] = useState(false);
    const originalRef = useRef<HTMLAudioElement | null>(null);
    const resultRef = useRef<HTMLAudioElement | null>(null);
    const compareTokenRef = useRef(0);

    useEffect(() => {
        setOriginalUrl(originalClipUrls.get(cacheKey) || "");
        setOriginalError("");
    }, [cacheKey]);

    const ensureOriginal = async () => {
        const cached = originalClipUrls.get(cacheKey);
        if (cached) {
            setOriginalUrl(cached);
            return cached;
        }
        if (!hasSourceAudio) {
            setOriginalError("没有可用原片音轨");
            return "";
        }
        setLoadingOriginal(true);
        setOriginalError("");
        try {
            const blob = await lineClipBlob(document, line);
            const url = URL.createObjectURL(blob);
            originalClipUrls.set(cacheKey, url);
            setOriginalUrl(url);
            return url;
        } catch (error) {
            setOriginalError(error instanceof Error ? error.message : String(error));
            return "";
        } finally {
            setLoadingOriginal(false);
        }
    };

    // Prefetch original clip once a result exists so A/B is ready.
    useEffect(() => {
        if (!line.audioKey || originalUrl || loadingOriginal || !hasSourceAudio) return;
        void ensureOriginal();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [line.audioKey, cacheKey, hasSourceAudio]);

    const stopCompare = () => {
        compareTokenRef.current += 1;
        originalRef.current?.pause();
        resultRef.current?.pause();
        setComparing(false);
    };

    const waitEnded = (el: HTMLAudioElement, token: number) =>
        new Promise<void>((resolve) => {
            if (compareTokenRef.current !== token) {
                resolve();
                return;
            }
            const done = () => {
                el.removeEventListener("ended", done);
                el.removeEventListener("pause", onPause);
                resolve();
            };
            const onPause = () => {
                if (compareTokenRef.current !== token) done();
            };
            el.addEventListener("ended", done);
            el.addEventListener("pause", onPause);
        });

    const playCompare = async () => {
        if (comparing) {
            stopCompare();
            return;
        }
        const url = originalUrl || (await ensureOriginal());
        if (!url || !line.audioKey) return;
        const token = ++compareTokenRef.current;
        setComparing(true);
        try {
            const original = originalRef.current;
            const result = resultRef.current;
            if (original && compareTokenRef.current === token) {
                original.currentTime = 0;
                await original.play();
                await waitEnded(original, token);
            }
            if (result && compareTokenRef.current === token) {
                result.currentTime = 0;
                await result.play();
                await waitEnded(result, token);
            }
        } catch {
            /* user gesture / abort */
        } finally {
            if (compareTokenRef.current === token) setComparing(false);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-neutral-500">原声</span>
                {originalUrl ? (
                    <audio ref={originalRef} src={originalUrl} controls preload="metadata" className="h-7 min-w-0 flex-1" />
                ) : (
                    <DarkButton size="sm" className="!h-6 !px-2" disabled={!hasSourceAudio || loadingOriginal} onClick={() => void ensureOriginal()} title="截取这句原片人声以便对比">
                        {loadingOriginal ? "截取中…" : "加载原声"}
                    </DarkButton>
                )}
            </div>
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-neutral-500">结果</span>
                {line.audioKey ? (
                    resultUrl ? (
                        <audio ref={resultRef} src={resultUrl} controls preload="metadata" className="h-7 min-w-0 flex-1" />
                    ) : (
                        <span className="text-[10px] text-neutral-500">加载中…</span>
                    )
                ) : (
                    <span className="text-[10px] text-neutral-600">尚未生成</span>
                )}
            </div>
            <div className="flex items-center gap-1.5">
                <DarkButton
                    size="sm"
                    className="!h-6 !px-2"
                    disabled={!hasSourceAudio || !line.audioKey || loadingOriginal}
                    title="先播这句原声，再播克隆/歌声/改词结果"
                    onClick={() => void playCompare()}
                >
                    {comparing ? "停止对比" : "原声→结果 对比"}
                </DarkButton>
            </div>
            {originalError ? <span className="text-[10px] text-red-300">{originalError}</span> : null}
        </div>
    );
}

function CoverAssistantPage() {
    const { message } = App.useApp();
    const [searchParams] = useSearchParams();
    const embed = searchParams.get("embed") === "1";
    const runner = useCoverRunner();
    const { document, busy } = runner;
    const source = document.source;
    const [checked, setChecked] = useState<string[]>([]);
    const [language, setLanguage] = useState("英语");
    const [lyricsDraft, setLyricsDraft] = useState("");
    const [lyricsOpen, setLyricsOpen] = useState(false);
    const separation = source?.separation;
    const peaks = usePeaks(separation?.vocalsKey || source?.audioKey);
    const duration = source?.durationSec || 1;
    const lines = useMemo(() => [...document.lines].sort((a, b) => a.startSec - b.startSec), [document.lines]);
    const targets = checked.length ? checked.filter((id) => lines.some((line) => line.id === id)) : lines.map((line) => line.id);
    const allChecked = lines.length > 0 && lines.every((line) => checked.includes(line.id));
    const stuckGenerating = !busy && lines.some((line) => line.status === "running" || line.status === "pending" || line.status === "uploading");
    const defaultVoiceId = document.refs[0]?.id || ORIGINAL_VOICE_REF;
    const voiceOptions = useMemo(
        () => [{ value: ORIGINAL_VOICE_REF, label: "原片人声（自动截取）" }, ...document.refs.map((ref) => ({ value: ref.id, label: ref.name || "未命名" }))],
        [document.refs],
    );

    useEffect(() => {
        if (!document.lines.some((line) => !line.voiceAudioId)) return;
        runner.update((current) => ({
            ...current,
            lines: current.lines.map((line) => (line.voiceAudioId ? line : { ...line, voiceAudioId: defaultVoiceId })),
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultVoiceId, document.lines.length, document.refs.length]);

    const shell = (
        <div className={cn("flex min-h-0 flex-col gap-2", embed ? "h-full p-2" : "h-[calc(100dvh-2.5rem)] p-3")}>
            <header className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-[#141416] px-3">
                <Music2 className="size-4 text-neutral-300" />
                <h1 className="text-sm font-medium text-neutral-100">翻唱助手</h1>
                <span className="text-[11px] text-neutral-500">上传歌曲 → 分离人声 → 音色可选（默认原片）→ 分句 / 完整歌词 → 与伴奏合成</span>
                {busy ? <span className="ml-2 text-[11px] text-amber-300">{busy}</span> : null}
                {stuckGenerating ? <span className="ml-2 text-[11px] text-amber-300">有句子卡在「生成中」</span> : null}
                <div className="ml-auto flex items-center gap-1.5">
                    {busy ? (
                        <DarkButton size="sm" onClick={runner.cancel}>
                            取消
                        </DarkButton>
                    ) : null}
                    {stuckGenerating ? (
                        <DarkButton size="sm" onClick={runner.clearStuck}>
                            清除卡住
                        </DarkButton>
                    ) : null}
                    <DarkButton size="sm" disabled={Boolean(busy)} onClick={runner.reset}>
                        新建
                    </DarkButton>
                    <DarkButton size="sm" tone="primary" disabled={Boolean(busy) || !source} onClick={() => void runner.exportMix()}>
                        导出翻唱混音
                    </DarkButton>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 gap-2">
                <Panel title="原曲" className="w-[300px] shrink-0" bodyClassName="flex min-h-0 flex-col gap-2 overflow-auto px-2.5 pb-2.5">
                    {source ? (
                        <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] p-3">
                            <span className="truncate text-sm text-neutral-200">{source.fileName}</span>
                            <span className="text-[11px] text-neutral-500">{Number(source.durationSec || 0).toFixed(1)} 秒</span>
                            <StudioAudio mediaKey={source.audioKey} />
                            <DarkButton
                                size="sm"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                    pickFiles("audio/*", false, ([file]) => {
                                        if (file) void runner.uploadSong(file);
                                    })
                                }
                            >
                                <Upload className="size-3.5" />
                                更换歌曲
                            </DarkButton>
                        </div>
                    ) : (
                        <EmptyHint icon={<Upload className="size-6" />} title="上传要翻唱的歌曲" hint="支持 WAV / FLAC / MP3 / M4A" className="min-h-[140px]">
                            <DarkButton
                                size="sm"
                                tone="primary"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                    pickFiles("audio/*", false, ([file]) => {
                                        if (file) void runner.uploadSong(file);
                                    })
                                }
                            >
                                <Upload className="size-3.5" />
                                选择音频
                            </DarkButton>
                        </EmptyHint>
                    )}
                    <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] p-3">
                        <div className="flex items-center gap-2 text-xs text-neutral-300">
                            <AudioLines className="size-3.5" />
                            {separation?.vocalsKey ? "清晰人声" : "原声"}
                            {separation ? <StatusBadge status={separation.status} error={separation.error} /> : null}
                        </div>
                        <Waveform peaks={peaks} className="h-14" ranges={lines.map((line) => ({ start: line.startSec / duration, end: line.endSec / duration, color: "rgba(255,255,255,0.08)" }))} />
                        {separation && separation.status !== "done" && separation.status !== "failed" ? <p className="text-[11px] text-neutral-400">{separation.message}</p> : null}
                        {separation?.status === "failed" ? <p className="text-[11px] text-red-300">{separation.error}</p> : null}
                        <DarkButton size="sm" tone={separation?.vocalsKey ? "subtle" : "primary"} disabled={Boolean(busy) || !source?.audioKey} onClick={() => void runner.separate()}>
                            <Wand2 className="size-3.5" />
                            {separation?.vocalsKey ? "重新提取人声" : "提取清晰人声"}
                        </DarkButton>
                        <p className="text-[11px] leading-4 text-neutral-500">Demucs 分离人声与伴奏；干声用于分句与歌声转换，伴奏用于最终混音。</p>
                    </div>
                    {separation?.vocalsKey ? (
                        <div className="flex flex-col gap-2 text-xs text-neutral-400">
                            <span>人声</span>
                            <StudioAudio mediaKey={separation.vocalsKey} />
                            <span>伴奏</span>
                            <StudioAudio mediaKey={separation.backgroundKey} />
                        </div>
                    ) : null}
                </Panel>

                <Panel
                    title="参考音色"
                    extra={
                        <DarkButton
                            size="sm"
                            className="!h-6 !px-2"
                            disabled={Boolean(busy)}
                            onClick={() =>
                                pickFiles("audio/*", false, ([file]) => {
                                    if (file) void runner.uploadRef(file);
                                })
                            }
                        >
                            <Upload className="size-3" />
                            上传
                        </DarkButton>
                    }
                    className="w-[240px] shrink-0"
                    bodyClassName="flex flex-col gap-2 overflow-auto px-3 pb-3"
                >
                    <p className="text-[11px] leading-4 text-neutral-500">可选。不上传时默认用「原片人声」做克隆 / 歌声 / 改词；上传后可换成指定音色。</p>
                    {document.refs.length ? (
                        document.refs.map((ref) => (
                            <div key={ref.id} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm text-neutral-100">{ref.name || "未命名"}</span>
                                    <span className="text-[11px] text-neutral-500">{ref.durationSec.toFixed(1)}s</span>
                                </div>
                                <IconButton className="size-7" onClick={() => playKey(ref.key)} title="试听">
                                    <Play className="size-3.5" />
                                </IconButton>
                                <Popconfirm
                                    title="删除这个参考音色？"
                                    onConfirm={() =>
                                        runner.update((current) => ({
                                            ...current,
                                            refs: current.refs.filter((item) => item.id !== ref.id),
                                            lines: current.lines.map((line) => (line.voiceAudioId === ref.id ? { ...line, voiceAudioId: ORIGINAL_VOICE_REF } : line)),
                                        }))
                                    }
                                >
                                    <IconButton className="size-7" aria-label="删除">
                                        <Trash2 className="size-3.5" />
                                    </IconButton>
                                </Popconfirm>
                            </div>
                        ))
                    ) : (
                        <EmptyHint icon={<Mic className="size-5" />} title="未上传参考音色" hint="可直接用原片人声继续；要换声再上传样本" className="min-h-[120px]" />
                    )}
                </Panel>

                <Panel
                    title="句子与翻唱"
                    className="min-w-0 flex-1"
                    bodyClassName="flex min-h-0 flex-col gap-2 px-2.5 pb-2.5"
                    extra={
                        <>
                            <SmallSelect
                                value={document.settings.ttsEngine}
                                onChange={(value) => runner.update((current) => ({ ...current, settings: { ...current.settings, ttsEngine: value as "indextts" | "voicestudio" } }))}
                                options={[
                                    { value: "indextts", label: "IndexTTS" },
                                    { value: "voicestudio", label: "VoiceStudio" },
                                ]}
                            />
                            <DarkButton size="sm" disabled={Boolean(busy) || !source} onClick={() => void runner.transcribe()}>
                                <Sparkles className="size-3.5" />
                                {lines.length ? "重新分析" : "开始分析"}
                            </DarkButton>
                            <SmallSelect value={language} onChange={setLanguage} options={LANGUAGES.map((item) => ({ value: item, label: item }))} />
                            <DarkButton
                                size="sm"
                                disabled={Boolean(busy) || !targets.length}
                                title="把原文翻译到目标语言，写入译文栏（便于改词翻唱）"
                                onClick={() => message.info(`请直接在句上编辑译文；批量翻译可后续接入。当前目标：${language}`)}
                            >
                                <Languages className="size-3.5" />
                                翻译
                            </DarkButton>
                            <DarkButton size="sm" disabled={Boolean(busy) || !source} title="粘贴完整歌词，自动对齐到分句时间轴" onClick={() => setLyricsOpen((value) => !value)}>
                                <PenLine className="size-3.5" />
                                完整歌词
                            </DarkButton>
                            <DarkButton size="sm" tone="primary" disabled={Boolean(busy) || !targets.length} title="无参考音色时使用原片人声" onClick={() => void runner.convertLines(targets)}>
                                <Music2 className="size-3.5" />
                                {checked.length ? `歌声转换 ${targets.length}` : "歌声转换全部"}
                            </DarkButton>
                            <DarkButton size="sm" disabled={Boolean(busy) || !targets.length} title="无参考音色时使用原片人声" onClick={() => void runner.cloneLines(targets)}>
                                <Mic className="size-3.5" />
                                {checked.length ? `克隆 ${targets.length}` : "克隆全部"}
                            </DarkButton>
                            <Popconfirm
                                title={`确认改词翻唱 ${targets.length} 句？`}
                                description="需已填「译文/改词」。每句会跑 SVS+音色转换，可能较久；可随时点右上角取消。"
                                okText="开始"
                                cancelText="取消"
                                disabled={Boolean(busy) || !targets.length}
                                onConfirm={() => void runner.remakeLines(targets)}
                            >
                                <DarkButton size="sm" disabled={Boolean(busy) || !targets.length} title="须先填写改词栏；无参考音色时使用原片人声">
                                    <PenLine className="size-3.5" />
                                    {checked.length ? `改词翻唱 ${targets.length}` : "改词翻唱全部"}
                                </DarkButton>
                            </Popconfirm>
                        </>
                    }
                >
                    {lyricsOpen ? (
                        <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5">
                            <div className="flex items-center gap-2 text-xs text-neutral-300">
                                <span className="font-medium">粘贴完整歌词</span>
                                <span className="text-[11px] text-neutral-500">严格一行对应一句；句数一致时保留原时间轴，不一致则在分析区间内均分</span>
                            </div>
                            <Input.TextArea
                                variant="filled"
                                value={lyricsDraft}
                                onChange={(event) => setLyricsDraft(event.target.value)}
                                placeholder={"例：\n全屋定制一步到位\n品质生活从这里开始\n…"}
                                autoSize={{ minRows: 4, maxRows: 10 }}
                                className="!text-xs"
                            />
                            <div className="flex items-center gap-2">
                                <DarkButton
                                    size="sm"
                                    tone="primary"
                                    disabled={Boolean(busy) || !lyricsDraft.trim()}
                                    onClick={() => {
                                        runner.applyFullLyrics(lyricsDraft);
                                        setLyricsOpen(false);
                                    }}
                                >
                                    对齐到句子
                                </DarkButton>
                                <DarkButton size="sm" onClick={() => setLyricsOpen(false)}>
                                    收起
                                </DarkButton>
                            </div>
                        </div>
                    ) : null}
                    {!source ? (
                        <EmptyHint icon={<AudioLines className="size-6" />} title="先上传歌曲" hint="左侧上传原曲后，即可提取人声并分析句子" />
                    ) : !lines.length ? (
                        <EmptyHint icon={<Sparkles className="size-6" />} title="还没有句子" hint="可「开始分析」听写，或点「完整歌词」粘贴后自动生成分句">
                            <DarkButton size="sm" disabled={Boolean(busy)} onClick={() => void runner.transcribe()}>
                                开始分析
                            </DarkButton>
                            <DarkButton size="sm" tone="primary" disabled={Boolean(busy)} onClick={() => setLyricsOpen(true)}>
                                完整歌词
                            </DarkButton>
                        </EmptyHint>
                    ) : (
                        <>
                            <div className="relative h-8 shrink-0 rounded-lg bg-white/[0.04]">
                                {lines.map((line) => (
                                    <span
                                        key={line.id}
                                        title={line.text}
                                        className={cn("absolute inset-y-1 rounded-md", line.audioKey ? "bg-emerald-400/60" : "bg-white/20")}
                                        style={{ left: `${(line.startSec / duration) * 100}%`, width: `${Math.max(0.4, ((line.endSec - line.startSec) / duration) * 100)}%` }}
                                    />
                                ))}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-neutral-400">
                                <Checkbox className="!text-xs !text-neutral-300" checked={allChecked} indeterminate={!allChecked && checked.length > 0} onChange={(event) => setChecked(event.target.checked ? lines.map((line) => line.id) : [])}>
                                    全选
                                </Checkbox>
                                <span>
                                    {lines.length} 句 · 已生成 {lines.filter((line) => line.audioKey).length}
                                </span>
                            </div>
                            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
                                {lines.map((line, index) => (
                                    <div key={line.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                                        <div className="flex items-start gap-2">
                                            <Checkbox className="mt-1" checked={checked.includes(line.id)} onChange={(event) => setChecked((current) => (event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id)))} />
                                            <div className="min-w-0 flex-1 space-y-1.5">
                                                <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                                                    <span>#{index + 1}</span>
                                                    <span className="tabular-nums">
                                                        {line.startSec.toFixed(1)}s – {line.endSec.toFixed(1)}s
                                                    </span>
                                                    {line.status && line.status !== "idle" ? <StatusBadge status={line.status} error={line.error} /> : null}
                                                </div>
                                                <Input.TextArea
                                                    variant="filled"
                                                    autoSize={{ minRows: 1, maxRows: 4 }}
                                                    value={line.text}
                                                    onChange={(event) => runner.patchLine(line.id, { text: event.target.value, audioKey: undefined, status: "idle" })}
                                                    className="!text-xs"
                                                />
                                                <Input.TextArea
                                                    variant="filled"
                                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                                    value={line.translation || ""}
                                                    placeholder="译文 / 改词（可选，改词翻唱优先用这里）"
                                                    onChange={(event) => runner.patchLine(line.id, { translation: event.target.value, audioKey: undefined, status: "idle" })}
                                                    className="!text-xs"
                                                />
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <Select
                                                        size="small"
                                                        variant="filled"
                                                        className="min-w-[160px]"
                                                        placeholder="音色"
                                                        value={line.voiceAudioId || ORIGINAL_VOICE_REF}
                                                        onChange={(value) => runner.patchLine(line.id, { voiceAudioId: value })}
                                                        options={voiceOptions}
                                                    />
                                                    <DarkButton size="sm" disabled={Boolean(busy)} onClick={() => void runner.convertLines([line.id])}>
                                                        歌声
                                                    </DarkButton>
                                                    <DarkButton size="sm" disabled={Boolean(busy)} onClick={() => void runner.cloneLines([line.id])}>
                                                        克隆
                                                    </DarkButton>
                                                    <DarkButton size="sm" disabled={Boolean(busy)} onClick={() => void runner.remakeLines([line.id])}>
                                                        改词
                                                    </DarkButton>
                                                </div>
                                                <LineCompareAudio document={document} line={line} />
                                                {line.error ? <p className="text-[10px] text-red-300">{line.error}</p> : null}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Panel>
            </div>

            {runner.logLines.length ? (
                <div className="max-h-16 shrink-0 overflow-auto rounded-lg border border-white/[0.06] bg-black/30 px-3 py-1.5 text-[10px] leading-4 text-neutral-500">
                    {runner.logLines.slice(-6).map((line, index) => (
                        <div key={`${index}-${line}`}>{line}</div>
                    ))}
                </div>
            ) : null}
        </div>
    );

    return <DarkScope className={cn("h-full", embed && "min-h-0")}>{shell}</DarkScope>;
}

export default CoverAssistantPage;
