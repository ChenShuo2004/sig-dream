import { useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { zipSync } from "fflate";
import { useTranslation } from "react-i18next";

import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { requestLanSeedVc, requestLanTts, type LanTtsRequest } from "@/services/api/lan-bridge";
import { listVoiceRecords, persistVoiceResult, type VoiceRecord } from "@/services/api/voice-records";
import { AudioSlot } from "@/pages/voice/audio-slot";

import "./voice-page.css";

const METHODS = ["same", "audio", "vector", "text"] as const;
const VECTOR_KEYS = ["joy", "anger", "sadness", "fear", "disgust", "low", "surprise", "calm"] as const;
const MAX_BATCH = 10;

type Advanced = {
    doSample: boolean;
    temperature: number;
    topP: number;
    topK: number;
    numBeams: number;
    repetitionPenalty: number;
    lengthPenalty: number;
    maxMelTokens: number;
    maxTextTokens: number;
};

type BatchTask = {
    key: number;
    audio: File | null;
    audioUrl: string;
    storageKey?: string;
    text: string;
    resultUrl: string;
    resultBlob: Blob | null;
    message: string;
};

const INITIAL_ADVANCED: Advanced = {
    doSample: true,
    temperature: 0.8,
    topP: 0.8,
    topK: 30,
    numBeams: 3,
    repetitionPenalty: 10,
    lengthPenalty: 0,
    maxMelTokens: 1500,
    maxTextTokens: 120,
};

function VoiceHistoryRow({ record }: { record: VoiceRecord }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let cancelled = false;
        void resolveMediaUrl(record.storageKey, "").then((value) => {
            if (!cancelled) setUrl(value);
        });
        return () => {
            cancelled = true;
        };
    }, [record.storageKey]);
    return (
        <div className="tts-history-item">
            <span className="tts-history-text">{record.text}</span>
            {url ? <audio className="tts-audio" src={url} controls /> : null}
        </div>
    );
}

