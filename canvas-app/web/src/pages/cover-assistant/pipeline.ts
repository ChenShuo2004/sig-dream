import { nanoid } from "nanoid";

import { requestLanAsr, requestLanSvsRemake, requestLanTts, requestLanVoiceConvert, type LanAsrSegment } from "@/services/api/lan-bridge";
import { getStudioMediaBlob, resolveStudioMedia, saveStudioMedia } from "@/studios/media";
import { runMediaJob } from "@/studios/replacement/intake";
import { audioDuration, downloadBlob, encodeWav } from "@/studios/replacement/stages";

import { ORIGINAL_VOICE_REF, type CoverDocument, type CoverLine, type CoverTtsEngine } from "./document";

export type CoverContext = { signal?: AbortSignal; log: (text: string, level?: "info" | "warn" | "error") => void };

export { ORIGINAL_VOICE_REF };

async function decodeKey(key: string) {
    const blob = await getStudioMediaBlob(key);
    if (!blob) return null;
    const decoder = new AudioContext();
    try {
        return await decoder.decodeAudioData(await blob.arrayBuffer());
    } catch {
        return null;
    } finally {
        void decoder.close();
    }
}

function sliceBufferToWav(buffer: AudioBuffer, startSec: number, endSec: number, minSec = 0.2) {
    const rate = buffer.sampleRate;
    const from = Math.max(0, Math.floor(startSec * rate));
    const to = Math.min(buffer.length, Math.ceil(endSec * rate));
    if (to - from < rate * minSec) throw new Error("原声片段太短。");
    const length = to - from;
    const sliced = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: rate });
    sliced.getChannelData(0).set(buffer.getChannelData(0).subarray(from, to));
    return encodeWav(sliced);
}

function segmentsToLines(durationSec: number, segments: LanAsrSegment[] | undefined, fallbackText: string): CoverLine[] {
    const fromSegments = (segments || [])
        .map((segment) => {
            const text = String(segment.text || "").trim();
            const startSec = Number(segment.start);
            const endSec = Number(segment.end);
            if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
            return {
                id: nanoid(8),
                startSec: Math.max(0, startSec),
                endSec: Math.min(durationSec || endSec, endSec),
                text,
            } satisfies CoverLine;
        })
        .filter((line): line is CoverLine => Boolean(line))
        .sort((a, b) => a.startSec - b.startSec);
    if (fromSegments.length) return fromSegments;
    const text = fallbackText.trim();
    if (!text) throw new Error("VoiceStudio 没有听写出有效句子。");
    return [{ id: nanoid(8), startSec: 0, endSec: Math.max(0.5, durationSec || 0.5), text }];
}

export async function separateCoverSource(document: CoverDocument, onStatus: (message: string, jobId?: string) => void, signal?: AbortSignal) {
    const source = document.source;
    if (!source?.audioKey) throw new Error("请先上传歌曲。");
    const blob = await getStudioMediaBlob(source.audioKey);
    if (!blob) throw new Error("原曲文件缺失，请重新上传。");
    const result = await runMediaJob(blob, source.fileName || "song.mp3", document.projectId, { op: "separate" }, onStatus, signal);
    const vocalsKey = result.keys?.vocals;
    const backgroundKey = result.keys?.background;
    if (!vocalsKey || !backgroundKey) throw new Error("人声分离完成但没有返回音轨。");
    return { vocalsKey, backgroundKey, jobId: result.jobId };
}

export async function transcribeCover(document: CoverDocument, context: CoverContext): Promise<CoverLine[]> {
    const source = document.source;
    const audioKey = source?.separation?.vocalsKey || source?.audioKey;
    if (!source || !audioKey) throw new Error("请先上传歌曲。");
    await resolveStudioMedia(audioKey);
    const blob = await getStudioMediaBlob(audioKey);
    if (!blob?.size) throw new Error("音轨缺失，请重新上传或提取人声。");
    context.log("正在通过文件机调用 VoiceStudio 听写…");
    const transcript = await requestLanAsr(blob, context.signal, {
        model: document.settings.asrModel || "whisper-1",
        language: document.settings.asrLanguage || undefined,
        onStatus: (status, message) => {
            if (message) context.log(message);
            else if (status === "pending") context.log("听写任务已进入文件机队列…");
            else if (status === "running") context.log("VoiceStudio 正在听写…");
        },
    });
    const lines = segmentsToLines(source.durationSec, transcript.segments, String(transcript.text || ""));
    context.log(`听写完成 ${lines.length} 句`);
    return lines;
}

