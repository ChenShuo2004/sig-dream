import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    label?: string;
    price?: number;
    /** OnionCreate: per_task is one charge; per_second multiplies by duration. */
    billingMode?: "per_task" | "per_second";
    allowedDurations?: number[];
    allowedRatios?: string[];
    resolutions?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
    /** Empty means every canvas user. Otherwise only these usernames can see and call it. */
    allowedUsers?: string[];
};

export type ChannelApiKey = {
    id: string;
    label: string;
    key: string;
    /** Accounts that must call this channel with this key. */
    users: string[];
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiKeys?: ChannelApiKey[];
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    /** RunningHub instanceType: default(24G) | plus(48G); ultra/84G disabled. */
    runningHubInstanceType: string;
    /** Minimax H3 人脸「去油腻」LoRA strength_model（0–1，默认 0.4）。 */
    h3DeOilStrength: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
    proxyUrl: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "local-proxy" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
export const LAN_TTS_MODEL = "lan::indextts";
export const LAN_COMFY_MODEL = "lan::comfy-minimax-h3";
export const LAN_COMFY_FACE_MODEL = "lan::comfy-h3-face";
export const LAN_COMFY_GOLDFISH_MODEL = "lan::comfy-h3-goldfish";
export const LAN_COMFY_MODELS = [LAN_COMFY_MODEL, LAN_COMFY_FACE_MODEL, LAN_COMFY_GOLDFISH_MODEL] as const;

export function isLanTtsModel(value: string) {
    return value === LAN_TTS_MODEL;
}

export function isLanComfyModel(value: string) {
    return (LAN_COMFY_MODELS as readonly string[]).includes(value);
}

export function lanComfyWorkflow(value: string) {
    if (value === LAN_COMFY_FACE_MODEL) return "h3-face" as const;
    if (value === LAN_COMFY_GOLDFISH_MODEL) return "h3-goldfish" as const;
    return "";
}

export function isLanCanvasModel(value: string) {
    return isLanTtsModel(value) || isLanComfyModel(value);
}
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "frames",
    runningHubInstanceType: "default",
    h3DeOilStrength: "0.4",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "auto",
    background: "",
    count: "1",
    canvasImageCount: "3",
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    apiConfigNotice: string;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo", "seedance", "viraldance", "h3", "grok-imagine", "omni-fast", "manxue", "vidu"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (value.includes("hailuo-image")) return "image";
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    if (isLanTtsModel(value)) return "audio";
    if (isLanComfyModel(value)) return "video";
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const options = selectableModelsByCapability(config, capability);
    const saved = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const pick = (value: string | undefined) => {
        const model = (value || "").trim();
        if (!model) return "";
        if (options.includes(model)) return model;
        const normalized = normalizeModelOptionValue(model, config.channels);
        return normalized && options.includes(normalized) ? normalized : "";
    };
    return pick(currentModel) || pick(saved) || options[0] || "";
}

export function currentCanvasUsername() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { username?: unknown }) : null;
        return typeof parsed?.username === "string" ? parsed.username : "";
    } catch {
        return "";
    }
}

export function modelVisibleToUser(model: ChannelModel, username = currentCanvasUsername()) {
    const allowed = (model.allowedUsers || []).map((item) => item.trim()).filter(Boolean);
    if (!allowed.length) return true;
    return Boolean(username) && allowed.includes(username);
}

export function assertCurrentUserCanUseModel(config: AiConfig, value: string) {
    const raw = modelOptionName(value);
    if (!raw || isLanCanvasModel(raw)) return;
    const decoded = decodeChannelModel(value);
    const modelName = decoded?.model || raw;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === modelName));
    if (!channel) return;
    const model = channel.models.find((item) => item.name === modelName);
    if (!model || !modelVisibleToUser(model)) throw new Error("当前账号不能使用这个模型");
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    const models = config.channels.flatMap((channel) =>
        channel.models.filter((model) => model.capability === capability && modelVisibleToUser(model)).map((model) => encodeChannelModel(channel.id, model.name)),
    );
    if (capability === "audio") return [...models, LAN_TTS_MODEL];
    if (capability === "video") return [...models, ...LAN_COMFY_MODELS];
    return models;
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (isLanCanvasModel(model)) return Boolean(model.trim());
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && apiKeyForUser(channel).trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            importChannelCredentials: (input) => {
                const currentConfig = get().config;
                const result = upsertChannelCredentials(currentConfig, input);
                if (result.config !== currentConfig) set({ config: result.config });
                return { status: result.status, channelName: result.channelName };
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            apiConfigNotice: "",
            openConfigDialog: (shouldPromptContinue = false, tab = "channels") => {
                set({
                    isConfigOpen: true,
                    shouldPromptContinue: Boolean(shouldPromptContinue),
                    configTab: tab,
                    apiConfigNotice: "",
                });
            },
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoMode: config.videoMode === "reference" ? "reference" : "frames",
                        runningHubInstanceType: config.runningHubInstanceType || defaultConfig.runningHubInstanceType,
                        h3DeOilStrength: config.h3DeOilStrength || defaultConfig.h3DeOilStrength,
                        size: !config.size || config.size === "1:1" ? "auto" : config.size,
                        canvasImageCount: config.canvasImageCount || "3",
                        proxyEnabled: Boolean(config.proxyEnabled),
                        proxyUrl: config.proxyUrl || DEFAULT_LOCAL_PROXY_URL,
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const extra = typeof item === "string" ? {} : modelProfileFields(item);
        result.push({ name, capability, script, ...extra });
    }
    return result;
}

