/** Cut a time range out of an audio or video blob. Audio becomes WAV; video becomes an MP4 of that range. */

export async function trimMediaBlob(blob: Blob, kind: "audio" | "video", startSec: number, endSec: number) {
    if (!(endSec > startSec)) throw new Error("range");
    if (kind === "audio" || blob.type.startsWith("audio/")) return trimAudioBlob(blob, startSec, endSec);
    return trimVideoBlob(blob, startSec, endSec);
}

async function trimAudioBlob(blob: Blob, startSec: number, endSec: number) {
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        const start = Math.max(0, Math.min(startSec, decoded.duration));
        const end = Math.max(start, Math.min(endSec, decoded.duration));
        const startFrame = Math.floor(start * decoded.sampleRate);
        const endFrame = Math.max(startFrame + 1, Math.floor(end * decoded.sampleRate));
        const length = endFrame - startFrame;
        const sliced = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
            sliced.getChannelData(channel).set(decoded.getChannelData(channel).subarray(startFrame, endFrame));
        }
        return audioBufferToWav(sliced);
    } finally {
        await context.close().catch(() => undefined);
    }
}

async function trimVideoBlob(blob: Blob, startSec: number, endSec: number) {
    try {
        return await trimVideoFile(blob, startSec, endSec);
    } catch (error) {
        if (error instanceof Error && error.message === "range") throw error;
        try {
            return await trimVideoFrames(blob, startSec, endSec);
        } catch (frameError) {
            if (frameError instanceof Error && (frameError.message === "range" || frameError.message === "unsupported")) throw frameError;
            throw error instanceof Error && error.message && error.message !== "fallback" ? error : new Error("unsupported");
        }
    }
}

async function trimVideoFile(blob: Blob, startSec: number, endSec: number) {
    const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } = await import("mediabunny");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    try {
        const duration = await input.computeDuration().catch(() => Number.NaN);
        const end = Number.isFinite(duration) ? Math.min(endSec, Math.max(0, duration - 0.01)) : endSec;
        if (Number.isFinite(duration) && startSec >= duration - 0.05) throw new Error("range");
        if (!(end > startSec)) throw new Error("range");
        const videoTrack = await input.getPrimaryVideoTrack();
        const displayWidth = videoTrack?.displayWidth || 0;
        const conversion = await Conversion.init({
            input,
            output,
            tracks: "primary",
            showWarnings: false,
            trim: { start: startSec, end },
            video: { codec: "avc", quality: new Quality("medium"), ...(displayWidth > 1280 ? { width: 1280 } : {}) },
            audio: { codec: "aac", quality: new Quality("medium") },
        });
        if (!conversion.isValid || !conversion.utilizedTracks.some((track) => track.isVideoTrack())) throw new Error("fallback");
        let touchedAt = Date.now();
        conversion.onProgress = () => {
            touchedAt = Date.now();
        };
        const watchdog = window.setInterval(() => {
            if (Date.now() - touchedAt > 20000) void conversion.cancel();
        }, 2000);
        try {
            await conversion.execute();
        } finally {
            window.clearInterval(watchdog);
        }
        if (!target.buffer?.byteLength) throw new Error("read");
        return new Blob([target.buffer], { type: "video/mp4" });
    } finally {
        input.dispose();
    }
}

async function trimVideoFrames(blob: Blob, startSec: number, endSec: number) {
    const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } = await import("mediabunny");
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
        await waitFor(video, "loadedmetadata", 8000);
        if (!Number.isFinite(video.duration) || startSec >= video.duration - 0.05) throw new Error("range");
        const end = Math.min(endSec, Math.max(0, video.duration - 0.01));
        if (!(end > startSec)) throw new Error("range");
        const sourceWidth = video.videoWidth || 0;
        const sourceHeight = video.videoHeight || 0;
        if (sourceWidth < 2 || sourceHeight < 2) throw new Error("read");
        const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = evenSize(sourceWidth * scale);
        canvas.height = evenSize(sourceHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("unsupported");
        const target = new BufferTarget();
        const output = new Output({ format: new Mp4OutputFormat(), target });
        const frames = new CanvasSource(canvas, { codec: "avc", quality: new Quality("medium") });
        const fps = 12;
        output.addVideoTrack(frames, { frameRate: fps });
        const audioBuffer = await sliceAudioRange(blob, startSec, end);
        const audio = audioBuffer ? new AudioBufferSource({ codec: "aac", quality: new Quality("medium") }) : null;
        if (audio) output.addAudioTrack(audio);
        await output.start();
        const count = Math.max(1, Math.round((end - startSec) * fps));
        const step = (end - startSec) / count;
        for (let index = 0; index < count; index += 1) {
            await seekTo(video, Math.min(end - 0.02, startSec + index * step));
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            await frames.add(index / fps, 1 / fps, index % fps === 0 ? { keyFrame: true } : undefined);
        }
        if (audio && audioBuffer) await audio.add(audioBuffer);
        frames.close();
        audio?.close();
        await output.finalize();
        if (!target.buffer?.byteLength) throw new Error("read");
        return new Blob([target.buffer], { type: "video/mp4" });
    } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

function evenSize(value: number) {
    return Math.max(2, Math.round(value) & ~1);
}

async function sliceAudioRange(blob: Blob, startSec: number, endSec: number) {
    if (blob.size > 40 * 1024 * 1024) return null;
    const context = new AudioContext();
    const pending = blob
        .arrayBuffer()
        .then((data) => context.decodeAudioData(data))
        .catch(() => null);
    try {
        const decoded = await Promise.race([pending, waitMs(5000).then(() => null)]);
        if (!decoded) return null;
        const start = Math.max(0, Math.min(startSec, decoded.duration));
        const end = Math.max(start, Math.min(endSec, decoded.duration));
        const startFrame = Math.floor(start * decoded.sampleRate);
        const endFrame = Math.max(startFrame + 1, Math.floor(end * decoded.sampleRate));
        const sliced = context.createBuffer(decoded.numberOfChannels, endFrame - startFrame, decoded.sampleRate);
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) sliced.getChannelData(channel).set(decoded.getChannelData(channel).subarray(startFrame, endFrame));
        return sliced;
    } finally {
        await context.close().catch(() => undefined);
    }
}

function waitMs(timeoutMs: number) {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
    });
}

function waitFor(video: HTMLVideoElement, eventName: "loadedmetadata", timeoutMs: number) {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        let timer = 0;
        const finish = () => {
            window.clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            window.clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            reject(new Error("read"));
        };
        timer = window.setTimeout(fail, timeoutMs);
        video.addEventListener(eventName, finish);
        video.addEventListener("error", fail);
    });
}

function seekTo(video: HTMLVideoElement, time: number) {
    const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));
    if (Math.abs(video.currentTime - target) < 0.05 && video.readyState >= 2) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        let timer = 0;
        const finish = () => {
            window.clearTimeout(timer);
            video.onseeked = null;
            resolve();
        };
        timer = window.setTimeout(finish, 2000);
        video.onseeked = finish;
        video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("read"));
        };
        video.currentTime = target;
    });
}

function audioBufferToWav(buffer: AudioBuffer) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = samples * blockAlign;
    const view = new DataView(new ArrayBuffer(44 + dataSize));
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    let offset = 44;
    for (let i = 0; i < samples; i += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][i] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([view], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