export default function VoicePage() {
    const { t } = useTranslation();
    const [tab, setTab] = useState<"generate" | "batch" | "seedvc">("generate");
    const [reference, setReference] = useState<File | null>(null);
    const [referenceUrl, setReferenceUrl] = useState("");
    const [referenceKey, setReferenceKey] = useState("");
    const [emoKey, setEmoKey] = useState("");
    const [history, setHistory] = useState<VoiceRecord[]>([]);
    const [text, setText] = useState("");
    const [method, setMethod] = useState(0);
    const [emoAudio, setEmoAudio] = useState<File | null>(null);
    const [emoAudioUrl, setEmoAudioUrl] = useState("");
    const [emoText, setEmoText] = useState("");
    const [emoWeight, setEmoWeight] = useState(0.65);
    const [emoRandom, setEmoRandom] = useState(false);
    const [vector, setVector] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
    const [advanced, setAdvanced] = useState<Advanced>(INITIAL_ADVANCED);
    const [busy, setBusy] = useState(false);
    const [statusText, setStatusText] = useState("");
    const [error, setError] = useState("");
    const [resultUrl, setResultUrl] = useState("");
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [tasks, setTasks] = useState<BatchTask[]>([]);
    const [batchLog, setBatchLog] = useState("");
    const urls = useRef<string[]>([]);
    const referenceUpload = useRef<Promise<string>>(Promise.resolve(""));
    const emoUpload = useRef<Promise<string>>(Promise.resolve(""));

    useEffect(() => {
        const current = urls.current;
        return () => {
            current.forEach((url) => URL.revokeObjectURL(url));
        };
    }, []);

    useEffect(() => {
        void listVoiceRecords().then(setHistory).catch(() => undefined);
    }, []);

    const remember = (url: string) => {
        urls.current.push(url);
        return url;
    };

    const segments = useMemo(() => previewSegments(text, advanced.maxTextTokens), [advanced.maxTextTokens, text]);

    const options = (): LanTtsRequest => ({
        emoMethod: method,
        emoWeight,
        emoText: method === 3 ? emoText : "",
        emoVector: method === 2 ? vector : undefined,
        emoRandom: (method === 2 || method === 3) && emoRandom,
        emoAudio: method === 1 ? emoAudio || undefined : undefined,
        maxTextTokens: advanced.maxTextTokens,
        doSample: advanced.doSample,
        topP: advanced.topP,
        topK: advanced.topK,
        temperature: advanced.temperature,
        lengthPenalty: advanced.lengthPenalty,
        numBeams: advanced.numBeams,
        repetitionPenalty: advanced.repetitionPenalty,
        maxMelTokens: advanced.maxMelTokens,
        onStatus: (_status, message) => {
            if (message) setStatusText(message);
        },
    });

    const generate = async () => {
        const spoken = text.trim();
        if (!reference) {
            setError(t("voicePage.needReference"));
            return;
        }
        if (!spoken) {
            setError(t("voicePage.needText"));
            return;
        }
        if (method === 1 && !emoAudio) {
            setError(t("voicePage.needEmoAudio"));
            return;
        }
        setBusy(true);
        setError("");
        setStatusText("");
        try {
            const blob = await requestLanTts(spoken, reference, undefined, options());
            setResultBlob(blob);
            setResultUrl(remember(URL.createObjectURL(blob)));
            try {
                const refKey = referenceKey || (await referenceUpload.current);
                const emotionKey = emoKey || (await emoUpload.current);
                const saved = await persistVoiceResult(spoken, blob, [refKey, emotionKey]);
                setStatusText(saved.nasWarning || "");
                setHistory(await listVoiceRecords().catch(() => []));
            } catch {
                setStatusText(t("voicePage.nasFailed"));
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t("apiErrors.lanTtsFailed"));
            setStatusText("");
        } finally {
            setBusy(false);
        }
    };

    const addTask = () => {
        setTasks((current) => (current.length >= MAX_BATCH ? current : [...current, { key: Date.now(), audio: null, audioUrl: "", text: "", resultUrl: "", resultBlob: null, message: "" }]));
    };

    const startBatch = async () => {
        if (!tasks.length) {
            setBatchLog(t("voicePage.emptyBatch"));
            return;
        }
        setBusy(true);
        setBatchLog("");
        const lines: string[] = [];
        const next = tasks.map((task) => ({ ...task, resultUrl: "", resultBlob: null, message: "" }));
        for (let index = 0; index < next.length; index += 1) {
            const task = next[index];
            if (!task.audio || !task.text.trim()) {
                const message = `任务 ${index} 失败: 缺少音频或文本`;
                task.message = message;
                lines.push(message);
                continue;
            }
            try {
                if (!task.storageKey) {
                    try {
                        task.storageKey = (await uploadMediaFile(task.audio, "audio")).storageKey;
                    } catch {
                        task.storageKey = undefined;
                    }
                }
                const blob = await requestLanTts(task.text.trim(), task.audio, undefined, {
                    onStatus: (_status, message) => {
                        if (message) setBatchLog([...lines, `${index}: ${message}`].join("\n"));
                    },
                });
                task.resultBlob = blob;
                task.resultUrl = remember(URL.createObjectURL(blob));
                try {
                    const saved = await persistVoiceResult(task.text.trim(), blob, task.storageKey ? [task.storageKey] : []);
                    if (saved.nasWarning) lines.push(saved.nasWarning);
                } catch {
                    lines.push(t("voicePage.nasFailed"));
                }
                const message = `任务 ${index} 完成: ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
                task.message = message;
                lines.push(message);
            } catch (caught) {
                const message = `任务 ${index} 失败: ${caught instanceof Error ? caught.message : t("apiErrors.lanTtsFailed")}`;
                task.message = message;
                lines.push(message);
            }
            setTasks([...next]);
            setBatchLog(lines.join("\n"));
        }
        setTasks([...next]);
        setBatchLog(lines.join("\n") || t("voicePage.emptyBatch"));
        setBusy(false);
    };

    const downloadBatch = async () => {
        const ready = tasks.filter((task) => task.resultBlob);
        if (!ready.length) return;
        if (ready.length === 1 && ready[0].resultBlob) {
            saveAs(ready[0].resultBlob, "batch_0.wav");
            return;
        }
        const files: Record<string, Uint8Array> = {};
        for (let index = 0; index < ready.length; index += 1) {
            const blob = ready[index].resultBlob;
            if (!blob) continue;
            files[`batch_${index}.wav`] = new Uint8Array(await blob.arrayBuffer());
        }
        saveAs(new Blob([zipSync(files)], { type: "application/zip" }), `batch_download_${Date.now()}.zip`);
    };

    return (
        <main className="tts-page">
            <div className="tts-tabs">
                <button type="button" className={tab === "generate" ? "tts-tab is-selected" : "tts-tab"} onClick={() => setTab("generate")}>
                    {t("voicePage.tabGenerate")}
                </button>
                <button type="button" className={tab === "batch" ? "tts-tab is-selected" : "tts-tab"} onClick={() => setTab("batch")}>
                    {t("voicePage.tabBatch")}
                </button>
                <button type="button" className={tab === "seedvc" ? "tts-tab is-selected" : "tts-tab"} onClick={() => setTab("seedvc")}>
                    Seed-vc
                </button>
            </div>
            {tab === "seedvc" ? (
                <SeedVcPanel />
            ) : tab === "generate" ? (
                <>
                    <div className="tts-gen-row">
                        <AudioSlot
                            label={t("voicePage.reference")}
                            url={referenceUrl}
                            onFile={(file) => {
                                setReference(file);
                                setReferenceUrl(remember(URL.createObjectURL(file)));
                                setReferenceKey("");
                                setError("");
                                referenceUpload.current = uploadMediaFile(file, "audio")
                                    .then((stored) => {
                                        setReferenceKey(stored.storageKey);
                                        return stored.storageKey;
                                    })
                                    .catch(() => "");
                            }}
                            onClear={() => {
                                setReference(null);
                                setReferenceUrl("");
                                setReferenceKey("");
                                referenceUpload.current = Promise.resolve("");
                            }}
                        />
                        <div className="tts-stack">
                            <label className="tts-block">
                                <span className="tts-label">{t("voicePage.text")}</span>
                                <span className="tts-body">
                                    <textarea className="tts-text" placeholder={t("voicePage.textPlaceholder")} value={text} onChange={(event) => setText(event.target.value)} />
                                    <span className="tts-info">{t("voicePage.modelVersion", { version: "2.5" })}</span>
                                </span>
                            </label>
                            <button type="button" className="tts-primary" disabled={busy} onClick={() => void generate()}>
                                {t("voicePage.generate")}
                            </button>
                            {statusText ? <p className="tts-status">{statusText}</p> : null}
                            {error ? <p className="tts-error">{error}</p> : null}
                        </div>
                        <section className="tts-block">
                            <span className="tts-label">{t("voicePage.result")}</span>
                            <div className="tts-body">
                                {resultUrl ? <audio className="tts-audio" src={resultUrl} controls /> : null}
                                {resultBlob ? (
                                    <button type="button" className="tts-secondary" onClick={() => saveAs(resultBlob, "output.wav")}>
                                        {t("voicePage.download")}
                                    </button>
                                ) : null}
                            </div>
                        </section>
                    </div>
                    {history.length ? (
                        <section className="tts-history">
                            <span className="tts-label">{t("voicePage.history")}</span>
                            {history.map((record) => (
                                <VoiceHistoryRow key={record.id} record={record} />
                            ))}
                        </section>
                    ) : null}

                    <details className="tts-acc" open>
                        <summary>{t("voicePage.settings")}</summary>
                        <div className="tts-acc-body">
                            <div className="tts-block">
                                <span className="tts-label">{t("voicePage.emotion")}</span>
                                <div className="tts-radio tts-body">
                                    {METHODS.map((key, index) => (
                                        <button key={key} type="button" className={method === index ? "tts-radio-item is-selected" : "tts-radio-item"} onClick={() => setMethod(index)}>
                                            <span className="tts-dot" />
                                            {t(`voicePage.methods.${key}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </details>

                    {method === 1 ? (
                        <div className="tts-acc-body">
                            <AudioSlot
                                label={t("voicePage.emoAudio")}
                                url={emoAudioUrl}
                                onFile={(file) => {
                                    setEmoAudio(file);
                                    setEmoAudioUrl(remember(URL.createObjectURL(file)));
                                    setEmoKey("");
                                    emoUpload.current = uploadMediaFile(file, "audio")
                                        .then((stored) => {
                                            setEmoKey(stored.storageKey);
                                            return stored.storageKey;
                                        })
                                        .catch(() => "");
                                }}
                                onClear={() => {
                                    setEmoAudio(null);
                                    setEmoAudioUrl("");
                                    setEmoKey("");
                                    emoUpload.current = Promise.resolve("");
                                }}
                            />
                        </div>
                    ) : null}
                    {method === 2 || method === 3 ? (
                        <label className="tts-check">
                            <input type="checkbox" checked={emoRandom} onChange={(event) => setEmoRandom(event.target.checked)} />
                            {t("voicePage.random")}
                        </label>
                    ) : null}
                    {method === 2 ? (
                        <div className="tts-vectors">
                            {VECTOR_KEYS.map((key, index) => (
                                <Slider
                                    key={key}
                                    label={t(`voicePage.vectors.${key}`)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={vector[index]}
                                    onChange={(value) => {
                                        const next = [...vector];
                                        next[index] = value;
                                        setVector(next);
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                    {method === 3 ? (
                        <div className="tts-stack">
                            <div className="tts-warning">{t("voicePage.experimental")}</div>
                            <label className="tts-block">
                                <span className="tts-label">{t("voicePage.emoText")}</span>
                                <span className="tts-body">
                                    <textarea className="tts-text" placeholder={t("voicePage.emoTextPlaceholder")} value={emoText} onChange={(event) => setEmoText(event.target.value)} />
                                    <span className="tts-info">{t("voicePage.emoTextInfo")}</span>
                                </span>
                            </label>
                        </div>
                    ) : null}
                    {method > 0 ? <Slider label={t("voicePage.emoWeight")} min={0} max={1} step={0.01} value={emoWeight} onChange={setEmoWeight} /> : null}

                    <details className="tts-acc">
                        <summary>{t("voicePage.advanced")}</summary>
                        <div className="tts-acc-body tts-advanced">
                            <div>
                                <p className="tts-md">
                                    <strong>{t("voicePage.samplingTitle")}</strong> <em>{t("voicePage.samplingHint")}</em>{" "}
                                    <a href="https://huggingface.co/docs/transformers/main/en/generation_strategies" target="_blank" rel="noreferrer">
                                        Generation strategies
                                    </a>
                                    .
                                </p>
                                <label className="tts-check">
                                    <input type="checkbox" checked={advanced.doSample} onChange={(event) => setAdvanced({ ...advanced, doSample: event.target.checked })} />
                                    do_sample
                                    <span className="tts-info">{t("voicePage.doSample")}</span>
                                </label>
                                <Slider label="temperature" min={0.1} max={2} step={0.1} value={advanced.temperature} onChange={(temperature) => setAdvanced({ ...advanced, temperature })} />
                                <div className="tts-inline">
                                    <Slider label="top_p" min={0} max={1} step={0.01} value={advanced.topP} onChange={(topP) => setAdvanced({ ...advanced, topP })} />
                                    <Slider label="top_k" min={0} max={100} step={1} value={advanced.topK} onChange={(topK) => setAdvanced({ ...advanced, topK })} />
                                    <Slider label="num_beams" min={1} max={10} step={1} value={advanced.numBeams} onChange={(numBeams) => setAdvanced({ ...advanced, numBeams })} />
                                </div>
                                <div className="tts-inline">
                                    <Slider label="repetition_penalty" min={0.1} max={20} step={0.1} value={advanced.repetitionPenalty} onChange={(repetitionPenalty) => setAdvanced({ ...advanced, repetitionPenalty })} />
                                    <Slider label="length_penalty" min={-2} max={2} step={0.1} value={advanced.lengthPenalty} onChange={(lengthPenalty) => setAdvanced({ ...advanced, lengthPenalty })} />
                                </div>
                                <Slider label="max_mel_tokens" info={t("voicePage.maxMelInfo")} min={50} max={1815} step={10} value={advanced.maxMelTokens} onChange={(maxMelTokens) => setAdvanced({ ...advanced, maxMelTokens })} />
                            </div>
                            <div>
                                <p className="tts-md">
                                    <strong>{t("voicePage.segmentTitle")}</strong> <em>{t("voicePage.segmentHint")}</em>
                                </p>
                                <Slider label={t("voicePage.maxTextTokens")} info={t("voicePage.maxTextTokensInfo")} min={20} max={600} step={2} value={advanced.maxTextTokens} onChange={(maxTextTokens) => setAdvanced({ ...advanced, maxTextTokens })} />
                                <details className="tts-acc" open>
                                    <summary>{t("voicePage.preview")}</summary>
                                    <div className="tts-body">
                                        <table className="tts-table">
                                            <thead>
                                                <tr>
                                                    <th>{t("voicePage.columns.index")}</th>
                                                    <th>{t("voicePage.columns.content")}</th>
                                                    <th>{t("voicePage.columns.tokens")}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {segments.map((row) => (
                                                    <tr key={row.index}>
                                                        <td>{row.index}</td>
                                                        <td>{row.content}</td>
                                                        <td>{row.tokens}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        </div>
                    </details>
                </>
            ) : (
                <section>
                    <button type="button" className="tts-secondary" disabled={tasks.length >= MAX_BATCH || busy} onClick={addTask}>
                        {t("voicePage.addTask")}
                    </button>
                    {tasks.map((task, index) => (
                        <div className="tts-batch-row" key={task.key}>
                            <AudioSlot
                                label={`${t("voicePage.batchAudio")}_${index}`}
                                url={task.audioUrl}
                                onFile={(file) => {
                                    const audioUrl = remember(URL.createObjectURL(file));
                                    setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, audio: file, audioUrl, storageKey: undefined } : item)));
                                    void uploadMediaFile(file, "audio")
                                        .then((stored) => {
                                            setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, storageKey: stored.storageKey } : item)));
                                        })
                                        .catch(() => undefined);
                                }}
                                onClear={() => setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, audio: null, audioUrl: "", storageKey: undefined } : item)))}
                            />
                            <label className="tts-block">
                                <span className="tts-label">{`${t("voicePage.batchText")}_${index}`}</span>
                                <span className="tts-body">
                                    <textarea
                                        className="tts-text"
                                        placeholder={t("voicePage.textPlaceholder")}
                                        value={task.text}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, text: value } : item)));
                                        }}
                                    />
                                </span>
                            </label>
                            <button type="button" className="tts-secondary" onClick={() => setTasks((current) => current.filter((item) => item.key !== task.key))}>
                                {`${t("voicePage.deleteTask")}_${index}`}
                            </button>
                            {task.resultUrl ? (
                                <div className="tts-block">
                                    <span className="tts-label">{`${t("voicePage.taskPreview")}_${index}`}</span>
                                    <div className="tts-body">
                                        <audio className="tts-audio" src={task.resultUrl} controls />
                                        {task.resultBlob ? (
                                            <button type="button" className="tts-secondary" onClick={() => task.resultBlob && saveAs(task.resultBlob, `task_${index}.wav`)}>
                                                {`${t("voicePage.taskDownload")}_${index}`}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ))}
                    <div className="tts-actions">
                        <button type="button" className="tts-primary" disabled={busy} onClick={() => void startBatch()}>
                            {t("voicePage.startBatch")}
                        </button>
                        <button type="button" className="tts-secondary" disabled={busy || !tasks.some((task) => task.resultBlob)} onClick={() => void downloadBatch()}>
                            {t("voicePage.batchDownload")}
                        </button>
                    </div>
                    <label className="tts-block">
                        <span className="tts-label">{t("voicePage.batchResult")}</span>
                        <span className="tts-body">
                            <textarea className="tts-text" readOnly value={batchLog} />
                        </span>
                    </label>
                </section>
            )}
        </main>
    );
}

