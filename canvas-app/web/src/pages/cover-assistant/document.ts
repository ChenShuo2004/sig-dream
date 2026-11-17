import { nanoid } from "nanoid";

export type CoverTaskStatus = "idle" | "uploading" | "pending" | "running" | "done" | "failed";
export type CoverTtsEngine = "indextts" | "voicestudio";

/** Use original separated vocals as the voice reference (no uploaded timbre). */
export const ORIGINAL_VOICE_REF = "__original__";

export type CoverLine = {
    id: string;
    startSec: number;
    endSec: number;
    text: string;
    translation?: string;
    /** Uploaded ref id, or ORIGINAL_VOICE_REF / empty for original vocals. */
    voiceAudioId?: string;
    audioKey?: string;
    status?: CoverTaskStatus;
    error?: string;
};

export type CoverRef = { id: string; name: string; key: string; durationSec: number };

export type CoverSeparation = {
    status: CoverTaskStatus;
    message?: string;
    error?: string;
    jobId?: string;
    vocalsKey?: string;
    backgroundKey?: string;
};

export type CoverDocument = {
    version: 1;
    projectId: string;
    source: {
        fileName: string;
        audioKey: string;
        durationSec: number;
        separation?: CoverSeparation;
    } | null;
    refs: CoverRef[];
    lines: CoverLine[];
    settings: { ttsEngine: CoverTtsEngine; asrModel: string; asrLanguage: string; bedVolume: number };
};

const STORAGE_KEY = "cover-assistant-document-v1";

export function createCoverDocument(): CoverDocument {
    return {
        version: 1,
        projectId: nanoid(12),
        source: null,
        refs: [],
        lines: [],
        settings: { ttsEngine: "indextts", asrModel: "whisper-1", asrLanguage: "", bedVolume: 1 },
    };
}

const ACTIVE_STATUSES = new Set<CoverTaskStatus>(["uploading", "pending", "running"]);

/** Drop in-flight badges after refresh / crash — no live runner owns them. */
function sanitizeLoadedDocument(doc: CoverDocument): CoverDocument {
    const lines = doc.lines.map((line) =>
        ACTIVE_STATUSES.has(line.status || "idle") ? { ...line, status: "idle" as const, error: undefined } : line,
    );
    let source = doc.source;
    if (source?.separation && ACTIVE_STATUSES.has(source.separation.status)) {
        const sep = source.separation;
        source = {
            ...source,
            separation: sep.vocalsKey
                ? { ...sep, status: "done", message: sep.message || "已分离人声和伴奏", error: undefined }
                : undefined,
        };
    }
    return { ...doc, lines, source };
}

export function loadCoverDocument(): CoverDocument {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return createCoverDocument();
        const parsed = JSON.parse(raw) as CoverDocument;
        if (!parsed?.version || !parsed.projectId) return createCoverDocument();
        return sanitizeLoadedDocument({
            ...createCoverDocument(),
            ...parsed,
            settings: { ...createCoverDocument().settings, ...(parsed.settings || {}) },
            refs: Array.isArray(parsed.refs) ? parsed.refs : [],
            lines: Array.isArray(parsed.lines) ? parsed.lines : [],
            source: parsed.source || null,
        });
    } catch {
        return createCoverDocument();
    }
}

export function saveCoverDocument(document: CoverDocument) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}
