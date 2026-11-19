import { computeVideoSize, inferVideoRatio } from "@/lib/media-size";

export type GeeknowVideoInput = {
    model: string;
    prompt: string;
    seconds: number;
    size: string;
    resolution: string;
    mode: "frames" | "reference";
    images: string[];
    videos: string[];
    audios: string[];
};

export function buildGeeknowVideoBody(input: GeeknowVideoInput): Record<string, unknown> {
    const model = input.model.trim();
    const name = model.toLowerCase();
    const prompt = input.prompt.trim();
    const seconds = Math.round(Number(input.seconds) || 0);
    const ratio = inferVideoRatio(input.size || "auto");
    const reference = input.mode === "reference" || input.images.length > 2 || input.videos.length > 0 || input.audios.length > 0;
    if (name.includes("minimax-h3")) return minimaxBody(model, prompt, seconds, ratio, reference, input);
    if (name.includes("manxue-2.5")) return manxue25Body(model, prompt, seconds, ratio, input);
    if (name.includes("manxue-2")) return manxue20Body(model, prompt, seconds, ratio, input.resolution, reference, input);
    if (name.includes("mini-2.0")) return mini20Body(model, prompt, seconds, ratio, input);
    if (name.includes("wan3")) return wanBody(model, prompt, seconds, ratio, input.resolution, reference, input);
    if (name.includes("omni-fast")) return omniBody(model, prompt, seconds, ratio, name.includes("v2v"), reference, input);
    if (name.includes("grok-imagine")) return grokBody(model, prompt, seconds, ratio, input.resolution, name.includes("1.5") || name.includes("1-5"), input);
    if (name.includes("seedance-2-0") || name.includes("seedance-2.0") || name.includes("doubao-seedance-2")) return seedance2Body(model, prompt, seconds, ratio, input.resolution, reference, input);
    if (name.includes("seedance-1-5") || name.includes("seedance-1.5")) return seedance15Body(model, prompt, seconds, ratio, input);
    if (name.includes("sora") || name.includes("veo")) return openVideoBody(model, prompt, seconds, ratio, input.resolution, input);
    return genericBody(model, prompt, seconds, ratio, input.resolution, input);
}

function minimaxBody(model: string, prompt: string, seconds: number, ratio: string, reference: boolean, input: GeeknowVideoInput) {
    if (prompt.length > 7000) throw new Error("MiniMax H3 提示词最多 7000 字");
    const duration = requireSeconds(seconds, 1, 15, "MiniMax H3");
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (reference) {
        if (input.images.length + input.videos.length + input.audios.length > 12) throw new Error("MiniMax H3 参考素材最多 12 个");
        if (input.videos.length > 3) throw new Error("MiniMax H3 最多 3 段参考视频");
        if (input.audios.length > 3) throw new Error("MiniMax H3 最多 3 段参考音频");
        input.images.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
        input.videos.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
        input.audios.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    } else {
        if (input.images[0]) content.push({ type: "image_url", image_url: { url: input.images[0] }, role: "first_frame" });
        if (input.images[1]) content.push({ type: "image_url", image_url: { url: input.images[1] }, role: "last_frame" });
    }
    return {
        model,
        content,
        resolution: "768P",
        duration,
        ratio: pickRatio(ratio, ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], "16:9"),
    };
}

function manxue25Body(model: string, prompt: string, seconds: number, ratio: string, input: GeeknowVideoInput) {
    if (!input.images.length) throw new Error("这个模型必须上传参考图");
    if (input.images.length > 30) throw new Error("这个模型最多 30 张参考图");
    if (input.videos.length || input.audios.length) throw new Error("这个模型不支持参考视频或参考音频");
    if (seconds !== 30) throw new Error("这个模型只支持 30 秒");
    return {
        model,
        prompt,
        seconds: 30,
        ratio: pickRatio(ratio, ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"], "16:9"),
        images: input.images,
    };
}

function manxue20Body(model: string, prompt: string, seconds: number, ratio: string, resolution: string, reference: boolean, input: GeeknowVideoInput) {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (reference || input.images.length > 2) {
        input.images.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
    } else {
        if (input.images[0]) content.push({ type: "image_url", image_url: { url: input.images[0] }, role: "first_frame" });
        if (input.images[1]) content.push({ type: "image_url", image_url: { url: input.images[1] }, role: "last_frame" });
    }
    input.audios.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    if (input.videos.length) throw new Error("这个模型不支持参考视频");
    return {
        model,
        prompt,
        seconds: requireSeconds(seconds, 4, 15, "这个模型"),
        resolution: pickResolution(resolution, ["480P", "720P"]),
        ratio: pickRatio(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], "16:9"),
        content,
    };
}