function SeedVcPanel() {
    const [source, setSource] = useState<File | null>(null);
    const [sourceUrl, setSourceUrl] = useState("");
    const [reference, setReference] = useState<File | null>(null);
    const [referenceUrl, setReferenceUrl] = useState("");
    const [steps, setSteps] = useState(10);
    const [length, setLength] = useState(1);
    const [cfg, setCfg] = useState(0.7);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [resultUrl, setResultUrl] = useState("");
    const urls = useRef<string[]>([]);
    const remember = (url: string) => {
        urls.current.push(url);
        return url;
    };
    useEffect(() => {
        return () => {
            urls.current.forEach((url) => URL.revokeObjectURL(url));
        };
    }, []);

    const submit = async () => {
        if (!source || !reference) {
            setStatus(!source ? "请上传源音频" : "请上传参考音频");
            return;
        }
        setBusy(true);
        setStatus("");
        setResultUrl("");
        try {
            const blob = await requestLanSeedVc(source, reference, undefined, {
                diffusionSteps: steps,
                lengthAdjust: length,
                inferenceCfgRate: cfg,
                onStatus: (_state, message) => setStatus(message),
            });
            setResultUrl(remember(URL.createObjectURL(blob)));
            setStatus("完成");
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "音色替换失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="tts-seed">
            <div className="tts-stack">
                <AudioSlot
                    label="源音频"
                    url={sourceUrl}
                    onFile={(file) => {
                        setSource(file);
                        setSourceUrl(remember(URL.createObjectURL(file)));
                    }}
                    onClear={() => {
                        setSource(null);
                        setSourceUrl("");
                    }}
                />
                <AudioSlot
                    label="参考音频"
                    url={referenceUrl}
                    onFile={(file) => {
                        setReference(file);
                        setReferenceUrl(remember(URL.createObjectURL(file)));
                    }}
                    onClear={() => {
                        setReference(null);
                        setReferenceUrl("");
                    }}
                />
                <Slider label="扩散步数" info="默认为 10，50~100 为最佳质量" min={1} max={200} step={1} value={steps} onChange={setSteps} />
                <Slider label="长度调整" info="<1.0 加速语速，>1.0 减慢语速" min={0.5} max={2} step={0.1} value={length} onChange={setLength} />
                <Slider label="CFG 系数" info="有微小影响" min={0} max={1} step={0.1} value={cfg} onChange={setCfg} />
                <div className="tts-actions">
                    <button type="button" className="tts-primary" disabled={busy} onClick={() => void submit()}>
                        {busy ? "提交中" : "提交"}
                    </button>
                </div>
                {status ? <p className="tts-md">{status}</p> : null}
            </div>
            <div className="tts-stack">
                <label className="tts-block">
                    <span className="tts-label">流式输出</span>
                    <span className="tts-body">
                        <span className="tts-info">队列完成后在完整输出中播放。</span>
                    </span>
                </label>
                <label className="tts-block">
                    <span className="tts-label">完整输出</span>
                    <span className="tts-body">{resultUrl ? <audio className="tts-audio" src={resultUrl} controls /> : <span className="tts-info">等待转换</span>}</span>
                </label>
            </div>
        </section>
    );
}

function Slider({ label, info, min, max, step, value, onChange }: { label: string; info?: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
    const apply = (raw: number) => {
        if (Number.isNaN(raw)) return;
        const snapped = Math.round(raw / step) * step;
        onChange(Math.min(max, Math.max(min, Number(snapped.toFixed(4)))));
    };
    return (
        <label className="tts-slider">
            <span>{label}</span>
            <span className="tts-slider-row">
                <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => apply(Number(event.target.value))} />
                <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => apply(Number(event.target.value))} />
            </span>
            {info ? <span className="tts-info">{info}</span> : null}
        </label>
    );
}