export async function lineClipBlob(document: CoverDocument, line: CoverLine) {
    const key = document.source?.separation?.vocalsKey || document.source?.audioKey;
    if (!key) throw new Error("没有可用音轨。");
    await resolveStudioMedia(key);
    const buffer = await decodeKey(key);
    if (!buffer) throw new Error("音轨无法解码。");
    const startSec = Math.max(0, line.startSec);
    const endSec = Math.min(buffer.duration, Math.max(line.endSec, startSec + 0.15));
    return sliceBufferToWav(buffer, startSec, endSec, 0.1);
}

/** Expand the line window toward neighbors until ~5s — for TTS / VC reference from original vocals. */
async function originalReferenceClip(document: CoverDocument, line: CoverLine) {
    const key = document.source?.separation?.vocalsKey || document.source?.audioKey;
    if (!key) throw new Error("没有可用音轨，无法用原片人声作参考。请先上传歌曲或提取人声。");
    await resolveStudioMedia(key);
    const buffer = await decodeKey(key);
    if (!buffer) throw new Error("原片人声无法解码。");
    const peers = [...document.lines].sort((a, b) => a.startSec - b.startSec);
    const selfIndex = Math.max(0, peers.findIndex((item) => item.id === line.id));
    let startSec = line.startSec;
    let endSec = line.endSec;
    const targetSec = 5;
    let left = selfIndex - 1;
    let right = selfIndex + 1;
    while (endSec - startSec < targetSec && (left >= 0 || right < peers.length)) {
        const takeLeft = left >= 0 && (right >= peers.length || line.startSec - peers[left].startSec <= peers[right].endSec - line.endSec);
        if (takeLeft && left >= 0) {
            startSec = Math.min(startSec, peers[left].startSec);
            left -= 1;
        } else if (right < peers.length) {
            endSec = Math.max(endSec, peers[right].endSec);
            right += 1;
        } else break;
    }
    startSec = Math.max(0, startSec - 0.12);
    endSec = Math.min(buffer.duration, Math.max(endSec + 0.12, startSec + 2));
    const wav = await sliceBufferToWav(buffer, startSec, endSec);
    return new File([wav], "original-voice.wav", { type: "audio/wav" });
}

function usesOriginalVoice(line: CoverLine, document: CoverDocument) {
    const id = line.voiceAudioId;
    if (!id || id === ORIGINAL_VOICE_REF || id === "") return true;
    return !document.refs.some((item) => item.id === id);
}

async function referenceFile(document: CoverDocument, line: CoverLine) {
    if (usesOriginalVoice(line, document)) return originalReferenceClip(document, line);
    const ref = document.refs.find((item) => item.id === line.voiceAudioId) || document.refs[0];
    if (!ref) return originalReferenceClip(document, line);
    const sample = await getStudioMediaBlob(ref.key);
    if (!sample) throw new Error("参考音色缺失，请重新上传，或改用原片人声。");
    return new File([sample], "reference.wav", { type: sample.type || "audio/wav" });
}