function mini20Body(model: string, prompt: string, seconds: number, ratio: string, input: GeeknowVideoInput) {
    if (input.images.length > 9) throw new Error("这个模型最多 9 张参考图");
    if (input.videos.length || input.audios.length) throw new Error("这个模型不支持参考视频或参考音频");
    return {
        model,
        prompt,
        duration: requireSeconds(seconds, 4, 15, "这个模型"),
        ratio: pickRatio(ratio, ["16:9", "9:16"], "16:9"),
        resolution: "480p",
        ...(input.images.length ? { images: input.images } : {}),
    };
}

function wanBody(model: string, prompt: string, seconds: number, ratio: string, resolution: string, reference: boolean, input: GeeknowVideoInput) {
    const body: Record<string, unknown> = {
        model,
        prompt,
        seconds: requireSeconds(seconds, 2, 30, "Wan 3.0"),
        size: pickResolution(resolution, ["480P", "720P", "1080P"]),
        aspect_ratio: pickRatio(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], "16:9"),
    };
    if (reference || input.videos.length || input.audios.length || input.images.length > 2) {
        if (input.images.length > 10) throw new Error("Wan 3.0 最多 10 张参考图");
        if (input.videos.length > 5) throw new Error("Wan 3.0 最多 5 段参考视频");
        if (input.audios.length > 5) throw new Error("Wan 3.0 最多 5 段参考音频");
        if (input.images.length) {
            body.images = input.images;
            body.mode = "all-reference";
        }
        body.metadata = {
            ...(input.images.length ? { reference_image_urls: input.images } : {}),
            ...(input.videos.length ? { reference_video_urls: input.videos } : {}),
            ...(input.audios.length ? { reference_audio_urls: input.audios, parameters: { audio: true } } : {}),
        };
        return body;
    }
    if (input.images.length === 2) {
        body.mode = "first-last-frame";
        body.image = input.images[0];
        body.images = [input.images[1]];
        body.metadata = { first_frame_url: input.images[0], last_frame_url: input.images[1] };
        return body;
    }
    if (input.images.length === 1) body.image = input.images[0];
    return body;
}

function omniBody(model: string, prompt: string, seconds: number, ratio: string, videoToVideo: boolean, reference: boolean, input: GeeknowVideoInput) {
    if (input.images.length > 5) throw new Error("这个模型最多 5 张参考图");
    if (!videoToVideo && input.videos.length) throw new Error("参考视频请改用 omni-fast-v2v");
    if (input.videos.length > 1) throw new Error("这个模型只支持 1 段参考视频");
    const body: Record<string, unknown> = {
        model,
        prompt,
        seconds: requireSeconds(seconds, 4, 30, "这个模型"),
        aspect_ratio: pickRatio(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], "16:9"),
    };
    if (reference) {
        if (input.images.length) body.images = input.images;
    } else {
        if (input.images[0]) body.first_image_url = input.images[0];
        if (input.images[1]) body.last_image_url = input.images[1];
    }
    if (videoToVideo && input.videos[0]) body.video = input.videos[0];
    return body;
}