function previewSegments(text: string, maxTokens: number) {
    const source = text.trim();
    if (!source) return [] as { index: number; content: string; tokens: number }[];
    const limit = Math.max(20, maxTokens);
    const sentences = source.split(/(?<=[。！？!?;；\n])/u).map((item) => item.trim()).filter(Boolean);
    const rows: { index: number; content: string; tokens: number }[] = [];
    let bucket = "";
    let tokens = 0;
    const push = (content: string, count: number) => {
        const spoken = content.trim();
        if (!spoken) return;
        rows.push({ index: rows.length, content: spoken, tokens: Math.max(1, count) });
    };
    const flush = () => {
        push(bucket, tokens);
        bucket = "";
        tokens = 0;
    };
    for (const sentence of sentences) {
        const cost = estimateTokens(sentence);
        if (cost > limit) {
            flush();
            let piece = "";
            let pieceTokens = 0;
            for (const char of sentence) {
                const charCost = estimateTokens(char) || 1;
                if (piece && pieceTokens + charCost > limit) {
                    push(piece, pieceTokens);
                    piece = "";
                    pieceTokens = 0;
                }
                piece += char;
                pieceTokens += charCost;
            }
            push(piece, pieceTokens);
            continue;
        }
        if (tokens && tokens + cost > limit) flush();
        bucket += sentence;
        tokens += cost;
    }
    flush();
    return rows;
}

function estimateTokens(text: string) {
    let count = 0;
    for (const char of text) {
        if (/\s/u.test(char)) continue;
        count += char.charCodeAt(0) < 128 ? 0.3 : 1;
    }
    return Math.ceil(count);
}
