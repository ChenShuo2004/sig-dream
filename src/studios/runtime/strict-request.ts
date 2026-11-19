import { requestStructuredText, type AiTextMessage } from "@/services/api/image";
import { useConfigStore } from "@/stores/use-config-store";

export { fillTemplate, type TemplateVars } from "./template";

export class StrictResultError extends Error {
    validationDetails?: unknown;
    constructor(message: string, validationDetails?: unknown) {
        super(message);
        this.validationDetails = validationDetails;
    }
}

export function parseStrictJson(text: string): unknown {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new StrictResultError("模型没有返回内容。");
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [trimmed, fenced?.[1]?.trim(), extractBalancedObject(trimmed)].filter(Boolean) as string[];
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            /* try next candidate */
        }
    }
    throw new StrictResultError("模型返回的不是合法 JSON。");
}

function extractBalancedObject(text: string) {
    const start = text.search(/[{[]/);
    if (start < 0) return "";
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === open) depth += 1;
        else if (char === close) {
            depth -= 1;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }
    return "";
}

export function expectObject(value: unknown, label = "结果"): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new StrictResultError(`${label}必须是 JSON 对象。`);
    return value as Record<string, unknown>;
}

export function expectArray(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new StrictResultError(`${label}必须是数组。`);
    return value;
}

export function readText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    return "";
}

export function readTextList(value: unknown) {
    if (Array.isArray(value)) return value.map(readText).filter(Boolean);
    const text = readText(value);
    return text ? [text] : [];
}

export type StrictAttempt = { attempt: number; prompt: string; response?: string; error?: string };

export type StrictRequest<T> = {
    model: string;
    systemPrompt: string;
    payload: Record<string, unknown> | string;
    parse: (value: unknown, raw: string) => T;
    schemaName?: string;
    schema?: Record<string, unknown>;
    outputContract?: unknown;
    temperature?: number;
    retryTemperature?: number;
    maxOutputTokens?: number;
    maxAttempts?: number;
    repairInstruction?: string;
    images?: string[];
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
    onAttempt?: (attempt: StrictAttempt) => void;
};

function serializePayload(payload: Record<string, unknown> | string) {
    return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function buildRetryPrompt(originalPrompt: string, error: unknown, rejectedResponse: string, instruction: string, outputContract: unknown) {
    let originalRequest: unknown = originalPrompt;
    try {
        originalRequest = JSON.parse(originalPrompt);
    } catch {
        /* non-JSON prompt stays as text */
    }
    const details = error instanceof StrictResultError ? error.validationDetails : undefined;
    return JSON.stringify({
        task: "repair_invalid_agent_response",
        originalRequest,
        rejectionReason: readText(error instanceof Error ? error.message : error),
        ...(details ? { validationDetails: details } : {}),
        rejectedResponse: readText(rejectedResponse),
        instruction: readText(instruction) || "重新执行原任务，只返回符合要求的严格 JSON 对象。",
        outputContract,
    });
}

function userMessage(prompt: string, images: string[] | undefined): AiTextMessage {
    if (!images?.length) return { role: "user", content: prompt };
    return { role: "user", content: [...images.map((url) => ({ type: "image_url" as const, image_url: { url } })), { type: "text" as const, text: prompt }] };
}

export function studioModelConfig(model: string) {
    const config = useConfigStore.getState().config;
    const selected = model || config.textModel;
    if (!selected) throw new Error("请先在工作室设置里选择文本模型。");
    return { ...config, model: selected };
}

export async function requestStrictResult<T>(request: StrictRequest<T>): Promise<{ result: T; raw: string }> {
    const config = studioModelConfig(request.model);
    const maxAttempts = Math.max(1, request.maxAttempts ?? 2);
    const originalPrompt = serializePayload(request.payload);
    const outputContract = request.outputContract ?? request.schema ?? (typeof request.payload === "object" ? request.payload.outputSchema : undefined);
    let prompt = originalPrompt;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const { text } = await requestStructuredText(
            config,
            {
                messages: [
                    ...(request.systemPrompt ? [{ role: "system" as const, content: request.systemPrompt }] : []),
                    userMessage(prompt, request.images),
                ],
                schemaName: request.schemaName,
                schema: request.schema,
                temperature: attempt > 1 && request.retryTemperature !== undefined ? request.retryTemperature : request.temperature,
                maxOutputTokens: request.maxOutputTokens,
                onDelta: request.onDelta,
            },
            { signal: request.signal },
        );
        try {
            const result = request.parse(parseStrictJson(text), text);
            request.onAttempt?.({ attempt, prompt, response: text });
            return { result, raw: text };
        } catch (error) {
            lastError = error;
            request.onAttempt?.({ attempt, prompt, response: text, error: error instanceof Error ? error.message : String(error) });
            prompt = buildRetryPrompt(originalPrompt, error, text, request.repairInstruction || "", outputContract);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function requestPlainText({ model, systemPrompt, prompt, temperature, maxOutputTokens, signal, onDelta }: { model: string; systemPrompt: string; prompt: string; temperature?: number; maxOutputTokens?: number; signal?: AbortSignal; onDelta?: (text: string) => void }) {
    const config = studioModelConfig(model);
    const { text } = await requestStructuredText(
        config,
        { messages: [...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []), { role: "user", content: prompt }], temperature, maxOutputTokens, onDelta, plain: true },
        { signal },
    );
    return text.trim();
}