export function normalizeChannelApiKeys(keys: ChannelApiKey[] | undefined, defaultKey = ""): ChannelApiKey[] {
    const seenUsers = new Set<string>();
    const result: ChannelApiKey[] = [];
    const fallback = defaultKey.trim();
    for (const item of keys || []) {
        const key = (item?.key || "").trim();
        if (!key || key === fallback) continue;
        const users: string[] = [];
        for (const name of item?.users || []) {
            const username = name.trim();
            if (!username || seenUsers.has(username)) continue;
            seenUsers.add(username);
            users.push(username);
        }
        result.push({
            id: item?.id?.trim() || nanoid(),
            label: item?.label?.trim() || `Key ${result.length + 1}`,
            key,
            users,
        });
        if (result.length >= 20) break;
    }
    return result;
}

export function apiKeyForUser(channel: Pick<ModelChannel, "apiKey" | "apiKeys">, username = currentCanvasUsername()) {
    const assigned = (channel.apiKeys || []).find((item) => item.key.trim() && username && item.users.includes(username));
    return assigned?.key || channel.apiKey || "";
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const apiKey = channel?.apiKey || "";
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey,
        apiKeys: normalizeChannelApiKeys(channel?.apiKeys, apiKey),
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return { status: "updated", channelName: existing.name, config: { ...config, channels } };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return { status: "created", channelName: channel.name, config: { ...config, channels: [...config.channels, channel] } };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    try {
        return stripTrailingApiVersion(normalizeImportedBaseUrl(baseUrl));
    } catch {
        return stripTrailingApiVersion(baseUrl.trim().replace(/\/+$/, ""));
    }
}

function normalizeImportedBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

function stripTrailingApiVersion(baseUrl: string) {
    return baseUrl.replace(/\/v1$/i, "");
}

function importedChannelName(baseUrl: string) {
    const hostname = new URL(baseUrl).hostname;
    return hostname.replace(/^(?:www|api)\./i, "") || i18n.t("config.channels.newName");
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function channelModelOf(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    return channel?.models.find((model) => model.name === name);
}

export function modelOptionLabel(config: AiConfig, value: string) {
    if (isLanTtsModel(value)) return i18n.t("config.lan.tts");
    if (value === LAN_COMFY_FACE_MODEL) return i18n.t("config.lan.comfyFace");
    if (value === LAN_COMFY_GOLDFISH_MODEL) return i18n.t("config.lan.comfyGoldfish");
    if (isLanComfyModel(value)) return i18n.t("config.lan.comfy");
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const profile = channel?.models.find((model) => model.name === decoded.model);
    const title = profile?.label?.trim() || decoded.model;
    const points = typeof profile?.price === "number" ? ` · ${formatModelPoints(profile.price, profile.billingMode)}` : "";
    const station = channel?.name?.trim();
    return station ? `${station} · ${title}${points}` : `${title}${points}`;
}

export function formatModelPoints(price: number, billingMode?: string) {
    const rounded = Math.round(price * 100) / 100;
    const count = Number.isInteger(rounded) ? String(rounded) : String(rounded);
    return i18n.t(billingMode === "per_second" ? "config.modelSelect.pointsPerSecond" : "config.modelSelect.points", { count });
}

function modelProfileFields(model: ChannelModel): Partial<ChannelModel> {
    const numbers = (value: number[] | undefined) => (Array.isArray(value) ? value.filter((item) => Number.isFinite(item)) : undefined);
    const texts = (value: string[] | undefined) => (Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : undefined);
    const count = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
    return {
        label: model.label?.trim() || undefined,
        price: count(model.price),
        billingMode: model.billingMode === "per_second" || model.billingMode === "per_task" ? model.billingMode : undefined,
        allowedDurations: numbers(model.allowedDurations),
        allowedRatios: texts(model.allowedRatios),
        resolutions: Array.isArray(model.resolutions) ? model.resolutions.map((item) => item.trim()).filter(Boolean) : undefined,
        maxImages: count(model.maxImages),
        maxVideos: count(model.maxVideos),
        maxAudios: count(model.maxAudios),
        allowedUsers: (() => {
            const names = texts(model.allowedUsers);
            return names && names.length ? names : undefined;
        })(),
    };
}

export function replaceConfigChannels(config: AiConfig, rawChannels: ModelChannel[]): AiConfig {
    const channels = rawChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
        }),
    );
    if (!channels.length) return config;
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || "",
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    const pick = (capability: ModelCapability, current: string) => {
        const options = selectableModelsByCapability(next, capability);
        const normalized = normalizeModelOptionValue(current, channels);
        return options.includes(normalized) ? normalized : options[0] || "";
    };
    return {
        ...next,
        imageModel: pick("image", config.imageModel),
        videoModel: pick("video", config.videoModel),
        textModel: pick("text", config.textModel),
        audioModel: pick("audio", config.audioModel),
    };
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: apiKeyForUser(channel),
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Prefix an outgoing request with the local forwarding proxy so the browser is not blocked by CORS. */
export function withLocalProxy(url: string) {
    const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
    if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base || url.startsWith(`${base}/`)) return url;
    return `${base}/${url}`;
}
