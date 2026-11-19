import { useCallback, useEffect, useRef, useState } from "react";

import { getStudioProject, saveStudioProject } from "./api";
import { backfillStudioMedia } from "./media";
import type { StudioDocumentBase, StudioProject } from "./types";

const SAVE_DELAY_MS = 1200;

const studioLive = new Map<string, StudioProject<StudioDocumentBase>>();
const studioLiveListeners = new Map<string, Set<(project: StudioProject<StudioDocumentBase>) => void>>();

function publishStudioLive<TDocument extends StudioDocumentBase>(project: StudioProject<TDocument>) {
    studioLive.set(project.id, project);
    studioLiveListeners.get(project.id)?.forEach((listener) => listener(project));
}

function subscribeStudioLive<TDocument extends StudioDocumentBase>(id: string, listener: (project: StudioProject<TDocument>) => void) {
    const bucket = studioLiveListeners.get(id) ?? new Set();
    const wrapped = listener as (project: StudioProject<StudioDocumentBase>) => void;
    bucket.add(wrapped);
    studioLiveListeners.set(id, bucket);
    return () => {
        bucket.delete(wrapped);
    };
}

export type StudioProjectHandle<TDocument extends StudioDocumentBase> = {
    project: StudioProject<TDocument> | null;
    error: string;
    saving: boolean;
    getDocument: () => TDocument;
    update: (mutate: (document: TDocument) => TDocument) => TDocument;
    rename: (title: string) => void;
    flush: () => Promise<void>;
};

export function useStudioProject<TDocument extends StudioDocumentBase>(id: string | undefined): StudioProjectHandle<TDocument> {
    const [project, setProject] = useState<StudioProject<TDocument> | null>(null);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const latestRef = useRef<StudioProject<TDocument> | null>(null);
    const timerRef = useRef<number | undefined>(undefined);
    const dirtyRef = useRef<{ title?: string; document?: TDocument }>({});

    const flush = useCallback(async () => {
        window.clearTimeout(timerRef.current);
        const current = latestRef.current;
        const patch = dirtyRef.current;
        if (!current || (!patch.title && !patch.document)) return;
        dirtyRef.current = {};
        setSaving(true);
        try {
            await saveStudioProject(current.id, patch);
            setError("");
        } catch (saveError) {
            dirtyRef.current = { ...patch, ...dirtyRef.current };
            setError(saveError instanceof Error ? saveError.message : "保存失败");
        } finally {
            setSaving(false);
        }
    }, []);

    const schedule = useCallback(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    }, [flush]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        getStudioProject<TDocument>(id)
            .then((loaded) => {
                if (cancelled) return;
                const live = studioLive.get(id) as StudioProject<TDocument> | undefined;
                const chosen = live && live.updatedAt >= loaded.updatedAt ? live : loaded;
                latestRef.current = chosen;
                if (chosen === loaded) publishStudioLive(chosen);
                setProject(chosen);
                void backfillStudioMedia(chosen.document);
            })
            .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "读取项目失败"));
        return () => {
            cancelled = true;
        };
    }, [id]);

    useEffect(() => {
        if (!id) return;
        return subscribeStudioLive<TDocument>(id, (next) => {
            latestRef.current = next;
            setProject(next);
        });
    }, [id]);

    useEffect(() => {
        const beforeUnload = () => void flush();
        window.addEventListener("beforeunload", beforeUnload);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            void flush();
        };
    }, [flush]);

    const getDocument = useCallback(() => {
        const current = (id ? (studioLive.get(id) as StudioProject<TDocument> | undefined) : undefined) ?? latestRef.current;
        if (!current) throw new Error("项目尚未加载");
        return current.document;
    }, [id]);

    const update = useCallback(
        (mutate: (document: TDocument) => TDocument) => {
            const current = (id ? (studioLive.get(id) as StudioProject<TDocument> | undefined) : undefined) ?? latestRef.current;
            if (!current) throw new Error("项目尚未加载");
            const document = mutate(current.document);
            const next = { ...current, document, meta: document.meta, updatedAt: new Date().toISOString() };
            latestRef.current = next;
            publishStudioLive(next);
            setProject(next);
            dirtyRef.current.document = document;
            schedule();
            return document;
        },
        [id, schedule],
    );

    const rename = useCallback(
        (title: string) => {
            const current = latestRef.current;
            if (!current) return;
            const next = { ...current, title };
            latestRef.current = next;
            setProject(next);
            dirtyRef.current.title = title;
            schedule();
        },
        [schedule],
    );

    return { project, error, saving, getDocument, update, rename, flush };
}
