import { useEffect, useState } from "react";
import { Checkbox, Input, Popconfirm, Select } from "antd";
import { AudioLines, Languages, Mic, Music2, PenLine, Play, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { nanoid } from "nanoid";

import { cn } from "@/lib/utils";
import { resolveStudioMedia, saveStudioMedia, useStudioMedia } from "@/studios/media";
import { characterImageKey, KEEP_PERSON, lineCharacterId, ORIGINAL_VOICE_REF, type ReplacementLine, type ReplacementStudioDocument, type ReplacementTtsEngine } from "@/studios/replacement/document";
import { audioDuration, audioPeaks, lineVoice, originalLineClipBlob } from "@/studios/replacement/stages";

import { pickFiles } from "./assets-step";
import { StudioAudio, StudioImage, StudioVideo, Waveform } from "./media";
import { DarkButton, EmptyHint, IconButton, Panel, SmallSelect, StatusBadge, Tabs } from "./ui";
import type { ReplacementRunner } from "./use-replacement-runner";

const LANGUAGES = ["英语", "中文", "日语", "韩语", "西班牙语", "法语", "德语", "葡萄牙语", "俄语", "泰语", "越南语", "印尼语"];

/** Session cache of exact original line clips for A/B listen. */
const originalClipUrls = new Map<string, string>();

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

function lineClipCacheKey(line: ReplacementLine) {
    return `${line.id}:${line.sourceId}:${line.startSec.toFixed(3)}:${line.endSec.toFixed(3)}`;
}

function LineCompareAudio({ document, line, hasSourceAudio }: { document: ReplacementStudioDocument; line: ReplacementLine; hasSourceAudio: boolean }) {
    const cacheKey = lineClipCacheKey(line);
    const [originalUrl, setOriginalUrl] = useState(() => originalClipUrls.get(cacheKey) || "");
    const [loadingOriginal, setLoadingOriginal] = useState(false);
    const [originalError, setOriginalError] = useState("");

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
        setLoadingOriginal(true);
        setOriginalError("");
        try {
            const blob = await originalLineClipBlob(document, line);
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

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-neutral-500">原声</span>
                {originalUrl ? (
                    <audio src={originalUrl} controls preload="metadata" className="h-7 min-w-0 flex-1" />
                ) : (
                    <DarkButton
                        size="sm"
                        className="!h-6 !px-2"
                        disabled={!hasSourceAudio || loadingOriginal}
                        onClick={() => void ensureOriginal()}
                        title={hasSourceAudio ? "截取并播放这句原片人声" : "没有原片音轨"}
                    >
                        {loadingOriginal ? "截取中…" : "加载原声"}
                    </DarkButton>
                )}
            </div>
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-neutral-500">结果</span>
                {line.audioKey ? <StudioAudio mediaKey={line.audioKey} className="h-7 min-w-0 flex-1" /> : <span className="text-[10px] text-neutral-600">尚未克隆/换声</span>}
            </div>
            {originalError ? <span className="text-[10px] text-red-300">{originalError}</span> : null}
        </div>
    );
}

export function VoiceStep({ document, runner }: { document: ReplacementStudioDocument; runner: ReplacementRunner }) {
    const sources = document.sources.filter((source) => source.status === "done");
    const [sourceId, setSourceId] = useState(sources[0]?.id || "");
    const source = sources.find((item) => item.id === sourceId) || sources[0];
    const [checked, setChecked] = useState<string[]>([]);
    const [language, setLanguage] = useState("英语");
    const [hoverLine, setHoverLine] = useState("");
    const separation = source?.separation;
    const peaks = usePeaks(separation?.vocalsKey || source?.audioKey);
    const videoUrl = useStudioMedia(source?.videoKey);
    const busy = Boolean(runner.busy);

    if (!source) return <EmptyHint icon={<AudioLines className="size-6" />} title="还没有处理好的视频" hint="请先在顶部「原视频」里加入并处理视频" />;

    const lines = document.lines.filter((line) => line.sourceId === source.id).sort((a, b) => a.startSec - b.startSec);
    const characters = document.characters.filter((item) => item.kind === "character");
    const targets = checked.length ? checked.filter((id) => lines.some((line) => line.id === id)) : lines.map((line) => line.id);
    const allChecked = lines.length > 0 && lines.every((line) => checked.includes(line.id));
    const duration = source.durationSec || 1;

    const uploadReference = (bindCharacterId?: string) =>
        pickFiles("audio/*", false, async ([file]) => {
            if (!file) return;
            const key = await saveStudioMedia(file, "audio");
            const audio = { id: nanoid(8), name: file.name.replace(/\.[^.]+$/u, ""), key, durationSec: await audioDuration(key), origin: "upload" as const };
            runner.update((current) => ({
                ...current,
                audios: [...current.audios, audio],
                characters: bindCharacterId
                    ? current.characters.map((item) => (item.id === bindCharacterId ? { ...item, voiceAudioId: audio.id } : item))
                    : current.characters,
            }));
        });

    const voiceOptions = [
        { value: ORIGINAL_VOICE_REF, label: "原片人声（自动截取）" },
        ...document.audios.map((audio) => ({ value: audio.id, label: audio.name || "未命名音频" })),
    ];
    const ttsEngine = (document.settings.ttsEngine || "indextts") as ReplacementTtsEngine;

    return (
        <div className="flex h-full min-h-0 gap-2">
            <Panel
                title={source.audioOnly ? "原始声音" : "原始视频"}
                className="w-[300px] shrink-0"
                bodyClassName="flex min-h-0 flex-col gap-2 overflow-auto px-2.5 pb-2.5"
                extra={sources.length > 1 ? <Tabs value={source.id} onChange={setSourceId} items={sources.map((item, index) => ({ key: item.id, label: item.audioOnly ? `声音${index + 1}` : `视频${index + 1}` }))} /> : null}
            >
                {source.audioOnly ? (
                    <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] p-3">
                        <span className="truncate text-sm text-neutral-200">{source.fileName}</span>
                        <span className="text-[11px] text-neutral-500">{Number(source.durationSec || 0).toFixed(1)} 秒 · 仅声音项目</span>
                        {source.audioKey ? <StudioAudio mediaKey={source.audioKey} /> : null}
                    </div>
                ) : (
                    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-black">{videoUrl ? <StudioVideo mediaKey={source.videoKey} className="max-h-full w-full" /> : null}</div>
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
                    <DarkButton size="sm" tone={separation?.vocalsKey ? "subtle" : "primary"} disabled={busy || !source.audioKey} onClick={() => void runner.separateSource(source.id)}>
                        <Wand2 className="size-3.5" />
                        {separation?.vocalsKey ? "重新提取人声" : "提取清晰人声"}
                    </DarkButton>
                    <p className="text-[11px] leading-4 text-neutral-500">Demucs 干声用于分析、原声克隆参考，以及「歌声转换」（Seed-VC）的源旋律；合成时用背景声替代原声。</p>
                </div>
                {separation?.vocalsKey ? (
                    <div className="flex flex-col gap-2 text-xs text-neutral-400">
                        <span>人声</span>
                        <StudioAudio mediaKey={separation.vocalsKey} />
                        <span>背景声</span>
                        <StudioAudio mediaKey={separation.backgroundKey} />
                    </div>
                ) : null}
            </Panel>

            <Panel
                title="声音参考"
                extra={
                    <DarkButton size="sm" className="!h-6 !px-2" disabled={busy} onClick={() => uploadReference()}>
                        <Upload className="size-3" />
                        上传
                    </DarkButton>
                }
                className="w-[260px] shrink-0"
                bodyClassName="flex flex-col gap-2 overflow-auto px-3 pb-3"
            >
                <p className="text-[11px] leading-4 text-neutral-500">上传参考音色后，可在右侧每句选用。也可不上传，直接用原片人声截取克隆。</p>
                {document.audios.length ? (
                    document.audios.map((audio) => (
                        <div key={audio.id} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm text-neutral-100">{audio.name || "未命名"}</span>
                                <span className="text-[11px] text-neutral-500">{audio.origin === "upload" ? "上传" : audio.origin === "clip" ? "截取" : audio.origin}</span>
                            </div>
                            <IconButton className="size-7" onClick={() => playKey(audio.key)} title="试听">
                                <Play className="size-3.5" />
                            </IconButton>
                            <Popconfirm
                                title="删除这个参考音频？"
                                onConfirm={() =>
                                    runner.update((current) => ({
                                        ...current,
                                        audios: current.audios.filter((item) => item.id !== audio.id),
                                        characters: current.characters.map((item) => (item.voiceAudioId === audio.id ? { ...item, voiceAudioId: undefined } : item)),
                                        lines: current.lines.map((line) => (line.voiceAudioId === audio.id ? { ...line, voiceAudioId: undefined } : line)),
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
                    <EmptyHint icon={<Mic className="size-5" />} title="还没有参考音频" hint="点右上角「上传」加入音色样本，或克隆时自动用原片人声" className="min-h-[120px]" />
                )}
                {characters.length ? (
                    <>
                        <div className="mt-1 text-[11px] text-neutral-500">替换人物（可选绑定参考）</div>
                        {characters.map((character) => {
                            const voice = document.audios.find((item) => item.id === character.voiceAudioId);
                            return (
                                <div key={character.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/x-replacement-character", character.id)} className="flex cursor-grab flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2 active:cursor-grabbing">
                                    <div className="flex items-center gap-2">
                                        <StudioImage mediaKey={characterImageKey(character)} className="pointer-events-none size-10 shrink-0 rounded-lg" />
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm text-neutral-100">{character.name || "未命名"}</span>
                                            <span className="text-[11px] text-neutral-500">拖到句子上</span>
                                        </div>
                                        <IconButton className="size-7" disabled={!voice} onClick={() => playKey(voice?.key)} title="试听声音样本">
                                            <Play className="size-3.5" />
                                        </IconButton>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Select
                                            size="small"
                                            variant="filled"
                                            popupMatchSelectWidth={false}
                                            className="min-w-0 flex-1"
                                            placeholder="选择声音"
                                            value={character.voiceAudioId || undefined}
                                            allowClear
                                            onChange={(value) => runner.patchCharacter(character.id, { voiceAudioId: value || undefined })}
                                            options={document.audios.map((item) => ({ value: item.id, label: item.name }))}
                                        />
                                        <IconButton className="size-7" onClick={() => uploadReference(character.id)} title="上传并绑定到此人">
                                            <Upload className="size-3.5" />
                                        </IconButton>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                ) : null}
            </Panel>

            <Panel
                title="语音工作室"
                className="min-w-0 flex-1"
                bodyClassName="flex min-h-0 flex-col gap-2 px-2.5 pb-2.5"
                extra={
                    <>
                        <SmallSelect
                            value={ttsEngine}
                            onChange={(value) => runner.update((current) => ({ ...current, settings: { ...current.settings, ttsEngine: value as ReplacementTtsEngine } }))}
                            options={[
                                { value: "indextts", label: "IndexTTS（本地 GPU）" },
                                { value: "voicestudio", label: "VoiceStudio（本地 GPU）" },
                            ]}
                        />
                        <DarkButton size="sm" disabled={busy} onClick={() => void runner.transcribe(source.id)}>
                            <Sparkles className="size-3.5" />
                            {lines.length ? "重新分析" : "开始分析"}
                        </DarkButton>
                        <SmallSelect value={language} onChange={setLanguage} options={LANGUAGES.map((item) => ({ value: item, label: item }))} />
                        <DarkButton size="sm" disabled={busy || !targets.length} onClick={() => void runner.translate(targets, language)}>
                            <Languages className="size-3.5" />
                            翻译
                        </DarkButton>
                        <DarkButton size="sm" tone="primary" disabled={busy || !targets.length} onClick={() => void runner.cloneLines(targets)}>
                            <Mic className="size-3.5" />
                            {checked.length ? `克隆所选 ${targets.length} 句` : "克隆全部"}
                        </DarkButton>
                        <DarkButton
                            size="sm"
                            disabled={busy || !targets.length}
                            title="用原片干声换音色（Seed-VC）。只改声音像谁，不改歌词。"
                            onClick={() => void runner.convertSingingLines(targets)}
                        >
                            <Music2 className="size-3.5" />
                            {checked.length ? `歌声转换 ${targets.length}` : "歌声转换全部"}
                        </DarkButton>
                        <DarkButton
                            size="sm"
                            tone="primary"
                            disabled={busy || !targets.length}
                            title="按句上改词栏翻唱；无上传音色时用原片人声（88: SVS 7866 + Seed-VC 7865）"
                            onClick={() => void runner.remakeSingingLines(targets)}
                        >
                            <PenLine className="size-3.5" />
                            {checked.length ? `改词翻唱 ${targets.length}` : "改词翻唱全部"}
                        </DarkButton>
                        {source.audioOnly ? (
                            <DarkButton
                                size="sm"
                                tone="primary"
                                disabled={busy || (!document.lines.some((line) => line.audioKey) && !source.audioKey)}
                                title="混音克隆结果与背景声，导出最终 WAV"
                                onClick={() => void runner.composeMix()}
                            >
                                <AudioLines className="size-3.5" />
                                合成最终音频
                            </DarkButton>
                        ) : null}
                    </>
                }
            >
                {lines.length ? (
                    <>
                        <div className="relative h-8 shrink-0 rounded-lg bg-white/[0.04]">
                            {lines.map((line) => {
                                const character = document.characters.find((item) => item.id === lineCharacterId(document, line));
                                return (
                                    <span
                                        key={line.id}
                                        title={line.text}
                                        className={cn("absolute inset-y-1 rounded-md", line.audioKey ? "bg-emerald-400/60" : character ? "bg-white/40" : "bg-white/15", hoverLine === line.id && "ring-2 ring-white")}
                                        style={{ left: `${(line.startSec / duration) * 100}%`, width: `${Math.max(0.4, ((line.endSec - line.startSec) / duration) * 100)}%` }}
                                    />
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-neutral-400">
                            <Checkbox className="!text-xs !text-neutral-300" checked={allChecked} indeterminate={!allChecked && checked.length > 0} onChange={(event) => setChecked(event.target.checked ? lines.map((line) => line.id) : [])}>
                                全选
                            </Checkbox>
                            <span>{lines.length} 句 · 已配音 {lines.filter((line) => line.audioKey).length}</span>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
                            {lines.map((line) => {
                                const identity = document.identities.find((item) => item.id === line.speaker);
                                const characterId = lineCharacterId(document, line);
                                const character = document.characters.find((item) => item.id === characterId);
                                const voice = character?.voiceAudioId ? document.audios.find((item) => item.id === character.voiceAudioId) : undefined;
                                const hasOriginalAudio = Boolean(source.separation?.vocalsKey || source.audioKey);
                                const { audio: lineRef, useOriginal } = lineVoice(document, line);
                                const cloneBlocked = busy
                                    ? "任务进行中"
                                    : voice
                                      ? ""
                                      : hasOriginalAudio
                                        ? ""
                                        : "没有原片音轨，请先处理视频或上传声音样本";
                                const singingBlocked = busy
                                    ? "任务进行中"
                                    : !hasOriginalAudio
                                      ? "没有干声/原片音轨"
                                      : useOriginal || !lineRef
                                        ? "歌声转换需选用上传的目标音色（不能只用原片）"
                                        : "";
                                const remakeBlocked = busy
                                    ? "任务进行中"
                                    : !(line.translation?.trim() || line.text.trim())
                                      ? "请先填写新歌词（改词栏）"
                                      : !hasOriginalAudio
                                        ? "没有干声/原片音轨"
                                        : "";
                                return (
                                    <div
                                        key={line.id}
                                        onMouseEnter={() => setHoverLine(line.id)}
                                        onMouseLeave={() => setHoverLine("")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            setHoverLine(line.id);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const id = event.dataTransfer.getData("text/x-replacement-character");
                                            if (id) runner.patchLine(line.id, { characterId: id, audioKey: undefined, status: undefined });
                                        }}
                                        className={cn("flex gap-3 rounded-xl border p-2.5 transition", hoverLine === line.id ? "border-white/40 bg-white/[0.06]" : "border-white/[0.06] bg-white/[0.02]")}
                                    >
                                        <Checkbox checked={checked.includes(line.id)} onChange={(event) => setChecked((list) => (event.target.checked ? [...list, line.id] : list.filter((id) => id !== line.id)))} />
                                        <div className="flex w-24 shrink-0 flex-col gap-1">
                                            <span className="text-[11px] tabular-nums text-neutral-400">
                                                {line.startSec.toFixed(1)}–{line.endSec.toFixed(1)}s
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                {identity ? <StudioImage mediaKey={identity.coverKey} className="size-6 shrink-0 rounded" /> : null}
                                                <span className="truncate text-[11px] text-neutral-300">{identity?.name || (line.speaker === "narrator" ? "旁白" : "未知")}</span>
                                            </div>
                                        </div>
                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                            <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 4 }} value={line.text} onChange={(event) => runner.patchLine(line.id, { text: event.target.value, audioKey: line.translation ? line.audioKey : undefined })} className="!p-0 !text-sm" />
                                            <Input.TextArea
                                                variant="borderless"
                                                autoSize={{ minRows: 1, maxRows: 4 }}
                                                value={line.translation ?? ""}
                                                placeholder="改词 / 译文（改词翻唱优先用这里；可留空则用上方原文）"
                                                onChange={(event) => runner.patchLine(line.id, { translation: event.target.value, audioKey: undefined })}
                                                className="!p-0 !text-xs !text-sky-200"
                                            />
                                            {line.error ? <span className="text-[11px] text-red-300">{line.error}</span> : null}
                                            <LineCompareAudio document={document} line={line} hasSourceAudio={hasOriginalAudio} />
                                        </div>
                                        <div className="flex w-[17rem] shrink-0 flex-col items-end gap-1.5">
                                            <Select
                                                size="small"
                                                variant="filled"
                                                popupMatchSelectWidth={false}
                                                className="w-full"
                                                value={line.characterId ?? ""}
                                                onChange={(value) => {
                                                    // KEEP_PERSON only affects compose; keep cloned audio for A/B listen.
                                                    if (value === KEEP_PERSON) runner.patchLine(line.id, { characterId: value });
                                                    else runner.patchLine(line.id, { characterId: value, audioKey: undefined, status: undefined });
                                                }}
                                                options={[
                                                    { value: "", label: character && !line.characterId ? `跟随人物（${character.name}）` : "跟随人物设定" },
                                                    { value: KEEP_PERSON, label: "合成保留原声" },
                                                    ...characters.map((item) => ({ value: item.id, label: item.name || "未命名" })),
                                                ]}
                                            />
                                            <Select
                                                size="small"
                                                variant="filled"
                                                popupMatchSelectWidth={false}
                                                className="w-full"
                                                value={line.voiceAudioId === undefined ? (character?.voiceAudioId && voice ? character.voiceAudioId : ORIGINAL_VOICE_REF) : line.voiceAudioId || ORIGINAL_VOICE_REF}
                                                onChange={(value) => runner.patchLine(line.id, { voiceAudioId: value, audioKey: undefined, status: undefined })}
                                                options={voiceOptions}
                                            />
                                            <div className="flex w-full flex-nowrap items-center justify-end gap-1">
                                                <StatusBadge status={line.status} error={line.error} />
                                                <span className="shrink-0" title={cloneBlocked || `用所选参考音 + ${ttsEngine === "voicestudio" ? "VoiceStudio" : "IndexTTS"} 克隆`}>
                                                    <DarkButton size="sm" className="!h-6 !px-2" disabled={Boolean(cloneBlocked)} onClick={() => void runner.cloneLines([line.id])}>
                                                        <Mic className="size-3" />
                                                        克隆
                                                    </DarkButton>
                                                </span>
                                                <span className="shrink-0" title={singingBlocked || "只换音色，歌词仍是原片唱的"}>
                                                    <DarkButton size="sm" className="!h-6 !px-2" disabled={Boolean(singingBlocked)} onClick={() => void runner.convertSingingLines([line.id])}>
                                                        <Music2 className="size-3" />
                                                        歌声
                                                    </DarkButton>
                                                </span>
                                                <span className="shrink-0" title={remakeBlocked || (useOriginal || !lineRef ? "新词 + 原曲旋律 + 原片人声（也可换上传音色）" : "新词 + 原曲旋律 + 参考音色")}>
                                                    <DarkButton size="sm" className="!h-6 !px-2" disabled={Boolean(remakeBlocked)} onClick={() => void runner.remakeSingingLines([line.id])}>
                                                        <PenLine className="size-3" />
                                                        改词
                                                    </DarkButton>
                                                </span>
                                                <Popconfirm title="删除这句？" onConfirm={() => runner.update((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }))}>
                                                    <IconButton className="size-6 shrink-0" aria-label="删除">
                                                        <Trash2 className="size-3" />
                                                    </IconButton>
                                                </Popconfirm>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <EmptyHint icon={<AudioLines className="size-6" />} title="还没有分析句子" hint="点击「开始分析」经 VoiceStudio 听写人声并归属说话人；先提取清晰人声更准确，需局域网 GPU 主机的 VoiceStudio（:3901）与文件机在线">
                        <DarkButton size="sm" tone="primary" disabled={busy} onClick={() => void runner.transcribe(source.id)}>
                            <Sparkles className="size-3.5" />
                            开始分析
                        </DarkButton>
                    </EmptyHint>
                )}
            </Panel>
        </div>
    );
}
