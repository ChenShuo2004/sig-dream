import localforage from "localforage";
import { nanoid } from "nanoid";

import type { StudioDocumentBase, StudioKind, StudioProject, StudioProjectSummary } from "./types";

const store = localforage.createInstance({
    name: "sig-dream-studios",
    storeName: "projects",
});

function toSummary(project: StudioProject<StudioDocumentBase>): StudioProjectSummary {
    return {
        id: project.id,
        kind: project.kind,
        title: project.title,
        meta: project.document?.meta || project.meta || {},
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

export async function listStudioProjects(kind: StudioKind): Promise<StudioProjectSummary[]> {
    const items: StudioProject<StudioDocumentBase>[] = [];
    await store.iterate<StudioProject<StudioDocumentBase>, void>((value) => {
        if (value && value.kind === kind) items.push(value);
    });
    items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return items.map(toSummary);
}

export async function getStudioProject<TDocument extends StudioDocumentBase>(id: string): Promise<StudioProject<TDocument>> {
    const item = await store.getItem<StudioProject<TDocument>>(id);
    if (!item) throw new Error("项目不存在或已删除");
    return item;
}

export async function createStudioProject<TDocument extends StudioDocumentBase>(kind: StudioKind, title: string, document: TDocument): Promise<StudioProject<TDocument>> {
    const now = new Date().toISOString();
    const project: StudioProject<TDocument> = {
        id: nanoid(),
        kind,
        title: title.trim() || "未命名项目",
        meta: document.meta || {},
        createdAt: now,
        updatedAt: now,
        document,
    };
    await store.setItem(project.id, project);
    return project;
}

export async function saveStudioProject(id: string, patch: { title?: string; document?: StudioDocumentBase }): Promise<StudioProjectSummary> {
    const existing = await store.getItem<StudioProject<StudioDocumentBase>>(id);
    if (!existing) throw new Error("项目不存在或已删除");
    const nextDoc = patch.document !== undefined ? patch.document : existing.document;
    const updated: StudioProject<StudioDocumentBase> = {
        ...existing,
        title: patch.title !== undefined ? patch.title : existing.title,
        document: nextDoc,
        meta: nextDoc?.meta || existing.meta || {},
        updatedAt: new Date().toISOString(),
    };
    await store.setItem(id, updated);
    return toSummary(updated);
}

export async function deleteStudioProject(id: string): Promise<void> {
    await store.removeItem(id);
}
