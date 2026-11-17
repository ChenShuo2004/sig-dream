import { useEffect, useRef, useState } from "react";
import { Mic, Music, Pause, Play, RotateCcw, Scissors, SkipBack, SkipForward, Upload, Volume2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";

const RATES = [0.5, 1, 1.5, 2];
const ACCENT = "#ea580c";
const inkOnWhite = { color: "#18181b", WebkitTextFillColor: "#18181b" };

export function AudioSlot({ label, url, onFile, onClear }: { label: string; url: string; onFile: (file: File) => void; onClear?: () => void }) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const waveRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<RegionsPlugin | null>(null);
    const regionRef = useRef<Region | null>(null);
    const originalFile = useRef<File | null>(null);
    const edited = useRef(false);
    const volumeRef = useRef(1);
    const rateRef = useRef(1);
    const [over, setOver] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [rate, setRate] = useState(1);
    const [volume, setVolume] = useState(1);
    const [showVolume, setShowVolume] = useState(false);
    const [editing, setEditing] = useState(false);
    const [trimSpan, setTrimSpan] = useState(0);
    const [source, setSource] = useState<"upload" | "microphone">("upload");
    const [recording, setRecording] = useState(false);
    const [paused, setPaused] = useState(false);
    const [recordSeconds, setRecordSeconds] = useState(0);
    const [micError, setMicError] = useState("");
    const micHostRef = useRef<HTMLDivElement>(null);
    const recordRef = useRef<RecordPlugin | null>(null);
    const discardRef = useRef(false);
    const onFileRef = useRef(onFile);
    onFileRef.current = onFile;

    useEffect(() => {
        const host = hostRef.current;
        if (!url || !host) {
            setDuration(0);
            setTime(0);
            setPlaying(false);
            setEditing(false);
            return;
        }
        setEditing(false);
        setTime(0);
        setPlaying(false);
        const regions = RegionsPlugin.create();
        const wave = WaveSurfer.create({
            container: host,
            height: 50,
            barWidth: 2,
            barGap: 3,
            cursorWidth: 2,
            cursorColor: "#ddd5e9",
            barRadius: 10,
            dragToSeek: true,
            normalize: true,
            minPxPerSec: 20,
            waveColor: "#9ca3af",
            progressColor: ACCENT,
            url,
            plugins: [regions],
        });
        wave.setVolume(volumeRef.current);
        wave.on("ready", () => {
            const next = wave.getDuration() || 0;
            setDuration(next);
            wave.setPlaybackRate(rateRef.current);
        });
        wave.on("timeupdate", (current) => setTime(current));
        wave.on("play", () => setPlaying(true));
        wave.on("pause", () => setPlaying(false));
        wave.on("finish", () => setPlaying(false));
        waveRef.current = wave;
        regionsRef.current = regions;
        return () => {
            regionRef.current = null;
            regionsRef.current = null;
            waveRef.current = null;
            wave.destroy();
        };
    }, [url]);

    useEffect(() => {
        const host = micHostRef.current;
        if (source !== "microphone" || url || !host) return;
        const wave = WaveSurfer.create({
            container: host,
            height: 50,
            barWidth: 2,
            barGap: 3,
            cursorWidth: 0,
            barRadius: 10,
            normalize: false,
            waveColor: "#9ca3af",
            progressColor: ACCENT,
            interact: false,
        });
        const recorder = wave.registerPlugin(RecordPlugin.create({ scrollingWaveform: true, renderRecordedAudio: false }));
        recorder.on("record-progress", (milliseconds) => setRecordSeconds(milliseconds / 1000));
        recorder.on("record-end", (blob) => {
            setRecording(false);
            setPaused(false);
            if (discardRef.current) return;
            void blobToWav(blob).then((wav) => {
                const file = new File([wav], "recording.wav", { type: "audio/wav" });
                originalFile.current = file;
                edited.current = false;
                onFileRef.current(file);
            });
        });
        recordRef.current = recorder;
        return () => {
            discardRef.current = true;
            try {
                if (recorder.isRecording() || recorder.isPaused()) recorder.stopRecording();
                recorder.stopMic();
            } catch {
                /* 麦克风已释放 */
            }
            recordRef.current = null;
            wave.destroy();
        };
    }, [source, url]);

    useEffect(() => {
        const regions = regionsRef.current;
        const wave = waveRef.current;
        if (!editing || !regions || !wave) return;
        const place = () => {
            const length = wave.getDuration() || 0;
            if (length <= 0) return;
            regions.clearRegions();
            const region = regions.addRegion({
                start: length / 4,
                end: length / 2,
                drag: true,
                resize: true,
                color: "rgba(234, 88, 12, 0.28)",
                minLength: 0.05,
            });
            regionRef.current = region;
            setTrimSpan(region.end - region.start);
        };
        if (wave.getDuration()) place();
        else wave.once("ready", place);
        const onUpdated = (region: Region) => {
            regionRef.current = region;
            setTrimSpan(region.end - region.start);
        };
        const onOut = () => wave.pause();
        regions.on("region-updated", onUpdated);
        regions.on("region-out", onOut);
        return () => {
            regionRef.current = null;
            try {
                regions.un("region-updated", onUpdated);
                regions.un("region-out", onOut);
                regions.clearRegions();
            } catch {
                /* 波形已销毁 */
            }
        };
    }, [editing, url]);

    const take = (file: File | undefined) => {
        if (!file) return;
        originalFile.current = file;
        edited.current = false;
        setEditing(false);
        onFile(file);
    };

    const togglePlay = () => {
        const wave = waveRef.current;
        if (!wave) return;
        if (editing && regionRef.current) {
            if (wave.isPlaying()) wave.pause();
            else regionRef.current.play();
            return;
        }
        void wave.playPause();
    };

    const skip = (direction: number) => {
        const wave = waveRef.current;
        if (!wave) return;
        const amount = (wave.getDuration() / 100) * 5 || 5;
        wave.skip(direction * amount);
    };

    const applyTrim = () => {
        const wave = waveRef.current;
        const region = regionRef.current;
        const data = wave?.getDecodedData();
        if (!wave || !region || !data) return;
        const start = Math.min(region.start, region.end);
        const end = Math.max(region.start, region.end);
        if (end - start < 0.05) return;
        edited.current = true;
        setEditing(false);
        onFile(new File([cropToWav(data, start, end)], "trimmed.wav", { type: "audio/wav" }));
    };

    const selectSource = (next: "upload" | "microphone") => {
        discardRef.current = true;
        const recorder = recordRef.current;
        if (recorder && (recorder.isRecording() || recorder.isPaused())) recorder.stopRecording();
        originalFile.current = null;
        edited.current = false;
        setEditing(false);
        setRecording(false);
        setPaused(false);
        setRecordSeconds(0);
        setMicError("");
        setSource(next);
        if (url) onClear?.();
    };

    const startRecording = async () => {
        const recorder = recordRef.current;
        if (!recorder) return;
        discardRef.current = false;
        setMicError("");
        setRecordSeconds(0);
        try {
            await recorder.startRecording();
            setRecording(true);
            setPaused(false);
        } catch {
            setRecording(false);
            setMicError(t("voicePage.micDenied"));
        }
    };

    const stopRecording = () => {
        discardRef.current = false;
        recordRef.current?.stopRecording();
        setRecording(false);
        setPaused(false);
    };

    const togglePauseRecording = () => {
        const recorder = recordRef.current;
        if (!recorder) return;
        if (recorder.isPaused()) {
            recorder.resumeRecording();
            setPaused(false);
            return;
        }
        recorder.pauseRecording();
        setPaused(true);
    };

    const restore = () => {
        const source = originalFile.current;
        if (!source || !edited.current) return;
        edited.current = false;
        setEditing(false);
        onFile(source);
    };

    const emptyUpload = !url && source === "upload";

    return (
        <section className={emptyUpload ? "tts-block tts-audio-slot is-empty" : "tts-block tts-audio-slot"}>
            {emptyUpload ? (
                <span className="tts-float-label">
                    <Music className="size-3.5" />
                    {label}
                </span>
            ) : null}
            {emptyUpload ? null : (
            <span className="tts-label">
                <span>{label}</span>
                {url && onClear ? (
                    <button
                        type="button"
                        className="tts-icon-btn"
                        aria-label={t("voicePage.clearAudio")}
                        onClick={() => {
                            originalFile.current = null;
                            edited.current = false;
                            setEditing(false);
                            onClear();
                        }}
                    >
                        <X className="size-4" />
                    </button>
                ) : null}
            </span>
            )}
            <div className="tts-body">
                {url ? (
                    <>
                        <div className="tts-wave-stage">
                            <div ref={hostRef} className="tts-wave-host" />
                        </div>
                        <div className="tts-wave-times">
                            <span>{formatTime(time)}</span>
                            <span>
                                {editing && trimSpan > 0 ? <span className="tts-trim-len">{formatTime(trimSpan)}</span> : null}
                                {formatTime(duration)}
                            </span>
                        </div>
                        <div className="tts-wave-controls">
                            <div className="tts-wave-group">
                                <button
                                    type="button"
                                    className={showVolume ? "tts-icon-btn is-on" : "tts-icon-btn"}
                                    aria-label={t("voicePage.volume")}
                                    onClick={() => setShowVolume((value) => !value)}
                                >
                                    <Volume2 className="size-4" />
                                </button>
                                {showVolume ? (
                                    <input
                                        className="tts-volume"
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={volume}
                                        onChange={(event) => {
                                            const next = Number(event.target.value);
                                            volumeRef.current = next;
                                            setVolume(next);
                                            waveRef.current?.setVolume(next);
                                        }}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        className="tts-rate"
                                        onClick={() => {
                                            const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
                                            rateRef.current = next;
                                            setRate(next);
                                            waveRef.current?.setPlaybackRate(next);
                                        }}
                                    >
                                        {rate}x
                                    </button>
                                )}
                            </div>
                            <div className="tts-wave-group tts-wave-play">
                                <button type="button" className="tts-icon-btn" aria-label={t("voicePage.rewind")} onClick={() => skip(-1)}>
                                    <SkipBack className="size-4" />
                                </button>
                                <button type="button" className="tts-icon-btn" aria-label={playing ? t("voicePage.pause") : t("voicePage.play")} onClick={togglePlay}>
                                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                                </button>
                                <button type="button" className="tts-icon-btn" aria-label={t("voicePage.forward")} onClick={() => skip(1)}>
                                    <SkipForward className="size-4" />
                                </button>
                            </div>
                            <div className="tts-wave-group tts-wave-edit">
                                {editing ? (
                                    <>
                                        <button type="button" className="tts-trim-apply" onClick={applyTrim}>
                                            {t("voicePage.trim")}
                                        </button>
                                        <button type="button" className="tts-trim-cancel" onClick={() => setEditing(false)}>
                                            {t("voicePage.trimCancel")}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button type="button" className="tts-icon-btn" aria-label={t("voicePage.restoreAudio")} onClick={restore}>
                                            <RotateCcw className="size-4" />
                                        </button>
                                        <button
                                            type="button"
                                            className="tts-icon-btn"
                                            aria-label={t("voicePage.trim")}
                                            onClick={() => {
                                                waveRef.current?.pause();
                                                setEditing(true);
                                            }}
                                        >
                                            <Scissors className="size-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                ) : source === "microphone" ? (
                    <div className="tts-record-panel">
                        <div ref={micHostRef} className="tts-wave-host" />
                        {recording ? <div className="tts-wave-times"><span>{formatTime(recordSeconds)}</span><span>{formatTime(recordSeconds)}</span></div> : null}
                        <div className="tts-record-actions">
                            {recording ? (
                                <>
                                    <button type="button" className="tts-record is-live" style={inkOnWhite} onClick={stopRecording}>
                                        <span className="tts-record-dot" />
                                        {t("voicePage.stop")}
                                    </button>
                                    <button type="button" className="tts-record" style={inkOnWhite} onClick={togglePauseRecording}>
                                        {paused ? t("voicePage.resume") : t("voicePage.pause")}
                                    </button>
                                </>
                            ) : (
                                <button type="button" className="tts-record" style={inkOnWhite} onClick={() => void startRecording()}>
                                    <span className="tts-record-dot" />
                                    {t("voicePage.record")}
                                </button>
                            )}
                        </div>
                        {micError ? <span className="tts-info">{micError}</span> : null}
                    </div>
                ) : (
                    <button
                        type="button"
                        className={over ? "tts-drop is-over" : "tts-drop"}
                        onClick={() => inputRef.current?.click()}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setOver(true);
                        }}
                        onDragLeave={() => setOver(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setOver(false);
                            take(event.dataTransfer.files?.[0]);
                        }}
                    >
                        <Upload className="tts-drop-icon" />
                        <span>{t("voicePage.drop")}</span>
                        <span className="tts-or">{t("voicePage.or")}</span>
                        <span>{t("voicePage.upload")}</span>
                    </button>
                )}
            </div>
            <div className="tts-audio-foot">
                <button type="button" className={source === "upload" ? "tts-source-btn is-selected" : "tts-source-btn"} aria-label={t("voicePage.upload")} onClick={() => selectSource("upload")}>
                    <Upload className="size-5" />
                </button>
                <button type="button" className={source === "microphone" ? "tts-source-btn is-selected" : "tts-source-btn"} aria-label={t("voicePage.record")} onClick={() => selectSource("microphone")}>
                    <Mic className="size-5" />
                </button>
            </div>
            <input ref={inputRef} hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" onChange={(event) => take(event.target.files?.[0])} />
        </section>
    );
}

async function blobToWav(blob: Blob) {
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
        return audioBufferToWav(decoded);
    } finally {
        void context.close();
    }
}

function cropToWav(buffer: AudioBuffer, start: number, end: number) {
    const rate = buffer.sampleRate;
    const from = Math.max(0, Math.round(start * rate));
    const to = Math.min(buffer.length, Math.round(end * rate));
    const length = Math.max(1, to - from);
    const channels = buffer.numberOfChannels;
    const context = new AudioContext();
    const trimmed = context.createBuffer(channels, length, rate);
    for (let channel = 0; channel < channels; channel += 1) {
        trimmed.getChannelData(channel).set(buffer.getChannelData(channel).subarray(from, from + length));
    }
    void context.close();
    return audioBufferToWav(trimmed);
}

function audioBufferToWav(buffer: AudioBuffer) {
    const channels = buffer.numberOfChannels;
    const samples = buffer.length;
    const block = channels * 2;
    const bytes = new ArrayBuffer(44 + samples * block);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + samples * block, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * block, true);
    view.setUint16(32, block, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples * block, true);
    const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 44;
    for (let index = 0; index < samples; index += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][index] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([bytes], { type: "audio/wav" });
}

function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