function grokBody(model: string, prompt: string, seconds: number, ratio: string, resolution: string, imagesOnly: boolean, input: GeeknowVideoInput) {
    if (prompt.length > 4096) throw new Error("Grok 提示词最多 4096 字");
    if (input.images.length > 7) throw new Error("Grok 最多 7 张参考图");
    if (input.videos.length || input.audios.length) throw new Error("Grok 不支持参考视频或参考音频");
    const body: Record<string, unknown> = {
        model,
        prompt,
        seconds: requireSeconds(seconds, 4, 15, "Grok"),
        resolution: pickResolution(resolution, ["480P", "720P"]),
        aspect_ratio: pickRatio(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], "16:9"),
    };
    if (imagesOnly || input.images.length > 1) body.images = input.images;
    else if (input.images.length === 1) body.image = input.images[0];
    return body;
}

function seedance2Body(model: string, prompt: string, seconds: number, ratio: string, resolution: string, reference: boolean, input: GeeknowVideoInput) {
    const body: Record<string, unknown> = {
        model,
        prompt,
        duration: requireSeconds(seconds, 2, 30, "Seedance 2.0"),
        aspect_ratio: pickRatio(ratio, ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], "16:9"),
        resolution: pickResolution(resolution, ["480P", "720P", "1080P"]),
        watermark: false,
    };
    if (reference || input.videos.length || input.audios.length || input.images.length > 2) {
        if (input.images.length) body.reference_image_urls = input.images;
        if (input.videos.length) body.reference_video_urls = input.videos;
        if (input.audios.length) {
            body.reference_audio_urls = input.audios;
            body.generate_audio = true;
        }
        return body;
    }
    if (input.images[0]) body.first_image = input.images[0];
    if (input.images[1]) body.last_image = input.images[1];
    return body;
}

function seedance15Body(model: string, prompt: string, seconds: number, ratio: string, input: GeeknowVideoInput) {
    if (input.videos.length || input.audios.length || input.images.length > 2) throw new Error("Seedance 1.5 使用首帧或首尾帧，不支持全能参考");
    return {
        model,
        prompt,
        seconds: requireSeconds(seconds, 4, 11, "Seedance 1.5"),
        size: pickRatio(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], "16:9"),
        ...(input.images[0] ? { first_frame_image: input.images[0] } : {}),
        ...(input.images[1] ? { last_frame_image: input.images[1] } : {}),
    };
}

function openVideoBody(model: string, prompt: string, seconds: number, ratio: string, resolution: string, input: GeeknowVideoInput) {
    const pixels = ratio === "auto" ? "1280x720" : computeVideoSize(resolution || "720", ratio);
    return {
        model,
        prompt,
        seconds: requireSeconds(seconds, 4, 20, "这个模型"),
        size: pixels,
        ...(input.images.length === 1 ? { input_reference: input.images[0] } : {}),
        ...(input.images.length > 1 ? { input_reference: input.images } : {}),
    };
}

function genericBody(model: string, prompt: string, seconds: number, ratio: string, resolution: string, input: GeeknowVideoInput) {
    return {
        model,
        prompt,
        seconds: requireSeconds(seconds, 2, 30, "这个模型"),
        ...(ratio !== "auto" ? { aspect_ratio: ratio } : {}),
        ...(resolution ? { size: resolution.toUpperCase().endsWith("P") ? resolution.toUpperCase() : `${resolution.replace(/p$/i, "")}P` } : {}),
        ...(input.images.length === 1 ? { image: input.images[0] } : {}),
        ...(input.images.length > 1 ? { images: input.images } : {}),
    };
}

function requireSeconds(seconds: number, min: number, max: number, label: string) {
    if (seconds < min || seconds > max) throw new Error(`${label}只支持 ${min} 到 ${max} 秒`);
    return seconds;
}

function pickRatio(ratio: string, allowed: string[], fallback: string) {
    if (!ratio || ratio === "auto") return fallback;
    if (allowed.includes(ratio)) return ratio;
    throw new Error(`这个模型只支持画面比例 ${allowed.join("、")}`);
}

function pickResolution(value: string, allowed: string[]) {
    const number = String(value || "").trim().replace(/p$/i, "") || "720";
    const match = allowed.find((item) => item.replace(/p$/i, "").toLowerCase() === number.toLowerCase());
    if (match) return match;
    throw new Error(`这个模型只支持分辨率 ${allowed.join("、")}`);
}