/** Split pasted lyrics into non-empty lines. */
export function splitLyrics(raw: string) {
    return String(raw || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * Align full lyrics onto sentences: **strict 1 line → 1 sentence** (by newline order).
 * Same count: keep ASR timestamps, write into `translation`.
 * Different count: rebuild N sentences evenly across the original analysis span; attach nearest ASR text for对照.
 */
export function alignLyricsToLines(lines: CoverLine[], lyricsText: string): CoverLine[] {
    const parts = splitLyrics(lyricsText);
    if (!parts.length) throw new Error("请粘贴完整歌词（按行分隔）。");
    if (!lines.length) throw new Error("请先「开始分析」得到带时间轴的句子，再对齐歌词。");
    const sorted = [...lines].sort((a, b) => a.startSec - b.startSec);
    if (parts.length === sorted.length) {
        return sorted.map((line, index) => ({
            ...line,
            translation: parts[index],
            audioKey: undefined,
            status: "idle" as const,
            error: undefined,
        }));
    }
    const spanStart = sorted[0].startSec;
    const spanEnd = Math.max(spanStart + parts.length * 0.4, ...sorted.map((line) => line.endSec));
    const slot = (spanEnd - spanStart) / parts.length;
    return parts.map((text, index) => {
        const startSec = Number((spanStart + index * slot).toFixed(3));
        const endSec = Number((index === parts.length - 1 ? spanEnd : spanStart + (index + 1) * slot).toFixed(3));
        const mid = (startSec + endSec) / 2;
        let nearest = sorted[Math.min(index, sorted.length - 1)];
        let bestDist = Number.POSITIVE_INFINITY;
        for (const line of sorted) {
            const dist = Math.abs((line.startSec + line.endSec) / 2 - mid);
            if (dist < bestDist) {
                bestDist = dist;
                nearest = line;
            }
        }
        return {
            id: index < sorted.length ? sorted[index].id : nanoid(8),
            startSec,
            endSec,
            text: nearest?.text || "",
            translation: text,
            voiceAudioId: (index < sorted.length ? sorted[index].voiceAudioId : nearest?.voiceAudioId) || ORIGINAL_VOICE_REF,
            audioKey: undefined,
            status: "idle" as const,
            error: undefined,
        };
    });
}

/** When there is no ASR yet: create evenly timed lines from pasted lyrics across the song duration. */
export function linesFromLyricsOnly(durationSec: number, lyricsText: string): CoverLine[] {
    const parts = splitLyrics(lyricsText);
    if (!parts.length) throw new Error("请粘贴完整歌词（按行分隔）。");
    const total = Math.max(1, durationSec || parts.length);
    const slot = total / parts.length;
    return parts.map((text, index) => ({
        id: nanoid(8),
        startSec: Number((index * slot).toFixed(3)),
        endSec: Number((Math.min(total, (index + 1) * slot)).toFixed(3)),
        text,
        translation: text,
        voiceAudioId: ORIGINAL_VOICE_REF,
        status: "idle" as const,
    }));
}

export async function cloneCoverLine(document: CoverDocument, line: CoverLine, signal?: AbortSignal) {
    const spoken = line.translation?.trim() || line.text.trim();
    if (!spoken) throw new Error("这句话没有可配音的文本。");
    const reference = await referenceFile(document, line);
    const engine = (document.settings.ttsEngine || "indextts") as CoverTtsEngine;
    const blob = await requestLanTts(spoken, reference, signal, { engine });
    return saveStudioMedia(blob, "audio");
}

export async function convertCoverLine(document: CoverDocument, line: CoverLine, signal?: AbortSignal) {
    if (!document.source?.separation?.vocalsKey && !document.source?.audioKey) throw new Error("请先提取清晰人声。");
    const reference = await referenceFile(document, line);
    const dry = await lineClipBlob(document, line);
    const sourceFile = new File([dry], "source-vocals.wav", { type: "audio/wav" });
    const blob = await requestLanVoiceConvert(sourceFile, reference, signal, {
        f0Condition: true,
        diffusionSteps: 25,
        autoF0Adjust: false,
    });
    return saveStudioMedia(blob, "audio");
}

export async function remakeCoverLine(document: CoverDocument, line: CoverLine, signal?: AbortSignal) {
    const lyrics = line.translation?.trim() || line.text.trim();
    if (!lyrics) throw new Error("请先填写要唱的新歌词。");
    if (!document.source?.separation?.vocalsKey && !document.source?.audioKey) throw new Error("请先提取清晰人声。");
    const reference = await referenceFile(document, line);
    const dry = await lineClipBlob(document, line);
    const melody = new File([dry], "melody-vocals.wav", { type: "audio/wav" });
    const blob = await requestLanSvsRemake(lyrics, melody, reference, signal, { diffusionSteps: 25 });
    return saveStudioMedia(blob, "audio");
}

/** Mix background bed + converted line vocals into one WAV. */
export async function buildCoverMix(document: CoverDocument) {
    const source = document.source;
    if (!source) throw new Error("请先上传歌曲。");
    const bedKey = source.separation?.backgroundKey || source.audioKey;
    const total = Math.max(source.durationSec || 0, ...document.lines.map((line) => line.endSec), 1);
    const rate = 44100;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(total * rate)), rate);
    const bed = bedKey ? await decodeKey(bedKey) : null;
    if (bed) {
        const node = offline.createBufferSource();
        node.buffer = bed;
        const gain = offline.createGain();
        gain.gain.value = document.settings.bedVolume;
        node.connect(gain).connect(offline.destination);
        node.start(0);
    }
    let voiced = 0;
    for (const line of document.lines) {
        if (!line.audioKey) continue;
        const buffer = await decodeKey(line.audioKey);
        if (!buffer) continue;
        voiced += 1;
        const node = offline.createBufferSource();
        node.buffer = buffer;
        node.connect(offline.destination);
        node.start(Math.max(0, line.startSec));
    }
    if (!bed && !voiced) throw new Error("还没有可导出的人声或伴奏。");
    return encodeWav(await offline.startRendering());
}

export async function exportCoverMix(document: CoverDocument, title = "翻唱混音") {
    const blob = await buildCoverMix(document);
    downloadBlob(blob, `${title}.wav`);
}

export { audioDuration };
