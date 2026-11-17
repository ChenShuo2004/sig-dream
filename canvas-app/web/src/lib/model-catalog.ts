export type ModelCategory = "text" | "image" | "vision" | "video" | "audio" | "embedding" | "other";

const VENDORS: Array<{ label: string; keys: string[] }> = [
    { label: "Anthropic", keys: ["claude"] },
    { label: "Google", keys: ["gemini", "imagen", "veo"] },
    { label: "xAI", keys: ["grok"] },
    { label: "DeepSeek", keys: ["deepseek"] },
    { label: "阿里", keys: ["qwen", "qwq", "tongyi"] },
    { label: "智谱", keys: ["glm", "cogview", "cogvideo", "chatglm"] },
    { label: "月之暗面", keys: ["moonshot", "kimi"] },
    { label: "MiniMax", keys: ["minimax", "hailuo", "abab", "h3"] },
    { label: "字节", keys: ["doubao", "seedance", "seedream", "jimeng"] },
    { label: "可灵", keys: ["kling"] },
    { label: "万相", keys: ["wan2", "wan-", "aigc-video-wan"] },
    { label: "Black Forest", keys: ["flux"] },
    { label: "Midjourney", keys: ["midjourney", "mj-"] },
    { label: "Ideogram", keys: ["ideogram"] },
    { label: "Recraft", keys: ["recraft"] },
    { label: "Runway", keys: ["runway"] },
    { label: "Luma", keys: ["luma"] },
    { label: "Vidu", keys: ["vidu"] },
    { label: "Suno", keys: ["suno"] },
    { label: "腾讯", keys: ["hunyuan"] },
    { label: "Meta", keys: ["llama"] },
    { label: "Mistral", keys: ["mistral", "mixtral", "codestral"] },
    { label: "BAAI", keys: ["bge-", "baai/", "/bge"] },
    { label: "零一万物", keys: ["yi-", "/yi-"] },
    { label: "阶跃星辰", keys: ["step-"] },
    { label: "Cohere", keys: ["command-r", "cohere"] },
    { label: "OpenAI", keys: ["gpt-", "gpt_", "dall-e", "dalle", "whisper", "babbage", "davinci", "text-embedding", "chatgpt", "sora", "o1-", "o3-", "o4-", "-tts"] },
];

const IMAGE_KEYS = ["image", "imagen", "flux", "dall-e", "dalle", "midjourney", "ideogram", "recraft", "cogview", "seedream", "kolors", "stable-diffusion", "gpt-image", "sdxl", "sd3"];
const VIDEO_KEYS = ["video", "sora", "veo", "seedance", "viraldance", "runway", "luma", "vidu", "cogvideo", "hailuo", "wan2", "wan-", "wan3", "gen-3", "kling", "h3", "grok-imagine", "omni-fast", "manxue"];
const AUDIO_KEYS = ["audio", "tts", "whisper", "suno", "speech", "asr", "voice"];
const EMBED_KEYS = ["embed", "rerank", "bge"];
const VISION_KEYS = ["vision", "-vl", "vl-", "/vl", "llava", "internvl", "minicpm", "glm-4v", "qwen-vl", "gpt-4o", "omni", "claude-3", "claude-opus", "claude-sonnet", "claude-haiku", "claude-fable", "gemini"];

function hasKey(value: string, keys: string[]) {
    return keys.some((key) => value.includes(key));
}

export function modelVendor(name: string) {
    const value = name.toLowerCase();
    return VENDORS.find((vendor) => hasKey(value, vendor.keys))?.label || "其他";
}

export function modelCategories(name: string): ModelCategory[] {
    const value = name.toLowerCase();
    if (hasKey(value, IMAGE_KEYS)) return ["image"];
    if (hasKey(value, VIDEO_KEYS)) return ["video"];
    if (hasKey(value, AUDIO_KEYS)) return ["audio"];
    if (hasKey(value, EMBED_KEYS)) return ["embedding"];
    const categories: ModelCategory[] = ["text"];
    if (hasKey(value, VISION_KEYS) && !value.includes("imagen")) categories.push("vision");
    return categories;
}
