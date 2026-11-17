import { authorizedFetch, readDetail, readableError } from "@/services/api/canvas-channels";

import type { StudioDocumentBase, StudioKind, StudioProject, StudioProjectSummary } from "./types";

const BASE = "/api-proxy/studio-projects";

async function ensureOk(response: Response, fallback: string) {
    if (response.ok) return response;
    const detail = await readDetail(response);
    if (response.status === 403) throw new Error("没有使用画布工作室的权限，请联系管理员在角色权限里开通「使用画布工作室」");
    throw new Error(readableError(detail, fallback));
}

export async function listStudioProjects(kind: StudioKind) {
    const response = await ensureOk(await authorizedFetch(`${BASE}?kind=${kind}`), "读取项目列表失败");
    const payload = (await response.json()) as { projects?: StudioProjectSummary[] };
    return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function getStudioProject<TDocument extends StudioDocumentBase>(id: string) {
    const response = await ensureOk(await authorizedFetch(`${BASE}/${encodeURIComponent(id)}`), "读取项目失败");
    return (await response.json()) as StudioProject<TDocument>;
}

export async function createStudioProject<TDocument extends StudioDocumentBase>(kind: StudioKind, title: string, document: TDocument) {
    const response = await ensureOk(
        await authorizedFetch(BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, title, document }),
        }),
        "新建项目失败",
    );
    return (await response.json()) as StudioProject<TDocument>;
}

export async function saveStudioProject(id: string, patch: { title?: string; document?: StudioDocumentBase }) {
    const response = await ensureOk(
        await authorizedFetch(`${BASE}/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        }),
        "保存项目失败",
    );
    return (await response.json()) as StudioProjectSummary;
}

export async function deleteStudioProject(id: string) {
    await ensureOk(await authorizedFetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }), "删除项目失败");
}
