import i18n from "@/i18n";
import { clipText, trackApiCall } from "@/services/api/api-call-log";

type JobStatus = {
    job_id: string;
    status: string;
    message?: string | null;
    error_message?: string | null;
    transcript?: LanAsrTranscript;
    endpoint?: string;
    design?: LanVoiceDesignResult;
};

export type LanVoiceDesignAttrs = {
    Gender?: string;
    Age?: string;
    Pitch?: string;
    Style?: string;
    EnglishAccent?: string;
    ChineseDialect?: string;
};

export type LanVoiceDesignResult = {
    attrs?: LanVoiceDesignAttrs;
    instruct?: string;
    unmatched?: string[];
};

export type LanAsrSegment = {
    id?: number;
    start?: number;
    end?: number;
    text?: string;
};

export type LanAsrTranscript = {
    text?: string;
    language?: string;
    duration?: number;
    segments?: LanAsrSegment[];
};

const apiText = (key: string) => i18n.t(`apiErrors.${key}`);

function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

function tokenExpired(token: string) {
    try {
        const payload = token.split(".")[0]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
        const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
        const parsed = JSON.parse(atob(padded)) as { exp?: number };
        return typeof parsed.exp === "number" && parsed.exp <= Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

function storePlatformToken(accessToken: string, role?: string) {
    const raw = localStorage.getItem("lcp_auth_session");
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed.access_token = accessToken;
    if (role) parsed.role = role;
    localStorage.setItem("lcp_auth_session", JSON.stringify(parsed));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `lcp_auth_token=${encodeURIComponent(accessToken)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`;
}

async function refreshPlatformToken(token: string) {
    const response = await fetch("/api-proxy/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { access_token?: string; role?: string };
    if (!payload.access_token) return "";
    storePlatformToken(payload.access_token, payload.role);
    return payload.access_token;
}

async function ensureToken() {
    const token = platformToken();
    if (!token) throw new Error(apiText("lanLoginRequired"));
    if (!tokenExpired(token)) return token;
    const refreshed = await refreshPlatformToken(token);
    if (!refreshed) throw new Error(apiText("tokenExpired"));
    return refreshed;
}

async function readDetail(response: Response) {
    try {
        const payload = (await response.json()) as { detail?: unknown; message?: unknown };
        if (typeof payload.detail === "string" && payload.detail) return payload.detail;
        if (typeof payload.message === "string" && payload.message) return payload.message;
    } catch {
        return "";
    }
    return "";
}

function authError(detail: string) {
    if (detail === "Token expired") return apiText("tokenExpired");
    return detail || apiText("requestFailed");
}

async function postJob(path: string, body: FormData, signal?: AbortSignal) {
    let token = await ensureToken();
    let response = await fetch(`/api-proxy${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal,
    });
    if (response.status === 401) {
        const detail = await readDetail(response);
        const refreshed = detail === "Token expired" ? await refreshPlatformToken(token) : "";
        if (!refreshed) throw new Error(authError(detail));
        token = refreshed;
        response = await fetch(`/api-proxy${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
            signal,
        });
    }
    if (!response.ok) throw new Error(authError(await readDetail(response)));
    const payload = (await response.json()) as { job_id?: string };
    if (!payload.job_id) throw new Error(apiText("requestFailed"));
    return payload.job_id;
}

async function waitForJob(jobId: string, timeoutMs: number, signal?: AbortSignal, onStatus?: (job: JobStatus) => void) {
    let token = await ensureToken();
    let refreshedOnce = false;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await fetch(`/api-proxy/canvas-lan/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });
        if (response.status === 401) {
            if (refreshedOnce) throw new Error(apiText("tokenExpired"));
            refreshedOnce = true;
            const refreshed = await refreshPlatformToken(token);
            if (!refreshed) throw new Error(apiText("tokenExpired"));
            token = refreshed;
            continue;
        }
        if (!response.ok) throw new Error((await readDetail(response)) || apiText("requestFailed"));
        const job = (await response.json()) as JobStatus;
        onStatus?.(job);
        if (job.status === "success") return job;
        if (job.status === "failed") throw new Error(job.error_message || job.message || apiText("requestFailed"));
        await delay(2000, signal);
    }
    throw new Error(apiText("requestFailed"));
}

async function downloadOutput(jobId: string, signal?: AbortSignal) {
    const token = await ensureToken();
    const response = await fetch(`/api-proxy/canvas-lan/jobs/${jobId}/output`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
    });
    if (!response.ok) throw new Error(authError(await readDetail(response)));
    return response.blob();
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export type LanTtsEngine = "indextts" | "voicestudio";

export type LanTtsRequest = {
    /** indextts = LAN GPU :7860；voicestudio = LAN VoiceStudio :3901 /generate */
    engine?: LanTtsEngine;
    emoMethod?: number;
    emoWeight?: number;
    emoText?: string;
    emoVector?: number[];
    emoRandom?: boolean;
    emoAudio?: File;
    maxTextTokens?: number;
    doSample?: boolean;
    topP?: number;
    topK?: number;
    temperature?: number;
    lengthPenalty?: number;
    numBeams?: number;
    repetitionPenalty?: number;
    maxMelTokens?: number;
    onStatus?: (status: string, message: string) => void;
};

export async function requestLanTts(prompt: string, reference: File, signal?: AbortSignal, extra?: LanTtsRequest) {
    const body = new FormData();
    body.set("text", prompt);
    body.set("reference", reference, reference.name || "reference.wav");
    body.set("engine", extra?.engine === "voicestudio" ? "voicestudio" : "indextts");
    if (extra?.emoMethod != null) body.set("emo_control_method", String(extra.emoMethod));
    if (extra?.emoWeight != null) body.set("emo_weight", String(extra.emoWeight));
    if (extra?.emoText != null) body.set("emo_text", extra.emoText);
    if (extra?.emoVector?.length) body.set("emo_vector", extra.emoVector.join(","));
    if (extra?.emoRandom != null) body.set("emo_random", extra.emoRandom ? "1" : "0");
    if (extra?.emoAudio) body.set("emo_audio", extra.emoAudio, extra.emoAudio.name || "emotion.wav");
    if (extra?.maxTextTokens != null) body.set("max_text_tokens_per_segment", String(extra.maxTextTokens));
    if (extra?.doSample != null) body.set("do_sample", extra.doSample ? "1" : "0");
    if (extra?.topP != null) body.set("top_p", String(extra.topP));
    if (extra?.topK != null) body.set("top_k", String(extra.topK));
    if (extra?.temperature != null) body.set("temperature", String(extra.temperature));
    if (extra?.lengthPenalty != null) body.set("length_penalty", String(extra.lengthPenalty));
    if (extra?.numBeams != null) body.set("num_beams", String(extra.numBeams));
    if (extra?.repetitionPenalty != null) body.set("repetition_penalty", String(extra.repetitionPenalty));
    if (extra?.maxMelTokens != null) body.set("max_mel_tokens", String(extra.maxMelTokens));
    const jobId = await postJob("/canvas-lan/tts", body, signal);
    extra?.onStatus?.("pending", "");
    await waitForJob(jobId, 20 * 60 * 1000, signal, (job) => extra?.onStatus?.(job.status, job.message || ""));
    const blob = await downloadOutput(jobId, signal);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" });
}

export type LanVoiceDesignRequest = {
    mode: "describe" | "generate";
    text: string;
    description: string;
    attrs: LanVoiceDesignAttrs;
    seed?: string;
    onStatus?: (status: string, message: string) => void;
};

export function requestLanVoiceDesign(input: LanVoiceDesignRequest, signal?: AbortSignal) {
    return trackApiCall(
        {
            capability: "audio",
            action: input.mode,
            provider: "voicestudio",
            model: "voice-design",
            endpoint: "/canvas-lan/voice-design",
            parameters: {
                mode: input.mode,
                prompt: clipText(input.text),
                description: clipText(input.description),
                gender: input.attrs.Gender,
                age: input.attrs.Age,
                pitch: input.attrs.Pitch,
                style: input.attrs.Style,
                accent: input.attrs.EnglishAccent,
                dialect: input.attrs.ChineseDialect,
                seed: input.seed || "",
            },
        },
        () => requestLanVoiceDesignBody(input, signal),
    );
}

async function requestLanVoiceDesignBody(input: LanVoiceDesignRequest, signal?: AbortSignal) {
    const body = new FormData();
    body.set("mode", input.mode);
    body.set("text", input.text);
    body.set("description", input.description);
    body.set("gender", input.attrs.Gender || "Auto");
    body.set("age", input.attrs.Age || "Auto");
    body.set("pitch", input.attrs.Pitch || "Auto");
    body.set("style", input.attrs.Style || "Auto");
    body.set("accent", input.attrs.EnglishAccent || "Auto");
    body.set("dialect", input.attrs.ChineseDialect || "Auto");
    if (input.seed?.trim()) body.set("seed", input.seed.trim());
    const jobId = await postJob("/canvas-lan/voice-design", body, signal);
    input.onStatus?.("pending", "");
    const job = await waitForJob(jobId, 20 * 60 * 1000, signal, (status) => input.onStatus?.(status.status, status.message || ""));
    if (input.mode === "describe") return { blob: null as Blob | null, design: job.design };
    const audio = await downloadOutput(jobId, signal);
    return { blob: audio.type.startsWith("audio/") ? audio : new Blob([audio], { type: "audio/wav" }), design: job.design };
}

export type LanAsrRequest = {
    model?: string;
    language?: string;
    prompt?: string;
    onStatus?: (status: string, message: string) => void;
};

export async function requestLanAsr(audio: File | Blob, signal?: AbortSignal, extra?: LanAsrRequest): Promise<LanAsrTranscript> {
    const body = new FormData();
    const file = audio instanceof File ? audio : new File([audio], "audio.wav", { type: audio.type || "audio/wav" });
    body.set("audio", file, file.name || "audio.wav");
    body.set("model", (extra?.model || "whisper-1").trim() || "whisper-1");
    if (extra?.language?.trim()) body.set("language", extra.language.trim());
    if (extra?.prompt?.trim()) body.set("prompt", extra.prompt.trim());
    const jobId = await postJob("/canvas-lan/asr", body, signal);
    extra?.onStatus?.("pending", "");
    const job = await waitForJob(jobId, 30 * 60 * 1000, signal, (status) => extra?.onStatus?.(status.status, status.message || ""));
    if (!job.transcript || typeof job.transcript !== "object") {
        throw new Error(apiText("lanAsrEmpty"));
    }
    return job.transcript;
}

export type LanVoiceConvertRequest = {
    /** Keep source pitch contour (singing). Default true. */
    f0Condition?: boolean;
    diffusionSteps?: number;
    inferenceCfgRate?: number;
    autoF0Adjust?: boolean;
    pitchShift?: number;
    lengthAdjust?: number;
    onStatus?: (status: string, message: string) => void;
};

/** Lyric remake: SVS guide (new lyrics + dry F0) then Seed-VC to reference timbre. */
export async function requestLanSvsRemake(
    lyrics: string,
    melody: File | Blob,
    reference: File | Blob,
    signal?: AbortSignal,
    extra?: { diffusionSteps?: number; onStatus?: (status: string, message: string) => void },
) {
    const text = lyrics.trim();
    if (!text) throw new Error(apiText("requestFailed"));
    const body = new FormData();
    const melodyFile = melody instanceof File ? melody : new File([melody], "melody.wav", { type: melody.type || "audio/wav" });
    const refFile = reference instanceof File ? reference : new File([reference], "reference.wav", { type: reference.type || "audio/wav" });
    body.set("lyrics", text);
    body.set("melody", melodyFile, melodyFile.name || "melody.wav");
    body.set("reference", refFile, refFile.name || "reference.wav");
    body.set("diffusion_steps", String(extra?.diffusionSteps ?? 25));
    const jobId = await postJob("/canvas-lan/svs-remake", body, signal);
    extra?.onStatus?.("pending", "");
    await waitForJob(jobId, 45 * 60 * 1000, signal, (job) => extra?.onStatus?.(job.status, job.message || ""));
    const blob = await downloadOutput(jobId, signal);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" });
}

/** Seed-VC: source dry vocal / singing + reference timbre → converted wav. */
export async function requestLanVoiceConvert(
    source: File | Blob,
    reference: File | Blob,
    signal?: AbortSignal,
    extra?: LanVoiceConvertRequest,
) {
    const body = new FormData();
    const sourceFile = source instanceof File ? source : new File([source], "source.wav", { type: source.type || "audio/wav" });
    const refFile = reference instanceof File ? reference : new File([reference], "reference.wav", { type: reference.type || "audio/wav" });
    body.set("source", sourceFile, sourceFile.name || "source.wav");
    body.set("reference", refFile, refFile.name || "reference.wav");
    body.set("f0_condition", extra?.f0Condition === false ? "0" : "1");
    body.set("diffusion_steps", String(extra?.diffusionSteps ?? 40));
    body.set("inference_cfg_rate", String(extra?.inferenceCfgRate ?? 0.7));
    body.set("auto_f0_adjust", extra?.autoF0Adjust ? "1" : "0");
    body.set("pitch_shift", String(extra?.pitchShift ?? 0));
    body.set("length_adjust", String(extra?.lengthAdjust ?? 1));
    const jobId = await postJob("/canvas-lan/voice-convert", body, signal);
    extra?.onStatus?.("pending", "");
    await waitForJob(jobId, 45 * 60 * 1000, signal, (job) => extra?.onStatus?.(job.status, job.message || ""));
    const blob = await downloadOutput(jobId, signal);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" });
}

/** Seed-VC Gradio page (:17860): source audio + reference timbre → full wav. */
export async function requestLanSeedVc(
    source: File | Blob,
    reference: File | Blob,
    signal?: AbortSignal,
    extra?: { diffusionSteps?: number; lengthAdjust?: number; inferenceCfgRate?: number; onStatus?: (status: string, message: string) => void },
) {
    const body = new FormData();
    const sourceFile = source instanceof File ? source : new File([source], "source.wav", { type: source.type || "audio/wav" });
    const refFile = reference instanceof File ? reference : new File([reference], "reference.wav", { type: reference.type || "audio/wav" });
    body.set("source", sourceFile, sourceFile.name || "source.wav");
    body.set("reference", refFile, refFile.name || "reference.wav");
    body.set("diffusion_steps", String(extra?.diffusionSteps ?? 10));
    body.set("length_adjust", String(extra?.lengthAdjust ?? 1));
    body.set("inference_cfg_rate", String(extra?.inferenceCfgRate ?? 0.7));
    const jobId = await postJob("/canvas-lan/seed-vc", body, signal);
    extra?.onStatus?.("pending", "");
    await waitForJob(jobId, 45 * 60 * 1000, signal, (job) => extra?.onStatus?.(job.status, job.message || ""));
    const blob = await downloadOutput(jobId, signal);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" });
}

export async function requestLanComfy(
    input: {
        prompt: string;
        mode: "t2v" | "i2v" | "r2v";
        duration: number;
        aspect: string;
        megapixels?: number;
        seed?: number;
        workflow?: "h3-face" | "h3-goldfish";
        quality?: string;
        deoil?: number;
        image?: File;
        image2?: File;
        images?: File[];
        videos?: File[];
        audios?: File[];
        lastFrame?: File;
    },
    signal?: AbortSignal,
) {
    const body = new FormData();
    body.set("prompt", input.prompt);
    body.set("mode", input.mode);
    body.set("duration", String(input.duration));
    body.set("aspect", input.aspect);
    body.set("megapixels", String(Math.max(0.1, Math.min(16, Number(input.megapixels) || 0.4))));
    if (input.seed != null && Number.isFinite(input.seed) && input.seed >= 0) body.set("seed", String(Math.floor(input.seed)));
    if (input.workflow) body.set("workflow", input.workflow);
    if (input.quality) body.set("quality", input.quality);
    if (input.deoil != null && Number.isFinite(input.deoil)) body.set("deoil", String(input.deoil));
    const images = input.images?.length ? input.images : [input.image, input.image2].filter((file): file is File => Boolean(file));
    images.slice(0, 9).forEach((file, index) => {
        const field = index === 0 ? "image" : index === 1 ? "image2" : `image${index + 1}`;
        body.set(field, file, file.name || `image-${index + 1}.png`);
    });
    (input.videos || []).slice(0, 3).forEach((file, index) => {
        const field = index === 0 ? "video" : `video${index + 1}`;
        body.set(field, file, file.name || `video-${index + 1}.mp4`);
    });
    (input.audios || []).slice(0, 3).forEach((file, index) => {
        const field = index === 0 ? "audio" : `audio${index + 1}`;
        body.set(field, file, file.name || `audio-${index + 1}.wav`);
    });
    if (input.lastFrame) body.set("last_frame", input.lastFrame, input.lastFrame.name || "last.png");
    const jobId = await postJob("/canvas-lan/comfy", body, signal);
    // Worker Comfy wait defaults to 60m (+ soft extension); keep frontend ahead of that.
    await waitForJob(jobId, 75 * 60 * 1000, signal);
    const blob = await downloadOutput(jobId, signal);
    return blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
}
